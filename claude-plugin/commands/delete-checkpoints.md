---
description: チェックポイントを削除
allowed-tools: Bash(*list-checkpoints.sh*), Bash(*delete-checkpoints.sh*)
---

# チェックポイント削除

## 手順

1. まず以下のコマンドでチェックポイント一覧を取得してください：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/list-checkpoints.sh
   ```

2. 一覧をユーザーに表示し、削除方法を尋ねてください：
   - **特定のチェックポイントを削除**: 番号またはIDで指定
   - **Claude作成のチェックポイントをすべて削除**: リネームされたものは保護されます
   - **すべてのチェックポイントを削除**
   - **指定日数より古いチェックポイントを削除**: お気に入りは保護されます

3. ユーザーが選択したら、**削除対象と件数を明示して確認を取ってから**以下のいずれかのコマンドを実行してください：

   特定のIDを削除する場合：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/delete-checkpoints.sh --ids <id1> [id2 ...]
   ```

   Claude作成のチェックポイントをすべて削除する場合：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/delete-checkpoints.sh --claude
   ```

   すべてのチェックポイントを削除する場合：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/delete-checkpoints.sh --all
   ```

   指定日数より古いチェックポイントを削除する場合：
   ```
   ${CLAUDE_PLUGIN_ROOT}/scripts/delete-checkpoints.sh --older-than <days>
   ```

## 注意事項
- 削除はソフトデリートです（`.deleted` ファイルにIDを追加）
- 削除後もチェックポイントデータ自体はシャドウリポジトリに残ります
- `--all` や `--claude` を実行する前に、必ずユーザーに確認してください
- 削除対象の件数をユーザーに伝えてから確認を取ってください
