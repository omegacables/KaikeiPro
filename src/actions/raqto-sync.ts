"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { createRaqtoSupabaseClient } from "@/lib/supabase-raqto";
import { getRaqtoIntegration } from "@/actions/raqto-integration";
import { assertClientAccess } from "@/lib/authz";
import type {
  RaqtoPartner,
  RaqtoOrder,
  RaqtoOrderItem,
  RaqtoDocument,
  RaqtoDocumentItem,
} from "@/types/raqto";

export type RaqtoSyncResult = {
  success: boolean;
  syncedAt: string;
  counts: { partners: number; salesOrders: number; purchaseOrders: number; payments: number; receipts: number; documents: number };
  errors: string[];
};

function emptyResult(): RaqtoSyncResult {
  return {
    success: true,
    syncedAt: new Date().toISOString(),
    counts: { partners: 0, salesOrders: 0, purchaseOrders: 0, payments: 0, receipts: 0, documents: 0 },
    errors: [],
  };
}

async function getRaqtoCompanyId(clientId: string): Promise<string> {
  // Raqto側はサービスロールで読むため、先に呼び出し者のアクセス権を検証する
  await assertClientAccess(clientId);
  const integration = await getRaqtoIntegration(clientId);
  if (!integration?.raqto_company_id) {
    throw new Error("Raqto受発注との連携が設定されていません。先にアカウント連携を行ってください。");
  }
  return integration.raqto_company_id;
}

export async function syncRaqtoPartners(clientId: string): Promise<RaqtoSyncResult> {
  const result = emptyResult();

  try {
    const raqtoCompanyId = await getRaqtoCompanyId(clientId);
    const raqto = createRaqtoSupabaseClient();
    const supabase = await createServerSupabaseClient();

    // Fetch partners from Raqto
    const { data: raqtoPartners, error: fetchError } = await raqto
      .from("partners")
      .select("*")
      .eq("company_id", raqtoCompanyId);

    if (fetchError) {
      result.errors.push(`Raqto取引先取得エラー: ${fetchError.message}`);
      result.success = false;
      return result;
    }

    if (!raqtoPartners || raqtoPartners.length === 0) return result;

    let upsertedCount = 0;

    for (const rp of raqtoPartners as RaqtoPartner[]) {
      // Check if already synced by raqto_partner_id
      const { data: existing } = await supabase
        .from("business_partners")
        .select("id")
        .eq("client_id", clientId)
        .eq("raqto_partner_id", rp.id)
        .maybeSingle();

      if (existing) {
        // Update existing partner
        const { error: updateError } = await supabase
          .from("business_partners")
          .update({
            name: rp.name,
            postal_code: rp.postal_code,
            address: rp.address,
            telephone: rp.telephone,
            email: rp.email,
            invoice_registration_number: rp.invoice_registration_number,
            is_invoice_registered: !!rp.invoice_registration_number,
          })
          .eq("id", existing.id);

        if (updateError) {
          result.errors.push(`取引先「${rp.name}」更新エラー: ${updateError.message}`);
        } else {
          upsertedCount++;
        }
      } else {
        // Insert new partner
        const { error: insertError } = await supabase
          .from("business_partners")
          .insert({
            client_id: clientId,
            name: rp.name,
            type: "customer",
            postal_code: rp.postal_code,
            address: rp.address,
            telephone: rp.telephone,
            email: rp.email,
            invoice_registration_number: rp.invoice_registration_number,
            is_invoice_registered: !!rp.invoice_registration_number,
            raqto_partner_id: rp.id,
          });

        if (insertError) {
          result.errors.push(`取引先「${rp.name}」追加エラー: ${insertError.message}`);
        } else {
          upsertedCount++;
        }
      }
    }

    result.counts.partners = upsertedCount;
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : "取引先同期に失敗しました");
  }

  return result;
}

