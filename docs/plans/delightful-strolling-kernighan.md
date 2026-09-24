# git worktree 対応と restore 誤爆ガード

## Context

work-checkpoints は「1 リポジトリ = 1 シャドウリポジトリ」を前提に、ID を
`sha256(origin remote URL ?? gitRoot)[0:12]` で決めている（`src/utils/hashUtils.ts:3-5` ほか計 10 箇所）。
git worktree ではこの前提が破綻する。同一 remote の全 worktree が 1 つのシャドウリポジトリを共有し、
`core.worktree` は実行のたびに「最後に走ったワークスペース」へ付け替わる
（`claude-plugin/scripts/save-checkpoint.sh:216-219`、`src/services/shadowGitService.ts:180,184,201`）。

実測（`~/.work-checkpoints/dd2fbf26d19f` / meetsone、2026-08-20）:

- 履歴が 4 つの worktree のブランチで交互に並ぶ
- HEAD は `review` worktree と差分 0、`dev` worktree とは **1253 ファイル差** → dev のスナップショットは実質存在しない
- 付け替えを受けたリポジトリでは `git status` が壊れる: fsmonitor ON で **0 件**、OFF で **548 件**
- 付け替えの無いリポジトリ（`0fced72270a0`）では ON/OFF とも **14219 件**で一致 → fsmonitor 自体は健全で、原因は付け替え

起きること:

1. 意図した worktree のチェックポイントが取れない
2. `restore-checkpoint.sh:83` は `core.worktree` が指す先へ checkout するだけで呼び出し元と一致するか検証しない
   → **worktree A から restore すると worktree B が丸ごと上書きされる**。
   VSCode 拡張の `restoreSnapshot`（`shadowGitService.ts:420-430`）は `clean -f -d` + `reset --hard` なのでさらに破壊的
3. `git add -A` が部分的にしかステージしなくても `save-checkpoint.sh:280-282` で無言 `exit 0`。痕跡が残らない
   （`checkpoint.log` の最終更新は 8/14 のまま）

## 決定事項（ユーザー承認済み）

- **識別子**: ハッシュ元は従来どおり `remoteUrl ?? gitRoot`。**linked worktree のときだけ** `#worktree:<name>` を付加。
  メイン worktree の ID は現行とバイト単位で一致 → worktree 未使用ユーザーは移行不要・履歴維持。
- **リリースは 2 段**: 破壊を止めるのは restore ガードだけであり、ID 変更に依存しない。先に出す。
  - **1.3.1**: restore ガード（シェル + VSCode 拡張）＋ 汚染済みリポジトリの fsmonitor 修復
  - **1.4.0**: ID の worktree 分離、`.worktree-owner`、可観測性、ドキュメント
- **fsmonitor**: 一律無効化はしない。**汚染済みリポジトリの修復は必須で入れる**（1.3.1）。
  新規設定を残すか外すかは、ID 修正後の新しいシャドウリポジトリで ON/OFF を実測してから決める（作業順序 step 8）。

## 前提として確認済みの git の挙動

| 事実 | 確認方法 |
|---|---|
| linked worktree の判定は `--absolute-git-dir` の親が `worktrees` かどうか | メイン `<root>/.git` / linked `<main>/.git/worktrees/<name>` |
| **判別子は worktree の管理ディレクトリ名で、ディレクトリ名とは限らない** | `meetsone.worktrees/review` の git dir は `.git/worktrees/**master**` |
| `git worktree move` は管理ディレクトリ名を変えない → 移動しても ID は不変 | 名前ベースを選ぶ積極的な理由 |
| 同名 basename で `add` すると `dev`, `dev1` と採番される → 同一リポジトリ内で一意 | |
| submodule は git dir が `<super>/.git/modules/<name>` → 親が `modules` なので対象外（従来どおり） | |
| `git update-index --[no-]fsmonitor / --[no-]untracked-cache` は git 2.50 に存在 | `git update-index -h` |
| `printf '%s'` と node `crypto` はバイト一致 | `#worktree:dev` 込みで `5537aa5e375e` 一致 |

