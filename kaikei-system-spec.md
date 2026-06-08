# KaikeiPro（仮称）- 税理士向けAI会計システム 仕様書

## 概要

税理士事務所と顧問先をつなぐクラウド会計システム。
顧問先がスマホで領収書を撮影するだけで、AIが自動仕訳を行い、税理士がレビュー・修正する流れを実現する。

Raqto 受発注管理との完全連携により、受発注→仕訳→帳簿→決算までを一気通貫で自動化する。

> 本書は要件定義（あるべき姿）を記述する。データモデルの「想定」は実装と細部が異なる場合がある。
> **現時点の実装状況は [`docs/features.md`](./docs/features.md) を参照**（最終更新: 2026-06-09）。

---

## 実装状況サマリー（2026-06-09 現在）

| カテゴリ | 状況 |
|---------|------|
| 認証・ロール（4ロール）・ルート保護 | 実装済 |
| 勘定科目・補助科目・取引先管理 | 実装済 |
| 仕訳（複合仕訳・バランス検証・CSV AI取込） | 実装済 |
| 領収書アップロード（Storage）＋AI-OCR＋AI仕訳自動生成 | 実装済（Gemini） |
| 明細書取込（銀行/クレカ明細のAI解析→一括仕訳）・カード取引 | 実装済 |
| 帳簿閲覧（6帳簿）／試算表・BS・PL・月次推移・棚卸 | 実装済（CSV/印刷出力） |
| 消費税集計（10%/8%・本則/簡易） | 実装済（申告書PDFは未対応） |
| 決算処理（決算整理仕訳・減価償却サマリー・年度締め） | 実装済（償却の自動仕訳計上は未対応） |
| 請求書・入金消込・固定資産（減価償却計算） | 実装済 |
| 顧問先ポータル（アップロード/領収書/質問/請求書/設定） | 実装済 |
| ダッシュボード（残高サマリー・請求書/支払状況・要確認証憑・税務カレンダー） | 実装済 |
| レスポンシブ（スタッフ側もモバイル対応・カメラ撮影） | 実装済 |
| Raqto連携・アグリゲーション（Moneytree/MF/Zaim）連携設定 | 実装済 |
| **通知の自動生成（メール/LINE送信、コメント通知INSERT）** | **未実装** |
| 減価償却の自動仕訳計上 / 消費税申告書フォーム出力 | 未実装 |

---

## 技術スタック（Raqto と統一）

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes + Server Actions
- **Database**: Supabase PostgreSQL
- **Auth**: Supabase Auth（税理士: staff, 顧問先: client）
- **Storage**: Supabase Storage（領収書画像、PDFなど）
- **AI/OCR**: Google Gemini API（Vision + Text。OCR=Gemini 2.5 Pro / 仕訳推定=Gemini 2.5 Flash）※当初想定の Claude から実装時に変更
- **PDF**: ブラウザ印刷（`window.print`）ベースで出力。CSV出力も併設
- **通知**: Resend (メール) / LINE Messaging API（※アプリ内通知は実装済、メール/LINE送信は未実装）
- **Deploy**: Vercel

---

## ユーザーロール

| ロール | 説明 | 主な操作 |
|-------|------|---------|
| **税理士（staff）** | 税理士事務所のメンバー | 全機能にアクセス可能 |
| **顧問先（client）** | 税理士の顧問先企業 | 領収書アップロード、質問回答、請求書確認 |

---

## 機能一覧

---

### 1. 勘定科目の管理機能

#### 概要
標準勘定科目をベースに、顧問先ごとにカスタマイズ可能な科目体系を管理する。

#### 要件
- あらかじめ標準的な勘定科目が登録されている（勘定科目テンプレート）
  - 資産・負債・純資産・収益・費用の5分類
  - 中小企業会計基準に準拠した標準科目セット
- 顧問先ごとに科目を追加・編集できる
- 補助科目（取引先別、口座別など）を設定できる
- 部門別に分けて管理できる（営業部、管理部など）
- 使わない科目は非表示にできる（削除ではなく非アクティブ化）

#### データモデル（想定）