export async function importRaqtoSalesOrders(clientId: string): Promise<RaqtoSyncResult> {
  const result = emptyResult();

  try {
    const raqtoCompanyId = await getRaqtoCompanyId(clientId);
    const raqto = createRaqtoSupabaseClient();
    const supabase = await createServerSupabaseClient();

    // Build raqto_partner_id → local business_partner_id mapping
    const { data: localPartners } = await supabase
      .from("business_partners")
      .select("id, name, raqto_partner_id")
      .eq("client_id", clientId)
      .not("raqto_partner_id", "is", null);

    const partnerMap = new Map<string, string>();
    const partnerNameMap = new Map<string, string>();
    for (const lp of localPartners ?? []) {
      if (lp.raqto_partner_id) {
        partnerMap.set(lp.raqto_partner_id, lp.id);
        partnerNameMap.set(lp.raqto_partner_id, lp.name);
      }
    }

    // Lookup accounts for sales journal entries (売上高 + 売掛金)
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name")
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .in("name", ["売上高", "売掛金"]);

    const salesAccountId = accounts?.find((a) => a.name === "売上高")?.id;
    const receivableAccountId = accounts?.find((a) => a.name === "売掛金")?.id;

    // 既存のRaqto由来請求書を一括取得（ループ内の逐次クエリを避け、重複取込を防ぐ）
    const { data: existingRaqtoInvoices } = await supabase
      .from("invoices")
      .select("raqto_source_id, raqto_source_type")
      .eq("client_id", clientId)
      .not("raqto_source_id", "is", null);

    const importedDocIds = new Set<string>();
    const orderSourcedInvoiceIds = new Set<string>();
    for (const inv of existingRaqtoInvoices ?? []) {
      if (!inv.raqto_source_id) continue;
      if (inv.raqto_source_type === "document") importedDocIds.add(inv.raqto_source_id);
      if (inv.raqto_source_type === "order") orderSourcedInvoiceIds.add(inv.raqto_source_id);
    }

    let invoiceCount = 0;
    let receiptCount = 0;

    // --- 1. Fetch active sales orders (exclude canceled) ---
    const { data: raqtoOrders, error: orderError } = await raqto
      .from("orders")
      .select("*")
      .eq("company_id", raqtoCompanyId)
      .eq("order_type", "sales_order")
      .neq("status", "canceled")
      .is("deleted_at", null);

    if (orderError) {
      result.errors.push(`Raqto受注取得エラー: ${orderError.message}`);
      result.success = false;
      return result;
    }

    // Build order_id → order status map
    const orderStatusMap = new Map<string, string>();
    for (const o of (raqtoOrders ?? []) as RaqtoOrder[]) {
      orderStatusMap.set(o.id, o.status);
    }

    const importedOrderIds = new Set<string>();

    // --- 2. Fetch invoice/receipt documents (受注紐付き + 単独発行の両方) ---
    {
      const { data: raqtoDocs, error: docError } = await raqto
        .from("documents")
        .select("*")
        .eq("company_id", raqtoCompanyId)
        .in("document_type", ["invoice", "receipt"])
        .neq("status", "void");

      if (docError) {
        result.errors.push(`Raqto書類取得エラー: ${docError.message}`);
      }

      for (const doc of (raqtoDocs ?? []) as RaqtoDocument[]) {
        // 発注（purchase_order）等、売上系以外の注文に紐づく請求書/領収書は
        // 売上として誤計上しないためスキップ（単独発行 = order_id なしは対象）
        if (doc.order_id && !orderStatusMap.has(doc.order_id)) continue;

        const orderStatus = doc.order_id ? orderStatusMap.get(doc.order_id) ?? null : null;

        if (doc.document_type === "receipt") {
          // --- Receipt → receipts table ---
          // Use image_path for dedup since raqto_source_id column may not exist yet
          const raqtoImagePath = `raqto://documents/${doc.id}`;
          const { data: existingReceipt } = await supabase
            .from("receipts")
            .select("id")
            .eq("client_id", clientId)
            .eq("image_path", raqtoImagePath)
            .maybeSingle();

          const vendorName = partnerNameMap.get(doc.partner_id) ?? doc.document_number;

          // Fetch document_items for this receipt
          const { data: receiptDocItems } = await raqto
            .from("document_items")
            .select("*")
            .eq("document_id", doc.id)
            .order("sort_order");

          const receiptItems = (receiptDocItems as RaqtoDocumentItem[] | null)?.map((item) => ({
            item_name: item.item_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            subtotal: item.subtotal,
            tax_amount: item.tax_amount,
          })) ?? [];

          if (existingReceipt) {
            // Update existing receipt with latest ocr_result (補完: vendor_name, items)
            await supabase.from("receipts").update({
              ocr_result: {
                source: "raqto",
                raqto_document_id: doc.id,
                document_number: doc.document_number,
                vendor_name: vendorName,
                amount_total: doc.total_amount,
                date: doc.issued_date,
                partner_id: doc.partner_id,
                subtotal: doc.subtotal,
                tax_amount: doc.tax_amount,
                total_amount: doc.total_amount,
                items: receiptItems,
              },
              raqto_source_id: doc.id,
            }).eq("id", existingReceipt.id);

            if (doc.order_id) importedOrderIds.add(doc.order_id);
            receiptCount++;
            continue;
          }

          const { error: receiptError } = await supabase
            .from("receipts")
            .insert({
              client_id: clientId,
              uploaded_by: clientId,
              image_path: raqtoImagePath,
              status: "ocr_done",
              ocr_result: {
                source: "raqto",
                raqto_document_id: doc.id,
                document_number: doc.document_number,
                vendor_name: vendorName,
                amount_total: doc.total_amount,
                date: doc.issued_date,
                partner_id: doc.partner_id,
                subtotal: doc.subtotal,
                tax_amount: doc.tax_amount,
                total_amount: doc.total_amount,
                items: receiptItems,
              },
              raqto_source_id: doc.id,
            });

          if (receiptError) {
            result.errors.push(`領収書「${doc.document_number}」: ${receiptError.message}`);
          } else {
            receiptCount++;
          }

          if (doc.order_id) importedOrderIds.add(doc.order_id);
          continue;
        }

        // --- Invoice → invoices table ---
        if (importedDocIds.has(doc.id)) {
          if (doc.order_id) importedOrderIds.add(doc.order_id);
          continue;
        }

        // 過去の同期で受注（order）として先に取り込まれている場合も重複させない
        // （同じ受注に対して order 由来と document 由来の請求書・仕訳が二重になるのを防ぐ）
        if (doc.order_id && orderSourcedInvoiceIds.has(doc.order_id)) {
          importedOrderIds.add(doc.order_id);
          continue;
        }

        const localPartnerId = partnerMap.get(doc.partner_id);
        if (!localPartnerId) {
          result.errors.push(`書類「${doc.document_number}」: 取引先が未同期です`);
          continue;
        }

        // Fetch document items
        const { data: docItems } = await raqto
          .from("document_items")
          .select("*")
          .eq("document_id", doc.id)
          .order("sort_order");

        // Create sales journal entry if accounts exist
        let journalEntryId: string | null = null;
        if (salesAccountId && receivableAccountId) {
          const partnerName = partnerNameMap.get(doc.partner_id) ?? "";
          const desc = `${partnerName} ${doc.document_number}`.trim();
          const { data: entry, error: entryError } = await supabase
            .from("journal_entries")
            .insert({
              client_id: clientId,
              entry_date: doc.issued_date,
              description: desc,
              status: "draft",
              source: "raqto",
              raqto_source_id: doc.id,
              created_by: clientId,
            })
            .select()
            .single();

          if (!entryError && entry) {
            journalEntryId = entry.id;
            await supabase.from("journal_entry_lines").insert([
              { journal_entry_id: entry.id, account_id: receivableAccountId, debit_amount: doc.total_amount, credit_amount: 0, sort_order: 0 },
              { journal_entry_id: entry.id, account_id: salesAccountId, debit_amount: 0, credit_amount: doc.total_amount, tax_category: "taxable_sales", tax_rate: 10, sort_order: 1 },
            ]);
          }
        }

        const { data: inv, error: invError } = await supabase
          .from("invoices")
          .insert({
            client_id: clientId,
            business_partner_id: localPartnerId,
            invoice_number: doc.document_number,
            issued_date: doc.issued_date,
            due_date: doc.due_date,
            subtotal: doc.subtotal,
            tax_amount: doc.tax_amount,
            total_amount: doc.total_amount,
            status: "draft",
            raqto_source_id: doc.id,
            raqto_source_type: "document",
            raqto_order_status: orderStatus,
            journal_entry_id: journalEntryId,
          })
          .select()
          .single();

        if (invError) {
          result.errors.push(`書類「${doc.document_number}」: ${invError.message}`);
          continue;
        }

        if (docItems && docItems.length > 0) {
          const { error: itemsError } = await supabase
            .from("invoice_items")
            .insert(
              (docItems as RaqtoDocumentItem[]).map((item, i) => ({
                invoice_id: inv.id,
                sort_order: item.sort_order ?? i,
                item_name: item.item_name,
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: item.tax_rate,
                subtotal: item.subtotal,
                tax_amount: item.tax_amount,
              }))
            );
          if (itemsError) {
            result.errors.push(`書類明細「${doc.document_number}」: ${itemsError.message}`);
          }
        }

        if (doc.order_id) importedOrderIds.add(doc.order_id);
        invoiceCount++;
      }
    }

    // --- 3. Import sales orders that don't have a document yet (as draft) ---
    for (const order of (raqtoOrders ?? []) as RaqtoOrder[]) {
      if (importedOrderIds.has(order.id)) continue;
      if (orderSourcedInvoiceIds.has(order.id)) continue;

      const localPartnerId = partnerMap.get(order.partner_id);
      if (!localPartnerId) {
        result.errors.push(`受注「${order.order_number}」: 取引先が未同期です`);
        continue;
      }

      const { data: orderItems } = await raqto
        .from("order_items")
        .select("*")
        .eq("order_id", order.id)
        .order("sort_order");

      // Create sales journal entry if accounts exist
      let journalEntryId: string | null = null;
      if (salesAccountId && receivableAccountId) {
        const partnerName = partnerNameMap.get(order.partner_id) ?? "";
        const desc = `${partnerName} ${order.order_number}`.trim();
        const { data: entry, error: entryError } = await supabase
          .from("journal_entries")
          .insert({
            client_id: clientId,
            entry_date: order.order_date.split("T")[0],
            description: desc,
            status: "draft",
            source: "raqto",
            raqto_source_id: order.id,
            created_by: clientId,
          })
          .select()
          .single();

        if (!entryError && entry) {
          journalEntryId = entry.id;
          await supabase.from("journal_entry_lines").insert([
            { journal_entry_id: entry.id, account_id: receivableAccountId, debit_amount: order.total_amount, credit_amount: 0, sort_order: 0 },
            { journal_entry_id: entry.id, account_id: salesAccountId, debit_amount: 0, credit_amount: order.total_amount, tax_category: "taxable_sales", tax_rate: 10, sort_order: 1 },
          ]);
        }
      }

      const { data: inv, error: invError } = await supabase
        .from("invoices")
        .insert({
          client_id: clientId,
          business_partner_id: localPartnerId,
          invoice_number: order.order_number,
          issued_date: order.order_date.split("T")[0],
          due_date: order.payment_due_date,
          subtotal: order.subtotal,
          tax_amount: order.tax_amount,
          total_amount: order.total_amount,
          status: "draft",
          raqto_source_id: order.id,
          raqto_source_type: "order",
          raqto_order_status: order.status,
          journal_entry_id: journalEntryId,
        })
        .select()
        .single();

      if (invError) {
        result.errors.push(`受注「${order.order_number}」: ${invError.message}`);
        continue;
      }

      if (orderItems && orderItems.length > 0) {
        const { error: itemsError } = await supabase
          .from("invoice_items")
          .insert(
            (orderItems as RaqtoOrderItem[]).map((item, i) => ({
              invoice_id: inv.id,
              sort_order: i,
              item_name: item.item_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              tax_rate: item.tax_rate,
              subtotal: item.subtotal,
              tax_amount: item.tax_amount,
            }))
          );
        if (itemsError) {
          result.errors.push(`受注明細「${order.order_number}」: ${itemsError.message}`);
        }
      }

      invoiceCount++;
    }

    result.counts.salesOrders = invoiceCount;
    result.counts.receipts = receiptCount;
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : "受注データ取込に失敗しました");
  }

  return result;
}

