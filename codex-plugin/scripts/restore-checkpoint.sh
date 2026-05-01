#!/bin/bash

if [ -z "$1" ]; then
  echo "Error: Checkpoint ID is required"
  echo "Usage: restore-checkpoint.sh <checkpoint-id>"
  exit 1
fi

CHECKPOINT_ID="$1"

# シャドウリポジトリのパスを計算
WORKSPACE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$WORKSPACE_ROOT" ]; then
  echo "Error: Not a Git repository"
  exit 1
fi

REMOTE_URL=$(git remote get-url origin 2>/dev/null)
if [ -n "$REMOTE_URL" ]; then
  REPO_ID=$(echo -n "$REMOTE_URL" | shasum -a 256 | cut -c1-12)
else
  REPO_ID=$(echo -n "$WORKSPACE_ROOT" | shasum -a 256 | cut -c1-12)
fi

SHADOW_REPO="$HOME/.work-checkpoints/$REPO_ID"
LOG_FILE="$SHADOW_REPO/checkpoint.log"

if [ ! -d "$SHADOW_REPO/.git" ]; then
  echo "Error: No checkpoints repository found"
  exit 1
fi

# チェックポイントが存在するか確認
if ! git -C "$SHADOW_REPO" rev-parse --verify "$CHECKPOINT_ID" > /dev/null 2>&1; then
  echo "Error: Checkpoint '$CHECKPOINT_ID' not found"
  exit 1
fi

# チェックポイントの情報を表示
COMMIT_MSG=$(git -C "$SHADOW_REPO" log -1 --format="%s" "$CHECKPOINT_ID" 2>/dev/null)
COMMIT_DATE=$(git -C "$SHADOW_REPO" log -1 --format="%ci" "$CHECKPOINT_ID" 2>/dev/null)
echo "Restoring checkpoint: $CHECKPOINT_ID"
echo "  Message: $COMMIT_MSG"
echo "  Date: $COMMIT_DATE"
echo ""

# --- mkdir ベースの排他ロック ---
# save-checkpoint.sh と同一のパスを使用（並行 git checkout / index.lock 競合を防止）
LOCK_DIR="$SHADOW_REPO/.checkpoint.lock"

acquire_lock() {
  local timeout=10
  # restore は対話操作なのでタイムアウトと同程度の stale しきい値で素早く回復する
  local stale_threshold=$timeout
  local i=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ -d "$LOCK_DIR" ]; then
      if [ "$(uname)" = "Darwin" ]; then
        local lock_time=$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)
      else
        local lock_time=$(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)
      fi
      local age=$(( $(date +%s) - lock_time ))
      if [ "$age" -gt "$stale_threshold" ]; then
        rm -rf "$LOCK_DIR" 2>/dev/null
        continue
      fi
    fi
    sleep 0.5
    i=$((i + 1))
    if [ "$i" -ge $((timeout * 2)) ]; then
      echo "Error: Could not acquire lock on $LOCK_DIR (another checkpoint operation may be running)"
      return 1
    fi
  done
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM HUP
  return 0
}

acquire_lock || exit 1

# 復元を実行（core.worktree が設定されているので直接 checkout 可能）
git -C "$SHADOW_REPO" checkout "$CHECKPOINT_ID" -- . 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  CURRENT_BRANCH=$(git -C "$WORKSPACE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  if ! printf '%s - Restored to %s on branch %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$CHECKPOINT_ID" "$CURRENT_BRANCH" >> "$LOG_FILE" 2>/dev/null; then
    echo "Warning: could not append restore record to $LOG_FILE" >&2
  fi
  echo "Successfully restored checkpoint: $CHECKPOINT_ID"
else
  echo "Error: Failed to restore checkpoint (git exit $rc)" >&2
  exit 1
fi
