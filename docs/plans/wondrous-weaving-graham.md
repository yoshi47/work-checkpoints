# Codex 連携を「手動 cp」から正式な Codex プラグインへ

> **実施済み（2026-08-27）**。検証ゲートで前提が 2 つ覆ったので、確定した結論をここに残す:
> - `${PLUGIN_ROOT}` は**展開される**。相対パス `./scripts/...` は展開されず hook が Failed になる（バンドル済みプラグインが使っている形なのに動かない）。絶対パスも不可。
> - Codex プラグインの capability は `skills / hooks / apps / appTemplates / mcpServers / scheduledTasks` で、**`commands` は無い**。restore/delete は `skills/<name>/SKILL.md` として同梱した。
> - 新規プラグインの hook は**承認するまで黙って走らない**。対話起動時の "Hooks need review" で承認するか、`codex exec --dangerously-bypass-hook-trust` を使う。承認結果は `[hooks.state]` の `trusted_hash`。
> - `codex plugin add` は作業ツリーを参照せず `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` に**コピー**する。`codex-plugin/` を編集したら remove → add が要る。

## Context

`codex-plugin/` は今もプラグインではなく、`~/.codex/hooks/work-checkpoints/` へスクリプトを手で `cp` し、hook 定義を `~/.codex/hooks.json` か `~/.codex/config.toml` に手で書く方式になっている（`README.md:233-262`、`codex-plugin/README.md:12-49`）。`codex-plugin/hooks/hooks.json:8` が `$HOME/.codex/hooks/work-checkpoints/save-checkpoint.sh` という絶対パスを持つのは「Codex には plugin root 変数がない」という前提だったため。

その前提は現行の Codex CLI（手元は 0.149.1）では成り立たない。実機で確認した事実:

- Codex にはプラグイン機構がある（`codex plugin marketplace add` / `codex plugin add` / `codex plugin list`）。実例として crit が `~/.codex/plugins/crit/.codex-plugin/plugin.json` + `hooks/hooks.json` でプラグインとして入っている。
- マニフェスト探索順は `.codex-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.cursor-plugin/plugin.json`。
- マーケットプレイス探索順は `.agents/plugins/marketplace.json` → `.claude-plugin/marketplace.json` → `.cursor-plugin/marketplace.json`（先に見つかった 1 つだけを使う。`codex plugin list` はマーケットプレイスごとに解決済みファイルを 1 本だけ表示する）。
- codex バイナリの hooks モジュールに `PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` / `PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` が並んでおり、hook コマンド内で展開されると読める（**これだけは動作実例で裏を取っていない唯一の前提**。§リスク に代替を用意）。
- Codex の `UserPromptSubmit` hook 入力は Claude 互換（必須フィールドに `prompt` / `cwd` / `session_id` / `transcript_path` を含む）。`save-checkpoint.sh` は無改造で動く。
- hook エントリは `timeout` と `statusMessage` を解する。
- feature flag 名は `codex_hooks` ではなく **`hooks`**（`[features] hooks = true`）。ドキュメントが古い。

到達点: Codex 側も `codex plugin marketplace add` + `codex plugin add` で入り、リポジトリの作業ツリーをそのまま参照して動く。chezmoi の `config.toml` 直書き hook は不要になり、Claude 側と同じ「プラグインとして入れる」形に揃う。

## 決定事項と理由

