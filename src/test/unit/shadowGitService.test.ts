import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { ShadowGitService } from '../../services/shadowGitService';
import { SHADOW_REPO_BASE_PATH } from '../../utils/constants';
import { generateRepoIdentifier } from '../../utils/hashUtils';

suite('ShadowGitService', () => {
  let tempDir: string;
  let workspaceDir: string;
  let shadowGitService: ShadowGitService;
  let repoIdentifier: string;

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-checkpoints-test-'));
    workspaceDir = path.join(tempDir, 'workspace');

    // Create a mock workspace with git
    await fs.mkdir(workspaceDir, { recursive: true });
    const git = simpleGit(workspaceDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');

    // Create test files
    await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content1');
    await fs.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'src', 'index.ts'), 'console.log("hello")');

    // Calculate the expected shadow repo path
    repoIdentifier = generateRepoIdentifier(null, workspaceDir);

    // Create service
    shadowGitService = new ShadowGitService(null, workspaceDir);
  });

  teardown(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Clean up shadow repo if created
    const shadowRepoPath = path.join(SHADOW_REPO_BASE_PATH, repoIdentifier);
    try {
      await fs.rm(shadowRepoPath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  suite('shadowRepoPath', () => {
    test('should return correct shadow repo path', () => {
      const expectedPath = path.join(SHADOW_REPO_BASE_PATH, repoIdentifier);
      assert.strictEqual(shadowGitService.shadowRepoPath, expectedPath);
    });
  });

  suite('initializeIfNeeded', () => {
    test('should create shadow repo directory and initialize git', async () => {
      await shadowGitService.initializeIfNeeded();

      const shadowRepoPath = shadowGitService.shadowRepoPath;
      const gitDirExists = await fs
        .access(path.join(shadowRepoPath, '.git'))
        .then(() => true)
        .catch(() => false);

      assert.strictEqual(gitDirExists, true);
    });

    test('should not reinitialize if already exists', async () => {
      await shadowGitService.initializeIfNeeded();

      // Create a file to verify it's not wiped
      const markerPath = path.join(shadowGitService.shadowRepoPath, 'marker.txt');
      await fs.writeFile(markerPath, 'marker');

      await shadowGitService.initializeIfNeeded();

      const markerExists = await fs
        .access(markerPath)
        .then(() => true)
        .catch(() => false);

      assert.strictEqual(markerExists, true);
    });
  });

  suite('createSnapshot', () => {
    test('should create a snapshot with correct metadata', async () => {
      const snapshot = await shadowGitService.createSnapshot('main');

      assert.ok(snapshot.id);
      assert.strictEqual(snapshot.id.length, 7);
      assert.strictEqual(snapshot.branchName, 'main');
      assert.ok(snapshot.timestamp instanceof Date);
      assert.ok(snapshot.description.includes('main @'));
    });

    test('should track workspace files via core.worktree', async () => {
      await shadowGitService.createSnapshot('feature/test');

      // Verify that the snapshot includes workspace files
      const snapshotFiles = await shadowGitService.listSnapshots();
      assert.strictEqual(snapshotFiles.length, 1);

      const files = await shadowGitService.getSnapshotFiles(snapshotFiles[0].id);
      assert.ok(files.has('file1.txt'));
      assert.strictEqual(files.get('file1.txt')?.toString(), 'content1');
    });

    test('should create multiple snapshots', async () => {
      await shadowGitService.createSnapshot('main');

      // Modify file
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'modified content');

      await shadowGitService.createSnapshot('main');

      const snapshots = await shadowGitService.listSnapshots();
      assert.strictEqual(snapshots.length, 2);
    });

    test('should preserve branch name when using custom description', async () => {
      const customDescription = 'Fix critical bug';
      const snapshot = await shadowGitService.createSnapshot(
        'feature/my-branch',
        undefined,
        undefined,
        customDescription
      );

      assert.strictEqual(snapshot.branchName, 'feature/my-branch');
      assert.strictEqual(snapshot.description, customDescription);

      // Verify branch name is preserved when listing snapshots
      const snapshots = await shadowGitService.listSnapshots();
      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].branchName, 'feature/my-branch');
      assert.strictEqual(snapshots[0].description, customDescription);
    });

    test('should handle custom description without branch trailer in display', async () => {
      const customDescription = 'Add new feature';
      await shadowGitService.createSnapshot('develop', undefined, undefined, customDescription);

      const snapshots = await shadowGitService.listSnapshots();

      // Description should not contain the Branch: trailer
      assert.strictEqual(snapshots[0].description, customDescription);
      assert.ok(!snapshots[0].description.includes('Branch:'));
    });
  });

  suite('listSnapshots', () => {
    test('should return empty array when no snapshots exist', async () => {
      const snapshots = await shadowGitService.listSnapshots();

      assert.deepStrictEqual(snapshots, []);
    });

    test('should return snapshots in reverse chronological order', async () => {
      await shadowGitService.createSnapshot('branch1');

      // Modify file to create a new snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content2');
      await shadowGitService.createSnapshot('branch2');

      // Modify file again
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content3');
      await shadowGitService.createSnapshot('branch3');

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 3);
      assert.strictEqual(snapshots[0].branchName, 'branch3');
      assert.strictEqual(snapshots[1].branchName, 'branch2');
      assert.strictEqual(snapshots[2].branchName, 'branch1');
    });

    test('should strip [Claude] prefix from branch name', async () => {
      await shadowGitService.createSnapshot('[Claude] main');

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].branchName, 'main');
    });

    test('should strip [Claude] prefix from branch name with custom description', async () => {
      await shadowGitService.createSnapshot('[Claude] feature/test', undefined, undefined, 'Custom description');

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].branchName, 'feature/test');
      assert.strictEqual(snapshots[0].description, 'Custom description');
    });

    test('should not modify branch name without [Claude] prefix', async () => {
      await shadowGitService.createSnapshot('feature/normal-branch');

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].branchName, 'feature/normal-branch');
    });
  });

  suite('getSnapshotFiles', () => {
    test('should return files from a specific snapshot', async () => {
      const snapshot = await shadowGitService.createSnapshot('main');

      const snapshotFiles = await shadowGitService.getSnapshotFiles(snapshot.id);

      assert.strictEqual(snapshotFiles.size, 2);
      assert.strictEqual(snapshotFiles.get('file1.txt')?.toString(), 'content1');
      assert.strictEqual(
        snapshotFiles.get(path.join('src', 'index.ts'))?.toString(),
        'console.log("hello")'
      );
    });

    test('should return correct files for older snapshot', async () => {
      const snapshot1 = await shadowGitService.createSnapshot('main');

      // Modify file and create new snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'modified');
      await shadowGitService.createSnapshot('main');

      // Get files from first snapshot
      const snapshotFiles = await shadowGitService.getSnapshotFiles(snapshot1.id);

      assert.strictEqual(snapshotFiles.get('file1.txt')?.toString(), 'content1');
    });
  });

  suite('deleteSnapshot', () => {
    test('should remove snapshot from list after deletion', async () => {
      const snapshot1 = await shadowGitService.createSnapshot('branch1');

      // Modify file for second snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content2');
      const snapshot2 = await shadowGitService.createSnapshot('branch2');

      // Modify file for third snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content3');
      const snapshot3 = await shadowGitService.createSnapshot('branch3');

      // Delete the middle snapshot
      await shadowGitService.deleteSnapshot(snapshot2.id);

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 2);
      assert.ok(snapshots.some((s) => s.id === snapshot1.id));
      assert.ok(snapshots.some((s) => s.id === snapshot3.id));
      assert.ok(!snapshots.some((s) => s.id === snapshot2.id));
    });

    test('should be able to delete multiple snapshots', async () => {
      const snapshot1 = await shadowGitService.createSnapshot('branch1');

      // Modify file for second snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content2');
      const snapshot2 = await shadowGitService.createSnapshot('branch2');

      // Modify file for third snapshot
      await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content3');
      const snapshot3 = await shadowGitService.createSnapshot('branch3');

      await shadowGitService.deleteSnapshot(snapshot1.id);
      await shadowGitService.deleteSnapshot(snapshot3.id);

      const snapshots = await shadowGitService.listSnapshots();

      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].id, snapshot2.id);
    });

    test('should still be able to restore deleted snapshot files', async () => {
      const snapshot = await shadowGitService.createSnapshot('main');
      await shadowGitService.deleteSnapshot(snapshot.id);

      // Even though deleted from list, files should still be accessible
      const snapshotFiles = await shadowGitService.getSnapshotFiles(snapshot.id);
      assert.strictEqual(snapshotFiles.get('file1.txt')?.toString(), 'content1');
    });
  });
});