## 1.3.1 — restore ガード（先行リリース）

### シェル（`{claude,codex}-plugin/scripts/restore-checkpoint.sh`、両者バイト一致）

`acquire_lock || exit 1`（`:80`）の**後**、checkout（`:83`）の前に置く。ロック前だと TOCTOU
（バックグラウンドの save が検査と checkout の間に `core.worktree` を付け替えうる）。

```bash
CONFIGURED_WORKTREE=$(git -C "$SHADOW_REPO" config --get core.worktree 2>/dev/null)
if [ -n "$CONFIGURED_WORKTREE" ] && [ ! "$CONFIGURED_WORKTREE" -ef "$WORKSPACE_ROOT" ]; then
  echo "Error: this checkpoint repository last tracked a different workspace." >&2
  echo "  tracked : $CONFIGURED_WORKTREE" >&2
  echo "  current : $WORKSPACE_ROOT" >&2
  if [ ! -e "$CONFIGURED_WORKTREE" ]; then
    echo "  (that path no longer exists)" >&2
  fi
  echo "Its history may contain snapshots of that other workspace." >&2
  echo "  inspect : git -C $SHADOW_REPO log --oneline" >&2
  echo "  discard : delete-checkpoints.sh --all   (ソフト削除。.deleted に追記するだけで復帰可能)" >&2
  echo "  override: WORK_CHECKPOINTS_FORCE_WORKTREE=1" >&2
  exit 1
fi
```

- `-ef`（bash 組み込み。`/tmp -ef /private/tmp` が真になることを確認済み）を使うのは、macOS の `/var`→`/private/var` や
  シンボリックリンク経由のパスで誤検知しないため。外部 `realpath` は macOS に無い。
- **「まず save してください」とは書かない**。save は `core.worktree` を張り替えたうえで
  他 worktree の tree に対して `add -A` するので、1253 ファイルのゴミコミットを 1 個作らせるだけになる。
- save 側の自動張り替え（`:216-219`）は残す。クローン移動時の自己修復経路であり、save が誤ってもコミットが 1 つ増えるだけ。
  ただし §可観測性で WARN を出す。

### VSCode 拡張

`restoreSnapshot`（`shadowGitService.ts:420`）は先頭で `initializeIfNeeded()` を呼び、それが `core.worktree` を
自分のパスへ書き換える（`:180,184`）。**ガードは `initializeIfNeeded` より前**でないと必ず通ってしまう。

```ts
  restoreSnapshot = async (snapshotId: string, force = false): Promise<void> => {
    if (!force) { await this.assertWorktreeBinding(); }   // initializeIfNeeded より前
    await this.initializeIfNeeded();
    // …既存の clean/reset
  };
```

`assertWorktreeBinding` は `core.worktree` を読み、`fs.realpath` で両側を正規化して比較し、
不一致なら `WORKTREE_MISMATCH:<path>` を throw。`src/commands/restoreSnapshot.ts` が接頭辞で捕まえ、
`showWarningMessage({ modal: true }, 'Restore Anyway')` で確認し、承諾時のみ `restoreSnapshot(id, true)`。
（既存の確認ダイアログのパターンが `restoreSnapshot.ts:53-60` にある）

### 汚染済みリポジトリの fsmonitor 修復

`git config --unset core.untrackedcache` **だけでは不十分**。git の意味論では unset は `keep` で、
index に残った untracked-cache 拡張は使われ続ける。`update-index` で拡張ごと落とす。

`save-checkpoint.sh` の `core.worktree` 更新ブロック（`:216-219`）直後、`git add -A`（`:277`）より前、
**ロック保持中**に挿入（`update-index` が並行 save と競合しないように）:

