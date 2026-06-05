"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import type { OcrResult, AiJournalSuggestion } from "@/types/index";

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY が設定されていません");
  return new GoogleGenerativeAI(apiKey);
}

/**
 * OCR結果から仕訳を提案
 */
export async function generateJournalSuggestion(
  receiptId: string,
  memo?: string | null
): Promise<AiJournalSuggestion> {
  console.log(`[ai-journal] generateJournalSuggestion開始: ${receiptId}, memo=${memo ? "あり" : "なし"}`);
  // fire-and-forget で呼ばれるためリクエストコンテキスト不要の admin client を使用
  const supabase = createAdminSupabaseClient();

  // 1. レシート取得
  const { data: receipt, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .single();

  if (error || !receipt) throw new Error("領収書が見つかりません");

  const ocrResult = receipt.ocr_result as OcrResult | null;
  if (!ocrResult) {
    throw new Error("OCR結果がありません。先にOCRを実行してください。");
  }

  // 2. クライアントの勘定科目一覧取得
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories(type, name)")
    .or(`client_id.eq.${receipt.client_id},client_id.is.null`)
    .eq("is_active", true)
    .order("code");

  const accountList = (accounts ?? [])
    .map(
      (a: Record<string, unknown>) =>
        `${a.code} ${a.name} (${(a.account_categories as Record<string, unknown>)?.name ?? ""})`
    )
    .join("\n");

  // 3. 仕訳用金額（円ベース）を決定
  const isForex = ocrResult.currency && ocrResult.currency !== "JPY";
  const jpyTotal = isForex
    ? ocrResult.amount_jpy ?? ocrResult.amount_total
    : ocrResult.amount_total;
  const jpyTaxExcluded = isForex
    ? ocrResult.amount_tax_excluded // OCRで既に換算済み
    : ocrResult.amount_tax_excluded;
  const jpyTax = isForex
    ? ocrResult.tax_amount
    : ocrResult.tax_amount;

  // 4. Gemini APIで仕訳提案生成
  const forexNote = isForex
    ? `\n- 原通貨: ${ocrResult.currency} ${ocrResult.original_amount}\n- 適用レート: 1 ${ocrResult.currency} = ${ocrResult.exchange_rate} JPY\n- ※以下の金額は全て円換算後の値です`
    : "";

  const prompt = `あなたは日本の会計仕訳の専門家です。以下のOCR結果を元に仕訳を提案してください。

## OCR結果
- 日付: ${ocrResult.date ?? "不明"}
- 取引先: ${ocrResult.vendor_name ?? "不明"}
- 合計金額（税込・円）: ${jpyTotal ?? "不明"}
- 税抜金額（円）: ${jpyTaxExcluded ?? "不明"}
- 消費税額（円）: ${jpyTax ?? "不明"}
- 税率: ${ocrResult.tax_rate != null ? `${ocrResult.tax_rate * 100}%` : "不明"}
- 品目: ${ocrResult.items?.join(", ") ?? "不明"}
- インボイス番号: ${ocrResult.invoice_number ?? "なし"}
- 支払方法: ${receipt.payment_method ?? "不明"}${forexNote}

## 利用可能な勘定科目
${accountList}

## ルール
1. 借方・貸方は必ず均衡させること（合計が一致）
2. 消費税がある場合は「仮払消費税」科目で税額を分離
3. 支払方法に応じた貸方科目を選択:
   - cash → 現金
   - card → 未払金
   - bank_transfer → 普通預金
   - e_money → 未払金
4. 品目・取引先から適切な費用科目を推定:
   - 文房具・事務用品 → 消耗品費
   - タクシー・交通費 → 旅費交通費
   - 携帯・インターネット → 通信費
   - 飲食（打合せ）→ 会議費
   - 飲食（接待）→ 接待交際費
   - 書籍・新聞 → 新聞図書費
   - コンビニ(消耗品) → 消耗品費
   - 電気・ガス・水道 → 水道光熱費
   - 家賃 → 地代家賃
5. 摘要(description)には支払方法を括弧書きで末尾に付ける:
   - cash → （現金）
   - card → （カード）
   - e_money → （電子マネー）
   - bank_transfer → （振込）
   - 不明の場合は省略
6. インボイス番号がない場合はインボイス経過措置の税区分を使用
6. 外貨建て取引の場合:
   - 金額は全て円換算後の値を使用すること
   - 摘要に原通貨金額とレートを記載（例: 「$40.98 @150.32」）
   - 海外取引は消費税がかからないため、仮払消費税は計上しない

以下のJSON形式で回答してください:
{
  "description": "摘要（取引先名 + 内容の簡潔な説明 + 支払方法）例: 'Amazon 書籍購入（カード）'",
  "entry_date": "YYYY-MM-DD",
  "lines": [
    {
      "account_name": "勘定科目名",
      "account_code": "科目コード",
      "debit_amount": 数値,
      "credit_amount": 0,
      "tax_category": "purchase_10等",
      "tax_rate": 0.10
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "この仕訳にした理由の簡潔な説明"
}

JSONのみ返してください。`;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("仕訳提案のJSON解析に失敗しました");

  const suggestion = JSON.parse(jsonMatch[0]) as AiJournalSuggestion;

  // 4. レシートに保存
  await supabase
    .from("receipts")
    .update({
      ai_journal_suggestion:
        suggestion as unknown as import("@/types/database").Json,
    })
    .eq("id", receiptId);

  // 5. AI提案を自動で仕訳帳に記録
  await autoCreateJournalFromSuggestion(receiptId, receipt, suggestion, accounts ?? [], memo);

  return suggestion;
}

/**
 * AI提案から仕訳エントリーを自動作成（fire-and-forget用、admin権限）
 */
async function autoCreateJournalFromSuggestion(
  receiptId: string,
  receipt: { client_id: string; uploaded_by: string },
  suggestion: AiJournalSuggestion,
  accounts: { id: string; name: string; code: string }[],
  memo?: string | null
): Promise<void> {
  console.log(`[ai-journal] autoCreateJournal開始: ${receiptId}, 科目数=${accounts.length}`);
  const admin = createAdminSupabaseClient();

  // 科目名 → 科目ID を解決
  const accountMap = new Map(
    accounts.map((a: { name: string; id: string }) => [a.name, a.id])
  );

  // 未対応の科目があればエラー
  const missingAccounts = suggestion.lines
    .filter((line) => !accountMap.has(line.account_name))
    .map((line) => line.account_name);

  if (missingAccounts.length > 0) {
    const msg = `勘定科目「${missingAccounts.join("、")}」が見つかりません。手動で仕訳を作成してください。`;
    console.error(`[ai-journal] ${msg} (receipt: ${receiptId})`);
    throw new Error(msg);
  }

  // 仕訳エントリー作成
  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: receipt.client_id,
      entry_date: suggestion.entry_date,
      description: suggestion.description,
      status: "draft",
      source: "ai",
      receipt_id: receiptId,
      created_by: receipt.uploaded_by,
      needs_review: false,
    })
    .select()
    .single();

  if (entryError) {
    console.error(`自動仕訳エントリー作成エラー: ${entryError.message}`);
    return;
  }

  // 仕訳明細作成
  const lines = suggestion.lines.map((line, i) => ({
    journal_entry_id: entry.id,
    account_id: accountMap.get(line.account_name)!,
    debit_amount: line.debit_amount,
    credit_amount: line.credit_amount,
    tax_category: line.tax_category ?? null,
    tax_rate: line.tax_rate ?? null,
    sort_order: i,
  }));

  const { error: linesError } = await admin
    .from("journal_entry_lines")
    .insert(lines);

  if (linesError) {
    console.error(`自動仕訳明細作成エラー: ${linesError.message}`);
    return;
  }

  // レシートを仕訳済に更新
  await admin
    .from("receipts")
    .update({
      status: "journalized" as const,
      reviewed_at: new Date().toISOString(),
      reviewed_by: receipt.uploaded_by,
    })
    .eq("id", receiptId);

  console.log(`自動仕訳作成完了: receipt=${receiptId}, journal=${entry.id}`);
}

