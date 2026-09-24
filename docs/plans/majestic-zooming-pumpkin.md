# OpenCode v2 プラグイン API への移行

## Context

OpenCode v2 では v1 のプラグイン実装が動かない（"V1 plugin implementations do not run in V2" — https://opencode.ai/v2/docs/migrate-v1/#plugins ）。
手元の OpenCode は既に v2.0.11（`/opt/homebrew/Cellar/opencode-v2/2.0.11`）なので、`opencode-plugin/work-checkpoints.ts` は現状ロードされず、自動チェックポイントも list/restore ツールも死んでいる。
ゴールは、同じシャドウリポジトリ互換の挙動（prompt ごとの自動保存・list・restore）を v2 API で取り戻すこと。

方針: v1 実装を v2 実装で置き換える（dual export はしない）。v1 を残す理由は「外部利用者が v1 に留まる」だけで、ファイルコピー配布なので v1 利用者は旧タグのファイルを使えば足りる。

## 確認済みの v2 API（`@opencode/plugin@2.0.15` の型定義）

- エントリ: `export default Plugin.define({ id, setup(ctx) })`。`define` は恒等関数（`dist/promise/plugin.js`）
- `ctx.location.directory`: v1 の `worktree` の代替（`@opencode/schema/dist/location.d.ts:6`）
- v1 注入の `$` は廃止。ランタイムは Bun（バイナリに `Bun v1.4.2`）なので `import { $ } from "bun"` で置換できる
- `chat.message` → `ctx.session.hook("prompt", (e) => …)`。本文は `e.prompt.text`（`dist/promise/session.d.ts:13-19`）
- ツール登録: `ctx.tool.transform((editor) => editor.add({ name, description, input: JSONSchema, execute, options }))`（`dist/promise/tool.d.ts`）
- `execute` の戻り値は `{ content: string }`（`@opencode/schema/dist/tool.d.ts:66-68`）
- `Tool.Context` に v1 の `ask` は無い（`schema/dist/tool.d.ts:10-16`）。代わりに `options.permission?: string` で権限アクションを宣言する（同 `:21-24`）。ルール未一致時の既定は `ask`（https://opencode.ai/v2/docs/permissions/ ）
- ローカルプラグインの依存は自動インストールされない → `@opencode/plugin` は `import type` のみにして実行時依存をゼロにする

## 変更内容

### 1. `opencode-plugin/work-checkpoints.ts`

ロジック（`getShadowRepo` / `initShadowRepo` / lock 待ち / retry / `readConfig` / `formatDate` / list 本体 / restore 本体）はそのまま。差し替えるのは外枠だけ。

```ts
import { $ } from "bun"
import type { Plugin } from "@opencode/plugin"

const plugin: Plugin.Plugin = {
  id: "work-checkpoints",
  async setup(ctx) {
    const worktree = ctx.location.directory
    // …既存ヘルパー群（$ は import 版をそのまま使う）…

    await ctx.session.hook("prompt", async (event) => {
      try {
        // 既存 chat.message 本体。promptText の取得元だけ変更:
        const promptText = event.prompt.text?.substring(0, 500) || ""
        // …
      } catch {
        // Never break the session due to checkpoint failure
      }
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "list_checkpoints",
        description: "List all work checkpoints (snapshots saved on each user message)",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: await listCheckpoints() }),
      })
      editor.add({
        name: "restore_checkpoint",
        description: "Restore workspace files to a specific checkpoint",
        input: {
          type: "object",
          properties: {
            checkpoint_id: { type: "string", description: "Checkpoint commit ID (short hash from list_checkpoints)" },
          },
          required: ["checkpoint_id"],
          additionalProperties: false,
        },
        options: { permission: "restore_checkpoint" },
        // JSON Schema 入力は InputValue<S> が unknown に落ちる（schema/dist/tool.d.ts:32-33）
        execute: async (input) => ({
          content: await restoreCheckpoint((input as { checkpoint_id: string }).checkpoint_id),
        }),
      })
    })
  },
}

export default plugin
```

- `listCheckpoints()` / `restoreCheckpoint(id)` は既存 `execute` 本体を `setup` 内のローカル関数に移しただけ（string を返す）
- restore から `context.ask(...)` を削除。確認は `options.permission` による権限プロンプトに移る
- `setup` は hook/transform の `Registration` を返さない（プラグイン unload 時はホストが破棄する前提。検証 4 で確認）
- ヘッダコメントのインストール先を `plugins/`（複数形）に更新

### 2. `README.md`（`## OpenCode Plugin` 節 :204-231）

- コピー先: `~/.config/opencode/plugins/` / `.opencode/plugins/`
- Features: `chat.message` → `session prompt hook`
- Requirements: OpenCode v2 以降。`@opencode-ai/plugin` の記述は削除（実行時依存なし）
- v1 利用者向けに「v1 は 1.3.1 タグのファイルを使う」1行
- restore の確認プロンプトを常に出したい場合の権限設定例（検証 3 の結果次第）:
  ```jsonc
  { "permissions": [{ "action": "restore_checkpoint", "effect": "ask" }] }
  ```

### 3. `CHANGELOG.md` `[Unreleased]` → `### Changed`

OpenCode プラグインを v2 API に移行した旨、インストール先が `plugins/` になった旨、v1 非対応になった旨。

### 型チェック

`tsconfig.json` は `opencode-plugin` を exclude 済みでリポジトリに依存追加もしない。
型検証は scratchpad に実機と同じ `@opencode/plugin@2.0.11` と `bun-types` を入れて `tsc --noEmit --strict` で一度だけ行う（リポジトリには残さない）。エラーが出たら本体を直してから実機検証に進む。
API 調査は 2.0.15 の型で行ったため、2.0.11 との差分もこの型チェックで拾う。

## 検証（実機 opencode v2.0.11）

1. `~/.config/opencode/plugins/work-checkpoints.ts` にコピー（旧 `plugin/work-checkpoints.ts` は v1 版なので退避）。`opencode` 起動後、プラグイン一覧に `work-checkpoints` が出ること
2. 任意の git リポジトリで prompt を送り、`git -C ~/.work-checkpoints/<id> log -1` に `[OpenCode] <branch> @ <date>` + prompt 本文が入ること
3. 「restore_checkpoint で <id> に戻して」と依頼し、TUI に承認プロンプトが出るか目視確認。出ない（allow 扱い）なら README の権限設定例を「必須」として記載、出るなら「任意」
4. `list_checkpoints` が既存の VSCode / Claude Code のチェックポイントも含めて一覧すること
5. restore 後にファイルが戻ること
6. プラグインファイルを外して再起動し、エラーなく起動すること（hook の後始末をホストに任せてよいかの確認）

## 未確定事項

- `options.permission` にカスタムアクション名を渡したときの既定挙動（ask か allow か）はドキュメントで確定できず、検証 3 で決める