```bash
  # --- fsmonitor / untrackedCache の修復（初回のみ） ---
  # core.worktree を付け替えられたリポジトリでは index に残った fsmonitor トークンが
  # 別ワークツリー由来になり、status/add が変更を無言で取りこぼす（実測 0/548）。
  # config --unset だけでは untracked cache の index 拡張が残る（unset = keep）ため update-index も叩く。
  FSMONITOR_MARKER="$SHADOW_REPO/.fsmonitor-repaired"
  if [ ! -f "$FSMONITOR_MARKER" ]; then
    git -C "$SHADOW_REPO" config --unset core.fsmonitor 2>/dev/null
    git -C "$SHADOW_REPO" config --unset core.untrackedcache 2>/dev/null
    git -C "$SHADOW_REPO" update-index --no-fsmonitor --no-untracked-cache 2>/dev/null
    : > "$FSMONITOR_MARKER"
  fi
```

マーカーで 1 回だけ実行する（無条件だと毎回 3 プロセス生成し、`update-index` も 1200 ファイル規模では無料ではない）。
`core.fsmonitor` の有無で分岐しないのは、手動で fsmonitor だけ消したリポジトリで untrackedCache 修復が漏れるため。

**シャドウリポジトリは 4 クライアントで共有される**ので、同じ修復を
`ShadowGitService.initializeIfNeeded`（両分岐の後、`syncConfigFile` の前）と
opencode の `initShadowRepo`（`work-checkpoints.ts:58-71`）にも入れる。
既存 21 ディレクトリすべてに `core.fsmonitor=true` が入っており、拡張機能しか使わないユーザーは
シェル経路の修復に到達しない。

## 1.4.0 — ID の worktree 分離

### 正準ハッシュ入力

```
base   = remoteUrl（空でなければ）, else gitRoot
source = worktreeName ? `${base}#worktree:${worktreeName}` : base
id     = sha256(source).hex[0:12]

worktreeName: g = git rev-parse --absolute-git-dir
              linked ⟺ basename(dirname(g)) == "worktrees" かつ basename(g) != ".git"
              判定不能・失敗時は null（＝従来 ID にフォールバック）
```

`basename(g) != ".git"` の条件は、ディレクトリ名が `worktrees` のメインリポジトリ
（`/home/u/worktrees/.git`）を誤判定しないため。

**空文字列の扱いを揃える**: TS の `remoteUrl ?? gitRoot`（`hashUtils.ts:4`）はシェルの `[ -n "$REMOTE_URL" ]` と
食い違う。`getRemoteOriginUrl` が `''` を返すと TS だけ `''` をハッシュするので `remoteUrl || gitRoot` に変える。

**`cd` も `realpath` も使わない**（文字列演算のみ）。理由: `cd .git` は `CDPATH` 探索の対象で、
`CDPATH` が設定されているとメイン worktree を誤判定しうる。文字列演算に寄せることで
TS 版とシェル版が同じ条件で同じフォールバックをする（片方だけフォールバックすると
拡張機能と hook が別のシャドウリポジトリに書き、スナップショットが UI から消える）。

### TypeScript

`src/utils/hashUtils.ts` — 第3引数は **必須**にする。optional だと構築箇所が黙って旧挙動のまま残るが、
必須なら `tsc` が変更漏れを列挙する。

```ts
// KEEP IN SYNC WITH the repo-id block in {claude,codex}-plugin/scripts/*.sh
// and opencode-plugin/work-checkpoints.ts
export const generateRepoIdentifier = (
  remoteUrl: string | null,
  gitRoot: string,
  worktreeName: string | null,
): string => {
  const base = remoteUrl || gitRoot;
  const source = worktreeName ? `${base}#worktree:${worktreeName}` : base;
  return crypto.createHash('sha256').update(source).digest('hex').substring(0, 12);
};
```

`src/services/workspaceService.ts` — `import * as fs from 'fs/promises'` を追加（現状は `simple-git` と `path` のみ）。
`getWorktreeName()` を追加し、**未使用の `getActualGitRoot`（:64-81）は削除**する
（worktree をメインリポジトリのルートへ畳む関数で今回と逆向き。呼び出し元ゼロ・テストゼロ）。

```ts
  // git の worktree 管理ディレクトリ名。git worktree move しても変わらない不透明な識別子で、
  // worktree のディレクトリ名とは一致しないことがある。
  getWorktreeName = async (): Promise<string | null> => {
    try {
      const gitDir = (await this.git.revparse(['--absolute-git-dir'])).trim();
      if (!gitDir) { return null; }
      const name = path.basename(gitDir);
      if (path.basename(path.dirname(gitDir)) !== 'worktrees' || name === '.git') { return null; }
      return name;
    } catch {
      return null;
    }
  };