/**
 * 仕訳提案を承認して実際の仕訳エントリーを作成
 */
export async function approveJournalSuggestion(
  receiptId: string
): Promise<string> {
  const supabase = await createServerSupabaseClient();

  // 1. レシート取得
  const { data: receipt, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .single();

  if (error || !receipt) throw new Error("領収書が見つかりません");

  const suggestion = receipt.ai_journal_suggestion as AiJournalSuggestion | null;
  if (!suggestion) throw new Error("仕訳提案がありません");

  // 2. 科目名→科目IDを解決
  const accountNames = suggestion.lines.map((l) => l.account_name);
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, code")
    .or(`client_id.eq.${receipt.client_id},client_id.is.null`)
    .in("name", accountNames);

  const accountMap = new Map(
    (accounts ?? []).map((a: { name: string; id: string }) => [a.name, a.id])
  );

  // 未対応の科目があればエラー
  for (const line of suggestion.lines) {
    if (!accountMap.has(line.account_name)) {
      throw new Error(
        `勘定科目「${line.account_name}」が見つかりません。手動で仕訳を作成してください。`
      );
    }
  }

  // 3. 認証ユーザー取得
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) throw new Error("認証エラー");

  // 4. 仕訳エントリー作成（raqto-sync.tsパターン踏襲）
  const { data: entry, error: entryError } = await supabase
    .from("journal_entries")
    .insert({
      client_id: receipt.client_id,
      entry_date: suggestion.entry_date,
      description: suggestion.description,
      status: "draft",
      source: "ai",
      receipt_id: receiptId,
      created_by: authUser.id,
    })
    .select()
    .single();

  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  // 5. 仕訳明細作成
  const lines = suggestion.lines.map((line, i) => ({
    journal_entry_id: entry.id,
    account_id: accountMap.get(line.account_name)!,
    debit_amount: line.debit_amount,
    credit_amount: line.credit_amount,
    tax_category: line.tax_category ?? null,
    tax_rate: line.tax_rate ?? null,
    sort_order: i,
  }));

  const { error: linesError } = await supabase
    .from("journal_entry_lines")
    .insert(lines);

  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  // 6. レシートを仕訳済に更新
  await supabase
    .from("receipts")
    .update({
      status: "journalized",
      reviewed_at: new Date().toISOString(),
      reviewed_by: authUser.id,
    })
    .eq("id", receiptId);

  return entry.id;
}

