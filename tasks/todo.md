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

---

# 改修タスク：バグ修正＋決算書の一般的な帳票化（2026-07-03）

## 決算書（表紙付き決算報告書）の刷新
- [x] settlement-report.ts: B/Sを区分表示化（流動資産／固定資産（有形・無形・投資その他）／繰延資産、流動負債／固定負債、株主資本）。繰越利益剰余金に当期純利益を算入し「うち当期純利益」を内書き
- [x] report/[year]/page.tsx: 一般的な決算書の見た目へ全面刷新
  - 明朝体（Hiragino Mincho 等）・和暦表記（令和/平成）・△マイナス表記・（単位：円）
  - 表紙: 決算報告書・事業年度（自/至）・会社名・住所・TEL・作成者（会計事務所）
  - 貸借対照表: 勘定式（左=資産の部／右=負債の部・純資産の部）
  - 損益計算書: 報告式（内訳・金額の2列）
  - 株主資本等変動計算書: 横形式マトリクス（当期首残高/当期変動額/当期末残高）
  - 個別注記表・販売費及び一般管理費の明細

## バグ修正
- [x] lib/parse-tabular.ts: CSVの引用符対応（"1,234" のカンマ・改行・""エスケープ）。ExcelJSのリッチテキスト/数式/ハイパーリンクセルが [object Object] になる問題を修正
- [x] actions/invoices.ts: deleteInvoice/deleteAllInvoices に認可ガード追加（resolveClientIdForRecord/assertClientAccess）。請求書本体が削除できた場合のみ仕訳を連動削除するよう修正
- [x] actions/closing.ts: 減価償却を会計年度・月割りベースに修正（取得年度の月割り、償却可能限度額の上限、定率法の年度窓計算）

## 検証
- [x] tsc --noEmit / npm run build 通過
- [x] CSVパーサ・減価償却のユニット検証（全ケース合格）
- [x] 実データ（株式会社MRコネクト・令和7年3月期）でプレビュー表示確認（全6シート・コンソールエラーなし・貸借一致）
- 備考: エージェント指摘の「認可漏れ9件」はRLS付きクライアント使用のため誤検知と判断（本プロジェクトの規約: サービスロール経路のみ明示認可）

---

# 改修タスク：期間表示の整合性修正（2026-07-03 追記）

- [x] tax/page.tsx: 消費税ページの対象期間を fiscal_years テーブルから clients.fiscal_year_start_month ベースに変更（他画面と基準統一。fiscal_years 未登録クライアントで「会計年度が未設定です」となり機能しなかった問題も解消）
- [x] closing.ts getActiveFiscalYear: fiscal_years 未登録時にクライアントの決算月から当期分を自動作成（決算処理ページが空になる問題の解消）＋ assertClientAccess 追加
- [x] closing/page.tsx: 決算整理仕訳の created_by に clientId を渡していた誤りを修正（useAuth の user.id へ）
- [x] ledgers/page.tsx: 「今年度」プリセットが「今月」と同じ範囲だったバグを修正（決算月基準の会計年度に）
- [x] clients/page.tsx 新規顧問先ダイアログ: 「決算開始月」（期首月を直接選択）→「決算月」に統一（設定ページと同じ変換 settlementMonth/startMonthFromSettlement）＋会計年度プレビュー表示
- [x] 決算月表示の統一: clients/[id]/page.tsx・clients/page.tsx・portal settings の独自計算式を settlementMonth() に置換
- [x] 「会計年度: N月〜翌M月」表記が期首1月のとき「翌12月」になる誤表示を修正（settings / clients 新規ダイアログ）
- [x] 検証: tsc / build 通過。実データで税務ページ期間（3月〜2月）・元帳「今年度」（2026-03-01〜2027-02-28）・決算処理の年度自動作成（Renaxis 2026-05-01〜2027-04-30）を確認

## 未解決（要ユーザー確認）
- 株式会社MRコネクト: fiscal_year_start_month=3（=2月決算扱い）だが fiscal_years 行は 2025-04-01〜2026-03-31（=3月決算）で矛盾。実際の決算月の確認が必要（3月決算なら設定ページで決算月を3月に変更）

---

# 改修タスク：ポータルから決算月を変更可能に（2026-07-03 追記）

- [x] portal/[firm]/settings: 会社情報の編集フォームに「決算月」セレクタを追加（settlementMonth/startMonthFromSettlement 変換、会計年度プレビュー付き）
- [x] 決算月変更時は確認ダイアログを表示（全帳票の集計期間に影響する旨＋会計事務所と確認を推奨）
- [x] updateClient は既に admin 経路＋assertClientAccess 済みのため追加のサーバー変更・マイグレーション不要（firm_id 変更は super_admin のみのまま）
- [x] Next.js PageProps 検証エラーの根治: page.tsx から追加 export していた5ページ（tax/audit/company-documents/invoices/receipts）を content.tsx に分離し、page.tsx は薄いラッパーに（settings/documents の import も追随）
- [x] 検証: tsc / build 通過。ポータルに顧問先ユーザーでログインし、決算月 4月→3月 変更（確認ダイアログ表示→DB反映）を確認後、データを元に戻し検証アカウント削除。分離した5ページのレンダリングもスモークテスト済み

