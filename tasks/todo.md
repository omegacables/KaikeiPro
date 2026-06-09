# 領収書「発行」/「受領」タブの機能差別化

## 背景
証憑管理の「発行」「受領」タブは同一機能。会計上は別物（発行＝売上側／受領＝経費・仕入側）なので差別化する。
ユーザー指定：
- 発行：証憑管理タブ内での機能差別化（新規PDF作成は不要）
- 受領：①インボイス番号確認の強化 ②経費計上のAI仕訳 ③支払方法・支払先の管理

## タスク
- [x] 1. backend: `ai-journal.ts` `generateJournalSuggestion` を direction 対応に
      - received → 経費仕訳（借方=費用, 貸方=支払手段）※現状維持
      - issued → 売上仕訳（借方=入金手段, 貸方=売上高+仮受消費税）
- [x] 2. frontend: `ReceiptsPageContent` を direction 対応に
      - 用語: received=支払先/支払方法, issued=宛先/入金方法, all=取引先/支払方法
      - 受領: インボイス番号の検証バッジ（適格/要確認/番号なし）をカード・一覧・詳細に追加
      - 受領: インボイスフィルター（全て/適格のみ/未登録のみ）追加 + 仕入税額控除の注記
      - 発行: インボイス確認UIは出さない（売上側のため）
- [x] 3. 検証: tsc=0 / dev server ログ エラー0

## レビュー
### backend (`src/actions/ai-journal.ts`)
- `generateJournalSuggestion` を区分対応に分岐。`receipt.direction` を読み、
  - 受領 → 従来どおり経費・仕入の仕訳プロンプト
  - 発行 → 売上計上プロンプト（貸方=売上高＋仮受消費税、借方=入金手段／現金・普通預金・売掛金、tax_category=sales_*）
- OCRが `direction` を判定済み（migration 021、ocr.ts L265）なので追加のデータ変更は不要。

### frontend (`src/app/(dashboard)/clients/[id]/receipts/page.tsx`)
- 区分由来の用語: 受領=支払先/支払方法、発行=宛先/入金方法、全体=取引先/支払方法。
- インボイス検証ヘルパー `checkInvoiceNumber`（T＋13桁）を追加し、受領側のみ
  カード・一覧列・詳細・フィルターに「適格／要確認／番号なし」を表示。
- 詳細パネルは受領側で番号が無くても確認結果＋仕入税額控除の注記を常時表示。
- 発行側ではインボイス確認UIを非表示。

### 検証
- `tsc --noEmit` = exit 0
- dev server ログ エラー0、/documents 各タブ 200。

### 残課題（任意）
- 既存の発行レシートで誤って経費仕訳が作成済みのものは、再生成（詳細パネルの再OCR/仕訳提案）で売上仕訳に直せる。
- 発行レシートの自動仕訳は OCR の direction 判定精度に依存。

---

# 追加: 証憑管理に「処理中」タブを新設

## 変更
- [x] `ReceiptsPageContent` に `processingOnly` / `hideProcessingSection` プロパティを追加
      - processingOnly: 処理中の証憑のみ表示。書類種別タブ・フィルタ・一覧・サマリーを非表示、0件時は専用空状態。
      - hideProcessingSection: 区分タブではインラインの処理中セクションを抑制（処理中タブに集約）。
- [x] `documents/page.tsx` に「処理中」タブを追加（件数バッジ付き、10秒ポーリング）
      - 受領/発行タブには `hideProcessingSection` を付与。
      - 処理中タブは `<ReceiptsPageContent hideHeader processingOnly />`。
- [x] 単体 `/receipts` ページは従来どおりインラインの処理中セクションを表示（プロパティ未指定）。

## 検証
- `tsc --noEmit` = exit 0
- dev server: 編集途中の一時的な構文エラーは解消済み。最終状態で /documents 各タブ 200、件数ポーリング動作。

---

# 追加: 証憑管理に「明細書」タブを新設（銀行明細の分離）

## 背景
銀行明細（document_type="statement"）が領収書（受領）に混在し「明細書」バッジで表示されていた。
独立した「明細書」タブに分離する（ユーザー選択: 証憑管理に新設）。
将来的に「明細から取引を抽出・仕訳化」する機能を載せる土台とする。