```
account_categories: 勘定科目分類（資産/負債/純資産/収益/費用）
accounts: 勘定科目マスタ
  - client_id (顧問先ごと)
  - category_id
  - code (科目コード)
  - name (科目名)
  - is_active (表示/非表示)
  - is_default (標準科目かどうか)

sub_accounts: 補助科目
  - account_id
  - name (取引先名、口座名など)

departments: 部門
  - client_id
  - name (営業部、管理部など)
```

---

### 2. 仕訳入力機能

#### 概要
手動での仕訳入力と、AI自動仕訳の結果を確認・修正するための画面。

#### 要件
- 日付・勘定科目・金額・摘要を入力して仕訳を作成できる
- 1つの取引で複数の科目に分ける「複合仕訳」に対応
  - 借方・貸方それぞれ複数行の入力が可能
  - 借方合計と貸方合計が一致しないと保存できない（貸借バランスチェック）
- よく使う仕訳をテンプレートとして保存できる
- 過去の仕訳をコピーして新規作成できる
- 仕訳の検索・絞り込みができる
  - 日付範囲、勘定科目、金額範囲、摘要キーワード、部門
- 仕訳ステータス: draft（下書き）/ confirmed（確定）/ locked（締め済み）
- AIが作成した仕訳には「AI生成」フラグを付与

#### データモデル（想定）

```
journal_entries: 仕訳ヘッダー
  - client_id
  - entry_date (取引日)
  - description (摘要)
  - status (draft / confirmed / locked)
  - source (manual / ai / import / raqto)
  - receipt_id (関連する領収書)
  - created_by

journal_entry_lines: 仕訳明細
  - journal_entry_id
  - account_id (勘定科目)
  - sub_account_id (補助科目)
  - department_id (部門)
  - debit_amount (借方金額)
  - credit_amount (貸方金額)
  - tax_category (税区分)
  - tax_rate (税率)

journal_templates: 仕訳テンプレート
  - client_id
  - name (テンプレート名)
  - template_data (JSON: 科目・金額パターン)
```

---

### 3. 帳簿の作成・閲覧機能

#### 概要
仕訳データから各種帳簿を自動生成する。すべてリアルタイムで仕訳データから算出（静的なレポートではない）。

#### 帳簿一覧

| 帳簿 | 内容 |
|------|------|
| **仕訳帳** | すべての仕訳を日付順に一覧表示 |
| **総勘定元帳** | 勘定科目ごとの取引履歴と残高推移を表示 |
| **現金出納帳** | 現金勘定の入出金を記録・表示 |
| **預金出納帳** | 銀行口座（補助科目）ごとの入出金を記録・表示 |
| **売掛帳** | 取引先別の売掛金残高と取引履歴 |
| **買掛帳** | 取引先別の買掛金残高と取引履歴 |

#### 要件
- 日付範囲での絞り込み
- CSV/PDFエクスポート
- 各帳簿から仕訳の詳細にジャンプできる

---

### 4. 試算表・財務諸表の作成機能

#### 概要
任意の期間の試算表・財務諸表をリアルタイムで生成する。

#### 要件
- **残高試算表**: 各勘定科目の借方合計・貸方合計・残高を一覧表示
- **貸借対照表（B/S）**: 資産・負債・純資産を表示
- **損益計算書（P/L）**: 売上・費用・利益を表示
- **月次推移表**: 月ごとの数字の変化を比較できる（12ヶ月分）
- 前年同期との比較ができる
- PDF出力対応
- 部門別での表示切り替え

---

### 5. 消費税の計算機能

#### 概要
インボイス制度に完全対応した消費税計算・集計機能。

#### 要件
- 税率ごと（10%・8%軽減税率）に自動で集計する
- **本則課税**に対応
  - 課税売上に係る消費税額 − 課税仕入に係る消費税額
- **簡易課税**に対応
  - 事業区分（第1種〜第6種）ごとのみなし仕入率で計算
