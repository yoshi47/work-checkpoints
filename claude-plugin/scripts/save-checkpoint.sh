#!/bin/bash

# === フォアグラウンド: stdin 読み取りとパス計算 (高速、<50ms) ===
# エラー時も正常終了してユーザー操作をブロックしない

# stdinからJSONを読み取り、プロンプトを抽出
INPUT=$(cat)
if command -v jq &> /dev/null; then
  USER_PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null | head -c 500)
else
  USER_PROMPT=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('prompt', '')[:500])" 2>/dev/null)
fi

# シャドウリポジトリのパスを計算
WORKSPACE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$WORKSPACE_ROOT" ]; then
  exit 0  # Gitリポジトリでなければスキップ
fi

REMOTE_URL=$(git remote get-url origin 2>/dev/null)
if [ -n "$REMOTE_URL" ]; then
  REPO_ID=$(echo -n "$REMOTE_URL" | shasum -a 256 | cut -c1-12)
else
  REPO_ID=$(echo -n "$WORKSPACE_ROOT" | shasum -a 256 | cut -c1-12)
fi

SHADOW_REPO="$HOME/.work-checkpoints/$REPO_ID"
LOG_FILE="$SHADOW_REPO/checkpoint.log"
mkdir -p "$SHADOW_REPO" || exit 0

# ログファイルが書けないとバックグラウンドの全エラーが消失するため起動時に検証
# touch だとオーナー権限で 444 ファイルでも成功するので実際の append を試行
if ! ( : >>"$LOG_FILE" ) 2>/dev/null; then
  err_file="$HOME/.work-checkpoints-error"
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  if ! printf '%s - %s: cannot write to %s\n' "$ts" "$(basename "$0")" "$LOG_FILE" >> "$err_file" 2>/dev/null; then
    printf 'work-checkpoints: cannot write log (%s) or error file (%s)\n' "$LOG_FILE" "$err_file" >&2
  fi
  exit 0
fi

