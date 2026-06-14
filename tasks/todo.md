# 改修タスク：バッジ誤判定・セキュリティ・入金消込・仕訳学習

計画書: `/Users/adminpc/.claude/plans/validated-drifting-pnueli.md`

## Part B — セキュリティ（最優先・防御境界を先に固める）
- [x] B-1 共通認可ヘルパー `src/lib/authz.ts`（assertClientAccess / resolveClientIdForRecord / assertRecordsAccess / assertFirmAccess / assertClientManagedByFirm / assert(is)SuperAdmin）
- [x] B-2 サービスロール経路に認可付与（ledgers, statements, settlement-report, opening-balances, closing-checklist, pending-reviews, payroll, receipts.deleteReceipts, statement-lines, journals.deleteJournalEntries, clients, moneytree, cards, bank）
- [x] B-3 アカウント作成系の権限昇格修正（auth.ts: createClientPortalAccount / createFirmMemberAccount, firms.ts: inviteFirmMember / createFirm / getFirms）
- [x] B-4 ストレージIDOR（receipt-storage.ts: getReceiptImageUrl/downloadReceiptImage/uploadReceipt, company-documents.ts）
- [x] B-5 Moneytree（authorize/callback route, moneytree.ts）
- [x] B-6 ダッシュボードのロールゲート（(dashboard)/layout.tsx 役割判定リダイレクト, auth-provider フォールバック廃止）※self-service考慮済み
- [x] B-7 CSVフォーミュラインジェクション中和（lib/export.ts）
- [x] B-8a open redirect callback / fetchExchangeRate currency検証 / OCRプロンプト注入緩和
- [x] B-8b ai-journal の低信頼/貸借不一致/OCR不整合時に needs_review＋CSVプロンプト注入緩和
- [x] B-9 DBポリシー是正（migration 038: firms_insert, moneytree token SELECT廃止）

## Part A — (要確認)バッジ誤判定
- [x] A-1 OCRで登録番号と請求書番号を分離（ocr.ts プロンプト + buildOcrFromParsed, types/index.ts OcrResult.document_number）
- [x] A-2 判定ロジック堅牢化（receipt-review.ts: checkInvoiceNumber）※既存データも修正される

## Part D — 仕訳学習機能
- [x] D-1 migration 037（ai_journal_patterns 拡張 + database.ts 型追加）
- [x] D-2 アクション層 `src/actions/learned-rules.ts`
- [x] D-3 読込連携（ai-journal / bank-csv-ai にヒント注入、journal-csv-ai は認可のみ）
- [x] D-4 書込連携（approveJournalSuggestion / createJournalEntry / importBankJournalEntries で学習）
- [x] D-5 UI（学習ルール管理画面 + サイドバー導線）

## Part C — 入金消込刷新
- [x] C-1 「銀行入金から自動消込」ボタン削除（payments/page.tsx）
- [x] C-2 消込コア `reconcileDeposits`（payments.ts, onlyWhenMatchedオプション付き）
- [x] C-3 入金登録のCSV/PDF対応（lib/parse-tabular.ts, deposit-csv-ai.ts, payments/page.tsx UI）
- [x] C-4 仕訳ページ銀行CSVから消込連携（journals/page.tsx, オプトイン・既定ON）
- [x] C-5 created_by 誤り修正（journals/page.tsx）

## 検証
- [x] tsc --noEmit（型チェック通過）
- [ ] npm run build
- [ ] preview で バッジ / 入金消込 / 学習 動作確認
- [ ] マイグレーション 037/038 適用手順の確認

## Review（実装後）

### 完了したこと
- **(要確認)バッジ誤判定**: OCRで登録番号(T+13)と請求書番号を `invoice_number`/`document_number` に分離。`checkInvoiceNumber` は非T文字列を `none` 扱いに変更（＝既存データの誤バッジも解消）。`tsx` で14ケース全て検証済み。
- **セキュリティ（25件）**: 共通認可ヘルパー `src/lib/authz.ts` を新設し、サービスロール経路の全アクション（ledgers/statements/settlement/opening-balances/closing-checklist/pending-reviews/payroll/receipts/statement-lines/journals/clients/moneytree/cards/bank/payments/ocr/receipt-storage/company-documents）に `assertClientAccess`/`resolveClientIdForRecord`/`assertRecordsAccess` を適用。アカウント作成系（auth/firms）の権限昇格を是正。ストレージIDOR・Moneytree・CSVインジェクション・open redirect・通貨検証・AI自動記帳の needs_review ゲート・ダッシュボードのロールゲートを修正。DBポリシー是正（038）。
- **入金消込刷新**: 自動消込ボタン削除。`reconcileDeposits` 中核を抽出。入金登録に CSV/Excel/PDF 取込（AI解析＋取引先推定＋プレビュー）を追加。仕訳ページ銀行CSVの入金行を強マッチのみ消込連携（既定ON）。
- **仕訳学習**: 既存 `ai_journal_patterns` を活性化（037拡張）。`learned-rules.ts` で読み書き。承認/手入力/銀行CSV取込時に学習し、AI仕訳提案へヒント注入。管理画面 `/clients/[id]/learned-rules`。

