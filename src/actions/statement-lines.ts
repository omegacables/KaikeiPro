"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { downloadReceiptImage } from "./receipt-storage";
import type { OcrResult, StatementLine } from "@/types/index";

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY が設定されていません");
  return new GoogleGenerativeAI(apiKey);
}

type DbRow = Record<string, unknown>;

function rowToStatementLine(r: DbRow): StatementLine {
  return {
    id: r.id as string,
    receipt_id: r.receipt_id as string,
    client_id: r.client_id as string,
    line_date: (r.line_date as string) ?? null,
    description: (r.description as string) ?? "",
    amount: (r.amount as number) ?? 0,
    direction: (r.direction as "deposit" | "withdrawal") ?? "withdrawal",
    balance_after: (r.balance_after as number) ?? null,
    counterparty: (r.counterparty as string) ?? null,
    journal_entry_id: (r.journal_entry_id as string) ?? null,
    status: (r.status as StatementLine["status"]) ?? "pending",
    suggested_account_id: (r.suggested_account_id as string) ?? null,
    sort_order: (r.sort_order as number) ?? 0,
    created_at: (r.created_at as string) ?? "",
  };
}

/**
 * 明細書(receipts.document_type='statement')の行データを取得
 */
export async function getStatementLines(
  receiptId: string
): Promise<StatementLine[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("statement_lines")
    .select("*")
    .eq("receipt_id", receiptId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToStatementLine(r as DbRow));
}

/**
 * 明細書をOCRで複数行パースし、statement_lines を再生成する。
 * - 既に仕訳化済みの行がある場合は中断（仕訳を消してから再抽出する運用）
 * - 明細種別(bank/card/other)を判定し ocr_result.statement_subtype に保存
 */