| 論点 | 決定 | 理由 |
|---|---|---|
| hook のパス表現 | `${PLUGIN_ROOT}/scripts/save-checkpoint.sh` | agent-plugins 標準。`CLAUDE_` 接頭辞は Codex 専用ディレクトリでは誤読を招く。相対 `./scripts/...` も Codex は解する（バンドル済み figma / replayio プラグインが採用）が、cwd 依存に見えるので避ける。ただし根拠は codex バイナリ内の文字列（`PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` が hooks モジュールの定数表に並ぶ）であって動作実例ではない（crit は PATH 上の `crit` を直接叩いていて変数を使っていない）。実際に動かして確かめる — §検証 と §リスク を参照 |
| マーケットプレイス定義 | リポジトリ直下に **新規** `.agents/plugins/marketplace.json`（`./codex-plugin` を指す） | 既存 `.claude-plugin/marketplace.json` に 2 件目（`work-checkpoints-codex` → `./codex-plugin`）を足す案もあるが、それだと Claude の `/plugin` 一覧に Codex 用エントリが出てしまい、誤ってインストールされると `codex-plugin/` にはマニフェストが `.codex-plugin/plugin.json` しかない（Claude は読まない）ので黙って何も動かない。Claude Code は `.agents/plugins/marketplace.json` を読まず、Codex はこちらを優先するので相互に干渉しない。代償はマーケットプレイス定義が 2 ファイルになること（`version` の同期は §8 のテストで担保する） |
| `codex-plugin/hooks/feature-flag.toml` | 削除 | 手動インストール専用の補助ファイルで、しかもフラグ名が現行と違う（`codex_hooks` → `hooks`）。プラグイン導入後は残す理由がない |
| 旧 cp 手順のドキュメント | 削除し、移行手順に置き換え | 古い hook が残ると 1 プロンプトで 2 重コミットになるため、併記より移行を明示する方が安全 |
| restore/delete コマンド | `codex-plugin/commands/` をディレクトリだけ新設（マニフェストには宣言しない）。実際に出るかを早い段階で確認し、駄目なら `skills/` に作り替える | 手元の Codex プラグイン 5 本は `commands/` を持つが誰も `plugin.json` に宣言していない＝自動検出。宣言すると未知キーでマニフェストごと弾かれる恐れがあり、その場合 hook まで巻き添えになる |
| `scripts/dev-channel.js` | 今回は触らない | Codex 対応にはマーケットプレイスの add/remove 相当が要り、`codex` バイナリ前提の分岐が増える。tech debt としてメモリに残す |

## 変更するファイル

### 1. `codex-plugin/.codex-plugin/plugin.json`（新規）

```json
{
  "name": "work-checkpoints",
  "version": "1.3.1",
  "description": "Automatically save work checkpoints when you submit a prompt",
  "author": { "name": "kururu6966" },
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "Work Checkpoints",
    "shortDescription": "Snapshot your workspace on every prompt",
    "category": "Developer Tools"
  }
}
```

`version` は `package.json` / `claude-plugin/.claude-plugin/plugin.json:3` / `.claude-plugin/marketplace.json:12` と同じ 1.3.1 に揃える。

`commands` キーは**宣言しない**。手元にある実在の Codex プラグイン 5 本（figma / vercel / cloudflare / zoom / expo）は `commands/` ディレクトリを持ちながら `plugin.json` に `commands` キーを一切書いておらず、Codex 側ではディレクトリの自動検出とみられる。Claude の `claude-plugin/.claude-plugin/plugin.json:6-9` に合わせて書くと、スキーマ違反でマニフェストごと弾かれる（＝hook も死ぬ）恐れがある。`commands/` はディレクトリだけ置き、§実行順序 の早い段階で実際に出るか確かめる。

### 2. `codex-plugin/hooks/hooks.json`（書き換え）

