#!/bin/bash

# 何があっても正常終了してユーザー操作をブロックしない
trap 'exit 0' EXIT ERR

# stdinからJSONを読み取り、プロンプトを抽出
INPUT=$(cat)
if command -v jq &> /dev/null; then
  USER_PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null | head -c 500)
else
  USER_PROMPT=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('prompt', '')[:500])" 2>/dev/null)
fi

# 古いロックファイルを削除する関数（60秒以上古い場合）
remove_stale_lock() {
  local lock_file="$1"
  if [ -f "$lock_file" ]; then
    # ロックファイルが60秒以上前のものか確認
    if [ "$(uname)" = "Darwin" ]; then
      # macOS
      local file_time=$(stat -f %m "$lock_file" 2>/dev/null || echo 0)
    else
      # Linux
      local file_time=$(stat -c %Y "$lock_file" 2>/dev/null || echo 0)
    fi
    local current_time=$(date +%s)
    local age=$((current_time - file_time))

    # 60秒以上古い場合は削除
    if [ "$age" -gt 60 ]; then
      rm -f "$lock_file" 2>/dev/null
      return 0
    fi
  fi
  return 1
}

# Gitロック待機関数（最大3秒）
wait_for_git_lock() {
  local repo="$1"
  local lock_file="$repo/.git/index.lock"
  local config_lock="$repo/.git/config.lock"

  # 古いロックファイルを削除
  remove_stale_lock "$lock_file"
  remove_stale_lock "$config_lock"

  # 短時間待機
  local i=0
  while [ -f "$lock_file" ] && [ "$i" -lt 6 ]; do
    sleep 0.5
    i=$((i + 1))
  done

  # まだロックファイルが残っていれば再度削除を試みる
  if [ -f "$lock_file" ]; then
    remove_stale_lock "$lock_file"
  fi

  [ ! -f "$lock_file" ]
}

# リトライ付きgit add（最大3回）
safe_git_add() {
  local repo="$1"
  for i in 1 2 3; do
    wait_for_git_lock "$repo" || return 1
    git -C "$repo" add -A 2>/dev/null && return 0
    sleep 0.3
  done
  return 1
}

# リトライ付きgit commit（最大3回）
safe_git_commit() {
  local repo="$1"
  local message="$2"
  for i in 1 2 3; do
    wait_for_git_lock "$repo" || return 1
    git -C "$repo" diff --cached --quiet 2>/dev/null && return 0
    git -C "$repo" commit -m "$message" 2>/dev/null && return 0
    sleep 0.3
  done
  return 1
}

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

# エラーをログファイルにリダイレクト（デバッグ用）
mkdir -p "$SHADOW_REPO"
exec 2>>"$LOG_FILE"

# シャドウリポジトリの初期化（必要な場合）
if [ ! -d "$SHADOW_REPO/.git" ]; then
  git -C "$SHADOW_REPO" init
  git -C "$SHADOW_REPO" config core.worktree "$WORKSPACE_ROOT"
  git -C "$SHADOW_REPO" config user.email "work-checkpoints@local"
  git -C "$SHADOW_REPO" config user.name "Work Checkpoints"
  git -C "$SHADOW_REPO" config core.quotepath false
  git -C "$SHADOW_REPO" config i18n.commitencoding utf-8
  git -C "$SHADOW_REPO" config i18n.logoutputencoding utf-8
fi

# core.worktreeを更新
git -C "$SHADOW_REPO" config core.worktree "$WORKSPACE_ROOT"

# スナップショット作成
BRANCH=$(git -C "$WORKSPACE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date "+%Y/%m/%d %H:%M:%S")
TITLE="[Claude] $BRANCH @ $TIMESTAMP"
if [ -n "$USER_PROMPT" ]; then
  MESSAGE="$TITLE

$USER_PROMPT"
else
  MESSAGE="$TITLE"
fi

cd "$SHADOW_REPO" || exit 0
if safe_git_add "$SHADOW_REPO"; then
  safe_git_commit "$SHADOW_REPO" "$MESSAGE" || echo "$(date '+%Y-%m-%d %H:%M:%S') - Commit failed, see log: $LOG_FILE" >&2
fi

# ログファイルパスを出力
echo "Checkpoint log: $LOG_FILE"
exit 0
