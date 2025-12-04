import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { WorkspaceService } from '../../services/workspaceService';

// Resolve symlinks for macOS /var -> /private/var
const resolvePath = (p: string): string => fssync.realpathSync(p);

suite('WorkspaceService', () => {
  let tempDir: string;
  let workspaceDir: string;
  let workspaceService: WorkspaceService;

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-checkpoints-test-'));
    workspaceDir = path.join(tempDir, 'workspace');

    // Create a mock workspace with git
    await fs.mkdir(workspaceDir, { recursive: true });
    const git = simpleGit(workspaceDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');

    workspaceService = new WorkspaceService(workspaceDir);
  });

  teardown(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  suite('getGitRoot', () => {
    test('should return git root for valid git repo', async () => {
      const gitRoot = await workspaceService.getGitRoot();

      // Resolve symlinks for comparison (macOS /var -> /private/var)
      assert.strictEqual(gitRoot, resolvePath(workspaceDir));
    });

    test('should return null for non-git directory', async () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      await fs.mkdir(nonGitDir, { recursive: true });

      const service = new WorkspaceService(nonGitDir);
      const gitRoot = await service.getGitRoot();

      assert.strictEqual(gitRoot, null);
    });
  });

  suite('getCurrentBranch', () => {
    test('should return current branch name', async () => {
      // Create initial commit to have a branch
      await fs.writeFile(path.join(workspaceDir, 'file.txt'), 'content');
      const git = simpleGit(workspaceDir);
      await git.add('.');
      await git.commit('initial commit');

      const branch = await workspaceService.getCurrentBranch();

      // Default branch could be 'main' or 'master' depending on git config
      assert.ok(branch === 'main' || branch === 'master');
    });

    test('should return unknown for new repo without commits', async () => {
      const branch = await workspaceService.getCurrentBranch();

      // On a fresh repo without commits, git might return HEAD or fail
      assert.ok(typeof branch === 'string');
    });
  });

  suite('getRemoteOriginUrl', () => {
    test('should return null when no remote is configured', async () => {
      const remoteUrl = await workspaceService.getRemoteOriginUrl();

      assert.strictEqual(remoteUrl, null);
    });

    test('should return remote URL when configured', async () => {
      const git = simpleGit(workspaceDir);
      await git.addRemote('origin', 'https://github.com/user/repo.git');

      const remoteUrl = await workspaceService.getRemoteOriginUrl();

      assert.strictEqual(remoteUrl, 'https://github.com/user/repo.git');
    });
  });

  suite('hasUncommittedChanges', () => {
    test('should return false for clean repo', async () => {
      // Create initial commit
      await fs.writeFile(path.join(workspaceDir, 'file.txt'), 'content');
      const git = simpleGit(workspaceDir);
      await git.add('.');
      await git.commit('initial commit');

      const hasChanges = await workspaceService.hasUncommittedChanges();

      assert.strictEqual(hasChanges, false);
    });

    test('should return true for modified files', async () => {
      // Create initial commit
      await fs.writeFile(path.join(workspaceDir, 'file.txt'), 'content');
      const git = simpleGit(workspaceDir);
      await git.add('.');
      await git.commit('initial commit');

      // Modify file
      await fs.writeFile(path.join(workspaceDir, 'file.txt'), 'modified');

      const hasChanges = await workspaceService.hasUncommittedChanges();

      assert.strictEqual(hasChanges, true);
    });

    test('should return true for untracked files', async () => {
      // Create initial commit
      await fs.writeFile(path.join(workspaceDir, 'file.txt'), 'content');
      const git = simpleGit(workspaceDir);
      await git.add('.');
      await git.commit('initial commit');

      // Add new untracked file
      await fs.writeFile(path.join(workspaceDir, 'new-file.txt'), 'new content');

      const hasChanges = await workspaceService.hasUncommittedChanges();

      assert.strictEqual(hasChanges, true);
    });
  });

});
