# 借入金台帳の再設計 ＋ 対話型AI起票

計画: `~/.claude/plans/crispy-painting-candle.md`
ブランチ: `feat/loan-ledger-redesign`

## P0: 台帳の作り替え

- [x] 1. `supabase/migrations/040_loan_ledger.sql`
  - [x] `loans` のヘッダ化（direction / counterparty_kind / business_partner_id / repayment_terms）
  - [x] `loan_entries`（増減明細）＋ RLS
  - [x] `loan_entry_receipts`（証憑の多対多）＋ RLS
  - [x] `statutory_interest_rates`（認定利息の利率マスタ）
  - [x] 勘定科目 seed（役員借入金 / 役員貸付金）
  - [x] `journal_entries.source` に 'loan' を追加
  - [x] 既存データの自動移行（差額は adjust 明細）
- [x] 2. 型定義（`src/types/index.ts` / `src/types/database.ts`）
- [x] 3. `src/lib/loan-ledger.ts`（純関数）＋ `loan-ledger.test.ts`
- [x] 4. `src/actions/loans.ts` 全面改修 ＋ **認可ガード追加**（既存のIDOR是正）
- [x] 5. UI: 増減明細・残高推移・区分別フォーム出し分け・6章の文字視認性

## P1: 認定利息アラート ＋ AI

- [x] 6. 役員貸付金サマリー・決算日カウントダウン・認定利息試算
- [x] 7. `src/lib/gemini.ts`（共通ラッパー）
- [x] 8. `src/actions/loan-ai.ts`
  - [x] 4-3 自然言語からの起票
  - [x] 4-4 証憑PDFからの一括起票
  - [x] 4-5 曖昧な取引の判別（確認ループ）＋UI接続
- [x] 9. AI確認パネルUI

## 検証

- [x] `npm test` 全通過（99件）
- [x] `npm run build` 通過
- [ ] テストアカウント `qa-test@raqto.local` で画面操作確認（**未実施**: ブラウザ権限が必要）
- [x] 認可ガードを全アクションに追加（既存のIDOR是正）／実データでの越境テストは未実施

## Review

### 実施したこと
- 借入金台帳を「1レコード＝1相手先＋増減明細」に作り替えた。残高はDBに持たず `loan_entries` から常に算出する
- 立替（現金が動かず債務が増える）を区分として追加し、`借方 費用 / 貸方 役員借入金` で仕訳化できるようにした
- 証憑を明細行に多対多で紐付け、証憑内の行番号まで記録できるようにした
- 役員貸付金を `direction='lend'` で同じ構造に載せ、認定利息アラート（決算日カウントダウン → 期末跨ぎで「計上が必要」）を実装
- 対話型AI起票（自然言語 / 通帳PDF一括 / 役員送金の判別）を追加。AIは下書きのみ作り、DBへの反映は人間の操作を必須にした
- **既存の欠陥を是正**: `src/actions/loans.ts` はサービスロールでRLSを迂回しながら認可ガードを一度も呼んでいなかった（IDOR相当）。全アクションに `assertClientAccess` / `resolveClientIdForRecord` を追加

### 設計上の判断（計画から変えた点）
- 増減の符号は `direction × entry_type` ではなく **`entry_type` のみ**で決まる設計にした。残高は各台帳の方向における正の値で表すため（帳簿にマイナス表記を使わない方針に一致）。`direction` は残高の意味づけ（債務か債権か）だけを決める
- `principal` / `current_balance` / `loan_type` を DROP せず非推奨コメントに留めた。マイグレーション適用とコードデプロイが同時でないため、旧コードが動き続けられる状態を保つ
- 仕訳の借方貸方ルールを `src/lib/loan-ledger.ts` の純関数 `buildJournalLines` に切り出し、単体テストの対象にした

### 残課題
- **画面操作での動作確認が未実施**（ブラウザ起動の権限が必要）
- 認定利息の利率 seed（2021〜2024）は暫定値。国税庁の公表値で要検証。2025年度以降は未登録
- P2以降（仕訳の逆方向反映・整合性チェック・内訳明細書出力・質問応答）は後続PR
- 既存7ファイルの `getGeminiClient` コピペは未集約（新規分のみ `src/lib/gemini.ts` を使用）
