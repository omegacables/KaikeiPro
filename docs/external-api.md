# 外部連携の受け口（API v1）

社内の自動仕訳などのシステムから、**仕訳と証憑**を顧問先へ送るための受け口。
送られた仕訳は**確定済み**（`status=confirmed`・`needs_review=false`・`source=api`）で登録される。

- 中身: `src/lib/external-api/`（`core.ts` が確かめと登録、`supabase-store.ts` が読み書き、`http.ts` が入口）
- 受け口: `src/app/api/v1/`（`ping`・`accounts`・`receipts`・`journals`）
- キーの画面: 顧問先の「設定」→「外部連携（APIキー）」（`src/app/(dashboard)/clients/[id]/settings/api-keys-settings.tsx`）
- データベース: `supabase/migrations/078_api_keys_and_external_ids.sql`
- テスト: `src/lib/external-api/core.test.ts`

## 認証

`Authorization: Bearer rk_…`。キーは顧問先ごとに発行し、**その会社にだけ効く**。

- 会社（`client_id`）と操作者はキーで決まる。本文に `client_id` などを入れても使わない
- 書き込みはキーを発行した人として行われる（監査ログ・仕訳の変更履歴にもその人が残る）。
  その人が閲覧専用になった・アクセスを止められたときは書き込めない（403 `user_cannot_write`）。キーを発行し直す
- データベースにはキーの SHA-256 だけを保存する。キーはそのときだけ画面に出る
- 発行・無効化はその会社の管理者（社長）・事務所の管理者・システム管理者だけ
- 呼び出しはキーごとに **1分あたり60回まで**（超えたら 429・`Retry-After: 60`）

## 受け口

### `GET /api/v1/ping`

キーが有効か・どの会社か。

```json
{ "ok": true, "client": { "id": "…", "name": "株式会社…" }, "scopes": ["journals:write", "receipts:write"] }
```

### `GET /api/v1/accounts`

キーの会社で**使える科目**＝その会社の科目＋標準科目（使われていない科目は除く・コード順）。
同じコード・同じ名前の科目が会社にあれば、標準科目の方は出さない。仕訳を送る前に、使う科目がその会社にあるかを確かめる。
権限は `journals:write`。

```json
{ "accounts": [
  { "code": "720", "name": "通信費", "type": "expenses", "type_label": "費用", "scope": "standard",
    "tax_category_allowed": true, "tax_categories": ["purchase_10", "purchase_08_reduced", "…"] },
  { "code": "110", "name": "普通預金", "type": "assets", "type_label": "資産", "scope": "standard",
    "tax_category_allowed": false, "tax_categories": [] }
] }
```

- `scope` は `company`（その会社の科目）か `standard`（全社共通の標準科目）
- `type` は `assets`（資産）・`liabilities`（負債）・`equity`（純資産）・`revenue`（収益）・`expenses`（費用）
- `tax_category_allowed` は POST journals と同じ判定（収益・費用の行。仮払消費税の行は輸入の消費税の区分だけ）。
  `tax_categories` はその行に付けられるコード

### `POST /api/v1/receipts`（multipart/form-data）

| 欄 | 中身 |
|---|---|
| `file` | JPG / PNG / PDF。10MBまで（※下の「大きさの上限」） |
| `payment_method` | `cash`・`card`・`e_money`・`bank_transfer`（省略可） |
| `direction` | `received`（受け取った・既定）/ `issued`（発行した） |
| `original_filename` | 元のファイル名（省略すると `file` の名前） |

返す: `{ "receipt_id": "…", "duplicate": false, "mime_type": "image/jpeg" }`（新しく作ったら 201）。
**同じ内容のファイルがその会社に登録済みなら、その `receipt_id` を返す**（200・`duplicate: true`）。

### `POST /api/v1/journals`（JSON）

```json
{
  "external_id": "sha256:…（送り手が付ける一意のID・200文字まで）",
  "entry_date": "2026-06-10",
  "description": "回線使用料 NTT",
  "receipt_id": "（receipts で返った id・省略可）",
  "lines": [
    { "account": "通信費", "debit": 5500, "credit": 0, "tax_category": "purchase_10" },
    { "account": "普通預金", "debit": 0, "credit": 5500 }
  ],
  "metadata": { "任意": "記録用（10,000文字まで）" }
}
```

- `account` は**科目コード、無ければ科目名**で引く。引く先は**その会社の科目＋標準科目**（`client_id IS NULL`・画面の科目一覧と同じ）。
  同じコード・同じ名前の科目が会社にあれば会社の科目を使う。使われていない科目は不可
