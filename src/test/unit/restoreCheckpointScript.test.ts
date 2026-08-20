import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { generateRepoIdentifier } from '../../utils/hashUtils';

// restore-checkpoint.sh の worktree ガードは VS Code 拡張とは独立した実装（inode 比較、
// 再バインド失敗時の中断、未設定時の再バインド、環境変数による上書き）で、
// シェル用のテスト基盤はこのリポジトリに無い。スクリプトは HOME と cwd だけで
// シャドウリポジトリの位置を決めるので、その 2 つを差し替えれば Mocha から隔離実行できる。
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLAUDE_SCRIPT = path.join(REPO_ROOT, 'claude-plugin/scripts/restore-checkpoint.sh');
const CODEX_SCRIPT = path.join(REPO_ROOT, 'codex-plugin/scripts/restore-checkpoint.sh');

interface RunResult {
  status: number;
  stderr: string;
}

suite('restore-checkpoint.sh worktree guard', () => {
  let tempDir: string;
  let homeDir: string;
  let workspaceDir: string;
  let otherDir: string;
  let shadowRepo: string;
  let checkpointId: string;

  const git = (cwd: string, args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  const runScript = (env: NodeJS.ProcessEnv = {}): RunResult => {
    try {
      execFileSync('bash', [CLAUDE_SCRIPT, checkpointId], {
        cwd: workspaceDir,
        env: { ...process.env, HOME: homeDir, ...env },
        encoding: 'utf-8',
      });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { status: failure.status ?? -1, stderr: failure.stderr ?? '' };
    }
  };

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-checkpoints-script-'));
    homeDir = path.join(tempDir, 'home');
    workspaceDir = path.join(tempDir, 'workspace');
    otherDir = path.join(tempDir, 'other-workspace');
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(otherDir, { recursive: true });

    git(workspaceDir, ['init', '-q', '.']);
    git(workspaceDir, ['config', 'user.email', 'test@test.com']);
    git(workspaceDir, ['config', 'user.name', 'Test User']);
    await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'snapshot content');

    // remote が無いのでスクリプトは toplevel をハッシュする。git が返す実体パスで揃える。
    const toplevel = git(workspaceDir, ['rev-parse', '--show-toplevel']);
    shadowRepo = path.join(homeDir, '.work-checkpoints', generateRepoIdentifier(null, toplevel));
    await fs.mkdir(shadowRepo, { recursive: true });
    git(shadowRepo, ['init', '-q', '.']);
    git(shadowRepo, ['config', 'user.email', 'test@test.com']);
    git(shadowRepo, ['config', 'user.name', 'Test User']);
    git(shadowRepo, ['config', 'core.worktree', toplevel]);
    git(shadowRepo, ['add', '-A']);
    git(shadowRepo, ['commit', '-qm', 'snapshot']);
    checkpointId = git(shadowRepo, ['rev-parse', '--short', 'HEAD']);

    await fs.writeFile(path.join(workspaceDir, 'file1.txt'), 'work in progress');
  });

  teardown(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('should refuse to restore into a workspace the repository does not track', async () => {
    git(shadowRepo, ['config', 'core.worktree', otherDir]);
    await fs.writeFile(path.join(otherDir, 'file1.txt'), 'other workspace content');

    const result = runScript();

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /last tracked a different workspace/);

    // 拒否した側だけでなく、追跡先も壊していないこと
    assert.strictEqual(
      await fs.readFile(path.join(workspaceDir, 'file1.txt'), 'utf-8'),
      'work in progress'
    );
    assert.strictEqual(
      await fs.readFile(path.join(otherDir, 'file1.txt'), 'utf-8'),
      'other workspace content'
    );
  });

  test('should record the refusal in checkpoint.log', async () => {
    git(shadowRepo, ['config', 'core.worktree', otherDir]);

    runScript();

    const log = await fs.readFile(path.join(shadowRepo, 'checkpoint.log'), 'utf-8');
    assert.match(log, /Refused to restore/);
  });

  test('should restore when WORK_CHECKPOINTS_FORCE_WORKTREE=1', async () => {
    git(shadowRepo, ['config', 'core.worktree', otherDir]);

    const result = runScript({ WORK_CHECKPOINTS_FORCE_WORKTREE: '1' });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(
      await fs.readFile(path.join(workspaceDir, 'file1.txt'), 'utf-8'),
      'snapshot content'
    );
  });

  test('should warn when the override is set to something other than 1', async () => {
    git(shadowRepo, ['config', 'core.worktree', otherDir]);

    const result = runScript({ WORK_CHECKPOINTS_FORCE_WORKTREE: 'true' });

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /only '1' disables the check/);
  });

  test('should rebind and restore when core.worktree is unset', async () => {
    // 未設定のまま checkout するとシャドウリポジトリ自身の中にファイルが展開され、
    // ワークスペースは何も変わらないのに成功として報告されてしまう。
    git(shadowRepo, ['config', '--unset', 'core.worktree']);

    const result = runScript();

    assert.strictEqual(result.status, 0);
    assert.strictEqual(
      await fs.readFile(path.join(workspaceDir, 'file1.txt'), 'utf-8'),
      'snapshot content'
    );

    const strayFile = await fs
      .access(path.join(shadowRepo, 'file1.txt'))
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(strayFile, false, 'checkout landed inside the shadow repository');
  });

  test('should keep the Claude and Codex copies identical', async () => {
    const [claude, codex] = await Promise.all([
      fs.readFile(CLAUDE_SCRIPT, 'utf-8'),
      fs.readFile(CODEX_SCRIPT, 'utf-8'),
    ]);
    assert.strictEqual(codex, claude);
  });
});