export async function extractStatementTransactions(
  receiptId: string
): Promise<StatementLine[]> {
  const admin = createAdminSupabaseClient();

  // 1. 明細書(receipt)取得
  const { data: receipt, error: fetchError } = await admin
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .single();
  if (fetchError || !receipt) throw new Error("明細書が見つかりません");

  if (
    receipt.image_path.startsWith("raqto://") ||
    receipt.image_path.startsWith("receipts/")
  ) {
    throw new Error("この明細書は抽出対象外です");
  }

  // 2. 仕訳化済みの行があれば中断
  const { data: journalized } = await admin
    .from("statement_lines")
    .select("id")
    .eq("receipt_id", receiptId)
    .eq("status", "journalized");
  if (journalized && journalized.length > 0) {
    throw new Error(
      "仕訳化済みの明細があります。再抽出するには先に該当する仕訳を削除してください。"
    );
  }

  // 3. 画像/PDFをダウンロード → Base64
  const { data: imageData, mimeType } = await downloadReceiptImage(
    receipt.image_path
  );
  const base64 = Buffer.from(imageData).toString("base64");
  const isPdf = mimeType === "application/pdf";

  // 4. Gemini Pro で明細行を抽出
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mimeType as "image/jpeg" | "image/png" | "application/pdf",
        data: base64,
      },
    },
    {
      text: `${isPdf ? "このPDF" : "この画像"}は銀行明細・クレジットカード明細などの「明細書」です。明細に含まれる取引行を全て漏れなく読み取り、以下のJSON形式で返してください。JSONのみ返し、説明文は不要です。

{"statement_subtype":"bank|card|other","lines":[{"date":"YYYY-MM-DD","description":"摘要","amount":金額数値,"direction":"deposit|withdrawal","balance_after":残高数値またはnull,"counterparty":"取引先名またはnull"}]}

statement_subtype の判定:
- bank: 銀行口座の入出金明細（普通預金・当座等）
- card: クレジットカードの利用明細
- other: 上記以外（電子マネー明細・証券明細等）

各行のルール:
- amount: 正の数値（金額の絶対値）で返す
- direction: 入金/預入/返金は "deposit"、出金/引落/利用/支払は "withdrawal"
- クレジットカード明細の利用行は通常 "withdrawal"
- balance_after: 残高列があれば数値、なければ null
- counterparty: 振込先・利用店名など。不明なら null
- 合計行・繰越行・見出し行は含めない（実取引行のみ）`,
    },
  ]);

  const responseText = result.response.text();
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("明細の解析に失敗しました");

  const parsed = JSON.parse(jsonMatch[0]) as {
    statement_subtype?: string;
    lines?: Array<Record<string, unknown>>;
  };

  const validSubtypes = ["bank", "card", "other"];
  const subtype = validSubtypes.includes(parsed.statement_subtype ?? "")
    ? (parsed.statement_subtype as "bank" | "card" | "other")
    : "other";

  const parsedLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  if (parsedLines.length === 0) {
    throw new Error("明細から取引行を検出できませんでした");
  }

  // 5. 既存の（未仕訳の）行を削除して作り直し（冪等）
  await admin.from("statement_lines").delete().eq("receipt_id", receiptId);

  const rows = parsedLines.map((l, i) => {
    const rawAmount =
      typeof l.amount === "number" ? Math.abs(l.amount) : 0;
    const direction: "deposit" | "withdrawal" =
      l.direction === "deposit" ? "deposit" : "withdrawal";
    const signed = direction === "deposit" ? rawAmount : -rawAmount;
    return {
      receipt_id: receiptId,
      client_id: receipt.client_id,
      line_date: (l.date as string) || null,
      description: (l.description as string) || "",
      amount: signed,
      direction,
      balance_after:
        typeof l.balance_after === "number" ? l.balance_after : null,
      counterparty: (l.counterparty as string) || null,
      status: "pending" as const,
      sort_order: i,
      raw_data: l as unknown as import("@/types/database").Json,
    };
  });

  const { data: inserted, error: insertError } = await admin
    .from("statement_lines")
    .insert(rows)
    .select("*");
  if (insertError) throw new Error(`明細行の保存に失敗しました: ${insertError.message}`);

  // 6. ocr_result に statement_subtype を保存（書類種別も確実に statement に）
  const currentOcr = (receipt.ocr_result as OcrResult | null) ?? { confidence: 0 };
  const mergedOcr: OcrResult = {
    ...currentOcr,
    document_type: "statement",
    statement_subtype: subtype,
  };
  await admin
    .from("receipts")
    .update({
      ocr_result: mergedOcr as unknown as import("@/types/database").Json,
      document_type: "statement",
      status: "reviewed",
    })
    .eq("id", receiptId);

  return (inserted ?? [])
    .map((r) => rowToStatementLine(r as DbRow))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * 明細行の手動修正（日付・摘要・金額・取引先）。
 * 金額の符号から direction を再計算する。
 */
export async function updateStatementLine(
  id: string,
  patch: {
    line_date?: string | null;
    description?: string;
    amount?: number; // 符号付き（+入金/-出金）
    counterparty?: string | null;
  }
): Promise<StatementLine> {
  const supabase = await createServerSupabaseClient();

  const update: DbRow = {};
  if (patch.line_date !== undefined) update.line_date = patch.line_date;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.counterparty !== undefined) update.counterparty = patch.counterparty;
  if (patch.amount !== undefined) {
    update.amount = patch.amount;
    update.direction = patch.amount >= 0 ? "deposit" : "withdrawal";
  }

  const { data, error } = await supabase
    .from("statement_lines")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return rowToStatementLine(data as DbRow);
}

/**
 * 明細行の状態変更（除外/解除）。journalized へは createJournals... 経由でのみ遷移。
 */