- 金額は0以上の整数。各行は借方か貸方の**どちらか一方だけ**。借方と貸方の合計が同じこと
- `tax_category` は `src/lib/tax-category.ts` のコード。**収益・費用の行にだけ**付けられる（資産・負債の行に付けると 400）
- **締めた（ロック済みの）会計年度の日付は 409**
- 返す: `{ "journal_entry_id", "external_id", "status": "confirmed", "needs_review": false, "duplicate": false, … }`（201）
- **同じ `external_id` がその会社にあれば、前に作った仕訳を返す**（200・`duplicate: true`。中身は上書きしない）

### `GET /api/v1/journals?external_id=…`

その仕訳の今の状態。無ければ 404（画面で削除された場合も）。

## エラー

```json
{ "error": { "code": "validation_failed", "message": "仕訳の内容に誤りがあります", "details": ["2行目: この会社に科目がありません: \"広告費\""] } }
```

| status | code | いつ |
|---|---|---|
| 400 | `invalid_json` `invalid_body` `validation_failed` `invalid_external_id` `receipt_not_found` `file_missing` `file_type` `invalid_payment_method` `invalid_direction` `invalid_multipart` | 入力の誤り（直して送り直す） |
| 401 | `unauthorized` `invalid_key` `revoked_key` | キーが無い・違う・無効 |
| 403 | `insufficient_scope` `user_cannot_write` | 権限が無い |
| 404 | `not_found` | その external_id の仕訳が無い |
| 409 | `fiscal_year_locked` | 締めた年度 |
| 413 | `file_too_large` | 10MB超 |
| 429 | `rate_limited` | 呼び出しが多すぎる（60秒待つ） |
| 500 | `internal_error` | サーバー側の問題（時間をおいて送り直す。external_id があるので二重にはならない） |

### 大きさの上限

Vercel の関数は**リクエスト本文が 4.5MB まで**。それを超えるファイルは受け口に届く前に Vercel が 413
（本文は JSON ではない）で止める。送る側で 4MB を超える画像は縮めてから送る。

## 免税事業者の会社の `tax_category`

免税かどうかは**会社の設定**（`clients.consumption_tax_status = 'exempt'`、画面は「設定」→「消費税計算」）で決まり、
明細の税区分では決まらない。免税の会社では消費税の申告・納付の計算をせず、決算書は税込方式で作る。
そのため明細には**取引の実態どおりの区分**を付ける（売上 `sales_10`、10%の経費 `purchase_10`、
軽減8% `purchase_08_reduced`、給料・租税公課 `purchase_out_of_scope`、保険料・利息 `purchase_exempt` など）。
付けない（省略・null）こともできるが、課税事業者になるかの判定（基準期間の課税売上高）や、
課税事業者になったあとの集計に使えるので、付けておく方がよい。資産・負債の行には付けない。

## 確定済みの仕訳を直す・取り消す

Raqto会計では `confirmed` でも、**締めていない年度なら画面から直せる・削除できる**（止めるのは年度のロックだけ）。
直した・消した記録は変更履歴（`journal_entries_history`）と監査ログに残る（電子帳簿保存法）。

- **直す**: 仕訳帳・元帳から開いて直す。`external_id` は残るので、同じ外部IDで送り直しても上書きされない（直した方が残る）
- **取り消す**: 画面で仕訳を削除する。**紐づく証憑も一緒に消える**（今の作り）。そのあと同じファイル・同じ external_id を送り直せば作り直される
- **締めた年度**: 直せない。翌期に修正の仕訳を入れる

受け口での取り消し（`DELETE /api/v1/journals?external_id=…`）・直し（`PATCH`）はまだ無い（案は下）。

**案**: 第1段階は画面で直す運用にし、送り側で直すことが増えたら `DELETE`（締めていない年度だけ・証憑も一緒に消すかを選べる）を足す。
実装は今の `deleteJournalEntries` の本体（年度ロックの確認・請求書と証憑の連動削除）を、
ログイン前提の確認（`assertRecordsAccess`）から切り離して受け口と共用する形にする。

## 本番に入れる手順（社長の承認が要る）

1. `supabase/migrations/078_api_keys_and_external_ids.sql` を本番の Supabase の SQL エディタで実行する
2. このブランチを main に入れる（＝ Vercel が本番に自動デプロイ）。`/api/version` でコミットを確かめる
3. 本番の会社の「設定」→「外部連携（APIキー）」でキーを発行し、送る側に登録する（キーはそのときだけ表示）
4. `GET /api/v1/ping` で会社名が返ることを確かめてから、1件だけ送って画面で確かめる