- 課税売上・非課税売上・免税売上・不課税を区分できる
- 消費税申告書の作成に必要なデータを出力できる
- **インボイス経過措置の自動判定**
  - 2023/10〜2026/9: 80%控除
  - 2026/10〜2029/9: 50%控除
  - 仕入先のインボイス登録有無で自動判定

#### 税区分マスタ（想定）

```
tax_categories:
  - 課税売上10%
  - 課税売上8%（軽減）
  - 非課税売上
  - 免税売上
  - 不課税
  - 課税仕入10%
  - 課税仕入8%（軽減）
  - 課税仕入10%（経過措置80%）
  - 課税仕入10%（経過措置50%）
  - 課税仕入8%（経過措置80%）
  - 課税仕入8%（経過措置50%）
```

---

### 6. 決算処理機能

#### 概要
年度末の決算処理を支援する機能群。

#### 要件
- **減価償却費の自動計算**
  - 定額法・定率法に対応
  - 耐用年数テーブル（税法準拠）
  - 月割計算対応（期中取得の場合）
- **固定資産台帳の管理**
  - 資産名、取得日、取得価額、耐用年数、償却方法
  - 期首帳簿価額・当期償却額・期末帳簿価額の自動計算
  - 除却・売却の処理
- **決算整理仕訳の入力**
  - 前払費用、未払費用、前受収益、未収収益
  - 貸倒引当金、賞与引当金
- **年度締め処理**
  - 翌期にデータを繰り越す（繰越利益剰余金の算出）
  - 期首残高の自動設定
- **データロック**
  - 締め処理後のデータは編集できないようロックできる
  - ロック解除は税理士権限のみ

#### データモデル（想定）

```
fixed_assets: 固定資産台帳
  - client_id
  - name (資産名)
  - category (建物/車両/器具備品/ソフトウェア等)
  - acquisition_date (取得日)
  - acquisition_cost (取得価額)
  - useful_life (耐用年数)
  - depreciation_method (定額法/定率法)
  - salvage_value (残存価額)
  - disposed_at (除却日)

fiscal_years: 会計年度
  - client_id
  - start_date
  - end_date
  - status (open / closed / locked)

closing_balances: 期末残高
  - fiscal_year_id
  - account_id
  - balance
```

---

### 7. 取引先（得意先・仕入先）管理機能

#### 概要
顧問先企業の取引先を管理する。売掛帳・買掛帳や補助科目と連動。

#### 要件
- 取引先の名前・住所・連絡先を登録できる
- インボイス登録番号の管理（経過措置の自動判定に使用）
- 取引先ごとの取引履歴を確認できる
- 取引先別の売上・仕入金額を集計できる
- 得意先 / 仕入先 / 両方 の区分

#### データモデル（想定）

```
business_partners: 取引先
  - client_id
  - name
  - type (customer / vendor / both)
  - postal_code
  - address
  - telephone
  - email
  - invoice_registration_number
  - is_invoice_registered (インボイス登録事業者かどうか)
```

---

### 8. 領収書スマホアップロード機能

#### 概要
顧問先がスマホで領収書を撮影し、税理士事務所に送信する機能。顧問先向けのメイン機能。

#### 要件
- 顧問先がスマホで領収書を撮影してアップロードできる
- 撮影時に「現金」「カード」「電子マネー」「銀行振込」など支払い方法を選べる
- 写真がぼやけていたら撮り直しを促す（画像品質チェック）
  - 解像度チェック、ぼやけ検出
- 複数枚まとめてアップロードできる（バッチアップロード）
- 電波がない場所で撮影しても、あとから送信できる（オフライン対応）
  - ローカルストレージに一時保存 → オンライン復帰時に自動送信
- アップロード後のステータス管理
  - uploaded（アップロード済）→ processing（OCR処理中）→ reviewed（確認済）→ journalized（仕訳済）

#### データモデル（想定）

```
receipts: 領収書
  - client_id
  - uploaded_by (顧問先ユーザー)
  - image_path (Supabase Storage)
  - payment_method (cash / card / e_money / bank_transfer)
  - status (uploaded / processing / ocr_done / reviewed / journalized)
  - ocr_result (JSON: OCR結果)
  - ai_journal_suggestion (JSON: AI仕訳提案)
  - fiscal_year_id
  - uploaded_at
  - reviewed_at
  - reviewed_by
```

