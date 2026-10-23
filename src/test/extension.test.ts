import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { saveSnapshotInWorkspace } from '../commands/saveSnapshot';
import { SHADOW_REPO_BASE_PATH } from '../utils/constants';
import { generateRepoIdentifier } from '../utils/hashUtils';

// コマンド登録と activate を含めた VS Code 側の経路を通す。サービス単体のユニットテスト
// （out/test/unit）はコマンド配線を見ないので、ここで実拡張を activate して叩く。
// ウィンドウのワークスペースは差し替えない（ヘッドレスの拡張ホストでは
// updateWorkspaceFolders が反映されない）ので、保存処理はパス指定で直接呼ぶ。
suite('Extension commands', () => {
  let tempDir: string;
  let shadowRepo: string;

  const git = (cwd: string, args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  const assertShadowRepoExists = async (): Promise<void> => {
    const exists = await fs.access(shadowRepo).then(() => true).catch(() => false);
    assert.ok(exists, `the snapshot command did not create ${shadowRepo}`);
  };

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-checkpoints-cmd-'));
    git(tempDir, ['init', '-q', '-b', 'main', '.']);
    git(tempDir, ['config', 'user.email', 'test@test.com']);
    git(tempDir, ['config', 'user.name', 'Test User']);
    await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
    git(tempDir, ['add', '-A']);
    git(tempDir, ['commit', '-qm', 'init']);

    // remote が無いのでスクリプトと同じく toplevel パスでシャドウリポジトリが決まる
    const toplevel = git(tempDir, ['rev-parse', '--show-toplevel']);
    shadowRepo = path.join(SHADOW_REPO_BASE_PATH, generateRepoIdentifier(null, toplevel));
  });

  teardown(async () => {
    await fs.rm(shadowRepo, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('registers the checkpoint commands on activation', async () => {
    const extension = vscode.extensions.getExtension('kururu6966.work-checkpoints');
    assert.ok(extension, 'the extension under test is not loaded');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'work-checkpoints.saveSnapshot',
      'work-checkpoints.restoreSnapshot',
      'work-checkpoints.showFileDiff',
      'work-checkpoints.groupByBranch',
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  test('saves a checkpoint on a per-branch ref', async () => {
    await saveSnapshotInWorkspace(tempDir);
    await assertShadowRepoExists();

    const ref = git(shadowRepo, ['rev-parse', '--verify', 'refs/checkpoints/main']);
    assert.strictEqual(ref.length, 40);

    // 一覧（git log --all）からも同じコミットが見える
    const listed = git(shadowRepo, ['log', '--all', '--format=%H']);
    assert.ok(listed.includes(ref), 'the new checkpoint should be listed');
  });

  test('skips when nothing changed', async () => {
    await saveSnapshotInWorkspace(tempDir);
    await saveSnapshotInWorkspace(tempDir);
    await assertShadowRepoExists();

    const count = git(shadowRepo, ['rev-list', '--count', '--all']);
    assert.strictEqual(count, '1');
  });
});