## 変更
- [x] `ReceiptsPageContent` に `lockedDocType?: DocumentType` / `excludeDocTypes?: DocumentType[]` プロパティ追加
      - `classifiedReceipts` 段階で固定/除外を先に適用し、件数バッジ・種別タブ・一覧の母集合を一致させる。
      - `lockedDocType` 時は方向（発行/受領）の概念がないため `effectiveDirection="all"` に固定。
      - `lockedDocType` 時は書類種別タブ・方向フィルターを非表示。
      - `showInvoiceCheck = !isIssued && !lockedDocType`（明細書ではインボイス確認UIを出さない）。
- [x] `documents/page.tsx`
      - DocumentTab に `"statements"` 追加、タブ配列に「明細書」(FileSpreadsheet) を受領/発行の後に挿入。
      - 受領/発行タブに `excludeDocTypes={["statement"]}` を付与（明細書を除外）。
      - 明細書タブは `<ReceiptsPageContent hideHeader lockedDocType="statement" hideProcessingSection />`。

## 検証
- `tsc --noEmit` = exit 0
- dev server: /documents 200 継続、エラーなし。

## 次フェーズ（ユーザー希望: 明細から取引を抽出・仕訳化）
- 大型機能のため別途設計・提案する。
  OCRで明細を複数行パース → 取引抽出 → 仕訳/口座取引化 → レビューUI。

---

# 機能: 明細書から取引を抽出して仕訳化

## ユーザー確定方針
- 相手勘定（固定側）: **明細種別から自動推定**（銀行明細→普通預金 / クレカ明細→未払金）
- 抽出行の保存: **専用テーブル新設**（おまかせ）

## 設計判断（再利用と回避）
- 既存 `autoCreateJournalFromBankTransaction`（ai-journal.ts）のAI仕訳プロンプト・科目解決を踏襲。
- 既存銀行フロー同様、生成仕訳には `receipt_id` を**付けない**（`source:"bank"`）。
  → `journal_entries.receipt_id` 経由の削除カスケード罠（明細書削除で全仕訳連動削除、
    1仕訳削除で他仕訳まで巻き込み）を回避。リンクは `statement_lines.journal_entry_id` で持つ。
- `bank_transactions` は使わない（bank_account 紐付けが必須でクレカ明細に不向き）。

## タスク
- [x] 1. DB migration `031_statement_lines.sql`
      - `statement_lines`: id, receipt_id(FK→receipts ON DELETE CASCADE), client_id,
        line_date(date), description(text), amount(int 符号付: +入金/-出金),
        direction('deposit'|'withdrawal'), balance_after(int null), counterparty(text null),
        journal_entry_id(FK→journal_entries ON DELETE SET NULL null),
        status('pending'|'journalized'|'ignored' default 'pending'),
        suggested_account_id(uuid null), sort_order(int), raw_data(jsonb), created_at.
      - index: receipt_id, status。RLS: client メンバーシップ準拠（既存receiptsのRLSパターン踏襲）。
      - `receipts.ocr_result` に `statement_subtype:'bank'|'card'|'other'` を格納（型拡張のみ、列追加不要）。
- [x] 2. action `src/actions/statement-lines.ts`
      - `extractStatementTransactions(receiptId)`: Gemini Pro で明細画像/PDFを複数行パース
        ＋ statement_subtype 判定。既存行を消して statement_lines を再生成（冪等）。
        receipt.status を 'reviewed' 等へ。
      - `getStatementLines(receiptId)` / `updateStatementLine(id, patch)` /
        `setStatementLineStatus(id, 'ignored'|'pending')`。
      - `createJournalsFromStatementLines(lineIds)`: 各 pending 行について
        固定側＝subtypeから(bank→普通預金, card→未払金) 科目を name 解決し、
        AIで相手科目を推定 → admin insert で journal_entries(source:"bank", needs_review:true)
        ＋ lines 作成 → statement_lines.journal_entry_id/status='journalized' 更新。
        科目未存在時は科目名を添えてエラー（勘定科目管理で追加を促す）。
        返り値 { success, failed, errors[] }（既存一括APIに倣う）。
- [x] 3. UI: 明細書タブ（receipts/page.tsx の詳細パネル）
      - 明細書選択時、詳細パネルを max-w-3xl に拡張・見出しを「明細書詳細」に。
      - `StatementLinesSection` を新設: 「明細を抽出」ボタン / 行テーブル
        （選択・状態バッジ・除外/解除・再抽出）/「選択を仕訳化」「全て仕訳化」。
      - 種別・固定側科目を上部に注記。明細書では区分(発行/受領)・AI仕訳提案ブロックを非表示。
- [x] 4. 検証: `tsc --noEmit`=0、dev server エラー0（/documents 200 継続）。
      ※ ランタイム動作には migration 031 の適用が必要（下記）。

