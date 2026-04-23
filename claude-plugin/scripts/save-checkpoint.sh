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
  LAST_COMMIT_TIME=$(git -C "$SHADOW_REPO" log -1 --format=%ct 2>/dev/null || echo 0)
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

    # fsmonitor と untrackedCache を有効化（大規模リポのスキャン高速化）
    git -C "$SHADOW_REPO" config core.fsmonitor true
    git -C "$SHADOW_REPO" config core.untrackedcache true

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
  MSG_TEMPLATE="${CFG_MSG_FMT:-\${branch} @ \${date}}"
  FORMATTED_MSG="${MSG_TEMPLATE//\$\{branch\}/$BRANCH}"
  FORMATTED_MSG="${FORMATTED_MSG//\$\{date\}/$TIMESTAMP}"
  TITLE="[Claude] $FORMATTED_MSG"
  if [ -n "$USER_PROMPT" ]; then
    MESSAGE="$TITLE

$USER_PROMPT"
  else
    MESSAGE="$TITLE"
  fi

  git -C "$SHADOW_REPO" add -A || { echo "$(date '+%Y-%m-%d %H:%M:%S') - git add failed" >&2; exit 0; }

  # ステージングエリアに変更がなければコミットをスキップ
  if git -C "$SHADOW_REPO" diff --cached --quiet 2>/dev/null; then
    exit 0
  fi

  printf '%s' "$MESSAGE" | git -C "$SHADOW_REPO" commit -F - || {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Commit failed" >&2
    exit 0
  }

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
