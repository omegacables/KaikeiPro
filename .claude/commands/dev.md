---
description: 開発サーバー（next dev）を起動する
allowed-tools: Bash(npm run dev:*), Bash(lsof:*), Bash(curl:*)
---

KaikeiPro の開発サーバーを起動してください。

手順:
1. ポート 3000 が既に使われていないか `lsof -i :3000` で確認する。
   - 既に起動中なら二重起動せず、その旨を伝えて終了する。
2. 空いていれば `npm run dev`（= `next dev --webpack`）を **バックグラウンドで** 起動する。
3. 起動後、サーバーが応答するまで待ち、`http://localhost:3000` の URL を伝える。
   起動ログにエラーが出ていないかも確認する。

注意:
- フォアグラウンドで起動して待ち続けない（ブロックしないこと）。
- 既存の dev サーバーがある場合は勝手に kill しない。必要なら確認を取る。