## 適用手順（ユーザー作業）
- Supabase ダッシュボードの SQL エディタで `supabase/migrations/031_statement_lines.sql` を実行。
  （本リポジトリに supabase CLI / DB接続文字列がないため手動適用）

## 検証
- `tsc --noEmit` = exit 0
- dev server: エラー0、/documents 各タブ 200。
- 明細書タブ→明細書を開く→「明細を抽出」→行レビュー→「仕訳化」の通し確認は
  migration 031 適用後に実機で確認。

## スコープ外（今回はやらない）
- 残高整合チェック（balance_after の自動検算）。
- 入金消込/照合フローとの連携（独立した仕訳生成に留める）。
- クレカ明細の支払（引落）仕訳の相殺（未払金の消し込みは別途）。

---

# 機能: 「要確認」をインボイス専用から横断レビューバッジへ拡張

## ユーザー確定方針
- 「要確認」の発火条件: ①インボイス番号の形式不正 ②OCR信頼度が低い ③必須項目が空 ④needs_reviewフラグ（4条件いずれか）
- インボイス用「適格／番号なし」は別バッジとして残し、両方表示する

## 変更（receipts/page.tsx）
- [x] OCR `confidence` を `ReceiptData.ocrConfidence` にマッピング（ocr_result 型に confidence 追加）。
- [x] `invoiceCheckConfig.invalid` のラベルを「要確認」→「番号不正」に改名（一般「要確認」と区別）。
- [x] `getReviewReasons(r, showInvoiceCheck)` を新設。OCR_CONFIDENCE_THRESHOLD=0.6。
      明細書(documentType==="statement")は対象外。理由は複数同時に付き得る。
- [x] カード/一覧（取引先セル）/詳細パネルに横断「要確認」バッジ（AlertTriangle）を追加。
      発行側でも OCR品質・必須項目・needs_review で発火（インボイス理由は受領側のみ）。
- [x] 一覧のインボイス列・カードのインボイスバッジは invalid 時は非表示（要確認に集約）。
- [x] 詳細パネル上部に理由リスト付きの赤い「要確認」ボックスを追加（編集/仕訳済解除への導線注記）。

## 検証
- `tsc --noEmit` = exit 0

---

# 機能: ダッシュボード再構築（要確認件数・税務カレンダー・残高サマリー）

## ユーザー確定方針
- ① 要確認バッジ付き証憑の件数を顧問先別に表示、クリックで証憑ページへ
- ② 決算2ヶ月前からアラートする税務カレンダー（定例税務期限も統合、土日祝/年末年始は翌営業日へ繰延）
- ③ 口座残高サマリー＋補助科目別残高一覧（クライアント選択式 / 口座=現金・預金の勘定科目）
- 帳簿のメモリ準拠: マイナス表記は使わず絶対値＋「逆残」タグで表示

## 変更
- [x] `src/lib/receipt-review.ts` 新設: 要確認判定の共通ロジック（UI/集計で再利用）。
- [x] `src/actions/receipts.ts` `getReviewCountsByClient()`: 顧問先別の要確認件数を集計。
- [x] `src/lib/japanese-holidays.ts` 新設: 祝日・営業日判定（春分/秋分は1980年基準, 振替休日, 国民の休日, 12/29〜1/3 税務署閉庁）。`deferToBusinessDay`。
- [x] `src/actions/clients.ts` `getTaxCalendar()`: 顧問先の決算/申告期限＋事務所共通の定例税務期限を統合、翌営業日繰延、期日順。
- [x] `src/actions/ledgers.ts` `getBalanceSummary(clientId)`: 現金・預金の勘定科目残高＋補助科目別残高（確定仕訳 needs_review=false・本日以前）。借方正/貸方正で符号算出。
- [x] `src/app/(dashboard)/dashboard/page.tsx`: 要確認カード / 税務カレンダーカード / クライアント選択式の口座残高・補助科目別残高カードを実装。残高は絶対値＋逆残タグ。

## 検証
- `tsc --noEmit` = exit 0
- dev server: /dashboard コンパイル成功、各サーバーアクション 200。
- ※ 残高は account_categories（資産/負債/純資産/収益/費用）の type で借方正/貸方正を判定。

---

# スマホ対応（レスポンシブ）＋ 仕訳入力のカメラ撮影