---

### 9. 写真から文字を読み取る機能（AI-OCR）

#### 概要
Claude Vision API を使い、領収書画像から必要な情報を自動抽出する。

#### 要件
- 領収書の写真から以下を自動で読み取る
  - 日付
  - 金額（税込・税抜・消費税額）
  - 店舗名 / 発行者名
  - 品目・内容
  - 税率区分（10% / 8%軽減）
- インボイス登録番号（T＋13桁）を自動で検出する
- 読み取った内容を画面に表示して確認できる
- 読み取り結果は手動で修正できる
- 読み取り精度のログを保存（改善のため）

#### AI処理フロー

```
1. 画像アップロード
2. 画像品質チェック（ぼやけ・暗さ）
3. Claude Vision API で画像解析
   - プロンプト: 日付、金額、店舗名、品目、税率、インボイス番号を抽出
4. 構造化データとして保存（ocr_result JSON）
5. 確認画面で表示 → 修正可能
6. 確定後、AI仕訳提案へ渡す
```

---

### 10. 帳簿を自動で作る機能（AI仕訳）

#### 概要
OCR結果をもとに、AIが適切な勘定科目を推定し仕訳を自動生成する。

#### 要件
- 領収書の内容から「何の費用か」を自動で推測する
  - 店舗名・品目・金額から勘定科目を推定
  - 例: 「スターバックス」→ 会議費 or 交際費
  - 例: 「アスクル」→ 消耗品費 or 事務用品費
- 過去に同じ店舗の領収書があれば、同じ分類を提案する（学習機能）
- 税理士が修正した内容をAIが学習して精度が上がる
  - 顧問先ごとの仕訳パターンを蓄積
  - 修正履歴をフィードバックデータとして保存
- よく使う仕訳パターンを登録して自動適用できる

#### AI処理フロー

```
1. OCR結果を受け取る
2. 過去の仕訳パターンを検索（同一店舗・類似摘要）
3. パターンがあれば → そのまま提案
4. パターンがなければ → Claude API で科目推定
   - 入力: 店舗名、品目、金額、顧問先の業種、科目一覧
   - 出力: 推定科目、信頼度、理由
5. 提案を表示 → 税理士が確認・修正
6. 確定した仕訳を学習データとして保存
```

#### データモデル（想定）

```
ai_journal_patterns: AI学習パターン
  - client_id
  - vendor_name (店舗名)
  - keyword (品目キーワード)
  - account_id (推定科目)
  - sub_account_id
  - tax_category
  - confidence (信頼度)
  - usage_count (使用回数)
  - last_used_at

ai_feedback_logs: AI修正ログ
  - receipt_id
  - original_suggestion (JSON: AIの元提案)
  - corrected_entry (JSON: 修正後)
  - corrected_by
```

---

### 11. 届いていない領収書を催促する機能

#### 概要
顧問先への領収書提出をリマインドする自動通知機能。

#### 要件
- 提出期限の前に自動でお知らせを送る（3日前・1日前・当日）
- お知らせの送信方法を選べる
  - アプリ内通知
  - メール（Resend）
  - LINE（LINE Messaging API）
- 届いていない顧問先を一覧で確認できる
- 顧問先ごとに提出期限を設定できる
  - 月次: 毎月○日まで
  - 随時: 発生から○日以内

#### データモデル（想定）

```
submission_schedules: 提出スケジュール
  - client_id
  - frequency (monthly / weekly)
  - due_day (毎月の締め日: 5, 10, 15, 末日など)
  - reminder_days (JSON: [3, 1, 0] = 3日前、1日前、当日)
  - notification_methods (JSON: ["app", "email", "line"])

submission_periods: 提出期間
  - client_id
  - period_start
  - period_end
  - due_date
  - status (pending / submitted / overdue / completed)
  - receipt_count (提出済み枚数)

reminder_logs: リマインダー送信ログ
  - submission_period_id
  - sent_at
  - method (app / email / line)
  - status (sent / failed)
```

