"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { downloadReceiptImage } from "./receipt-storage";
import { generateJournalSuggestion } from "./ai-journal";
import type { OcrResult } from "@/types/index";

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY が設定されていません");
  return new GoogleGenerativeAI(apiKey);
}

/**
 * 為替レート取得（外部API）
 * フォールバック: 手動入力を促す
 */
async function fetchExchangeRate(
  from: string,
  to: string = "JPY"
): Promise<number | null> {
  if (from === to) return 1;
  try {
    const res = await fetch(
      `https://api.exchangerate-api.com/v4/latest/${from}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.rates?.[to] ?? null;
  } catch {
    return null;
  }
}

/**
 * レシート画像をGemini Visionで解析してOCR結果を抽出
 * - 多言語対応（英語レシート→日本語翻訳）
 * - 多通貨対応（USD/EUR等→JPY自動換算）
 */
export async function processReceiptOcr(
  receiptId: string,
  memo?: string | null
): Promise<OcrResult> {
  console.log(`[ocr] processReceiptOcr開始: ${receiptId}`);
  // fire-and-forget で呼ばれるためリクエストコンテキスト不要の admin client を使用
  const supabase = createAdminSupabaseClient();

  // 1. レシート取得
  const { data: receipt, error: fetchError } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .single();

  if (fetchError || !receipt) throw new Error("領収書が見つかりません");

  // Raqto連携やプレースホルダーはスキップ
  if (
    receipt.image_path.startsWith("raqto://") ||
    receipt.image_path.startsWith("receipts/")
  ) {
    throw new Error("この領収書はOCR対象外です");
  }

  // 2. ステータスを「処理中」に更新
  await supabase
    .from("receipts")
    .update({ status: "processing" })
    .eq("id", receiptId);

  try {
    // 3. Storageから画像をダウンロード
    const { data: imageData, mimeType } = await downloadReceiptImage(
      receipt.image_path
    );

    // 4. Base64変換
    const base64 = Buffer.from(imageData).toString("base64");

    // 5. Gemini 3 Flash API呼び出し（画像・PDF両対応）
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const isPdf = mimeType === "application/pdf";

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType as
            | "image/jpeg"
            | "image/png"
            | "application/pdf",
          data: base64,
        },
      },
      {
        text: `${isPdf ? "このPDF" : "この画像"}は領収書・レシートです。言語や通貨を問わず、以下の情報をJSON形式で抽出してください。

必ず以下のJSON形式で回答してください。値が読み取れない場合はnullにしてください。

{
  "date": "YYYY-MM-DD形式の日付",
  "vendor_name": "店名・発行者名（そのまま）",
  "amount_total": 合計金額（税込、数値のみ、原通貨のまま）,
  "amount_tax_excluded": 税抜金額（数値のみ、原通貨のまま）,
  "tax_amount": 税額（数値のみ、原通貨のまま）,
  "tax_rate": 税率（小数。例: 10% → 0.10, 8.875% → 0.08875）,
  "currency": "通貨コード（ISO 4217。例: JPY, USD, EUR, GBP, CNY, KRW, TWD）",
  "items": ["品目1", "品目2"],
  "invoice_number": "インボイス番号（日本のT+13桁、あれば）",
  "payment_method": "cash / card / e_money / bank_transfer / null",
  "confidence": 0.0〜1.0の信頼度
}

重要:
- 金額は数値のみ（カンマや通貨記号は除く）
- 日付は西暦YYYY-MM-DD形式に変換（令和・平成は西暦に変換）
- 通貨は$ならUSD、¥で日本の店ならJPY、€ならEUR等を正確に判定
- 店名や品目はレシートに記載されたままの言語で返す（翻訳不要）
- 軽減税率(8%)対象品目がある場合はtax_rateに0.08を設定
- payment_methodはレシート記載から判定:
  - "cash": 現金、お釣り記載がある場合
  - "card": クレジット、VISA、Mastercard、JCB、AMEX、デビット等の記載
  - "e_money": Suica、PASMO、PayPay、iD、QUICPay、楽天Edy、nanaco、WAON等
  - "bank_transfer": 振込、振替、口座引落等の記載
  - null: 判別不可の場合
- JSONのみ返してください。説明文は不要です。`,
      },
    ]);

    const responseText = result.response.text();

    // 6. JSONパース
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("OCR結果のJSON解析に失敗しました");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // 7. 通貨判定 + 為替レート取得
    const currency: string = parsed.currency ?? "JPY";
    const originalAmount =
      typeof parsed.amount_total === "number" ? parsed.amount_total : undefined;

    let exchangeRate: number | undefined;
    let amountJpy: number | undefined;

    if (currency !== "JPY" && originalAmount != null) {
      // 外貨の場合、為替レートを取得
      const rate = await fetchExchangeRate(currency, "JPY");
      if (rate) {
        exchangeRate = Math.round(rate * 100) / 100;
        amountJpy = Math.round(originalAmount * rate);
      }
    } else if (currency === "JPY") {
      amountJpy = originalAmount;
    }

    // 支払い方法の判別
    const validPaymentMethods = ["cash", "card", "e_money", "bank_transfer"];
    const detectedPayment = validPaymentMethods.includes(parsed.payment_method)
      ? (parsed.payment_method as "cash" | "card" | "e_money" | "bank_transfer")
      : null;

    const ocrResult: OcrResult = {
      date: parsed.date || undefined,
      vendor_name: parsed.vendor_name || undefined,
      payment_method: detectedPayment,
      amount_total: amountJpy ?? originalAmount,
      amount_tax_excluded:
        typeof parsed.amount_tax_excluded === "number"
          ? currency !== "JPY" && exchangeRate
            ? Math.round(parsed.amount_tax_excluded * exchangeRate)
            : parsed.amount_tax_excluded
          : undefined,
      tax_amount:
        typeof parsed.tax_amount === "number"
          ? currency !== "JPY" && exchangeRate
            ? Math.round(parsed.tax_amount * exchangeRate)
            : parsed.tax_amount
          : undefined,
      tax_rate:
        typeof parsed.tax_rate === "number" ? parsed.tax_rate : undefined,
      items: Array.isArray(parsed.items) ? parsed.items : undefined,
      invoice_number: parsed.invoice_number || undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      // 多通貨フィールド
      currency,
      original_amount: currency !== "JPY" ? originalAmount : undefined,
      exchange_rate: exchangeRate,
      amount_jpy: amountJpy,
    };

    // 8. OCR結果をDB保存 + ステータス更新 + 支払い方法補完
    const updateData: Record<string, unknown> = {
      ocr_result: ocrResult as unknown as import("@/types/database").Json,
      status: "ocr_done",
    };
    // ユーザーが支払い方法を未選択の場合、OCR検出値で補完
    if (!receipt.payment_method && detectedPayment) {
      updateData.payment_method = detectedPayment;
    }
    await supabase
      .from("receipts")
      .update(updateData)
      .eq("id", receiptId);

    // 9. 仕訳提案を自動生成 → 仕訳帳に自動記録
    console.log(`[ocr] OCR完了、仕訳提案開始: ${receiptId}`);
    await generateJournalSuggestion(receiptId, memo);
    console.log(`[ocr] 仕訳提案→記帳完了: ${receiptId}`);

    return ocrResult;
  } catch (error) {
    // 失敗時: ステータスを「アップロード済」に戻す
    await supabase
      .from("receipts")
      .update({ status: "uploaded" })
      .eq("id", receiptId);

    throw error;
  }
}

/**
 * OCR結果を手動で修正して保存
 */
export async function updateOcrResult(
  receiptId: string,
  updates: Partial<OcrResult>
): Promise<OcrResult> {
  const supabase = await createServerSupabaseClient();

  // 現在のOCR結果を取得
  const { data: receipt, error } = await supabase
    .from("receipts")
    .select("ocr_result")
    .eq("id", receiptId)
    .single();

  if (error || !receipt) throw new Error("領収書が見つかりません");

  const currentOcr = (receipt.ocr_result as OcrResult | null) ?? {
    confidence: 0,
  };

  // マージ
  const merged: OcrResult = { ...currentOcr, ...updates };

  // 為替レートが更新された場合、JPY金額を再計算
  if (
    merged.currency &&
    merged.currency !== "JPY" &&
    merged.original_amount != null &&
    merged.exchange_rate != null
  ) {
    merged.amount_jpy = Math.round(
      merged.original_amount * merged.exchange_rate
    );
    merged.amount_total = merged.amount_jpy;
  }

  await supabase
    .from("receipts")
    .update({
      ocr_result: merged as unknown as import("@/types/database").Json,
    })
    .eq("id", receiptId);

  return merged;
}

/**
 * OCRを再実行
 */
export async function retriggerOcr(receiptId: string): Promise<OcrResult> {
  return processReceiptOcr(receiptId);
}