## タスク
- [x] 1. `layout.tsx` を `MobileNavProvider` でラップ、余白を `p-4 sm:p-6 lg:p-8` に
- [x] 2. `sidebar.tsx` をモバイルでオフキャンバス・ドロワー化（バックドロップ＋スライドイン、`lg:` 以上は常時表示）。ページ遷移で自動クローズ、閉じる(X)ボタン追加
- [x] 3. `header.tsx` にハンバーガー(`lg:hidden`)を追加、余白をレスポンシブ化、プロフィール名は `sm` 以上のみ表示
- [x] 4. `mobile-nav.tsx`（Provider/useMobileNav）でヘッダーとサイドバーの開閉状態を共有
- [x] 5. 仕訳入力: カメラ用 `<input accept="image/*" capture="environment">` と「写真を撮る」ボタン（`sm:hidden`）を追加
- [x] 6. 仕訳入力: 新規仕訳テーブルを `overflow-x-auto` + `min-w-[640px]` で横スクロール対応
- [x] 7. 検証: tsc=0 / `npm run build` 成功

## 検証
- `npx tsc --noEmit` = exit 0
- `npm run build` = ✓ Compiled successfully

---

# 未対応機能の実装（⑥→⑦→⑨→⑩）

着手順: ⑥給与 → ⑦借入金 → ⑨期首残高 → ⑩会社書類
給与スコープ: 記帳向け（支給・控除データ入力＋給与仕訳生成。社保・源泉は手入力）

## ⑥ 給与台帳・役員報酬 ✅ 完了（要: migration 032 をSupabaseに適用）
- [x] 1. migration `032_payroll_records.sql`（payroll_records + RLS）
- [x] 2. `src/types/index.ts` に Payroll 型 + `src/types/database.ts` に payroll_records 型
- [x] 3. `src/actions/payroll.ts`（CRUD + journalizePayroll/unjournalize、科目自動解決）
- [x] 4. `src/app/(dashboard)/clients/[id]/payroll/page.tsx`（月選択・一覧・入力・仕訳化）
- [x] 5. サイドバーに「給与台帳」を追加、ヘッダータイトル登録
- [x] 6. 検証: tsc=0 / build 成功

## ⑦ 借入金・役員借入金の明細 ✅ 完了（要: migration 033 をSupabaseに適用）
- [x] 1. migration `033_loans.sql`（loans + loan_repayments + RLS）
- [x] 2. `src/types/index.ts` に Loan/LoanRepayment 型 + `src/types/database.ts` に loans/loan_repayments 型
- [x] 3. `src/actions/loans.ts`（借入・返済CRUD + journalizeRepayment/unjournalize、残高自動更新、科目自動解決）
- [x] 4. `src/app/(dashboard)/clients/[id]/loans/page.tsx`（借入一覧＋残高・展開して返済記録・仕訳化）
- [x] 5. サイドバーに「借入金台帳」を追加、ヘッダータイトル登録
- [x] 6. 検証: tsc=0 / build 成功

## ⑨ 前期申告書・期首残高 ✅ 完了（migration 不要：journal_entries を再利用）
- [x] 1. `src/actions/opening-balances.ts`（BS科目取得 + 期首残高仕訳の生成/置換、貸借バランス検証）
- [x] 2. `src/app/(dashboard)/clients/[id]/opening-balances/page.tsx`（年度選択・資産/負債/純資産入力・貸借差額表示）
- [x] 3. サイドバーに「期首残高設定」を追加、ヘッダータイトル登録
- [x] 4. 検証: tsc=0 / build 成功
- 方式: source='closing'・期首日付・description='期首残高（前期繰越）'・metadata.kind='opening_balance' の1仕訳を作成。試算表の前期繰越ロジック（getTrialBalance の startDate 前/後 仕分け）に自動反映。決算仕訳（期末日）とは日付が異なるため衝突しない。
- [x] 追加: 前期繰越の自動化 — `carryForwardOpeningBalances()` で前年度末のBS残高を getTrialBalance から取得し、前期P/L純損益を繰越利益剰余金へ自動振替して期首残高仕訳を生成（貸借自動一致）。`TrialBalanceRow` に `id` を追加（非破壊）。ページに「前期から自動繰越」ボタンを追加。tsc=0 / build 成功。

## ⑩ 会社書類（定款・登記等）管理 ✅ 完了（要: migration 034 をSupabaseに適用）
- [x] 1. migration `034_company_documents.sql`（company_documents + RLS）
- [x] 2. `src/types/index.ts` に CompanyDocument 型 + `src/types/database.ts` に company_documents 型
- [x] 3. `src/actions/company-documents.ts`（Storage "company-docs" バケット自動作成・アップロード/一覧/更新/署名URL/削除、SHA-256ハッシュ）
- [x] 4. `src/app/(dashboard)/clients/[id]/company-documents/page.tsx`（種類別一覧・アップロード/編集/表示/削除）
- [x] 5. サイドバーに「会社書類」を追加、ヘッダータイトル登録
- [x] 6. 検証: tsc=0 / build 成功