### 検証
- `tsc --noEmit` 通過 / `npm run build` 成功（全ルートコンパイル）。
- バッジロジックを実モジュールでユニット検証（14/14）。

### 要対応（ユーザー環境）
- **マイグレーション適用が必須**: `037_learned_journal_rules.sql`, `038_security_policy_hardening.sql` を本番/開発DBに適用するまで、仕訳学習の新列・ポリシー変更は反映されない（学習の読み書きは未適用でも握りつぶして安全に動作。管理画面 `listLearnedRules` は037適用後に表示）。
- 認証セッションが必要な画面（消込/学習/各種ダッシュボード）と横断アクセス拒否の動作確認は、ログイン済み環境での手動確認を推奨。

### 既知の設計判断
- ダッシュボードのロールゲートは「事務所管理下の顧問先ユーザー」のみポータルへ誘導。セルフサービス（firm_id=NULL の client_user）は誤って締め出さない。
- 仕訳ページ銀行CSVの消込は `onlyWhenMatched=true`（請求残額と一致する取引先のみ消込）。現金売上等で宛先不明の入金を量産しない。

## フォローアップ修正（2回目）

### ① 対象期間の表示誤り
- **statements/page.tsx**: クライアントの決算月(`fiscal_year_start_month`)が非同期ロードされる前に既定4月で計算していたため、4月以外が期首の顧問先で対象期間・集計が誤表示。決算月ロード完了まで計算・データ取得・表示を保留するよう修正（`fiscalStartMonth` を `null` 初期化＋各fetchをガード＋フッターは「読み込み中…」）。
- **tax/page.tsx**: 期間ラベルが `new Date(ISO文字列)`（UTC解釈→ローカル変換）で月がズレ得たため、文字列を直接パースするタイムゾーン非依存の実装に変更。

### ② 請求書番号が適格請求書として処理される
- **ocr.ts**: `buildOcrFromParsed` で document_type=qualified_invoice でも登録番号(T+13)が無ければ category_invoice(区分記載請求書) に格下げ。非インボイス登録事業者の請求書を「適格請求書」と誤判定しない。
- **receipts/page.tsx**: 既存データ救済として、表示時にも同様の格下げを適用（DB再書き込み不要）。

### ③ AI処理された仕訳の編集
- **journals.ts**: `updateJournalEntryWithLines(id, header, lines)` を新設（所有権・ロック年度チェック、貸借一致検証、明細入替、編集時は needs_review 解除）。
- **ledgers/page.tsx**: 仕訳詳細スライドオーバーに「編集」ボタン＋編集フォーム（日付・摘要・明細の科目/借方/貸方を編集、行追加/削除、貸借バランス表示、保存）。AI・銀行・取込・手動すべての仕訳を編集可能。

検証: `tsc` 通過 / `npm run build` 成功 / dev server で変更4ページが500なし。

## フォローアップ修正（3回目）

### ① インボイス番号なしで保存できない
- **invoices/page.tsx**: 請求書作成(`handleCreateInvoice`)が `invoice_number` 必須で、削除すると保存ボタンが無効化されていた。`invoice_number` 未入力でも保存可能に変更（NOT NULL のため空時のみ自動採番。非インボイス登録事業者の受領請求書等に対応）。保存ボタンの `disabled` からも `invoice_number` 条件を除去。
- 補足: 領収書OCRの「インボイス番号」削除は元々DB上クリアされる（`{...,invoice_number:undefined}` がJSONから除外される）ことを node で確認済み。問題は請求書フォーム側だった。

### ② スマホはPC機能を制限し撮影のみ対応
- **dashboard-shell.tsx**（新規）: ダッシュボードの外枠を分離。PC幅は従来UI、スマホ幅(<768px)は撮影専用画面に切替（サイドバー/ヘッダーのはみ出しを回避）。
- **mobile-capture-screen.tsx**（新規）: スマホ用の最小機能画面。クライアント選択＋区分(受領/発行)＋カメラ撮影/ファイル選択で `uploadReceipt`+`processReceiptOcr` を実行。読み取り・仕訳確認はPCで行う旨を明記。
- **(dashboard)/layout.tsx**: 役割ゲート（前回追加）はサーバー側に残し、描画を `DashboardShell` に委譲。
- 顧問先ポータル(`/portal/[firm]`)は別レイアウトのため影響なし（クライアントのスマホ撮影は従来どおり）。

検証: `tsc` 通過 / `npm run build` 成功 / dev server 起動・/dashboard等は認証リダイレクト（500なし）・ログイン画面はスマホ幅で崩れなし（スクショ確認）。撮影画面は認証必須のため実機（ログイン済み・スマホ）での確認推奨。
