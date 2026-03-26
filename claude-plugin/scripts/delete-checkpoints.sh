#!/bin/bash

# チェックポイント削除スクリプト（ソフトデリート）
# Usage:
#   delete-checkpoints.sh --ids <id1> [<id2> ...]   指定IDを削除
#   delete-checkpoints.sh --claude                   Claude作成分をすべて削除（リネーム済みは保護）
#   delete-checkpoints.sh --all                      すべて削除
#   delete-checkpoints.sh --older-than <days>        指定日数より古いものを削除（お気に入りは保護）

# シャドウリポジトリのパスを計算（save-checkpoint.sh と同じロジック）
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

if [ ! -d "$SHADOW_REPO/.git" ]; then
  echo "Error: No checkpoints repository found"
  exit 1
fi

DELETED_FILE="$SHADOW_REPO/.deleted"
RENAMED_FILE="$SHADOW_REPO/.renamed"
FAVORITES_FILE="$SHADOW_REPO/.favorites"

# --- mkdir ベースの排他ロック（save-checkpoint.sh と同じ機構・同じタイムアウト） ---
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
    if [ "$i" -ge $((timeout * 2)) ]; then
      echo "Error: Could not acquire lock (timeout after ${timeout}s). Another checkpoint operation may be in progress."
      exit 1
    fi
  done
  trap "rm -rf '$LOCK_DIR'" EXIT
  return 0
}

# 削除済みIDかチェックする関数
is_deleted() {
  local check_id="$1"
  if [ -f "$DELETED_FILE" ]; then
    grep -q "^${check_id}$" "$DELETED_FILE" 2>/dev/null
    return $?
  fi
  return 1
}

# お気に入りかチェックする関数
is_favorite() {
  local check_id="$1"
  if [ -f "$FAVORITES_FILE" ]; then
    grep -q "^${check_id}$" "$FAVORITES_FILE" 2>/dev/null
    return $?
  fi
  return 1
}

# カスタム名があるかチェックする関数
is_renamed() {
  local check_id="$1"
  if [ -f "$RENAMED_FILE" ]; then
    grep -q "^${check_id}	" "$RENAMED_FILE" 2>/dev/null
    return $?
  fi
  return 1
}

# IDを.deletedファイルに追記して削除する関数
# ロックを保持した状態で呼び出すこと（read-check-write のアトミック性を保証するため）
# 戻り値: 0=新規削除, 1=書き込みエラー, 2=既に削除済み
delete_id() {
  local id="$1"
  if is_deleted "$id"; then
    echo "  Already deleted: $id"
    return 2
  fi
  if ! echo "$id" >> "$DELETED_FILE"; then
    echo "  Error: Failed to write deletion record for $id"
    return 1
  fi
  echo "  Deleted: $id"
  return 0
}

# --- メイン処理 ---
MODE="$1"
if [ -n "$MODE" ]; then
  shift
fi

cd "$SHADOW_REPO" || { echo "Error: Cannot change to shadow repo directory"; exit 1; }

# git log の出力を取得（全モードで共通）
get_checkpoint_log() {
  local output
  output=$(git log --oneline --all 2>&1)
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "Error: Failed to read checkpoint history: $output"
    exit 1
  fi
  echo "$output"
}

if [ "$MODE" = "--all" ]; then
  acquire_lock
  LOG_OUTPUT=$(get_checkpoint_log)
  COUNT=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ID=$(echo "$line" | cut -d' ' -f1)
    delete_id "$ID"
    local_rc=$?
    if [ $local_rc -eq 0 ]; then
      COUNT=$((COUNT + 1))
    elif [ $local_rc -eq 1 ]; then
      echo "Error: Aborting due to write failure"
      exit 1
    fi
  done <<< "$LOG_OUTPUT"

  echo "Deleted $COUNT checkpoint(s)."

