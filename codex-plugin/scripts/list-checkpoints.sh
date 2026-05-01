#!/bin/bash

# シャドウリポジトリのパスを計算（save-checkpoint.shと同じロジック）
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
  echo "No checkpoints found."
  exit 0
fi

# .deletedファイルを読み込む
DELETED_FILE="$SHADOW_REPO/.deleted"

# .renamedファイルを読み込む
RENAMED_FILE="$SHADOW_REPO/.renamed"

# 削除済みIDかチェックする関数
is_deleted() {
  local check_id="$1"
  if [ -f "$DELETED_FILE" ]; then
    grep -q "^${check_id}$" "$DELETED_FILE" 2>/dev/null
    return $?
  fi
  return 1
}

# カスタム名を取得する関数
get_custom_name() {
  local check_id="$1"
  if [ -f "$RENAMED_FILE" ]; then
    grep "^${check_id}	" "$RENAMED_FILE" 2>/dev/null | cut -f2
  fi
}

# チェックポイント一覧を取得
echo "=== Checkpoints ==="
echo ""

cd "$SHADOW_REPO"
COUNT=0

while IFS= read -r line; do
  # 形式: "abc1234 commit message"
  ID=$(echo "$line" | cut -d' ' -f1)
  MESSAGE=$(echo "$line" | cut -d' ' -f2-)

  # 削除済みならスキップ
  if is_deleted "$ID"; then
    continue
  fi

  COUNT=$((COUNT + 1))

  # カスタム名があればそれを使用
  CUSTOM_NAME=$(get_custom_name "$ID")
  if [ -n "$CUSTOM_NAME" ]; then
    DISPLAY_NAME="$CUSTOM_NAME"
  else
    DISPLAY_NAME="$MESSAGE"
  fi

  # 日時を取得
  DATE=$(git log -1 --format="%ci" "$ID" 2>/dev/null | cut -d' ' -f1,2)

  echo "$COUNT) $ID - $DISPLAY_NAME ($DATE)"
done < <(git log --oneline --all 2>/dev/null)

if [ "$COUNT" -eq 0 ]; then
  echo "No checkpoints found."
fi

echo ""
echo "Total: $COUNT checkpoint(s)"
