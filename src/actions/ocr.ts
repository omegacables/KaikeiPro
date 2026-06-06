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

  // 自社名（発行/受領の判定に使用）
  const { data: clientRow } = await supabase
    .from("clients")
    .select("name")
    .eq("id", receipt.client_id)
    .maybeSingle();
  const clientName = (clientRow as { name?: string } | null)?.name ?? "";

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

    // 5. Gemini API呼び出し（画像・PDF両対応）
    // 1画像内の複数レシートを漏れなく読み取るため精度の高い Pro を使用
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

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
        text: `${isPdf ? "このPDF" : "この画像"}に含まれる領収書・書類を全て読み取り、以下のJSON形式で返してください。値が不明な場合はnullにしてください。JSONのみ返し、説明文は不要です。

{"receipts":[{"date":"YYYY-MM-DD","vendor_name":"店名・発行者","amount_total":合計金額数値,"amount_tax_excluded":税抜金額数値,"tax_amount":税額数値,"tax_rate":税率小数,"currency":"JPY等","items":["品目"],"invoice_number":"T番号等","document_type":"qualified_invoice|category_invoice|receipt|statement|delivery_note|estimate|contract|other","payment_method":"cash|card|e_money|bank_transfer|null","direction":"issued|received","confidence":0.0-1.0}]}

document_typeの判定基準:
- qualified_invoice: T+13桁の登録番号がある請求書
- category_invoice: 8%/10%区分記載のある請求書（T番号なし）
- receipt: 領収書・レシート（コンビニ・飲食店・タクシー等）
- statement: 利用明細・クレカ明細・銀行明細・給与明細
- delivery_note: 納品書
- estimate: 見積書・注文書・発注書
- contract: 契約書・覚書
- other: 上記以外

direction（自社「${clientName || "名称不明"}」基準）:
- issued: 自社が発行者（発行元に自社名）
- received: 取引先から受領（宛名に自社名、または判断不能）

payment_method: cash=現金/釣銭あり、card=クレジット/デビット、e_money=電子マネー/QR決済、bank_transfer=振込

複数のレシートが写っている場合はreceipts配列を複数要素にしてください。`,
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
      documentType: "qualified_invoice" | "category_invoice" | "receipt" | "statement" | "delivery_note" | "estimate" | "contract" | "other" | undefined;
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

      const validDocumentTypes = ["qualified_invoice", "category_invoice", "receipt", "statement", "delivery_note", "estimate", "contract", "other"];
      const documentType = validDocumentTypes.includes(parsed.document_type as string)
        ? (parsed.document_type as "qualified_invoice" | "category_invoice" | "receipt" | "statement" | "delivery_note" | "estimate" | "contract" | "other")
        : undefined;

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
        document_type: documentType,
      };
      return { ocrResult, detectedPayment, documentType };
    };

    // 8. 1件目は元レコード更新、2件目以降はsibling行作成
    for (let i = 0; i < receiptsArray.length; i++) {
      const parsed = (receiptsArray[i] as Record<string, unknown>) ?? {};
      const { ocrResult, detectedPayment, documentType } = await buildOcrFromParsed(parsed);

      let currentId: string;
      if (i === 0) {
        currentId = receiptId;
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
      }

      const updateData: Record<string, unknown> = {
        ocr_result: ocrResult as unknown as import("@/types/database").Json,
        status: "ocr_done",
        // AI判定: 発行(自社発行) / 受領(取引先から受領)。不明時は received
        direction: parsed.direction === "issued" ? "issued" : "received",
        document_type: documentType ?? null,
      };
      if (!receipt.payment_method && detectedPayment) {
        updateData.payment_method = detectedPayment;
      }

      const { error: updateErr } = await supabase
        .from("receipts")
        .update(updateData)
        .eq("id", currentId);
      if (updateErr) {
        console.error(`[ocr] DB更新エラー (${currentId}): ${updateErr.message}`);
        throw new Error(`OCR結果の保存に失敗しました: ${updateErr.message}`);
      }

      console.log(`[ocr] OCR完了 (${i + 1}/${receiptsArray.length}): ${currentId}`);

      // 仕訳提案は別途 try/catch — 失敗しても OCR 結果は保持する
      try {
        await generateJournalSuggestion(currentId, memo);
        console.log(`[ocr] 仕訳提案→記帳完了: ${currentId}`);
      } catch (suggErr) {
        // 仕訳提案が失敗してもOCR結果は維持 (status は ocr_done のまま)
        console.error(`[ocr] 仕訳提案エラー (${currentId}):`, suggErr instanceof Error ? suggErr.message : suggErr);
      }
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