export async function importRaqtoPurchaseOrders(clientId: string): Promise<RaqtoSyncResult> {
  const result = emptyResult();

  try {
    const raqtoCompanyId = await getRaqtoCompanyId(clientId);
    const raqto = createRaqtoSupabaseClient();
    const supabase = await createServerSupabaseClient();

    // Get accounts for journal entries (仕入高 and 買掛金)
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name")
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .in("name", ["仕入高", "買掛金"]);

    const purchaseAccountId = accounts?.find((a) => a.name === "仕入高")?.id;
    const payableAccountId = accounts?.find((a) => a.name === "買掛金")?.id;

    if (!purchaseAccountId || !payableAccountId) {
      result.errors.push("勘定科目（仕入高/買掛金）が見つかりません。");
      return result;
    }

    // Build partner name map for descriptions
    const { data: localPartners } = await supabase
      .from("business_partners")
      .select("name, raqto_partner_id")
      .eq("client_id", clientId)
      .not("raqto_partner_id", "is", null);

    const partnerNameMap = new Map<string, string>();
    for (const lp of localPartners ?? []) {
      if (lp.raqto_partner_id) partnerNameMap.set(lp.raqto_partner_id, lp.name);
    }

    // Fetch purchase orders from Raqto (exclude canceled)
    const { data: raqtoOrders, error: fetchError } = await raqto
      .from("orders")
      .select("*")
      .eq("company_id", raqtoCompanyId)
      .eq("order_type", "purchase_order")
      .neq("status", "canceled")
      .is("deleted_at", null);

    if (fetchError) {
      result.errors.push(`Raqto発注取得エラー: ${fetchError.message}`);
      result.success = false;
      return result;
    }

    // 既存のRaqto由来仕訳を一括取得（ループ内の逐次クエリを避ける）
    const { data: existingEntries } = await supabase
      .from("journal_entries")
      .select("raqto_source_id")
      .eq("client_id", clientId)
      .not("raqto_source_id", "is", null);
    const importedPoIds = new Set(
      (existingEntries ?? []).map((e) => e.raqto_source_id).filter(Boolean)
    );

    let createdCount = 0;

    for (const po of (raqtoOrders ?? []) as RaqtoOrder[]) {
      // Skip if already imported
      if (importedPoIds.has(po.id)) continue;

      const partnerName = partnerNameMap.get(po.partner_id) ?? "";
      const description = `${partnerName} ${po.order_number}`.trim();

      // Fetch order_items for this PO
      const { data: poItems } = await raqto
        .from("order_items")
        .select("*")
        .eq("order_id", po.id)
        .order("sort_order");

      const metadataItems = (poItems as RaqtoOrderItem[] | null)?.map((item) => ({
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        subtotal: item.subtotal,
        tax_amount: item.tax_amount,
      })) ?? [];

      const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .insert({
          client_id: clientId,
          entry_date: po.order_date.split("T")[0],
          description,
          status: "draft",
          source: "raqto",
          raqto_source_id: po.id,
          created_by: clientId,
          metadata: {
            order_number: po.order_number,
            partner_name: partnerName,
            items: metadataItems,
          },
        })
        .select()
        .single();

      if (entryError) {
        result.errors.push(`発注仕訳「${description}」: ${entryError.message}`);
        continue;
      }

      const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert([
          { journal_entry_id: entry.id, account_id: purchaseAccountId, debit_amount: po.total_amount, credit_amount: 0, tax_category: "taxable_purchase", tax_rate: 10, sort_order: 0 },
          { journal_entry_id: entry.id, account_id: payableAccountId, debit_amount: 0, credit_amount: po.total_amount, sort_order: 1 },
        ]);

      if (linesError) {
        result.errors.push(`発注仕訳明細: ${linesError.message}`);
      } else {
        createdCount++;
      }
    }

    result.counts.purchaseOrders = createdCount;
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : "発注データ取込に失敗しました");
  }

  return result;
}