// ---------------------------------------------------------------------------
// 銀行取引からの自動仕訳作成
// ---------------------------------------------------------------------------

/**
 * 銀行取引からAIで仕訳を提案し自動作成
 */
export async function autoCreateJournalFromBankTransaction(
  transactionId: string
): Promise<string> {
  const admin = createAdminSupabaseClient();

  // 1. 銀行取引を取得
  const { data: txn, error: txnError } = await admin
    .from("bank_transactions")
    .select("*, bank_accounts!inner(id, client_id, account_id, bank_name)")
    .eq("id", transactionId)
    .single();

  if (txnError || !txn) throw new Error("銀行取引が見つかりません");

  const bankAccount = txn.bank_accounts as unknown as {
    id: string;
    client_id: string;
    account_id: string | null;
    bank_name: string;
  };

  if (!bankAccount.account_id) {
    throw new Error("銀行口座に勘定科目が紐付けられていません。口座設定で勘定科目を設定してください。");
  }

  // 2. 利用可能な勘定科目一覧を取得
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, code, name, account_categories(type, name)")
    .or(`client_id.eq.${bankAccount.client_id},client_id.is.null`)
    .eq("is_active", true)
    .order("code");

  const accountList = (accounts ?? [])
    .map(
      (a: Record<string, unknown>) =>
        `${a.code} ${a.name} (${(a.account_categories as Record<string, unknown>)?.name ?? ""})`
    )
    .join("\n");

  // 3. Gemini APIで仕訳提案生成
  const isDeposit = txn.amount >= 0;
  const absAmount = Math.abs(txn.amount);

  // 預金口座の科目名を取得
  const depositAccount = (accounts ?? []).find(
    (a: Record<string, unknown>) => a.id === bankAccount.account_id
  );
  const depositAccountName = (depositAccount as Record<string, unknown>)?.name as string ?? "普通預金";

  const prompt = `あなたは日本の会計仕訳の専門家です。以下の銀行取引を元に仕訳を提案してください。

## 銀行取引データ
- 取引日: ${txn.transaction_date}
- 摘要: ${txn.description}
- 取引先: ${txn.counterparty ?? "不明"}
- 金額: ${absAmount}円
- 取引種別: ${isDeposit ? "入金（預入）" : "出金（引出）"}
- 銀行名: ${bankAccount.bank_name}

## 預金口座の勘定科目
- ${depositAccountName}（この科目は ${isDeposit ? "借方" : "貸方"} に使用すること）

## 利用可能な勘定科目
${accountList}

## ルール
1. 借方・貸方は必ず均衡させること
2. 入金（預入）の場合:
   - 借方: ${depositAccountName}（金額: ${absAmount}）
   - 貸方: 摘要から推定した適切な科目
3. 出金（引出）の場合:
   - 借方: 摘要から推定した適切な科目
   - 貸方: ${depositAccountName}（金額: ${absAmount}）
4. 摘要から適切な相手科目を推定:
   - 給与・賞与 → 給料手当
   - 家賃 → 地代家賃
   - 電話・通信 → 通信費
   - 電気・ガス・水道 → 水道光熱費
   - 振込・送金 → 相手先名から推定
   - ATM引出 → 現金
   - 利息 → 受取利息
   - 手数料 → 支払手数料
   - 税金 → 租税公課
   - 売上入金 → 売上高 or 売掛金
5. 消費税が推定できる場合は仮払消費税/仮受消費税を計上

以下のJSON形式で回答してください:
{
  "description": "摘要（取引内容の簡潔な説明）",
  "entry_date": "${txn.transaction_date}",
  "lines": [
    {
      "account_name": "勘定科目名",
      "account_code": "科目コード",
      "debit_amount": 数値,
      "credit_amount": 0,
      "tax_category": null,
      "tax_rate": null
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "この仕訳にした理由"
}

JSONのみ返してください。`;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("仕訳提案のJSON解析に失敗しました");

  const suggestion = JSON.parse(jsonMatch[0]) as AiJournalSuggestion;

  // 4. 科目名 → ID を解決
  const accountMap = new Map(
    (accounts ?? []).map((a: Record<string, unknown>) => [a.name as string, a.id as string])
  );

  const missingAccounts = suggestion.lines
    .filter((line) => !accountMap.has(line.account_name))
    .map((line) => line.account_name);

  if (missingAccounts.length > 0) {
    throw new Error(`勘定科目「${missingAccounts.join("、")}」が見つかりません`);
  }

  // 5. 仕訳エントリー作成
  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: bankAccount.client_id,
      entry_date: suggestion.entry_date,
      description: suggestion.description,
      status: "draft",
      source: "bank",
      created_by: bankAccount.client_id, // システム作成
      needs_review: true,
    })
    .select()
    .single();

  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  // 6. 仕訳明細作成
  const lines = suggestion.lines.map((line, i) => ({
    journal_entry_id: entry.id,
    account_id: accountMap.get(line.account_name)!,
    debit_amount: line.debit_amount,
    credit_amount: line.credit_amount,
    tax_category: line.tax_category ?? null,
    tax_rate: line.tax_rate ?? null,
    sort_order: i,
  }));

  const { error: linesError } = await admin
    .from("journal_entry_lines")
    .insert(lines);

  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  // 7. 銀行取引を照合済みに更新
  await admin
    .from("bank_transactions")
    .update({
      journal_entry_id: entry.id,
      match_status: "matched" as const,
      match_confidence: suggestion.confidence,
      suggested_account_id: accountMap.get(
        suggestion.lines.find((l) => l.account_name !== depositAccountName)?.account_name ?? ""
      ) ?? null,
    })
    .eq("id", transactionId);

  return entry.id;
}

