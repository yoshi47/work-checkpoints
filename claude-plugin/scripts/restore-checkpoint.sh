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

if [ ! -d "$SHADOW_REPO/.git" ]; then
  echo "Error: No checkpoints repository found"
  exit 1
fi

# チェックポイントが存在するか確認
cd "$SHADOW_REPO"
if ! git rev-parse --verify "$CHECKPOINT_ID" > /dev/null 2>&1; then
  echo "Error: Checkpoint '$CHECKPOINT_ID' not found"
  exit 1
fi

# チェックポイントの情報を表示
COMMIT_MSG=$(git log -1 --format="%s" "$CHECKPOINT_ID" 2>/dev/null)
COMMIT_DATE=$(git log -1 --format="%ci" "$CHECKPOINT_ID" 2>/dev/null)
echo "Restoring checkpoint: $CHECKPOINT_ID"
echo "  Message: $COMMIT_MSG"
echo "  Date: $COMMIT_DATE"
echo ""

# 復元を実行
# core.worktreeが設定されているので、直接checkoutできる
git checkout "$CHECKPOINT_ID" -- . 2>&1

if [ $? -eq 0 ]; then
  echo "Successfully restored checkpoint: $CHECKPOINT_ID"
else
  echo "Error: Failed to restore checkpoint"
  exit 1
fi
