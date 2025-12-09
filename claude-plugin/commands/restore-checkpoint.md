---
description: チェックポイントを復元
allowed-tools: Bash(*list-checkpoints.sh*), Bash(*restore-checkpoint.sh*)
---

# チェックポイント復元

## 手順

1. まず以下のコマンドでチェックポイント一覧を取得してください：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/list-checkpoints.sh
   ```

2. 一覧をユーザーに表示し、復元したいチェックポイントの番号またはIDを尋ねてください。

3. ユーザーが選択したら、以下のコマンドで復元を実行してください：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/restore-checkpoint.sh <checkpoint-id>
   ```

## 注意事項
- 復元すると現在のワークスペースのファイルが上書きされます
- 復元前に重要な変更がある場合は、ユーザーに確認してください
