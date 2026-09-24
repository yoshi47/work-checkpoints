# OpenCode プラグインを Git 指定でインストール可能にする

## Context

Claude Code / Codex CLI はこのリポジトリをマーケットプレイスとして `plugin add` で入れられるが、
OpenCode だけは `opencode-plugin/work-checkpoints.ts` を手でコピーする手順になっている（`README.md:210-221`）。
コピー方式は更新が追えず、実際に作者自身のグローバル版も v1 のまま止まっていた。

OpenCode v2 の `opencode plugin add` は npm と Git の指定を受け付ける。
マーケットプレイスの目録は無く、Git 指定では **リポジトリルートの `package.json` をプラグインパッケージとして扱う**。

## 実機検証の結果（opencode v2.0.11、隔離した XDG_* ディレクトリで実施）

| 検証 | 結果 |
|---|---|
| `github:yoshi47/work-checkpoints`（現状） | 取得は成功、`Plugin package has no server or TUI entrypoint` で失敗 |
| ルートに `exports["./server"]` を足したクローン + `git+file://…#vtest` | `installed and added to …/opencode.json` |
| 上記で `opencode run` | `loading plugin … entrypoint=…/opencode-plugin/work-checkpoints.ts`、`[OpenCode] main @ …` のチェックポイント作成を確認 |
| ルートの依存 | `dependencies` の `ignore` / `simple-git` と推移依存（`@kwsites/*`, `debug`, `ms`）だけが入る。devDependencies は入らない |
| `vsce package`（exports 追加後） | 成功、9 files / 53.2 KB。`.vscodeignore` の `**/*.ts` で opencode-plugin は同梱されない |
| `opencode plugin check` / `update` | Git 指定は対象外（`No package plugins found`） |
| タグなし指定の再起動・`remove`→`add` | キャッシュが再利用され、新しいコミットは取り込まれない |
| `#vtest` → `#vtest2` に付け替え | 新しいキャッシュが作られ、新しいコードが入る |
| コピー版と Git 版を同時に置く | 両方 `loading plugin` される。チェックポイントは1件（2回目は差分なしでスキップと推定） |
| プロジェクトの `.opencode/opencode.json` に `plugins: ["git+…#tag"]` を書く | `plugin add` なしで起動時にインストール・ロードされる |

結論: タグ固定で配り、更新は「旧タグを remove → 新タグを add」にする。
タグはリリース workflow が `v<version>` で自動作成している（`.github/workflows/release.yml:103-106`）。

## 変更

### 1. `package.json` に exports を追加

```json
"main": "./out/extension.js",
"exports": {
  "./server": "./opencode-plugin/work-checkpoints.ts"
},
```

VSCode 拡張は `main` を読むので影響なし（上記 vsce 検証）。

### 2. `README.md` の OpenCode Installation（`README.md:208-221`）を差し替え

```markdown
### Installation

Requires OpenCode v2.

​```bash
opencode plugin add github:yoshi47/work-checkpoints#v<version>
​```

Use the latest [release](https://github.com/yoshi47/work-checkpoints/releases) tag.
Pin a tag: OpenCode caches Git plugins at install time and `opencode plugin update` does not cover them.

To enable it for one project only, add it to `.opencode/opencode.json` instead:

​```json
{ "plugins": ["github:yoshi47/work-checkpoints#v<version>"] }
​```

#### Updating

​```bash
opencode plugin remove github:yoshi47/work-checkpoints#v<old>
opencode plugin add github:yoshi47/work-checkpoints#v<new>
​```

#### Migrating from the copied file

Delete `~/.config/opencode/plugins/work-checkpoints.ts` (or `.opencode/plugins/…`).
If both are present, OpenCode loads the plugin twice.

OpenCode v1 users should keep copying the file from the [`v1.3.1`](…) tag.
```

`<version>` をどう書くかは下の「未決事項」。

### 3. `opencode-plugin/work-checkpoints.ts` のヘッダ（1-20 行）

- `Installation:` を `opencode plugin add github:yoshi47/work-checkpoints#v<version>` に更新
- tech debt の解消: `@see https://github.com/kururu6966/work-checkpoints` → `yoshi47`、互換対象に Codex CLI を追記

## 検証手順

1. `npm run compile && npx @vscode/vsce package` が通る
2. 隔離 XDG で、ブランチを push した後に `opencode plugin add github:yoshi47/work-checkpoints#<branch>` → `opencode run --print-logs` で `loading plugin` とチェックポイント作成を確認（`github:` 短縮形 + 実リモートの経路。上の表は `git+file://` での確認なので、これが通るまでマージしない）
3. リリース後、同じ手順を `#v<version>` で再確認

## 未決事項

- README に書くタグ: 次のリリース番号を具体的に書く（このPRでバージョンを上げる）か、`v<version>` のプレースホルダ + Releases へのリンクにするか。
  このブランチの内容は 1.3.1 以降未リリースの Codex プラグイン・OpenCode v2 移行と一緒に出ることになる。

## 受容するリスク

- OpenCode ユーザーの環境に、プラグインが使わない `ignore` / `simple-git` が入る。
  避けるには OpenCode 用に別パッケージ（npm 公開か別リポジトリ）が要り、依存2つのためにそれを持つ価値はないと判断。
  拡張の依存を足すときは、OpenCode ユーザーにも入ることを意識する。

## レビュー注記（Suggestion、今回は対応しない）

- `release.yml:88-107` はタグ作成が `vsce publish` / `ovsx publish` の成功に依存する。失敗すると新タグが出ないが、README は「最新の Release を使う」なので古いタグが使われるだけで壊れない。既存の workflow の問題として別扱い
- `exports` に `"."` を定義しないと将来の `require("work-checkpoints")` が解決できない。現状そうした参照は無い（YAGNI）

## スコープ外

- npm 公開（Git 指定で足りる。`plugin update` を使いたくなったら再検討）
- タグなし指定の自動更新（OpenCode 側の仕様）
