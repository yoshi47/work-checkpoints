import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { SHADOW_REPO_BASE_PATH } from '../utils/constants';
import { generateRepoIdentifier } from '../utils/hashUtils';

// コマンド登録と activate を含めた VS Code 側の経路を通す。サービス単体のユニットテスト
// （out/test/unit）はコマンド配線を見ないので、ここで workspaceFolders を差し替えて叩く。
suite('Extension commands', () => {
  let tempDir: string;
  let shadowRepo: string;

  const git = (cwd: string, args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  // updateWorkspaceFolders は適用が非同期で、直後にコマンドを叩くと空のウィンドウのまま
  // 実行されることがある（CI の Linux ランナーで実際に起きた）。フォルダが反映されるまで待つ。
  const waitForFolder = async (expected: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (current && path.resolve(current) === path.resolve(expected)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
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

    const added = vscode.workspace.updateWorkspaceFolders(0, null, {
      uri: vscode.Uri.file(tempDir),
      name: 'fixture',
    });
    assert.ok(added, 'could not open the fixture workspace in the test host');

    const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath);
    assert.ok(
      await waitForFolder(tempDir),
      `workspace folder was not applied: ${JSON.stringify(folders ?? null)}`
    );
  });

  teardown(async () => {
    vscode.workspace.updateWorkspaceFolders(0, null);
    await fs.rm(shadowRepo, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('saveSnapshot stores a checkpoint on a per-branch ref', async () => {
    await vscode.commands.executeCommand('work-checkpoints.saveSnapshot');

    const exists = await fs.access(shadowRepo).then(() => true).catch(() => false);
    assert.ok(exists, `the command did not create ${shadowRepo}`);

    const ref = git(shadowRepo, ['rev-parse', '--verify', 'refs/checkpoints/main']);
    assert.strictEqual(ref.length, 40);

    // 一覧（git log --all）からも同じコミットが見える
    const listed = git(shadowRepo, ['log', '--all', '--format=%H']);
    assert.ok(listed.includes(ref), 'the new checkpoint should be listed');
  });

  test('saveSnapshot skips when nothing changed', async () => {
    await vscode.commands.executeCommand('work-checkpoints.saveSnapshot');
    await vscode.commands.executeCommand('work-checkpoints.saveSnapshot');

    const exists = await fs.access(shadowRepo).then(() => true).catch(() => false);
    assert.ok(exists, `the command did not create ${shadowRepo}`);

    const count = git(shadowRepo, ['rev-list', '--count', '--all']);
    assert.strictEqual(count, '1');
  });
});