---

## レビュー（⑥〜⑩ 実装完了 2026-06-09）
4機能すべて実装・検証完了（tsc=0 / build 成功、全ルート登録確認）。
- ⑥ 給与台帳・役員報酬: 入力＋給与仕訳生成（Dr 給与手当/役員報酬 ／ Cr 預り金・普通預金）
- ⑦ 借入金・役員借入金: 借入登録＋返済記録→返済仕訳生成（Dr 借入金・支払利息 ／ Cr 普通預金）、残高自動増減
- ⑨ 前期申告書・期首残高: BS科目の期首残高入力→source='closing'の期首残高仕訳を生成（試算表の前期繰越に反映）
- ⑩ 会社書類: 定款・登記簿・届出控え等のファイル保管（Storage company-docs バケット）

### ⚠️ デプロイ前の手動作業（Supabase ダッシュボードのSQLエディタで実行）
未適用のマイグレーション:
- `032_payroll_records.sql`（給与）
- `033_loans.sql`（借入金）
- `034_company_documents.sql`（会社書類）
※ ⑨ 期首残高は migration 不要（journal_entries を再利用）。
※ ⑩ の Storage バケット "company-docs" はコード側で初回アップロード時に自動作成。

### 未コミット
⑥〜⑩ のコード・マイグレーション・docsはローカル変更のまま（最新コミット a91ce61 はレスポンシブ/カメラ/docsのみ）。
（その後 032/033/034 は Supabase に手動適用済み。動作確認済み。）

---

## 税理士レビューSaaS強化（① → ③ → ④ → ⑦ 2026-06-09）
おすすめ順で実装。各機能 tsc=0 / build 成功・全ルート登録確認。

### ① 税理士レビュー特化 ✅（要: migration 035 を適用）
- [x] migration `035_journal_review_status.sql`（journal_entries に review_status 4値[unreviewed/confirmed/needs_fix/question] + review_note 追加）
- [x] `src/types/database.ts` journal_entries に review_status/review_note 追加
- [x] `src/actions/review.ts`（getReviewEntries/getReviewSummary/setReviewStatus。質問中・要修正でメモ→comments連携、確認済みで質問resolve）
- [x] `/clients/[id]/review` 仕訳レビュー画面（サマリー・状態フィルタ・確認済み/要修正/質問中ボタン・メモモーダル）
- [x] サイドバー「仕訳レビュー」+ ヘッダー登録

### ③ AI仕訳チェック（異常検知）✅（migration 不要）
- [x] `src/actions/journal-check.ts`（ルールベース異常検知: 役員貸付金/交際費[1件高額+年800万限度]/消耗品費[10万・30万]/税区分ミス[不課税科目に課税仕入・課税科目に区分なし・売仕取り違え]）
- [x] `/clients/[id]/check` AI仕訳チェック画面（年度選択・重大度サマリー・ルールフィルタ・指摘一覧）
- [x] サイドバー「AI仕訳チェック」+ ヘッダー登録

### ④ 決算前チェックリスト ✅（migration 不要）
- [x] `src/actions/closing-checklist.ts`（未払費用/減価償却[getDepreciationSummaryと計上額比較]/棚卸/役員借入金/期首残高 を自動判定 ok/warning/todo/info）
- [x] `/clients/[id]/closing-checklist` 決算前チェック画面（年度選択・状態サマリー・項目別判定）
- [x] サイドバー「決算前チェック」+ ヘッダー登録

### ⑦ 電子帳簿保存法 検索要件の補強 ✅（migration 不要）
- [x] `src/actions/document-search.ts`（取引年月日[範囲]・取引金額[範囲]・取引先 の AND 検索。receipts.ocr_result から取引情報抽出）
- [x] `/clients/[id]/document-search` 証憑検索画面（検索フォーム・結果一覧・改ざん検証[verifyReceiptIntegrity]その場実行・証憑表示[署名URL]）
- [x] サイドバー「証憑検索（電帳法）」+ ヘッダー登録
- 改ざん防止（SHA-256ハッシュ）は既存実装を活用。検索要件（範囲＋組合せ）を新規追加。

### ⚠️ デプロイ前の手動作業（追加）
- `035_journal_review_status.sql` を Supabase SQL エディタで適用（③④⑦ は migration 不要）。