# === バックグラウンド: git 操作をフォークして即座にフォアグラウンドを返す ===
(
  # 親シェルの ERR trap を解除（サブシェル内では不要、デバッグ情報のマスク防止）
  trap - ERR

  # stdout は /dev/null、stderr はログファイルへリダイレクト。
  # 意図的にデバッグ出力を抑制している。デバッグ時は exec >/dev/null をコメントアウトして使う。
  exec >/dev/null 2>>"$LOG_FILE"

  # --- mkdir ベースの排他ロック ---
  # flock は macOS 標準では使えないため、mkdir のアトミック性を利用。
  LOCK_DIR="$SHADOW_REPO/.checkpoint.lock"

  acquire_lock() {
    local timeout=10
    local i=0
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
      # 60秒以上古いロックは異常終了の残骸とみなして削除
      if [ -d "$LOCK_DIR" ]; then
        if [ "$(uname)" = "Darwin" ]; then
          local lock_time=$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)
        else
          local lock_time=$(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)
        fi
        local age=$(( $(date +%s) - lock_time ))
        if [ "$age" -gt 60 ]; then
          rm -rf "$LOCK_DIR" 2>/dev/null
          continue
        fi
      fi
      sleep 0.5
      i=$((i + 1))
      # タイムアウト: ロック取得失敗時はスキップ（ゾンビ化防止）
      if [ "$i" -ge $((timeout * 2)) ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Lock timeout, skipping checkpoint" >&2
        return 1
      fi
    done
    # サブシェル終了時にロック自動解放
    trap "rm -rf '$LOCK_DIR'" EXIT
    return 0
  }

  acquire_lock || exit 0

  CONFIG_FILE="$SHADOW_REPO/config.json"

  # --- デフォルト exclude パターンの書き出し ---
  # KEEP IN SYNC WITH src/utils/excludes.ts getDefaultExcludePatterns()
  write_default_excludes() {
    cat << 'EXCLUDE_EOF'
# Build artifacts
node_modules/
dist/
build/
.next/
out/
.nuxt/
coverage/
.turbo/
.vercel/
__pycache__/
*.pyc
target/
vendor/
# Media files
*.png
*.jpg
*.jpeg
*.gif
*.bmp
*.ico
*.svg
*.webp
*.mp4
*.mov
*.avi
*.webm
*.mp3
*.wav
*.flac
*.ogg
*.pdf
# Cache and temp files
.DS_Store
Thumbs.db
*.log
*.tmp
*.temp
*.cache
.eslintcache
.stylelintcache
.prettiercache
*.swp
*.swo
*~
# Archives
*.zip
*.tar
*.tar.gz
*.tgz
*.rar
*.7z
# Data files
*.sql
*.sqlite
*.sqlite3
*.db
*.mdb
# Secrets
.env
.env.*
*.pem
*.key
*.crt
credentials.json
EXCLUDE_EOF
  }

  # --- config.json の ignorePatterns を exclude に追記 ---
  append_user_ignore_patterns() {
    local target="$1"
    if [ ! -f "$CONFIG_FILE" ] || ! command -v jq &> /dev/null; then
      return 0
    fi
    jq -r '.ignorePatterns // [] | .[]' "$CONFIG_FILE" 2>/dev/null >> "$target" || true
  }

  # --- デバウンス: 高速連打の抑制 ---
  # 最後のコミットから5秒未満ならスキップ。
  # 目的: 同一プロンプトの連打・即座の修正送信の重複防止。通常の作業間隔(1-2分)は影響なし。
  # rc を捕捉して破損リポジトリを検出（.git があるのに log が失敗するケース）
  # --all を付けるのは、スナップショットがブランチごとの ref に積まれ、HEAD が動かないため。
  if LAST_COMMIT_TIME=$(git -C "$SHADOW_REPO" log --all -1 --format=%ct 2>/dev/null); then
    # コミットがまだ1つも無いリポジトリでは空文字が返る
    [ -z "$LAST_COMMIT_TIME" ] && LAST_COMMIT_TIME=0
  elif [ -d "$SHADOW_REPO/.git" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Shadow repo .git exists but git log failed (corrupted?): $SHADOW_REPO" >&2
    exit 0
  else
    LAST_COMMIT_TIME=0
  fi
  CURRENT_TIME=$(date +%s)
  if [ $((CURRENT_TIME - LAST_COMMIT_TIME)) -lt 5 ]; then
    exit 0
  fi

  # --- シャドウリポジトリの初期化（必要な場合） ---
  if [ ! -d "$SHADOW_REPO/.git" ]; then
    if ! git -C "$SHADOW_REPO" init; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - git init failed for $SHADOW_REPO" >&2
      exit 0
    fi
    git -C "$SHADOW_REPO" config core.worktree "$WORKSPACE_ROOT"
    git -C "$SHADOW_REPO" config user.email "work-checkpoints@local"
    git -C "$SHADOW_REPO" config user.name "Work Checkpoints"
    git -C "$SHADOW_REPO" config core.quotepath false
    git -C "$SHADOW_REPO" config i18n.commitencoding utf-8
    git -C "$SHADOW_REPO" config i18n.logoutputencoding utf-8

    # gc 設定（リポ肥大化防止）
    git -C "$SHADOW_REPO" config gc.auto 100
    git -C "$SHADOW_REPO" config gc.autoPackLimit 4
    git -C "$SHADOW_REPO" config gc.pruneExpire "2.weeks.ago"

    # exclude パターン設定
    EXCLUDE_DIR="$SHADOW_REPO/.git/info"
    mkdir -p "$EXCLUDE_DIR"
    write_default_excludes > "$EXCLUDE_DIR/exclude"
    append_user_ignore_patterns "$EXCLUDE_DIR/exclude"
  fi

  # --- core.worktree の条件付き更新（変更がなければスキップ） ---
  CURRENT_WORKTREE=$(git -C "$SHADOW_REPO" config --get core.worktree 2>/dev/null)
  if [ "$CURRENT_WORKTREE" != "$WORKSPACE_ROOT" ]; then
    git -C "$SHADOW_REPO" config core.worktree "$WORKSPACE_ROOT"
  fi

  # --- fsmonitor / untrackedCache の無効化（初回のみ） ---
  # core.worktree を付け替えられたリポジトリでは index に残った fsmonitor トークンが
  # 別ワークツリー由来になり、status/add が変更を無言で取りこぼす（実測 0/548 件）。
  # --unset ではなく false を明示するのは、ユーザーの global config で有効化されていると
  # local を消しただけでは継承されてしまうため。untracked cache は設定を落としても index
  # 拡張が残る（unset = keep）ので update-index で拡張ごと削除する。
  # マーカーを立てるのは 3 つとも成功したときだけ。ロック競合等で失敗したまま
  # 済み扱いにすると、二度と再試行されず取りこぼしが恒久化する。
  # stderr は握り潰さず checkpoint.log へ流す（このサブシェルは冒頭で 2>>LOG_FILE 済み）。
  FSMONITOR_MARKER="$SHADOW_REPO/.fsmonitor-disabled"
  if [ ! -f "$FSMONITOR_MARKER" ]; then
    if git -C "$SHADOW_REPO" config core.fsmonitor false \
      && git -C "$SHADOW_REPO" config core.untrackedcache false; then
      # index は worktree ごとに分かれているので、既存の index すべてから拡張を落とす
      FSMONITOR_OK=1
      for index_file in "$SHADOW_REPO/.git/index" "$SHADOW_REPO"/.indexes/*; do
        [ -f "$index_file" ] || continue
        GIT_INDEX_FILE="$index_file" git -C "$SHADOW_REPO" update-index --no-fsmonitor --no-untracked-cache || FSMONITOR_OK=0
      done
      if [ "$FSMONITOR_OK" -eq 1 ]; then
        echo 1 > "$FSMONITOR_MARKER"
      else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Failed to disable fsmonitor; will retry next time" >&2
      fi
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') - Failed to disable fsmonitor; will retry next time" >&2
    fi
  fi

  # --- config.json の読み込み ---
  CFG_MSG_FMT=""
  CFG_DATE_FMT=""
  CFG_RETENTION=""
  if [ -f "$CONFIG_FILE" ]; then
    if ! command -v jq &> /dev/null; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - WARNING: jq not installed, config.json ignored" >&2
    elif ! jq empty "$CONFIG_FILE" 2>/dev/null; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - WARNING: config.json is not valid JSON, using defaults" >&2
    else
      CFG_MSG_FMT=$(jq -r '.messageFormat // empty' "$CONFIG_FILE" 2>/dev/null)
      CFG_DATE_FMT=$(jq -r '.dateFormat // empty' "$CONFIG_FILE" 2>/dev/null)
      CFG_RETENTION=$(jq -r '.retentionDays // empty' "$CONFIG_FILE" 2>/dev/null)
    fi
  fi

  # --- dateFormat トークン (yyyy/MM/dd) を strftime (%Y/%m/%d) に変換 ---
  format_date() {
    local fmt="${1:-yyyy/MM/dd HH:mm:ss}"
    fmt="${fmt//yyyy/%Y}"
    fmt="${fmt//MM/%m}"
    fmt="${fmt//dd/%d}"
    fmt="${fmt//HH/%H}"
    fmt="${fmt//mm/%M}"
    fmt="${fmt//ss/%S}"
    date "+$fmt"
  }

  # --- config.json が新しい場合は exclude を再生成 ---
  EXCLUDE_FILE="$SHADOW_REPO/.git/info/exclude"
  if [ -f "$CONFIG_FILE" ] && [ -f "$EXCLUDE_FILE" ] && [ "$CONFIG_FILE" -nt "$EXCLUDE_FILE" ]; then
    write_default_excludes > "$EXCLUDE_FILE"
    append_user_ignore_patterns "$EXCLUDE_FILE"
  fi

  # --- スナップショット作成 ---
  BRANCH=$(git -C "$WORKSPACE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  # KEEP IN SYNC WITH src/utils/configFile.ts DEFAULTS
  TIMESTAMP=$(format_date "${CFG_DATE_FMT}")
  if [ -n "$CFG_MSG_FMT" ]; then
    MSG_TEMPLATE="$CFG_MSG_FMT"
  else
    MSG_TEMPLATE='${branch} @ ${date}'
  fi
  FORMATTED_MSG="${MSG_TEMPLATE//\$\{branch\}/$BRANCH}"
  FORMATTED_MSG="${FORMATTED_MSG//\$\{date\}/$TIMESTAMP}"
  TITLE="[Claude] $FORMATTED_MSG"
  if [ -n "$USER_PROMPT" ]; then
    MESSAGE="$TITLE

$USER_PROMPT"
  else
    MESSAGE="$TITLE"
  fi

  # --- worktree ごとの index と、ブランチごとの ref ---
  # 単一の index と HEAD を worktree 間で共有すると、別の worktree のスナップショットが
  # 挟まるたびに「ブランチ間の全ツリー差分」が 1 コミットとして積まれる。差分表示も
  # 保存も無駄に重くなるうえ、中身が変わっていない空のコミットまで増える。
  RESOLVED_ROOT=$(cd "$WORKSPACE_ROOT" 2>/dev/null && pwd -P) || RESOLVED_ROOT="$WORKSPACE_ROOT"
  WORKTREE_KEY=$(printf '%s' "$RESOLVED_ROOT" | shasum -a 256 | cut -c1-12)
  INDEX_DIR="$SHADOW_REPO/.indexes"
  mkdir -p "$INDEX_DIR" || exit 0
  INDEX_FILE="$INDEX_DIR/$WORKTREE_KEY"

  if printf '%s' "$BRANCH" | grep -qE '^[A-Za-z0-9._/-]+$' \
    && [ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "unknown" ] \
    && [ "${BRANCH%.lock}" = "$BRANCH" ]; then
    CHECKPOINT_REF="refs/checkpoints/$BRANCH"
  else
    CHECKPOINT_REF="refs/checkpoints/$WORKTREE_KEY"
  fi

  # index はこの worktree 専用。git のコマンドごとに GIT_INDEX_FILE を差し替える
  shadow_git() {
    GIT_INDEX_FILE="$INDEX_FILE" git -C "$SHADOW_REPO" "$@"
  }

  shadow_git add -A || { echo "$(date '+%Y-%m-%d %H:%M:%S') - git add failed" >&2; exit 0; }
  TREE=$(shadow_git write-tree) || { echo "$(date '+%Y-%m-%d %H:%M:%S') - git write-tree failed" >&2; exit 0; }

  PARENT=$(shadow_git rev-parse --verify --quiet "$CHECKPOINT_REF" 2>/dev/null || true)
  if [ -z "$PARENT" ]; then
    # 新しいブランチの最初のスナップショットは既存の履歴につなげる（root コミットを増やさない）
    PARENT=$(shadow_git log --all -1 --format=%H 2>/dev/null || true)
  fi

  # 親と同一のツリーなら保存しない。worktree をまたいで保存すると、中身が変わっていないのに
  # 「別ブランチとの差分」だけのコミットが積まれていた。ワークツリーに差分があるのに
  # ツリーが同じなら、add -A が変更を取りこぼしている兆候（fsmonitor の不整合で実際に起きた）。
  if [ -n "$PARENT" ]; then
    PARENT_TREE=$(shadow_git rev-parse "$PARENT^{tree}" 2>/dev/null || true)
    if [ -n "$PARENT_TREE" ] && [ "$PARENT_TREE" = "$TREE" ]; then
      DIRTY_COUNT=$(git -C "$WORKSPACE_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      if [ "${DIRTY_COUNT:-0}" -gt 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - WARN staged nothing while the workspace has $DIRTY_COUNT changed path(s)" >&2
      fi
      exit 0
    fi
  fi

  # 同一秒に複数のスナップショットが並ぶと一覧の順序がばらつく。全 ref の最新コミットより
  # 必ず1秒以上後になる日時を刻んで単調増加を保つ。
  COMMIT_EPOCH=$(date +%s)
  LATEST_EPOCH=$(shadow_git log --all -1 --format=%ct 2>/dev/null || true)
  case "$LATEST_EPOCH" in
    ''|*[!0-9]*) ;;
    *) [ "$LATEST_EPOCH" -ge "$COMMIT_EPOCH" ] && COMMIT_EPOCH=$((LATEST_EPOCH + 1)) ;;
  esac
  COMMIT_DATE="@$COMMIT_EPOCH +0000"

  if [ -n "$PARENT" ]; then
    COMMIT_ID=$(printf '%s' "$MESSAGE" | env GIT_AUTHOR_DATE="$COMMIT_DATE" GIT_COMMITTER_DATE="$COMMIT_DATE" GIT_INDEX_FILE="$INDEX_FILE" git -C "$SHADOW_REPO" commit-tree "$TREE" -p "$PARENT" -F -)
  else
    COMMIT_ID=$(printf '%s' "$MESSAGE" | env GIT_AUTHOR_DATE="$COMMIT_DATE" GIT_COMMITTER_DATE="$COMMIT_DATE" GIT_INDEX_FILE="$INDEX_FILE" git -C "$SHADOW_REPO" commit-tree "$TREE" -F -)
  fi

  if [ -z "$COMMIT_ID" ] || ! shadow_git update-ref "$CHECKPOINT_REF" "$COMMIT_ID"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Commit failed" >&2
    exit 0
  fi

  # --- 確率的 gc（1/50 の確率で実行、リポ肥大化防止） ---
  # $RANDOM は bash 組み込み変数。shebang が #!/bin/bash なので使用可能。
  # ロック保持中に同期実行する（--auto 付きなので不要なら即座に終了する）。
  # バックグラウンド実行だとロック解放後に次のチェックポイントと index.lock 競合が起きうる。
  if [ $((RANDOM % 50)) -eq 0 ]; then
    git -C "$SHADOW_REPO" gc --auto --quiet 2>&1 || true
  fi

  # --- 確率的 auto-cleanup（1/50 の確率で実行） ---
  # 環境変数 WORK_CHECKPOINTS_RETENTION_DAYS で保持日数を設定（デフォルト: 0=無効）。
  # delete-checkpoints.sh --older-than と同じロジックだが、既にロック保持中のため
  # 外部スクリプト呼び出しではなくインラインで実行する（デッドロック防止）。
  RETENTION_DAYS="${WORK_CHECKPOINTS_RETENTION_DAYS:-${CFG_RETENTION:-0}}"
  # 非数値の場合は無効化（typo などによるサイレント無効化を防止）
  if ! echo "$RETENTION_DAYS" | grep -q '^[0-9]\+$'; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Invalid WORK_CHECKPOINTS_RETENTION_DAYS='$RETENTION_DAYS', must be a positive integer" >&2
    RETENTION_DAYS=0
  fi
  if [ "$RETENTION_DAYS" -gt 0 ] && [ $((RANDOM % 50)) -eq 0 ]; then
    CUTOFF=$(( $(date +%s) - RETENTION_DAYS * 86400 ))
    CLEANUP_LOG=$(git -C "$SHADOW_REPO" log --format="%h %ct" --all 2>&1)
    if [ $? -ne 0 ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - Auto-cleanup: git log failed: $CLEANUP_LOG" >&2
    else
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        HASH=$(echo "$line" | cut -d' ' -f1)
        TIMESTAMP=$(echo "$line" | cut -d' ' -f2)
        # タイムスタンプが数値でなければスキップ
        if ! echo "$TIMESTAMP" | grep -q '^[0-9]\+$'; then
          continue
        fi
        if [ "$TIMESTAMP" -lt "$CUTOFF" ]; then
          # お気に入りは保護（VS Code の deleteOldSnapshots と同じポリシー）
          if [ -f "$SHADOW_REPO/.favorites" ] && grep -q "^${HASH}$" "$SHADOW_REPO/.favorites" 2>/dev/null; then
            continue
          fi
          # 未削除のもののみ追記
          if ! grep -q "^${HASH}$" "$SHADOW_REPO/.deleted" 2>/dev/null; then
            if ! echo "$HASH" >> "$SHADOW_REPO/.deleted"; then
              echo "$(date '+%Y-%m-%d %H:%M:%S') - Auto-cleanup: failed to write deletion record for $HASH" >&2
              break
            fi
          fi
        fi
      done <<< "$CLEANUP_LOG"
    fi
  fi
) &
disown

exit 0