// Raqto帳票種別 → 会計側 receipts.document_type の対応（請求書・領収書は専用フローで取込）
const RAQTO_DOC_TYPE_MAP: Record<string, "purchase_order" | "contract" | "delivery_note"> = {
  purchase_order: "purchase_order",
  contract: "contract",
  delivery_note: "delivery_note",
};

/**
 * Raqto受発注で発行されたその他の帳票（発注書・契約書・納品書）を証憑として取り込む。
 * 会計仕訳は生成せず、帳票管理の「受発注書類」タブで閲覧できるようにする。
 */
export async function importRaqtoOtherDocuments(clientId: string): Promise<RaqtoSyncResult> {
  const result = emptyResult();

  try {
    const raqtoCompanyId = await getRaqtoCompanyId(clientId);
    const raqto = createRaqtoSupabaseClient();
    const supabase = await createServerSupabaseClient();

    // Build partner name map for vendor display
    const { data: localPartners } = await supabase
      .from("business_partners")
      .select("name, raqto_partner_id")
      .eq("client_id", clientId)
      .not("raqto_partner_id", "is", null);

    const partnerNameMap = new Map<string, string>();
    for (const lp of localPartners ?? []) {
      if (lp.raqto_partner_id) partnerNameMap.set(lp.raqto_partner_id, lp.name);
    }

    const { data: raqtoDocs, error: docError } = await raqto
      .from("documents")
      .select("*")
      .eq("company_id", raqtoCompanyId)
      .in("document_type", Object.keys(RAQTO_DOC_TYPE_MAP))
      .neq("status", "void");

    if (docError) {
      result.errors.push(`Raqto帳票取得エラー: ${docError.message}`);
      result.success = false;
      return result;
    }
    if (!raqtoDocs || raqtoDocs.length === 0) return result;

    // 既存取込分を一括取得して重複を避ける（image_path が重複判定キー）
    const paths = raqtoDocs.map((d: RaqtoDocument) => `raqto://documents/${d.id}`);
    const { data: existingRows } = await supabase
      .from("receipts")
      .select("id, image_path")
      .eq("client_id", clientId)
      .in("image_path", paths);
    const existingByPath = new Map<string, string>();
    for (const r of existingRows ?? []) {
      if (r.image_path) existingByPath.set(r.image_path, r.id);
    }

    let importedCount = 0;

    for (const doc of raqtoDocs as RaqtoDocument[]) {
      const imagePath = `raqto://documents/${doc.id}`;
      const documentType = RAQTO_DOC_TYPE_MAP[doc.document_type];
      if (!documentType) continue;

      const vendorName = partnerNameMap.get(doc.partner_id) ?? doc.document_number;

      const { data: docItems } = await raqto
        .from("document_items")
        .select("*")
        .eq("document_id", doc.id)
        .order("sort_order");

      const items = (docItems as RaqtoDocumentItem[] | null)?.map((item) => ({
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        subtotal: item.subtotal,
        tax_amount: item.tax_amount,
      })) ?? [];

      const ocrResult = {
        source: "raqto",
        raqto_document_id: doc.id,
        document_number: doc.document_number,
        vendor_name: vendorName,
        amount_total: doc.total_amount,
        date: doc.issued_date,
        partner_id: doc.partner_id,
        subtotal: doc.subtotal,
        tax_amount: doc.tax_amount,
        total_amount: doc.total_amount,
        items,
      };

      const existingId = existingByPath.get(imagePath);
      if (existingId) {
        // 最新の内容で更新（Raqto側での帳票修正を反映）
        const { error: updateError } = await supabase
          .from("receipts")
          .update({ ocr_result: ocrResult, document_type: documentType, raqto_source_id: doc.id })
          .eq("id", existingId);
        if (updateError) {
          result.errors.push(`帳票「${doc.document_number}」更新エラー: ${updateError.message}`);
        } else {
          importedCount++;
        }
        continue;
      }

      const { error: insertError } = await supabase.from("receipts").insert({
        client_id: clientId,
        uploaded_by: clientId,
        image_path: imagePath,
        status: "ocr_done",
        // Raqtoで自社が発行した帳票（発注書・契約書・納品書）
        direction: "issued",
        document_type: documentType,
        mime_type: "application/pdf",
        original_filename: doc.document_number ? `${doc.document_number}.pdf` : null,
        ocr_result: ocrResult,
        raqto_source_id: doc.id,
      });

      if (insertError) {
        result.errors.push(`帳票「${doc.document_number}」: ${insertError.message}`);
      } else {
        importedCount++;
      }
    }

    result.counts.documents = importedCount;
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : "帳票の取込に失敗しました");
  }

  return result;
}

