# 拡張に [Codex] / [OpenCode] を認識させ、Claude/Codex スクリプトのズレをテストで止める

## Context

VS Code 拡張は AI エージェントが作ったスナップショットを `[Claude]` だけで判定している
（`src/services/shadowGitService.ts:755-756,771-772`）。Codex / OpenCode のコミット
（`[Codex] main @ …`、`[OpenCode] main @ …`。`codex-plugin/scripts/save-checkpoint.sh:285`、
`opencode-plugin/work-checkpoints.ts:369`）は `Branch:` トレーラーを持たないため旧形式として解析され:

- `isClaudeCreated` が false → 「Hide Claude Snapshots」で隠れず、「Delete Claude Snapshots」の対象外
- `branchName` が `[Codex] main` になり、ブランチでグループ化すると `main` と別グループになる

また `claude-plugin/scripts/` と `codex-plugin/scripts/` の4本は名前違いのコピーで、片方だけ直すと黙ってズレる。
共通化はしない（Codex の `plugin add` はプラグインディレクトリだけをコピーするので `../` 参照が壊れる。memory: codex-plugin-mechanics）。

PR #24（1.4.0 リリース）より先にマージし、1.4.0 に含める。この PR では version を上げない。

## 決定事項（ユーザー承認済み）

- コマンド ID（`work-checkpoints.showClaudeSnapshots` / `hideClaudeSnapshots` / `deleteClaudeSnapshots`）、
  context key `workCheckpoints.showClaudeSnapshots`、globalState キーは変えない。
  変えるとユーザーのキーバインドと保存済みのトグル状態が失われる。変えるのは表示文言と内部名だけ

## 変更

### 1. 判定の一般化 — `src/services/shadowGitService.ts`

2箇所の重複を1つの関数にまとめる:

```ts
const AGENT_PREFIX = /^\[(Claude|Codex|OpenCode)\]\s*/i;

const parseAgentBranch = (originalBranch: string) => ({
  isAgentCreated: AGENT_PREFIX.test(originalBranch),
  branchName: originalBranch.replace(AGENT_PREFIX, ''),
});
```

末尾の unknown-format フォールバック（`:791` の `isClaudeCreated: false`）も `isAgentCreated: false` にする。
strip 側も `i` 付きにそろえる（現状は test が `i`、replace が大文字小文字区別で食い違っている）。

### 2. `isClaudeCreated` → `isAgentCreated`

- `src/types/index.ts:7`
- `src/commands/deleteSnapshots.ts:88-133`（関数名 `deleteClaudeSnapshots` → `deleteAgentSnapshots`、変数名、メッセージ文言を "agent snapshot(s)" に）
- `src/views/snapshotTreeProvider.ts:165,189-196,251,276-278`（`showClaudeSnapshots` → `showAgentSnapshots`、`setShowClaudeSnapshots` → `setShowAgentSnapshots`、`isShowingClaudeSnapshots` → `isShowingAgentSnapshots`）
- `src/extension.ts:6,54-59,184-199` の呼び出し側（コマンド ID・context key・globalState キーの文字列はそのまま）

### 3. 表示文言 — `package.json:130,135,145`

- `Show Claude Snapshots` → `Show Agent Snapshots`
- `Hide Claude Snapshots` → `Hide Agent Snapshots`
- `Delete Claude Snapshots` → `Delete Agent Snapshots`

README（`README.md:20,65-68,90-92`）も同じ文言にし、「Claude Code / Codex CLI / OpenCode が作ったスナップショット」と明記する。
CHANGELOG `[Unreleased]` の `### Changed` に書く（`### Fixed` ではなく）。
「Delete Agent Snapshots」は確認が件数だけの一括削除なので、Codex / OpenCode 分まで消える範囲拡大と、
既存の Codex / OpenCode スナップショットが Hide の対象に入ることを明記する（レビュー指摘）。

### 4. テスト — `src/test/unit/shadowGitService.test.ts:203-232`

- 既存3件の `isClaudeCreated` を `isAgentCreated` に
- 追加: `[Codex] main` と `[OpenCode] main`（`Branch:` トレーラー無しの旧形式経路）で `branchName === 'main'` かつ `isAgentCreated === true`

`createSnapshot('[Codex] main')`（説明なし）が旧形式 `"<branch> @ <date>"` で保存されることを実装で確認してから書く。

### 5. スクリプトのズレ検査 — `src/test/unit/pluginManifests.test.ts`

既存の配布物ドリフト検査（`:5-7` の目的、`:123-135` の version 検査）と同じ場所に1テスト足す:

```ts
test('claude-plugin and codex-plugin ship the same scripts apart from the agent name', async () => {
  const normalize = (text: string, agent: 'Claude' | 'Codex') =>
    text
      .replaceAll(agent, 'AGENT')
      .replaceAll(agent.toLowerCase(), 'agent')
      .split('\n')
      .filter((line) => !/^\s*#(?!!)/.test(line)) // コメントは除外（shebang は残す）
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n');

  const claudeScripts = (await fs.readdir(path.join(REPO_ROOT, 'claude-plugin/scripts'))).sort();
  const codexScripts = (await fs.readdir(path.join(REPO_ROOT, 'codex-plugin/scripts'))).sort();
  assert.deepStrictEqual(codexScripts, claudeScripts);

  for (const script of claudeScripts) { /* normalize して strictEqual */ }
});
```

- 空白の正規化は必要: `delete-checkpoints.sh:6,277` が名前の長さ違いで桁揃えがずれている
- コメント除外は必要: `codex-plugin/scripts/save-checkpoint.sh:7` に Codex 固有のコメントが1行ある
- 名前を置換した後の差分がこの2種類だけであることは確認済み

## 検証

1. `npm run compile && npm run lint && npm test`
2. 追加したスクリプト比較テストが、片方のスクリプトに1行足すと落ちることを確認
3. 拡張を dev channel（`npm run dev:on`）で入れ、既存の `[Codex]` / `[OpenCode]` スナップショットがあるリポジトリで
   Hide Agent Snapshots で隠れること、ブランチグループで `main` にまとまることを確認（可能なら）

## スコープ外

- `delete-checkpoints.sh --claude/--codex` が他エージェント分を黙ってスキップする件（memory: tech-debt-codex-plugin #2,#3）
- #24 の CI ステップ "Check version sync" を `pluginManifests.test.ts` に統合する件は #24 側で行う