/**
 * 複数の銀行取引から一括でAI仕訳を作成
 */
export async function autoCreateJournalsFromBankTransactions(
  transactionIds: string[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const txnId of transactionIds) {
    try {
      await autoCreateJournalFromBankTransaction(txnId);
      success++;
    } catch (e) {
      failed++;
      errors.push(`${txnId.slice(0, 8)}: ${e instanceof Error ? e.message : "不明なエラー"}`);
    }
  }

  return { success, failed, errors };
}

// ---------------------------------------------------------------------------
// カード取引からの自動仕訳作成
// ---------------------------------------------------------------------------

/**
 * カード取引からAIで仕訳を提案し自動作成
 * カード利用: Dr 費用 / Cr 未払金
 * カード返金: Dr 未払金 / Cr 費用
 */
export async function autoCreateJournalFromCardTransaction(
  transactionId: string
): Promise<string> {
  const admin = createAdminSupabaseClient();

  // 1. カード取引を取得
  const { data: txn, error: txnError } = await admin
    .from("card_transactions")
    .select("*, card_accounts!inner(id, client_id, payable_account_id, card_name, card_company)")
    .eq("id", transactionId)
    .single();

  if (txnError || !txn) throw new Error("カード取引が見つかりません");

  const cardAccount = txn.card_accounts as unknown as {
    id: string;
    client_id: string;
    payable_account_id: string | null;
    card_name: string;
    card_company: string;
  };

  if (!cardAccount.payable_account_id) {
    throw new Error("カードに未払金科目が紐付けられていません。設定画面でカードに未払金科目を登録してください。");
  }

  // 2. 利用可能な勘定科目一覧を取得
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, code, name, account_categories(type, name)")
    .or(`client_id.eq.${cardAccount.client_id},client_id.is.null`)
    .eq("is_active", true)
    .order("code");

  const accountList = (accounts ?? [])
    .map(
      (a: Record<string, unknown>) =>
        `${a.code} ${a.name} (${(a.account_categories as Record<string, unknown>)?.name ?? ""})`
    )
    .join("\n");

  // 3. 未払金の科目名を取得
  const payableAccount = (accounts ?? []).find(
    (a: Record<string, unknown>) => a.id === cardAccount.payable_account_id
  );
  const payableName = (payableAccount as Record<string, unknown>)?.name as string ?? "未払金";

  // 4. transaction_typeで分岐
  const isCharge = txn.transaction_type === "charge" || txn.transaction_type === "fee" || txn.transaction_type === "interest";
  const absAmount = Math.abs(txn.amount);

  const prompt = `あなたは日本の会計仕訳の専門家です。以下のクレジットカード取引から仕訳を提案してください。

## カード取引データ
- 利用日: ${txn.transaction_date}
- 利用店舗/摘要: ${txn.description}
- 取引先: ${txn.counterparty ?? "不明"}
- 金額: ${absAmount}円
- 取引種別: ${txn.transaction_type === "charge" ? "利用" : txn.transaction_type === "refund" ? "返金" : txn.transaction_type === "fee" ? "手数料" : txn.transaction_type === "interest" ? "利息" : "その他"}
- カード: ${cardAccount.card_company} ${cardAccount.card_name}
- 支払区分: ${txn.installment_type === "installment" ? `分割${txn.installment_count ?? ""}回` : txn.installment_type === "revolving" ? "リボ" : txn.installment_type === "bonus" ? "ボーナス" : "一括"}

## 未払金科目（必ず使用）
- ${payableName}（${isCharge ? "貸方" : "借方"} に計上すること）

## 利用可能な勘定科目
${accountList}

## ルール
1. 借方・貸方は必ず均衡させること
2. カード利用の場合:
   - 借方: 推定した費用科目（消費税があれば仮払消費税も）
   - 貸方: ${payableName}（${absAmount}円）
3. カード返金の場合:
   - 借方: ${payableName}（${absAmount}円）
   - 貸方: 推定した費用科目（逆仕訳）
4. 利用店舗から適切な費用科目を推定:
   - タクシー・交通費 → 旅費交通費
   - 飲食店（打合せ）→ 会議費
   - 飲食店（接待）→ 接待交際費
   - コンビニ・スーパー（消耗品）→ 消耗品費
   - 書籍・Amazon（書籍）→ 新聞図書費
   - 通信（NTT等）→ 通信費
   - 電気・ガス・水道 → 水道光熱費
   - 宿泊（ホテル）→ 旅費交通費
   - 広告（Google/Facebook）→ 広告宣伝費
   - 手数料 → 支払手数料
   - 利息 → 支払利息
5. 消費税10%を含むと仮定し、必要であれば仮払消費税で分離（約1.1で割って10%部分を算出）
6. 摘要末尾に「（カード）」を付ける

以下のJSON形式で回答してください:
{
  "description": "摘要（利用店舗 + 内容 + （カード））",
  "entry_date": "${txn.transaction_date}",
  "lines": [
    {
      "account_name": "勘定科目名",
      "account_code": "科目コード",
      "debit_amount": 数値,
      "credit_amount": 数値,
      "tax_category": "purchase_10等 or null",
      "tax_rate": 0.10 or null
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "推定理由"
}

JSONのみ返してください。`;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("仕訳提案のJSON解析に失敗しました");

  const suggestion = JSON.parse(jsonMatch[0]) as AiJournalSuggestion;

  // 5. 科目名 → ID を解決
  const accountMap = new Map(
    (accounts ?? []).map((a: Record<string, unknown>) => [a.name as string, a.id as string])
  );

  const missingAccounts = suggestion.lines
    .filter((line) => !accountMap.has(line.account_name))
    .map((line) => line.account_name);

  if (missingAccounts.length > 0) {
    throw new Error(`勘定科目「${missingAccounts.join("、")}」が見つかりません`);
  }

  // 6. 仕訳エントリー作成
  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: cardAccount.client_id,
      entry_date: suggestion.entry_date,
      description: suggestion.description,
      status: "draft",
      source: "card",
      created_by: cardAccount.client_id,
      needs_review: true,
    })
    .select()
    .single();

  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  // 7. 仕訳明細作成
  const lines = suggestion.lines.map((line, i) => ({
    journal_entry_id: entry.id,
    account_id: accountMap.get(line.account_name)!,
    debit_amount: line.debit_amount,
    credit_amount: line.credit_amount,
    tax_category: line.tax_category ?? null,
    tax_rate: line.tax_rate ?? null,
    sort_order: i,
  }));

  const { error: linesError } = await admin
    .from("journal_entry_lines")
    .insert(lines);

  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  // 8. カード取引を照合済みに更新
  await admin
    .from("card_transactions")
    .update({
      journal_entry_id: entry.id,
      match_status: "matched" as const,
      match_confidence: suggestion.confidence,
      suggested_account_id: accountMap.get(
        suggestion.lines.find((l) => l.account_name !== payableName)?.account_name ?? ""
      ) ?? null,
    })
    .eq("id", transactionId);

  return entry.id;
}

/**
 * 複数のカード取引から一括でAI仕訳を作成
 */
export async function autoCreateJournalsFromCardTransactions(
  transactionIds: string[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const txnId of transactionIds) {
    try {
      await autoCreateJournalFromCardTransaction(txnId);
      success++;
    } catch (e) {
      failed++;
      errors.push(`${txnId.slice(0, 8)}: ${e instanceof Error ? e.message : "不明なエラー"}`);
    }
  }

  return { success, failed, errors };
}