---

# 新機能：経営ダッシュボード（ポータル「経営」タブ、2026-07-03 追記）

- [x] actions/executive-summary.ts: getExecutiveSummary(clientId) 新設（assertClientAccess 済み）
  - 会社の財産: 現金・預金／総資産／負債／純資産（=資産−負債）を基準日時点で集計
  - 業績: 当期の売上・利益の累計＋月次推移（現金残高の月末推移も）
  - 役員報酬・社員給与: 給与台帳（payroll_records, employee_type で役員/従業員区分）優先、未登録なら仕訳の科目（役員報酬／給料・給与・賃金）から自動集計
- [x] portal/[firm]/company/page.tsx: スマホ最適化ダッシュボード
  - 現金・預金のヒーロー表示＋残高スパークライン、売上バー＋利益ドットの月次チャート（SVG自作）
  - 役員報酬カード（直近月・今期累計・役員別）、社員給与カード（直近月合計・人数・従業員別・手取り）
  - 金額の目隠しトグル（外出先での閲覧用）・更新ボタン・エラー表示
- [x] ポータルのボトムナビに「経営」タブを追加（6タブ化に伴い幅調整）
- [x] 修正: 認証解決前に useData が一度だけ実行され読み込みが終わらない問題 → clientId 解決に追従する fetch に変更
- [x] 検証: tsc / build 通過。実データ（MRコネクト）でスマホビューポート表示・目隠しトグル・会計年度表示（2026/04〜2027/03）を確認。検証アカウントは削除済み

---

# 改修タスク 2026-07-05：帳票D&D＋自動分類・Raqto同期修正

## Part E — Raqto受発注→帳票読み込みの検証・修正
- [x] E-1 検証: Raqto側スキーマ/データとコードの整合（MCPでDB直接確認）
- [x] E-2 raqto-sync.ts: 削除済み注文の除外（deleted_at IS NULL フィルタ）
- [x] E-3 raqto-sync.ts: 受注→請求書の二重取込防止（order由来とdocument由来の重複）
- [x] E-4 raqto-sync.ts: 認可強化（assertClientAccess）
- [x] E-5 receipt-storage.ts: raqto:// 帳票のPDF閲覧対応（Raqto documentsバケットの署名URL）
- [x] E-6 .env.local.example に RAQTO_SUPABASE_URL / RAQTO_SUPABASE_SERVICE_ROLE_KEY を追記

## Part F — 帳票管理ページ: D&Dアップロード＋自動分類
- [x] F-1 document_type に purchase_order（発注書）/ goods_receipt（受領書）を追加（ocr.ts プロンプト・types）
- [x] F-2 receipts/content.tsx: 新分類のラベル・バッジ、onlyDocTypes プロップ、raqto:// PDF表示
- [x] F-3 documents/page.tsx: ドラッグ&ドロップアップロードゾーン（複数ファイル、自動OCR分類）
- [x] F-4 documents/page.tsx: 「受発注書類」タブ追加（発注書・受領書・見積書・納品書・契約書）

## Part G — 検証・リリース
- [x] G-1 tsc --noEmit / npm run build
- [ ] G-2 GitHub push (main)
- [ ] G-3 デプロイ確認

## レビュー（2026-07-05 実施結果）
- コードレビュー（3系統の並列レビュア + 検証）で以下を検出・修正:
  - [重大] getRaqtoDocumentUrl のIDOR: image_path偽造で他社Raqto帳票の署名URL取得が可能だった → raqto_integrations.raqto_company_id との照合を追加
  - raqto-sync: 受注(order)由来とドキュメント由来の請求書二重取込 → 事前一括取得のSetで排除（ループ内逐次クエリも解消）
  - raqto-sync: 削除済み注文(deleted_at)の取込 → フィルタ追加
  - ledgers の証憑プレビューが Raqto PDF を <img> 表示 → PDF判定追加
  - dropzone: stale closure による並行アップロード、dragleave フリッカー、file.type 空のD&Dファイル拒否、OCRエラー不可視 → 修正
  - document_type の型定義4重複 → types/index.ts の DOCUMENT_TYPES に一元化
  - refreshKey での全タブ再マウント（操作状態消失） → refreshToken プロップでの refetch に変更
- 未対応（設計判断）: アップロードUI3箇所（portal/journals/documents）の共通フック化は影響範囲が広いため見送り。次回リファクタ候補。
- 環境設定の注意: RAQTO_SUPABASE_URL / RAQTO_SUPABASE_SERVICE_ROLE_KEY が .env.local に未設定。Raqto同期・Raqto帳票閲覧はローカルでは動作しない。Vercel側の環境変数を要確認。