export async function exportRaqtoPaymentStatus(clientId: string): Promise<RaqtoSyncResult> {
  const result = emptyResult();

  try {
    const supabase = await createServerSupabaseClient();

    const { data: payments } = await supabase
      .from("payments")
      .select("id, amount")
      .eq("client_id", clientId);

    result.counts.payments = payments?.length ?? 0;
    // Stub: payment status export will be implemented later
  } catch (e) {
    result.success = false;
    result.errors.push(e instanceof Error ? e.message : "入金ステータス連携に失敗しました");
  }

  return result;
}

export async function runFullRaqtoSync(clientId: string): Promise<RaqtoSyncResult> {
  const finalResult = emptyResult();
  const errors: string[] = [];

  const steps = [
    syncRaqtoPartners,
    importRaqtoSalesOrders,
    importRaqtoPurchaseOrders,
    importRaqtoOtherDocuments,
    exportRaqtoPaymentStatus,
  ];

  for (const step of steps) {
    const stepResult = await step(clientId);
    finalResult.counts.partners += stepResult.counts.partners;
    finalResult.counts.salesOrders += stepResult.counts.salesOrders;
    finalResult.counts.purchaseOrders += stepResult.counts.purchaseOrders;
    finalResult.counts.payments += stepResult.counts.payments;
    finalResult.counts.receipts += stepResult.counts.receipts;
    finalResult.counts.documents += stepResult.counts.documents;
    if (!stepResult.success) finalResult.success = false;
    errors.push(...stepResult.errors);
  }

  finalResult.errors = errors;
  finalResult.syncedAt = new Date().toISOString();

  // Update last_synced_at
  try {
    const supabase = await createServerSupabaseClient();
    await supabase
      .from("raqto_integrations")
      .update({ last_synced_at: finalResult.syncedAt })
      .eq("client_id", clientId)
      .eq("is_active", true);
  } catch {
    // Non-critical
  }

  return finalResult;
}
