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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
        text: `${isPdf ? "このPDF" : "この画像"}には1つまたは複数の領収書・レシートが含まれている可能性があります。
それぞれを別の取引として認識し、すべてのレシートを配列として返してください。

必ず以下のJSON形式（オブジェクトの配列）で回答してください。値が読み取れない場合はnullにしてください。

{
  "receipts": [
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
  ]
}

重要:
- レシートが1つしか見つからない場合も、必ず1要素の配列として返してください
- 1ページ内に複数のレシート画像がある場合、それぞれを別の要素として返してください
- 同じレシートの裏表や続きと判断できるものは1つにまとめてください
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

    // 6. JSONパース（配列形式: { receipts: [...] }）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("OCR結果のJSON解析に失敗しました");
    }

    const parsedRoot = JSON.parse(jsonMatch[0]);
    const receiptsArray: unknown[] = Array.isArray(parsedRoot)
      ? parsedRoot
      : Array.isArray(parsedRoot?.receipts)
      ? parsedRoot.receipts
      : [parsedRoot];

    if (receiptsArray.length === 0) {
      throw new Error("レシートが検出できませんでした");
    }

    // 7. 各レシートをOcrResultに変換
    const buildOcrFromParsed = async (
      parsed: Record<string, unknown>
    ): Promise<{
      ocrResult: OcrResult;
      detectedPayment: "cash" | "card" | "e_money" | "bank_transfer" | null;
    }> => {
      const currency: string = (parsed.currency as string) ?? "JPY";
      const originalAmount =
        typeof parsed.amount_total === "number" ? parsed.amount_total : undefined;

      let exchangeRate: number | undefined;
      let amountJpy: number | undefined;

      if (currency !== "JPY" && originalAmount != null) {
        const rate = await fetchExchangeRate(currency, "JPY");
        if (rate) {
          exchangeRate = Math.round(rate * 100) / 100;
          amountJpy = Math.round(originalAmount * rate);
        }
      } else if (currency === "JPY") {
        amountJpy = originalAmount;
      }

      const validPaymentMethods = ["cash", "card", "e_money", "bank_transfer"];
      const detectedPayment = validPaymentMethods.includes(
        parsed.payment_method as string
      )
        ? (parsed.payment_method as "cash" | "card" | "e_money" | "bank_transfer")
        : null;

      const taxExcluded =
        typeof parsed.amount_tax_excluded === "number"
          ? parsed.amount_tax_excluded
          : undefined;
      const taxAmt =
        typeof parsed.tax_amount === "number" ? parsed.tax_amount : undefined;

      const ocrResult: OcrResult = {
        date: (parsed.date as string) || undefined,
        vendor_name: (parsed.vendor_name as string) || undefined,
        payment_method: detectedPayment,
        amount_total: amountJpy ?? originalAmount,
        amount_tax_excluded:
          taxExcluded != null
            ? currency !== "JPY" && exchangeRate
              ? Math.round(taxExcluded * exchangeRate)
              : taxExcluded
            : undefined,
        tax_amount:
          taxAmt != null
            ? currency !== "JPY" && exchangeRate
              ? Math.round(taxAmt * exchangeRate)
              : taxAmt
            : undefined,
        tax_rate:
          typeof parsed.tax_rate === "number" ? parsed.tax_rate : undefined,
        items: Array.isArray(parsed.items) ? (parsed.items as string[]) : undefined,
        invoice_number: (parsed.invoice_number as string) || undefined,
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        currency,
        original_amount: currency !== "JPY" ? originalAmount : undefined,
        exchange_rate: exchangeRate,
        amount_jpy: amountJpy,
      };
      return { ocrResult, detectedPayment };
    };

    // 8. 1件目は元レコード更新、2件目以降はsibling行作成
    const firstReceiptId = receiptId;
    const allReceiptIds: string[] = [firstReceiptId];

    for (let i = 0; i < receiptsArray.length; i++) {
      const parsed = (receiptsArray[i] as Record<string, unknown>) ?? {};
      const { ocrResult, detectedPayment } = await buildOcrFromParsed(parsed);

      let currentId: string;
      if (i === 0) {
        currentId = firstReceiptId;
      } else {
        // 兄弟レコード作成（同じimage_path・file_hash・payment_method等を継承）
        const { data: sibling, error: createErr } = await supabase
          .from("receipts")
          .insert({
            client_id: receipt.client_id,
            uploaded_by: receipt.uploaded_by,
            image_path: receipt.image_path,
            payment_method: receipt.payment_method,
            status: "uploaded",
            original_filename: receipt.original_filename
              ? `${receipt.original_filename} (#${i + 1})`
              : null,
            file_size: receipt.file_size,
            mime_type: receipt.mime_type,
            file_hash: receipt.file_hash,
            hash_algorithm: receipt.hash_algorithm,
          })
          .select("id")
          .single();
        if (createErr || !sibling) {
          console.error(`[ocr] sibling作成失敗 (#${i + 1}):`, createErr);
          continue;
        }
        currentId = sibling.id;
        allReceiptIds.push(currentId);
      }

      const updateData: Record<string, unknown> = {
        ocr_result: ocrResult as unknown as import("@/types/database").Json,
        status: "ocr_done",
      };
      if (!receipt.payment_method && detectedPayment) {
        updateData.payment_method = detectedPayment;
      }
      await supabase.from("receipts").update(updateData).eq("id", currentId);

      console.log(`[ocr] OCR完了 (${i + 1}/${receiptsArray.length}): ${currentId}`);
      await generateJournalSuggestion(currentId, memo);
      console.log(`[ocr] 仕訳提案→記帳完了: ${currentId}`);
    }

    // 1件目のOcrResultを返す（後方互換）
    const { ocrResult: firstResult } = await buildOcrFromParsed(
      receiptsArray[0] as Record<string, unknown>
    );
    return firstResult;
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