elif [ "$MODE" = "--claude" ]; then
  acquire_lock
  LOG_OUTPUT=$(get_checkpoint_log)
  COUNT=0
  SKIPPED=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    ID=$(echo "$line" | cut -d' ' -f1)
    MESSAGE=$(echo "$line" | cut -d' ' -f2-)

    if is_deleted "$ID"; then
      continue
    fi

    # [Claude] プレフィックスで判定
    case "$MESSAGE" in
      "[Claude]"*) ;;
      *) continue ;;
    esac

    # リネーム済みは保護
    if is_renamed "$ID"; then
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    delete_id "$ID"
    local_rc=$?
    if [ $local_rc -eq 0 ]; then
      COUNT=$((COUNT + 1))
    elif [ $local_rc -eq 1 ]; then
      echo "Error: Aborting due to write failure"
      exit 1
    fi
  done <<< "$LOG_OUTPUT"

  echo "Deleted $COUNT Claude-created checkpoint(s)."
  if [ "$SKIPPED" -gt 0 ]; then
    echo "Skipped $SKIPPED renamed checkpoint(s) (protected)."
  fi

elif [ "$MODE" = "--older-than" ]; then
  DAYS="$1"
  if [ -z "$DAYS" ] || ! echo "$DAYS" | grep -q '^[0-9]\+$' || [ "$DAYS" -lt 1 ]; then
    echo "Error: --older-than requires a positive integer (days)"
    echo "Usage: delete-checkpoints.sh --older-than <days>"
    echo "  (Use --all to delete all checkpoints)"
    exit 1
  fi

  acquire_lock
  CUTOFF=$(( $(date +%s) - DAYS * 86400 ))
  COUNT=0
  SKIPPED_FAVORITES=0
  # %h=短縮ハッシュ, %ct=コミッタータイムスタンプ(UNIX)
  LOG_OUTPUT=$(git log --format="%h %ct" --all 2>&1)
  if [ $? -ne 0 ]; then
    echo "Error: Failed to read checkpoint history: $LOG_OUTPUT"
    exit 1
  fi
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    HASH=$(echo "$line" | cut -d' ' -f1)
    TIMESTAMP=$(echo "$line" | cut -d' ' -f2)

    # タイムスタンプが数値でなければスキップ
    if ! echo "$TIMESTAMP" | grep -q '^[0-9]\+$'; then
      echo "  Warning: Skipping malformed entry: $line"
      continue
    fi

    if [ "$TIMESTAMP" -lt "$CUTOFF" ]; then
      # お気に入りは保護（VS Code の deleteOldSnapshots と同じポリシー）
      if is_favorite "$HASH"; then
        SKIPPED_FAVORITES=$((SKIPPED_FAVORITES + 1))
        continue
      fi

      delete_id "$HASH"
      local_rc=$?
      if [ $local_rc -eq 0 ]; then
        COUNT=$((COUNT + 1))
      elif [ $local_rc -eq 1 ]; then
        echo "Error: Aborting due to write failure"
        exit 1
      fi
    fi
  done <<< "$LOG_OUTPUT"

  echo "Deleted $COUNT checkpoint(s) older than $DAYS day(s)."
  if [ "$SKIPPED_FAVORITES" -gt 0 ]; then
    echo "Skipped $SKIPPED_FAVORITES favorite(s) (protected)."
  fi

elif [ "$MODE" = "--ids" ]; then
  if [ $# -eq 0 ]; then
    echo "Error: No checkpoint IDs specified"
    echo "Usage: delete-checkpoints.sh --ids <id1> [id2 ...]"
    exit 1
  fi

  acquire_lock
  COUNT=0
  for CHECKPOINT_ID in "$@"; do
    # チェックポイントが存在するか確認
    if ! git rev-parse --verify "$CHECKPOINT_ID" > /dev/null 2>&1; then
      echo "  Warning: Checkpoint '$CHECKPOINT_ID' not found, skipping"
      continue
    fi
    delete_id "$CHECKPOINT_ID"
    local_rc=$?
    if [ $local_rc -eq 0 ]; then
      COUNT=$((COUNT + 1))
    elif [ $local_rc -eq 1 ]; then
      echo "Error: Aborting due to write failure"
      exit 1
    fi
  done

  echo ""
  echo "Deleted $COUNT checkpoint(s)."

else
  echo "Usage:"
  echo "  delete-checkpoints.sh --ids <id1> [id2 ...]   Delete specific checkpoints"
  echo "  delete-checkpoints.sh --claude                 Delete all Claude-created checkpoints"
  echo "  delete-checkpoints.sh --all                    Delete all checkpoints"
  echo "  delete-checkpoints.sh --older-than <days>      Delete checkpoints older than N days"
  exit 1
fi