---

### 12. 質問・回答をやり取りする機能

#### 概要
領収書や仕訳に関する税理士⇔顧問先のコミュニケーション機能。

#### 要件
- 領収書ごとにコメントで質問を送れる
- 顧問先のスマホに通知が届く
- 回答もアプリ内でできる
- やり取りの履歴がすべて残る
- 未回答の質問がある場合は再通知できる（リマインド）
- 質問のステータス: open → answered → resolved

#### データモデル（想定）

```
comments: コメント/質問
  - receipt_id (または journal_entry_id)
  - parent_id (スレッド対応)
  - author_id
  - author_role (staff / client)
  - body (本文)
  - status (open / answered / resolved)
  - created_at

comment_notifications: コメント通知
  - comment_id
  - recipient_id
  - is_read
  - notified_via (app / email / line)
```

---

### 13. 顧問先ダッシュボード

#### 概要
税理士が全顧問先の状況を一覧で把握するための管理画面。

#### 要件
- 全顧問先の領収書提出状況を一画面で確認できる
- 未回答の質問がある顧問先がわかる
- ステータス表示
  - 「順調」: 期限内に提出済み、未解決の質問なし
  - 「要確認」: 未回答の質問あり、または一部未提出
  - 「未提出」: 期限超過で未提出
- 対応が必要な項目の件数が表示される
  - 未確認の領収書 ○件
  - 未回答の質問 ○件
  - AI仕訳の確認待ち ○件
- 決算月が近い顧問先をアラート表示できる（決算月の2ヶ月前から）
- 顧問先ごとの月次進捗（領収書提出→OCR→仕訳→確認→完了）

---

### 14. 請求書の作成機能

#### 概要
顧問先が取引先に発行する請求書を作成する機能。インボイス制度に完全対応。

#### 要件
- 請求書を作成して印刷・PDF出力できる
- **インボイス制度に対応した適格請求書**を発行できる
  - 登録番号の記載
  - 税率ごとの消費税額の記載
  - 適用税率の明記
- 書類番号を自動で採番できる
- 過去の請求書をコピーして新規作成できる
- 請求書の発行履歴を一覧で確認できる
- 請求書発行時に売上仕訳を自動生成（オプション）
- メール送信機能

#### データモデル（想定）

```
invoices: 請求書
  - client_id
  - business_partner_id (請求先)
  - invoice_number
  - issued_date
  - due_date
  - subtotal
  - tax_amount
  - total_amount
  - status (draft / issued / sent / paid / overdue / void)
  - pdf_storage_path
  - journal_entry_id (自動生成した仕訳)

invoice_items: 請求書明細
  - invoice_id
  - sort_order
  - item_name
  - quantity
  - unit_price
  - tax_rate
  - subtotal
  - tax_amount
```

---

### 15. 入金消込機能

#### 概要
入金データと請求書を照合し、消込（突き合わせ）を行う機能。

#### 要件
- 登録した入金と請求書を照合して消込できる
- 金額・取引先が一致する請求書を候補として自動表示する
- 一部入金（分割払い）にも対応
- 未入金の請求書を一覧で確認できる
- 入金期限が過ぎた請求書をアラート表示
- 取引先ごとの未回収残高を確認できる
- 消込時に入金仕訳を自動生成

#### データモデル（想定）

```
payments: 入金記録
  - client_id
  - business_partner_id
  - amount
  - payment_date
  - payment_method
  - bank_account (補助科目)
  - memo

payment_allocations: 消込明細
  - payment_id
  - invoice_id
  - allocated_amount

  ※ 1つの入金を複数の請求書に分割消込可能
  ※ 1つの請求書に複数の入金を消込可能
```

---

## Raqto 受発注管理との連携

### 自動仕訳の連携フロー

```
【Raqto 受発注側】              【KaikeiPro 会計側】

請求書発行 ──────────→ 売掛金 / 売上 の仕訳を自動計上
入金確認（カード） ───→ 普通預金 / 売掛金 の消込仕訳
入金確認（銀行振込）──→ 普通預金 / 売掛金 の消込仕訳
発注書作成 ──────────→ 仕入 / 買掛金 の仕訳を自動計上
支払い完了 ──────────→ 買掛金 / 普通預金 の消込仕訳
領収書発行 ──────────→ 仕訳ステータスを「確定」に更新
```

