#!/bin/bash

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

# シャドウリポジトリの初期化（必要な場合）
if [ ! -d "$SHADOW_REPO/.git" ]; then
  mkdir -p "$SHADOW_REPO"
  git -C "$SHADOW_REPO" init
  git -C "$SHADOW_REPO" config core.worktree "$WORKSPACE_ROOT"
  git -C "$SHADOW_REPO" config user.email "work-checkpoints@local"
  git -C "$SHADOW_REPO" config user.name "Work Checkpoints"
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

cd "$SHADOW_REPO"
git add -A
git diff --cached --quiet || git commit -m "$MESSAGE"