export async function setStatementLineStatus(
  id: string,
  status: "pending" | "ignored"
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("statement_lines")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * 選択した明細行から一括で仕訳を作成する。
 * - 固定側（相手勘定）は明細種別から自動推定: bank→普通預金 / card→未払金 / other→現金
 * - 相手科目（費用・収益等）はGeminiが摘要から一括推定
 * - 生成仕訳は source='bank'・needs_review=true。receipt_id は付けず
 *   statement_lines.journal_entry_id でリンクする。
 */
export async function createJournalsFromStatementLines(
  lineIds: string[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  if (lineIds.length === 0) return { success: 0, failed: 0, errors: [] };
  const admin = createAdminSupabaseClient();

  // 1. 対象行（pending のみ）取得
  const { data: lineRows, error: linesError } = await admin
    .from("statement_lines")
    .select("*")
    .in("id", lineIds)
    .eq("status", "pending");
  if (linesError) throw new Error(linesError.message);
  const lines = (lineRows ?? []).map((r) => rowToStatementLine(r as DbRow));
  if (lines.length === 0) {
    return { success: 0, failed: 0, errors: ["仕訳化できる明細がありません"] };
  }

  const clientId = lines[0].client_id;

  // 2. 明細書ごとの種別(subtype)を取得（固定側科目の決定に使用）
  const receiptIds = Array.from(new Set(lines.map((l) => l.receipt_id)));
  const { data: receiptRows } = await admin
    .from("receipts")
    .select("id, ocr_result")
    .in("id", receiptIds);
  const subtypeByReceipt = new Map<string, "bank" | "card" | "other">();
  for (const r of receiptRows ?? []) {
    const ocr = (r as DbRow).ocr_result as OcrResult | null;
    const st = ocr?.statement_subtype;
    subtypeByReceipt.set(
      (r as DbRow).id as string,
      st === "bank" || st === "card" ? st : "other"
    );
  }

  // 3. 勘定科目一覧
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, code, name, account_categories(type, name)")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .order("code");
  const accountList = (accounts ?? [])
    .map(
      (a: DbRow) =>
        `${a.code} ${a.name} (${(a.account_categories as DbRow)?.name ?? ""})`
    )
    .join("\n");
  const accountByName = new Map<string, string>(
    (accounts ?? []).map((a: DbRow) => [a.name as string, a.id as string])
  );

  // 固定側科目名 → 種別から決定
  const fixedAccountName = (subtype: "bank" | "card" | "other"): string =>
    subtype === "bank" ? "普通預金" : subtype === "card" ? "未払金" : "現金";

  // 4. Geminiで相手科目を一括推定
  const linePrompts = lines
    .map((l, i) => {
      const subtype = subtypeByReceipt.get(l.receipt_id) ?? "other";
      const fixed = fixedAccountName(subtype);
      const isDeposit = l.direction === "deposit";
      return `#${i} [種別:${subtype} 固定側:${fixed}] 日付:${l.line_date ?? "不明"} / 摘要:${l.description} / 取引先:${l.counterparty ?? "不明"} / 金額:${Math.abs(l.amount)}円 / ${isDeposit ? "入金" : "出金"}`;
    })
    .join("\n");

  const prompt = `あなたは日本の会計仕訳の専門家です。以下の明細書の各行について、相手科目（固定側の反対側に来る勘定科目）を1つずつ推定してください。

## 固定側のルール
- 種別 bank（銀行明細）: 固定側=普通預金。入金→普通預金が借方、出金→普通預金が貸方。
- 種別 card（クレカ明細）: 固定側=未払金。利用(出金)→未払金が貸方・相手科目(費用)が借方。返金(入金)→未払金が借方。
- 種別 other: 固定側=現金。
あなたは「相手科目」のみ推定すればよい（固定側は上記で確定）。

## 相手科目の推定ヒント
- 給与・賞与→給料手当 / 家賃→地代家賃 / 通信・電話→通信費 / 電気ガス水道→水道光熱費
- 振込・送金→相手先から推定 / ATM引出→現金 / 利息→受取利息 / 手数料→支払手数料
- 税金→租税公課 / 売上入金→売上高 or 売掛金 / 仕入→仕入高 or 買掛金

## 利用可能な勘定科目（この中の name を必ず使うこと）
${accountList}

## 明細行
${linePrompts}

各行について以下のJSON配列で回答してください（順序・件数は明細行と一致させる）:
{"results":[{"index":行番号,"counter_account_name":"相手科目名","tax_category":null,"tax_rate":null,"confidence":0.0-1.0}]}

JSONのみ返してください。`;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const aiResult = await model.generateContent(prompt);
  const aiText = aiResult.response.text();
  const aiMatch = aiText.match(/\{[\s\S]*\}/);
  if (!aiMatch) throw new Error("相手科目の推定に失敗しました");
  const aiParsed = JSON.parse(aiMatch[0]) as {
    results?: Array<{
      index: number;
      counter_account_name: string;
      tax_category?: string | null;
      tax_rate?: number | null;
      confidence?: number;
    }>;
  };
  const suggestionByIndex = new Map(
    (aiParsed.results ?? []).map((r) => [r.index, r])
  );

  // 5. 行ごとに仕訳作成
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const subtype = subtypeByReceipt.get(line.receipt_id) ?? "other";
      const fixedName = fixedAccountName(subtype);
      const fixedId = accountByName.get(fixedName);
      if (!fixedId) {
        throw new Error(
          `固定側の勘定科目「${fixedName}」が見つかりません。勘定科目管理で追加してください。`
        );
      }

      const sugg = suggestionByIndex.get(i);
      const counterName = sugg?.counter_account_name;
      if (!counterName) {
        throw new Error("相手科目を推定できませんでした");
      }
      const counterId = accountByName.get(counterName);
      if (!counterId) {
        throw new Error(`勘定科目「${counterName}」が見つかりません`);
      }

      const absAmount = Math.abs(line.amount);
      const isDeposit = line.direction === "deposit";

      // 借方/貸方の決定
      // bank: 入金→借方=普通預金, 貸方=相手 / 出金→借方=相手, 貸方=普通預金
      // card: 出金(利用)→借方=相手, 貸方=未払金 / 入金(返金)→借方=未払金, 貸方=相手
      // other(現金)も bank と同じ向き
      const fixedOnDebit =
        subtype === "card" ? !isDeposit /* 利用は未払金が貸方なので相手が借方→fixedは貸方 */ : isDeposit;
      // fixedOnDebit=true: 固定側が借方
      const debitId = fixedOnDebit ? fixedId : counterId;
      const creditId = fixedOnDebit ? counterId : fixedId;

      const description =
        line.description ||
        (line.counterparty ?? "") ||
        (subtype === "card" ? "カード利用" : "口座取引");

      // 仕訳ヘッダ
      const { data: entry, error: entryErr } = await admin
        .from("journal_entries")
        .insert({
          client_id: clientId,
          entry_date: line.line_date ?? new Date().toISOString().slice(0, 10),
          description,
          status: "draft",
          source: "bank",
          created_by: clientId,
          needs_review: true,
        })
        .select("id")
        .single();
      if (entryErr || !entry) {
        throw new Error(`仕訳作成エラー: ${entryErr?.message ?? "不明"}`);
      }

      // 仕訳明細（2行: 借方/貸方）
      const { error: jlErr } = await admin.from("journal_entry_lines").insert([
        {
          journal_entry_id: entry.id,
          account_id: debitId,
          debit_amount: absAmount,
          credit_amount: 0,
          tax_category: sugg?.tax_category ?? null,
          tax_rate: sugg?.tax_rate ?? null,
          sort_order: 0,
        },
        {
          journal_entry_id: entry.id,
          account_id: creditId,
          debit_amount: 0,
          credit_amount: absAmount,
          tax_category: null,
          tax_rate: null,
          sort_order: 1,
        },
      ]);
      if (jlErr) {
        // 失敗したヘッダは掃除
        await admin.from("journal_entries").delete().eq("id", entry.id);
        throw new Error(`仕訳明細作成エラー: ${jlErr.message}`);
      }

      // 明細行を仕訳化済みに更新
      await admin
        .from("statement_lines")
        .update({
          journal_entry_id: entry.id,
          status: "journalized",
          suggested_account_id: counterId,
        })
        .eq("id", line.id);

      success++;
    } catch (e) {
      failed++;
      errors.push(
        `${line.description?.slice(0, 16) || line.id.slice(0, 8)}: ${
          e instanceof Error ? e.message : "不明なエラー"
        }`
      );
    }
  }

  return { success, failed, errors };
}
