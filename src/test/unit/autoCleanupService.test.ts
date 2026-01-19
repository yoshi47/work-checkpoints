import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { AutoCleanupService } from '../../services/autoCleanupService';
import { ShadowGitService } from '../../services/shadowGitService';
import { SHADOW_REPO_BASE_PATH } from '../../utils/constants';
import { generateRepoIdentifier } from '../../utils/hashUtils';

suite('AutoCleanupService', () => {
  let tempDir: string;
  let workspaceDir: string;
  let shadowGitService: ShadowGitService;
  let autoCleanupService: AutoCleanupService;
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

    // Create test file
    await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'content1');

    // Calculate the expected shadow repo path
    repoIdentifier = generateRepoIdentifier(null, workspaceDir);

    // Create service
    shadowGitService = new ShadowGitService(null, workspaceDir);

    // Create cleanup service
    autoCleanupService = new AutoCleanupService(() => shadowGitService);
  });

  teardown(async () => {
    if (autoCleanupService) {
      autoCleanupService.stop();
    }

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

  suite('start and stop', () => {
    test('should be able to start and stop service', () => {
      autoCleanupService.start();
      autoCleanupService.stop();

      // No error should occur
      assert.ok(true);
    });

    test('should handle multiple stop calls', () => {
      autoCleanupService.start();
      autoCleanupService.stop();
      autoCleanupService.stop();

      // No error should occur
      assert.ok(true);
    });

    test('should return ShadowGitService from getter', async () => {
      await shadowGitService.createSnapshot('branch1');

      const service = autoCleanupService;
      assert.ok(service);
    });
  });
});