`command` のみ差し替え。`timeout` / `statusMessage` は現行値を維持する。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${PLUGIN_ROOT}/scripts/save-checkpoint.sh",
            "timeout": 5,
            "statusMessage": "Saving checkpoint"
          }
        ]
      }
    ]
  }
}
```

### 3. `.agents/plugins/marketplace.json`（新規・リポジトリ直下）

```json
{
  "name": "work-checkpoints-plugin",
  "interface": { "displayName": "Work Checkpoints" },
  "plugins": [
    {
      "name": "work-checkpoints",
      "source": { "source": "local", "path": "./codex-plugin" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

書式は実機の `~/.codex/.tmp/bundled-marketplaces/openai-bundled/.agents/plugins/marketplace.json` と `~/.agents/plugins/marketplace.json`（crit）に合わせた。マーケットプレイス名は Claude 側（`.claude-plugin/marketplace.json:2`）と同じ `work-checkpoints-plugin` にして、プラグイン参照は `work-checkpoints@work-checkpoints-plugin` に統一する。

合わせて `.vscodeignore` に `.agents/**` を追加する（`.vscodeignore:14-16` で `claude-plugin/**` / `codex-plugin/**` / `.claude-plugin/**` を VSIX から外しているのと同じ理由。新しい直下ディレクトリだけ取り残されると VSIX に混入する）。

### 4. `codex-plugin/commands/restore-checkpoint.md` / `delete-checkpoints.md`（新規）

`claude-plugin/commands/*.md` をベースに 2 点だけ変える。

- `${CLAUDE_PLUGIN_ROOT}` → `${PLUGIN_ROOT}` を**全出現**（`restore-checkpoint.md:12,19` と `delete-checkpoints.md:12,25,30,35,40` の計 7 箇所）
- `delete-checkpoints.sh --claude` → `--codex`、および説明文の「Claude作成のチェックポイント」→「Codex作成のチェックポイント」（`claude-plugin/commands/delete-checkpoints.md:17,28,30,46`）。`--codex` はスクリプト側に既に実装済み（`codex-plugin/scripts/delete-checkpoints.sh:152`）なので、変えるのはドキュメントだけ

`allowed-tools` フロントマターは Claude 固有だが、Codex が解さなくても実害がないためそのまま残す。

### 5. `codex-plugin/hooks/feature-flag.toml`（削除）

### 6. `codex-plugin/README.md` / `README.md`（書き換え）

`codex-plugin/README.md:7-49` の Requirements + Installation を差し替える。**加えて Troubleshooting も直す** — `codex-plugin/README.md:76` と `README.md:278` に `codex_hooks` が残っており、ここを直さないと Requirements と矛盾する。`codex_hooks` は両 README から一掃する。

```bash
# リポジトリを clone 済みならローカルパスで
codex plugin marketplace add /path/to/work-checkpoints
# もしくは GitHub から
codex plugin marketplace add yoshi47/work-checkpoints

codex plugin add work-checkpoints@work-checkpoints-plugin
```

Requirements は「プラグインと hooks に対応した Codex CLI」「`~/.codex/config.toml` に `[features] hooks = true`」に更新（`codex_hooks` の記述をすべて置換）。

移行セクションを新設する。順序は「**先に新方式を入れて動作確認し、その後に旧方式を撤去**」。逆順（先に撤去）だと、プラグイン導入を忘れた時点でチェックポイントが黙って取られなくなる（安全網の消失に気づけない）。

二重登録の期間に 2 重コミットは起きない。`save-checkpoint.sh` に独立した歯止めが 2 つあるため: (1) mkdir ロック（`save-checkpoint.sh:52-84`）が 2 つの hook 呼び出しを直列化し、後発は 5 秒デバウンス（`:184-186`）で抜ける、(2) デバウンス窓を過ぎていても、`git add -A` の後に `git diff --cached --quiet` で差分ゼロなら commit せず抜ける（`:294-306`）。先発が既に同じ内容をコミットしているので後発は必ずここに落ちる。

```bash
# 1. 新方式を入れる
codex plugin marketplace add /path/to/work-checkpoints
codex plugin add work-checkpoints@work-checkpoints-plugin
# 2. スクラッチリポジトリで [Codex] コミットが 1 本入ることを確認（§検証）
# 3. 旧方式を撤去する
rm -rf ~/.codex/hooks/work-checkpoints
#    ~/.codex/hooks.json の UserPromptSubmit エントリ、または
#    ~/.codex/config.toml の [[hooks.UserPromptSubmit]] 直書きエントリを削除
# 4. もう一度 §検証 を回して、1 プロンプト 1 コミットに戻っていることを確認
```

`README.md:233-278`（Codex CLI Plugin の Installation / Requirements / Troubleshooting）も同じ内容に置き換え、`codex-plugin/README.md:47-49` の project-local install（`<repo>/.codex/` 配置）は今回の方式と両立しないので削除する。「Available scripts」表（`codex-plugin/README.md:59-71`）は残す。

### 7. `CHANGELOG.md`（追記）

`## [1.3.1]` の上に `## [Unreleased]` の `### Changed` を起こし、「Codex 連携を手動 cp から Codex プラグインに変更。既存利用者は移行手順が必要（旧 hook を残すと二重登録になる）」を書く。`package.json` の `version` は上げない（`.github/workflows/release.yml` が `package.json` の version 差分で VS Code Marketplace への公開を走らせるため、拡張の実体が変わらない今回は据え置く）。

### 8. `src/test/unit/codexPluginManifest.test.ts`（新規）

既存の Mocha スイート（`.vscode-test.mjs`、`src/test/unit/`）に足す。`suite()` / `test()` の TDD スタイル、`const REPO_ROOT = path.resolve(__dirname, '../../..')` でリポジトリ直下を取る形（`src/test/unit/restoreCheckpointScript.test.ts:12-14`）を踏襲し、こちらはスクリプトを実行せずファイル存在・モード・JSON の中身のチェックに徹する。

- `codex-plugin/.codex-plugin/plugin.json` の `hooks` / `commands` が指すパスが実在する
- `codex-plugin/hooks/hooks.json` の `command` が `${PLUGIN_ROOT}` 始まりで、`$HOME` を含まない（絶対パス回帰の防止）
- `${PLUGIN_ROOT}` を `codex-plugin/` に置換したパスが実在し、実行可能ビット（`100755`）が立っている
- `.agents/plugins/marketplace.json` と `.claude-plugin/marketplace.json` の `source` が実在するディレクトリを指し、その中にマニフェストがある
- 同じチェックを `claude-plugin/` 側（`${CLAUDE_PLUGIN_ROOT}`）にも適用する
- `version` が 4 箇所すべてで一致する: `package.json:5` / `.claude-plugin/marketplace.json:12` / `claude-plugin/.claude-plugin/plugin.json:3` / `codex-plugin/.codex-plugin/plugin.json`（今も手で 4 重管理されており、マニフェストが増えるとさらにずれやすい）
- 名前の整合: `.agents/plugins/marketplace.json` と `.claude-plugin/marketplace.json` の `name` がどちらも `work-checkpoints-plugin`、かつ各マーケットプレイスのプラグイン `name` が対応するマニフェストの `name` と一致する（README が `work-checkpoints@work-checkpoints-plugin` をハードコードするため）

### 9. chezmoi-dotfiles 側（別リポジトリ: `/Users/yoshiki.kadono/ghq/github.com/yoshi47/chezmoi-dotfiles`）

`dot_codex/modify_private_config.toml.tmpl`:

前提として、この直書き hook ブロックは**まだコミットされていない**（`git diff` の `@@ -121,6 +121,14 @@` のハンクがそれ）。同ファイルには無関係な `model_reasoning_effort` の変更も未コミットで乗っているので、コミットするときはハンクを選ぶ。

- **削除**: L124-130（コメント 2 行 + `[[hooks.UserPromptSubmit.hooks]]` の work-checkpoints エントリ）。実質はこの未コミットハンクの取り消し
- **追加**: managed plugins の並び（L229-249）の末尾に

```toml
[plugins."work-checkpoints@work-checkpoints-plugin"]
enabled = true
```

`apply_managed_config` は `[plugins]` について `enabled` だけを書き（L320-323）、`[marketplaces]` テーブルには触れないので、`codex plugin marketplace add` が書いた `[marketplaces.work-checkpoints-plugin]` は chezmoi apply で消えない。

裏返すと、テンプレートは `codex plugin marketplace add` / `codex plugin add` を代行しない。新しいマシンで `chezmoi apply` だけ走らせると `[plugins."work-checkpoints@work-checkpoints-plugin"] enabled = true` だけが書かれ、対応する `[marketplaces]` が無い状態になる（そのとき Codex がエラーを出すのか黙って無視するのかは未確認）。**追加**: managed plugins ブロックの直前に、その 2 コマンドを書いたコメントを置く。既存の `openai-curated` 系は Codex 自身がバンドルしているので同じ問題は起きず、work-checkpoints だけが手動登録を要する点も併記する。

## 実行順序

1. まず骨組みだけ作る: `codex-plugin/.codex-plugin/plugin.json`、`codex-plugin/hooks/hooks.json`、`.agents/plugins/marketplace.json`、`codex-plugin/commands/*.md`
2. `codex plugin marketplace add <repo path>` → `codex plugin add work-checkpoints@work-checkpoints-plugin` → `codex plugin list` で解決先を確認
3. **早期の検証ゲート**（§検証 1〜4）: (a) `${PLUGIN_ROOT}` が展開されて `[Codex]` コミットが入るか、(b) `codex` 対話起動時に restore-checkpoint / delete-checkpoints が `/` に出るか。ここで初めてパス表現と commands/skills の形が確定する。駄目なら §リスク の代替に差し替えて 2 に戻る
   - この時点では chezmoi の直書き hook と二重登録になるが、上記 2 つの歯止めで 2 重コミットにはならない
4. 確定した形に沿って残りを書く: README 2 本、CHANGELOG、`.vscodeignore`、`src/test/unit/codexPluginManifest.test.ts`、`codex-plugin/hooks/feature-flag.toml` の削除
5. `npm test`（`npm run compile` → `lint` → `vscode-test`）。ただしこのテストは静的なパス整合しか見ないので、手順 3 の代わりにはならない
6. `rm -rf ~/.codex/hooks/work-checkpoints`（旧スクリプト。2026-08-12 に手動配置されたもの）を撤去。この環境に `~/.codex/hooks.json` は存在せず、直書き hook は `~/.codex/config.toml:104-110` のみ（chezmoi 生成）なので、撤去は次の手順 7 で行われる
7. chezmoi 側を編集し `chezmoi apply ~/.codex/config.toml` → `~/.codex/config.toml` から work-checkpoints の直書き hook が消え、`[plugins."work-checkpoints@work-checkpoints-plugin"]` が入ったことを確認
8. §検証 を再実行し、1 プロンプト 1 コミットに戻っていることを確認
9. PR 作成前に `pr-review-toolkit:review-pr`

手順 3 を前に置くのは、`${PLUGIN_ROOT}` と `commands/` という 2 つの未検証前提が、README の文面・テストの形・マニフェストの中身をすべて決めてしまうため。後ろに置くと失敗時に書いたものを全部書き直すことになる。

「新方式を入れて確認 → 旧方式を撤去」（手順 2-3 → 6-7）の順にするのは、逆順だとプラグイン導入前に必ずチェックポイントが取られない期間ができ、しかもそれが無音で進むため。二重登録側は上記 2 つの歯止めで吸収される。

## 検証

```bash
# 1. プラグインが認識されているか
codex plugin list          # work-checkpoints@work-checkpoints-plugin が installed, enabled で PATH がリポジトリの codex-plugin を指す

# 2. hook が登録されたか（初回実行後に trusted_hash が入る）
grep -n "work-checkpoints" ~/.codex/config.toml   # [plugins."..."] enabled のみ。[[hooks.UserPromptSubmit]] の直書きが無いこと

# 3. スクラッチの git リポジトリで実際に発火させる
mkdir -p /tmp/wc-verify && cd /tmp/wc-verify && git init && echo hello > a.txt
codex exec "say ok"

# 4. シャドウリポジトリに [Codex] コミットが 1 本だけ入ったか
#    remote が無いリポジトリでは worktree root のパスが ID の元（save-checkpoint.sh:21-26）
REPO_ID=$(printf %s "$(git rev-parse --show-toplevel)" | shasum -a 256 | cut -c1-12)
git -C ~/.work-checkpoints/$REPO_ID log --oneline | head
tail ~/.work-checkpoints/$REPO_ID/checkpoint.log
```

- 4 で `[Codex]` コミットが 1 本（2 本なら hook が二重登録されている）
- コマンドの検証は別建て: `codex` を対話起動して `/` を開き、restore-checkpoint / delete-checkpoints が出るか確認する。出なければ `commands/` を `skills/`（`skills/<name>/SKILL.md`、マニフェストは `"skills": "./skills/"`）に作り替える。crit が Codex 側で採っている形がこれ。

## リスクと代替

- **`${PLUGIN_ROOT}` が hook コマンドで展開されない場合**: 症状はチェックポイントが作られず `checkpoint.log` も増えない。`${CLAUDE_PLUGIN_ROOT}` に差し替えて再確認し、それも駄目なら相対パス `./scripts/save-checkpoint.sh`（バンドル済み codex プラグインが実際に使っている形）に落とす。
- **Codex が `.agents/plugins/marketplace.json` より `.claude-plugin/marketplace.json` を優先した場合**: `codex plugin add` で Claude 用の `./claude-plugin` が入り、`[Claude]` プレフィックスのコミットが Codex から作られる。`codex plugin list` の 1 行目に出る解決済みマーケットプレイスファイルのパスで判別できる。その場合は `.claude-plugin/marketplace.json` に `work-checkpoints-codex` エントリを足す方式に切り替える。
- **旧ユーザーへの影響**: 手動 cp で入れている既存利用者は、移行手順を踏まないと 2 重コミットになる。README の移行セクションと CHANGELOG に明記する。
- **ローカルパス登録の脆さ**: `codex plugin marketplace add <path>` は `[marketplaces.work-checkpoints-plugin] source = "<絶対パス>"` を書く（`~/.codex/config.toml:406-420` の既存エントリと同じ形）。リポジトリを移動・削除するとプラグインが解決できなくなる（そのとき Codex が明示エラーを出すか黙って無効化するかは未確認）。自分の環境では ghq 配下で固定なので許容し、README では他人向けに `codex plugin marketplace add yoshi47/work-checkpoints`（Git 取得）を先に書く。

## スコープ外（メモリに残す）

- `claude-plugin/scripts/` と `codex-plugin/scripts/` の重複解消（差分は `[Claude]`/`[Codex]` プレフィックスと `--claude`/`--codex` の 2 点のみ）。プラグインルートは自己完結している必要があり、共有化にはビルドか symlink が要るため別件。
- `scripts/dev-channel.js` の Codex 対応（ローカル版 ⇄ 公開版の切り替え）。