### 連携方法

- Raqto側でイベント発生時に KaikeiPro の API を呼び出す
- または共通の Supabase DB を参照し、Webhook/トリガーで連携
- 連携設定画面で Raqto の company_id と KaikeiPro の client_id を紐付ける

---

## 画面構成（想定）

### 税理士側（PC）

```
/dashboard           - 顧問先ダッシュボード
/clients             - 顧問先一覧
/clients/[id]        - 顧問先詳細
/clients/[id]/journals    - 仕訳入力
/clients/[id]/documents   - 証憑管理
/clients/[id]/receipts    - 領収書管理
/clients/[id]/ledgers     - 帳簿閲覧
/clients/[id]/statements  - 試算表・財務諸表（棚卸表含む）
/clients/[id]/accounts    - 勘定科目管理
/clients/[id]/allocations - 家事按分設定
/clients/[id]/tax         - 消費税計算
/clients/[id]/closing     - 決算処理
/clients/[id]/assets      - 固定資産台帳
/clients/[id]/invoices    - 請求書管理
/clients/[id]/payments    - 入金消込
/clients/[id]/partners    - 取引先管理
/clients/[id]/questions   - 質問管理
/clients/[id]/card-transactions - カード取引
/clients/[id]/bank-transactions - 口座取引（現在サイドバー非表示）
/clients/[id]/audit       - 監査ログ
/settings            - 事務所設定
```

### 顧問先側（スマホ最適化）

```
/portal/[firm]/upload      - 領収書アップロード（メイン画面）
/portal/[firm]/receipts    - アップロード履歴
/portal/[firm]/questions   - 質問・回答
/portal/[firm]/invoices    - 請求書一覧
/portal/[firm]/settings    - 設定
```

---

## DB テーブル一覧（想定）

### マスタ系
- `firms` - 税理士事務所
- `firm_members` - 事務所メンバー（税理士・スタッフ）
- `clients` - 顧問先
- `client_users` - 顧問先ユーザー（ログイン用）
- `accounts` - 勘定科目
- `sub_accounts` - 補助科目
- `departments` - 部門
- `tax_categories` - 税区分マスタ
- `business_partners` - 取引先

### トランザクション系
- `fiscal_years` - 会計年度
- `journal_entries` - 仕訳ヘッダー
- `journal_entry_lines` - 仕訳明細
- `journal_templates` - 仕訳テンプレート
- `receipts` - 領収書
- `invoices` - 請求書
- `invoice_items` - 請求書明細
- `payments` - 入金記録
- `payment_allocations` - 消込明細
- `fixed_assets` - 固定資産

### AI系
- `ai_journal_patterns` - AI学習パターン
- `ai_feedback_logs` - AI修正ログ

### コミュニケーション系
- `comments` - 質問・コメント
- `comment_notifications` - コメント通知
- `submission_schedules` - 提出スケジュール
- `submission_periods` - 提出期間
- `reminder_logs` - リマインダーログ

### システム系
- `notifications` - 通知
- `raqto_integrations` - Raqto連携設定

---

## 補助金申請での位置づけ

### IT導入補助金 インボイス枠

- **分類**: 会計ソフト（インボイス制度対応）
- **AI機能**: 領収書OCR + 自動仕訳（AI導入枠にも対応）
- **電子帳簿保存法**: タイムスタンプ付き電子保存に対応

### Raqto との組み合わせ申請

| ITツール | 価格（2年） |
|---------|-----------|
| Raqto 受発注管理 | 960,000円 |
| Raqto AI 帳票認識オプション | 720,000円 |
| KaikeiPro 会計 | 960,000円 |
| KaikeiPro AI仕訳・OCRオプション | 720,000円 |
| 導入設定・マニュアル・研修 | 550,000円 |
| 保守サポート × 2年 | 720,000円 |
| **合計** | **4,630,000円** |