```

`shadowGitService.ts:16-24` にコンストラクタ第3引数 `worktreeName: string | null` を追加。
構築 4 箇所（`saveSnapshot.ts:31-40`、`restoreSnapshot.ts:29-30`、`deleteSnapshots.ts:27-28`、
`snapshotTreeProvider.ts:221-222`）は同じ 2 行の形:

```diff
-      const [branchName, remoteUrl] = await Promise.all([
+      const [branchName, remoteUrl, worktreeName] = await Promise.all([
         workspaceService.getCurrentBranch(),
         workspaceService.getRemoteOriginUrl(),
+        workspaceService.getWorktreeName(),
       ]);
-      const shadowGitService = new ShadowGitService(remoteUrl, gitRoot);
+      const shadowGitService = new ShadowGitService(remoteUrl, gitRoot, worktreeName);
```

### シェル（8 スクリプト）

ID 計算は 8 箇所に重複している。**同期マーカー付きで重複のまま維持**し、
バイト一致を自動テストで担保する。
why not 共通ファイル化: codex 版の導入手順が `cp scripts/*.sh ~/.codex/hooks/work-checkpoints/`
（`codex-plugin/README.md:16-20`）で各スクリプトの単体動作が前提。source 先の欠落で hook が壊れる失敗モードを増やさない。

`WORKSPACE_ROOT` のガードは save だけ `exit 0` で他と違うため、共通ブロックはその**後**から始める:

```bash
# --- BEGIN repo-id (KEEP IN SYNC WITH src/utils/hashUtils.ts generateRepoIdentifier) ---
# 呼び出し元から GIT_DIR 等を引き継ぐと cwd 基準の解決とズレるため落とす
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

REMOTE_URL=$(git remote get-url origin 2>/dev/null)
if [ -n "$REMOTE_URL" ]; then
  ID_SOURCE="$REMOTE_URL"
else
  ID_SOURCE="$WORKSPACE_ROOT"
fi

# リンク済み worktree はシャドウリポジトリを分離する（同一 remote の worktree 同士が
# 1 つのシャドウリポジトリを共有して core.worktree を奪い合うのを防ぐ）。
#   main worktree   : <root>/.git
#   linked worktree : <main>/.git/worktrees/<name>
# WORKTREE_NAME は git の管理ディレクトリ名で、worktree のディレクトリ名とは限らない。
# 判定できない場合（古い git など）は従来どおりの ID にフォールバックする。
GIT_DIR_ABS=$(git rev-parse --absolute-git-dir 2>/dev/null)
GIT_DIR_PARENT="${GIT_DIR_ABS%/*}"
WORKTREE_NAME="${GIT_DIR_ABS##*/}"
if [ -n "$GIT_DIR_ABS" ] && [ "${GIT_DIR_PARENT##*/}" = "worktrees" ] && [ "$WORKTREE_NAME" != ".git" ]; then
  ID_SOURCE="${ID_SOURCE}#worktree:${WORKTREE_NAME}"
else
  WORKTREE_NAME=""
fi

REPO_ID=$(printf '%s' "$ID_SOURCE" | shasum -a 256 | cut -c1-12)
SHADOW_REPO="$HOME/.work-checkpoints/$REPO_ID"
# --- END repo-id ---
```

- `dirname`/`basename` ではなくパラメータ展開: プロセス生成ゼロ。
  `save-checkpoint.sh:3` のフォアグラウンドは「<50ms」を明記した予算なので、増やすのは `git rev-parse` 1 回だけ。
- `printf '%s'` は `echo -n` 置換。bash 既定では同一バイトだが `xpg_echo` やバックスラッシュに対して安全。
  **ここは唯一 ID を変えうる編集**なので golden 値テストで固定する。
- `WORKTREE_NAME` は空白や UTF-8 を含みうるので全て二重引用符で扱う。

### `.worktree-owner`（残っていた衝突を閉じる）

ID 分離だけでは **同一 remote を 2 箇所にクローンした場合の衝突**は残る（判別子が覆うのは linked worktree のみ）。
シャドウリポジトリ初期化時に所有者を記録し、restore 時に検査する。

- 書き込み: init 時に `$SHADOW_REPO/.worktree-owner` へ `git rev-parse --absolute-git-dir` の値を 1 行。4 クライアント共通。
- 検査: restore ガードで、`.worktree-owner` が存在して現在の git dir と異なれば拒否（`core.worktree` 検査と同じ扱い）。
- **`.worktree-owner` が無い = 1.4.0 以前のリポジトリ**。この場合 `git worktree list` が 2 行以上なら
  「この履歴は worktree 分離前のもので、他の worktree の内容を含む可能性がある」と警告し、
  `WORK_CHECKPOINTS_FORCE_WORKTREE=1` を要求する。1.4.0 以前の混在履歴に対する唯一の防御になる
  （`core.worktree` は一致してしまうので他の検査では捕まらない）。

### opencode プラグイン

`opencode-plugin/work-checkpoints.ts:36-53` に同じ判定を実装（`path` ではなく `/` split で、
シェル版と文字通り同じルールにする）。現状 `catch` でしか `gitRoot` にフォールバックしないので、
**空文字列の remote** も拾うよう直す。冒頭のドキュメンテーションコメント（`:7-8`）の ID 説明も更新する。

### 可観測性

ロガーはバックグラウンドのサブシェル内、`exec >/dev/null 2>>"$LOG_FILE"`（`save-checkpoint.sh:49`）の直後に定義する
（フォアグラウンドに置くと hook の stderr に漏れる）。

```bash
  debug_log() {
    [ -n "$WORK_CHECKPOINTS_DEBUG" ] || return 0
    printf '%s - DEBUG %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  }
```

- `acquire_lock` 成功直後（`:85`）: `repo_id` と `worktree=${WORKTREE_NAME:-<main>}` と `root`。
  **`ID_SOURCE` は出さない** — remote URL にトークンが埋まっていることがあり `checkpoint.log` は平文。
- デバウンススキップ（`:182-185`）: 経過秒
- ステージ空スキップ（`:280-282`）: **`--cached` は定義上ゼロなので使わない**。
  `git -C "$SHADOW_REPO" status --porcelain | wc -l` を出す。これが「`add -A` が何も拾わなかった」の唯一の信号になる
- コミット成功: 件数は `git commit` の**前**に `git diff --cached --numstat | wc -l` で採る。
  `debug_log "$(...)"` は関数内ガードより先にコマンド置換が走るので `if [ -n "$WORK_CHECKPOINTS_DEBUG" ]` で囲む
- `core.worktree` 付け替え（`:218`）: **デバッグゲートなしの WARN**。Bug A の指紋そのもので、修正後は本来ほぼ出ない
- ID が変わった旧リポジトリの `checkpoint.log` に 1 行だけ「`worktree <name>` は `<newid>` へ移動」と追記する
  （「チェックポイントが消えた」ときの唯一の手がかりになる）

`:16-18`（git リポジトリでない）の `exit 0` は無言のままでよい。無変更プロンプトで `checkpoint.log` を汚す追加書き込みはしない。

## 変更ファイル

| リリース | ファイル | 内容 |
|---|---|---|
| 1.3.1 | `{claude,codex}-plugin/scripts/restore-checkpoint.sh` | restore ガード |
| 1.3.1 | `{claude,codex}-plugin/scripts/save-checkpoint.sh` | fsmonitor 修復（マーカー方式） |
| 1.3.1 | `src/services/shadowGitService.ts` | `assertWorktreeBinding`、`disableFsMonitor` |
| 1.3.1 | `src/commands/restoreSnapshot.ts` | 不一致時の確認モーダル |
| 1.3.1 | `opencode-plugin/work-checkpoints.ts` | fsmonitor 修復 |
| 1.4.0 | `src/utils/hashUtils.ts` | 第3引数（必須）、`remoteUrl \|\| gitRoot` |
| 1.4.0 | `src/services/workspaceService.ts` | `fs/promises` import、`getWorktreeName()` 追加、`getActualGitRoot()` 削除 |
| 1.4.0 | `src/services/shadowGitService.ts` | コンストラクタ第3引数、`.worktree-owner` |
| 1.4.0 | `src/commands/{saveSnapshot,restoreSnapshot,deleteSnapshots}.ts`, `src/views/snapshotTreeProvider.ts` | 構築 4 箇所 |
| 1.4.0 | `{claude,codex}-plugin/scripts/*.sh` (8) | repo-id ブロック、`.worktree-owner`、`debug_log` |
| 1.4.0 | `opencode-plugin/work-checkpoints.ts` | ID 計算、`:7-8` のコメント |
| 両方 | `src/test/unit/*.test.ts`, 新規 `repoIdentifierParity.test.ts` | 下記 |
| 両方 | `README.md:170,173,246`, `codex-plugin/README.md:5,53,75`, `CHANGELOG.md` | worktree ルール、環境変数、旧履歴の警告 |
| 両方 | `package.json`, `.claude-plugin/marketplace.json`, `claude-plugin/.claude-plugin/plugin.json` | バージョン統一（plugin.json だけ 1.0.5 に取り残されている） |

## テスト

既存様式（Mocha TDD `suite`/`test` + `node:assert`、`.vscode-test.mjs` は `out/test/**/*.test.js`、
CI は ubuntu + `xvfb-run`）。git を触るテストは `fs.mkdtemp` + 実 `simple-git`、
teardown で実 `~/.work-checkpoints/<id>` も消す。

**`git worktree add` は unborn HEAD では失敗する。** 既存 setup（`shadowGitService.test.ts:16-36`、
`workspaceService.test.ts:17-28`）は commit していないので、worktree 用フィクスチャは
`init → write → add . → commit → git worktree add <tempDir>/wt-feature -b feature` を自前で組む。
worktree も同じ `tempDir` 配下に置けば既存の `fs.rm(tempDir)` で片付く。
シャドウリポジトリ ID は 2 つできるので `createdRepoIds: string[]` に集めて teardown でループする。

- `hashUtils.test.ts`（既存 7 呼び出しに `null` を追加）
  - `should keep the pre-worktree hash byte-identical when no worktree name` — **golden 値をハードコード**。
    移行不要の契約であり `printf` 置換の回帰ガードでもある
  - linked worktree で異なる / worktree 名違いで異なる / 空 remote は gitRoot にフォールバック
- `workspaceService.test.ts` — `getWorktreeName` が メイン → `null` / linked → `basename($(git rev-parse --absolute-git-dir))` /
  非 git → `null`。**ディレクトリ名との一致を assert しない**（`review` → `master` の実例がある）。
  さらに `git worktree move` 後も ID が変わらないことを assert し、
  「ディレクトリ名を使うように直す」将来の改悪を止める
- `shadowGitService.test.ts`
  - linked worktree で `shadowRepoPath` が異なる
  - `restoreSnapshot should reject when core.worktree points to another workspace`
  - `restoreSnapshot should proceed when forced despite a mismatch`
  - `restoreSnapshot should tolerate a symlinked-equivalent core.worktree` —
    `/var/...` と `/private/var/...` で throw しないこと（これが無いと macOS の mkdtemp パスで restore が全部壊れる）
  - `initializeIfNeeded should repair fsmonitor on an existing shadow repo`
- 新規 `src/test/unit/repoIdentifierParity.test.ts`
  - `all plugin scripts embed a byte-identical repo-id block` — 8 ファイルから BEGIN/END 間を抽出して全比較。
    claude/codex のドリフトを止める要
  - `shell repo-id block agrees with generateRepoIdentifier` — メイン / linked / origin あり /
    名前に空白を含む worktree の 4 ケース。スクリプトは `path.resolve(__dirname, '../../../claude-plugin/scripts/...')`
    で参照する（テストは `out/test/unit/` から走る）。抽出ブロックは cwd 基準で bare `git` を呼ぶので、
    `execFileSync('bash', ['-c', ...], { cwd: fixtureDir })` かつ `WORKSPACE_ROOT` を渡す。
    `process.platform === 'win32'` はスキップ
  - `repo-id block is CDPATH-safe` — `env: { ...process.env, CDPATH: '.' }` でメイン worktree の ID が
    golden 値と一致すること
- `autoCleanupService.test.ts:33,51` — 第3引数 `null` を機械的に追加

opencode プラグインはこのリポジトリにテスト基盤が無い。「ルールを文字通り同一に保つ」規約のみでカバーする旨をコメントに明記する。

## 移行・ロールバック

| ユーザー | ID | 結果 |
|---|---|---|
| worktree 未使用 | 不変 | 影響ゼロ |
| worktree ユーザーのメイン worktree | 不変 | 混在履歴を引き継ぐ。`.worktree-owner` が無いので restore 時に警告＋force 要求 |
| linked worktree | 新 ID | 空のシャドウリポジトリを新規作成。旧ディレクトリはメインが使い続ける |
| bare clone + worktree のみ | 全て新 ID | メイン worktree が無いため全履歴が一斉に切り替わる。最も影響が大きい構成として CHANGELOG に明記 |

- **自動移行はしない**（コピーも削除もフォールバック検索もしない）。混在履歴を worktree 別に分離するのは原理的に無理で
  （コミットが持つのは `Branch:` トレーラだけ、worktree 間でブランチ名は重複しうる）、
  「新 ID に無ければ旧 ID を見る」フォールバックは今回消した衝突を復活させる。
- **アップグレード後の初回 save は巨大なコミットになる**（メイン worktree のシャドウリポジトリ HEAD が
  他 worktree の tree のため。実測で 1253 ファイル規模）。データ損失ではないが CHANGELOG に書く。
- **ディスク**: worktree 6 個なら独立リポジトリ 6 個ぶんのベースラインを持つ（meetsone の共有分は現在 137M）。
  `gc.auto`（`save-checkpoint.sh:205-207`）も N 倍働く。README に一言。
- `worktree remove` → 再 add で管理名が `<name>1` になると ID が変わり旧リポジトリは孤立する。データ損失ではないが README に 1 行。
- **ロールバック**: ダウングレードは安全だが新 ID のリポジトリが見えなくなる（消えはしない）。
  `~/.work-checkpoints` には索引が無いので、README に
  `git -C ~/.work-checkpoints/<id> config --get core.worktree` で対応を調べる方法を書く。
  `update-index --no-fsmonitor` も完全に可逆。
  `delete-checkpoints.sh --all` は `.deleted` への追記によるソフト削除（`delete-checkpoints.sh:31,96`）である旨も明記する。

**採らなかった案**: (1) ガードのみで ID 据え置き — 破壊は止まるが worktree ごとのチェックポイントが取れない。
(2) `gitRoot` を無条件でハッシュ — worktree も複数クローンも一発で解決するが全ユーザーの ID が変わり、
リポジトリを移動しただけで履歴が切れる（remote URL 基準を選んだ元の理由が失われる）。

## 作業順序

各ステップ終了時に `npm run compile && npm run lint && npm test` が通ること。

**1.3.1**

1. シェル restore ガードを claude 版に実装 → codex 版へ逐語コピー（`diff` が既知のブランディング差分のみ）
2. `assertWorktreeBinding` + `force` 引数 + 確認モーダル、テスト 3 本（シンボリックリンク等価を含む）
3. fsmonitor 修復をシェル 2 本 + `initializeIfNeeded` + opencode へ。対応テスト
4. CHANGELOG 1.3.1、バージョン 3 ファイル、リリース

**1.4.0**

5. `hashUtils.ts`: 先に golden 値テストで現行ハッシュを固定 → 第3引数必須化 + 新テスト。
   `tsc` が落とす `shadowGitService.ts:17` は一旦 `null` を渡す
6. `workspaceService`: `fs/promises` import、`getWorktreeName()` 追加、`getActualGitRoot()` 削除、テスト
7. `ShadowGitService` 第3引数 + 構築 4 箇所 + 既存テスト更新 → 拡張機能単体で正しくなる
8. シェル repo-id ブロックを claude 版 4 本 → codex 版 4 本へ逐語コピー。
   `repoIdentifierParity.test.ts` と**同一コミット**で入れる（分割するとバイト一致テストが落ちる）
9. **fsmonitor の最終判断**: dev worktree 用の新しいシャドウリポジトリで
   `git -C <new> -c core.fsmonitor=true status --porcelain | wc -l` と `=false` を比較。
   一致すれば `save-checkpoint.sh:200-202`（コメント含め 3 行）を残す。食い違えば削除し、結果をプランに追記
10. `.worktree-owner` の書き込みと検査を 4 クライアントへ
11. `debug_log` と呼び出し 4 箇所 + `core.worktree` WARN + 旧ログへの移動記録
12. opencode プラグインの ID 計算とコメント（テスト無し。メイン/linked 各 1 回手動確認）
13. ドキュメントとバージョン 3 ファイル
14. 実機検証（下記）→ `pr-review-toolkit:review-pr` → Critical 修正

## 検証

```bash
npm run compile && npm run lint && npm test
```

実機（meetsone。**別 worktree を上書きしないことの確認が主目的**。`<R>` はこのリポジトリのパス）:

```bash
# 1. dev worktree から保存 → dev 専用の新しいシャドウリポジトリができる
cd ~/ghq/github.com/meetsmore/meetsone.worktrees/dev
echo '{"prompt":"verify"}' | WORK_CHECKPOINTS_DEBUG=1 bash <R>/claude-plugin/scripts/save-checkpoint.sh
sleep 6                                                    # save-checkpoint.sh:182-185 の 5 秒デバウンス回避
bash <R>/claude-plugin/scripts/list-checkpoints.sh         # dev のブランチ名だけが並ぶこと

# 2. 新 ID の確認（旧 dd2fbf26d19f とは別ディレクトリであること）
ls -dt ~/.work-checkpoints/*/ | head -3
tail -5 ~/.work-checkpoints/<dev-id>/checkpoint.log         # DEBUG 行の worktree= が dev の管理名であること

# 3. review worktree から保存しても dev のシャドウリポジトリが動かないこと
cd ../review && echo '{"prompt":"verify"}' | bash <R>/claude-plugin/scripts/save-checkpoint.sh
sleep 6
git -C ~/.work-checkpoints/<dev-id> log --oneline -3        # dev のコミットが増えていない

# 4. 取りこぼしが無いこと（step 9 の判断材料も兼ねる）
git -C ~/.work-checkpoints/<dev-id> -c core.fsmonitor=true  status --porcelain | wc -l
git -C ~/.work-checkpoints/<dev-id> -c core.fsmonitor=false status --porcelain | wc -l   # 一致すること

# 5. restore ガード（review にいる状態で dev のチェックポイントを復元しようとする）
BEFORE=$(git -C . status --porcelain | wc -l)
bash <R>/claude-plugin/scripts/restore-checkpoint.sh <dev の checkpoint id>   # exit 1
[ "$(git -C . status --porcelain | wc -l)" = "$BEFORE" ] && echo "not touched"
```
