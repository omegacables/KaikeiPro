"use client";

/**
 * 相手先ごとの明細を入力する内訳書（②③④⑥⑧⑨⑩⑮）の画面。
 *
 * 上に入力表（画面のみ）、下に印刷用紙を出す。印刷用紙は入力中の内容から
 * その場で作り直すので、記載基準による「その他」へのまとめや試算表との照合を
 * 入力しながら確かめられる。様式ごとの欄は src/lib/breakdown-items.ts の定義から作る。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, Loader2, FileDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { PartnerInput } from "@/components/ui/partner-input";
import { Notice, CheckNotice } from "@/components/breakdown/notices";
import {
  FormSheet,
  FormHeader,
  BlankRows,
  cellCls,
  headCls,
  numCls,
  FORM_TABLE_MIN_W,
} from "@/components/print/form-sheet";
import {
  findItemFormSpec,
  buildSheetSection,
  reconcileItems,
  fieldValue,
  withFieldValue,
  emptyItem,
  type BreakdownItem,
  type ItemField,
  type ItemSectionSpec,
  type DetailValue,
} from "@/lib/breakdown-items";
import { formatYen, toWareki } from "@/lib/wareki";
import {
  saveBreakdownItems,
  draftReceivablesFromInvoices,
  draftDepositsFromBankAccounts,
  type BreakdownFormData,
  type ItemFormData,
  type PartnerOption,
} from "@/actions/breakdown";

type Data = ItemFormData & Pick<BreakdownFormData, "def" | "period">;

const inputCls =
  "w-full px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-sm";

/** 入力欄の幅（列ごとの最小幅） */
function fieldWidth(f: ItemField): string {
  switch (f.type) {
    case "partner":
      return "min-w-[200px]";
    case "account":
      return "min-w-[150px]";
    case "date":
      return "min-w-[140px]";
    case "amount":
      return "min-w-[130px]";
    case "number":
      return "min-w-[90px]";
    case "checkbox":
      return "min-w-[70px]";
    case "select":
      return "min-w-[100px]";
    default:
      return f.key === "address" || f.key === "note" ? "min-w-[220px]" : "min-w-[150px]";
  }
}

export function ItemForm({
  clientId,
  periodKey,
  data,
  onDirtyChange,
}: {
  clientId: string;
  periodKey: string;
  data: Data;
  /** 保存していない入力があるか（画面の移動前に確認するため） */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const spec = findItemFormSpec(data.def.key)!;
  const [items, setItems] = useState<BreakdownItem[]>(data.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "info"; text: string } | null>(null);
  const [drafting, setDrafting] = useState(false);

  // 保存していない入力があるときは、ページを離れる前に確認する
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);

  const accountName = useCallback(
    (id: string | null) => data.balances.find((a) => a.id === id)?.name ?? "",
    [data.balances]
  );
  const partnerSuggestions = useMemo(
    () => data.partners.map((p) => ({ ...p, sub: [p.address, p.registrationNumber].filter(Boolean).join("　") })),
    [data.partners]
  );

  // 連続した操作でも取りこぼさないよう、常に直前の状態から作り直す
  const update = (fn: (prev: BreakdownItem[]) => BreakdownItem[]) => {
    setItems(fn);
    setDirty(true);
    setMessage(null);
  };
  const setField = (id: string, key: ItemField["key"], value: DetailValue) =>
    update((prev) => prev.map((i) => (i.id === id ? withFieldValue(i, key, value) : i)));
  const selectPartner = (id: string, p: PartnerOption) =>
    update((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              partnerId: p.id,
              name: p.name,
              // 入力済みの欄は上書きしない
              address: i.address || p.address,
              registrationNumber: i.registrationNumber || p.registrationNumber,
            }
          : i
      )
    );
  const addRow = (section: string) =>
    update((prev) => {
      const item = emptyItem(section, prev.length, crypto.randomUUID());
      // 科目が1つしか無い様式は、最初から選んでおく
      if (data.balances.length === 1) item.accountId = data.balances[0].id;
      return [...prev, item];
    });
  const removeRow = (id: string) => update((prev) => prev.filter((i) => i.id !== id));
  const moveRow = (id: string, dir: -1 | 1) =>
    update((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      const section = prev[idx].section;
      let j = idx + dir;
      while (j >= 0 && j < prev.length && prev[j].section !== section) j += dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveBreakdownItems(clientId, periodKey, spec.key, items);
      setItems(saved);
      setDirty(false);
      setMessage({ tone: "success", text: `保存しました（${saved.length}件）。` });
    } catch (e) {
      setMessage({ tone: "warning", text: e instanceof Error ? e.message : "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  const draftFromInvoices = async () => {
    setDrafting(true);
    try {
      const drafts = await draftReceivablesFromInvoices(clientId, periodKey);
      const known = new Set(items.flatMap((i) => [i.partnerId, i.name.trim()]).filter(Boolean));
      const fresh = drafts.filter((d) => !known.has(d.partnerId) && !known.has(d.name.trim()));
      if (fresh.length === 0) {
        setMessage({
          tone: "info",
          text:
            drafts.length === 0
              ? "期末日時点で未回収の請求書はありませんでした。"
              : "請求書の取引先は、すべて入力済みです（入力済みの行は変えていません）。",
        });
        return;
      }
      update((prev) => [...prev, ...fresh.map((d, n) => ({ ...d, sortOrder: prev.length + n }))]);
      setMessage({
        tone: "info",
        text: `請求書から${fresh.length}件の取引先を追加しました。金額を確かめてから保存してください（入力済みの取引先はそのままです）。`,
      });
    } catch (e) {
      setMessage({ tone: "warning", text: e instanceof Error ? e.message : "下書きの作成に失敗しました" });
    } finally {
      setDrafting(false);
    }
  };

  const draftFromBanks = async () => {
    setDrafting(true);
    try {
      const drafts = await draftDepositsFromBankAccounts(clientId, periodKey);
      const key = (i: { details: Record<string, unknown> }) => `${i.details.bank ?? ""}|${i.details.branch ?? ""}|${i.details.account_no ?? ""}`;
      const known = new Set(items.map(key));
      const fresh = drafts.filter((d) => !known.has(key(d)));
      if (fresh.length === 0) {
        setMessage({
          tone: "info",
          text: drafts.length === 0 ? "登録されている銀行口座がありません。" : "銀行口座は、すべて入力済みです（入力済みの行は変えていません）。",
        });
        return;
      }
      update((prev) => [...prev, ...fresh.map((d, n) => ({ ...d, sortOrder: prev.length + n }))]);
      setMessage({
        tone: "info",
        text: `銀行口座から${fresh.length}件を追加しました。期末現在高が0の行は、1つの科目を複数の口座で使っているため口座ごとの残高が分かりません。残高証明などで入力してから保存してください。`,
      });
    } catch (e) {
      setMessage({ tone: "warning", text: e instanceof Error ? e.message : "下書きの作成に失敗しました" });
    } finally {
      setDrafting(false);
    }
  };

  const checks = reconcileItems(spec, items, data.balances);
  const sheets = spec.sections.map((s) => buildSheetSection(s, items, accountName));
  // 金額を入れたのに名称が無い行（名称の欄がある表だけ。未払配当金・棚卸資産などには名称欄が無い）
  const namedSections = new Set(spec.sections.filter((s) => s.fields.some((f) => f.key === "name")).map((s) => s.key));
  const unnamed = items.filter(
    (i) => i.amount !== 0 && namedSections.has(i.section) && !i.name.trim() && !i.registrationNumber.trim()
  ).length;

  return (
    <>
      {/* 照合結果・注意書き */}
      {checks.map((c) => (
        <CheckNotice
          key={c.label}
          label={c.label}
          check={c.check}
          hint={
            c.label === "科目未選択"
              ? "明細の「科目」を選んでください。"
              : "明細の入力漏れや金額の違いがないか確認してください。"
          }
        />
      ))}
      {spec.reconcileNote && <Notice tone="info">{spec.reconcileNote}</Notice>}
      {unnamed > 0 && (
        <Notice tone="warning">名称（または登録番号）が空の明細が{unnamed}件あります。</Notice>
      )}

      {/* 入力表（画面のみ） */}
      <div className="no-print rounded-lg border border-border bg-card p-3 sm:p-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-bold">明細の入力</h2>
          <div className="flex flex-wrap items-center gap-2">
            {spec.key === "1" && (
              <Button variant="outline" onClick={draftFromBanks} disabled={drafting}>
                {drafting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                銀行口座から取り込む
              </Button>
            )}
            {spec.key === "3" && (
              <Button variant="outline" onClick={draftFromInvoices} disabled={drafting}>
                {drafting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                請求書から取り込む
              </Button>
            )}
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {dirty ? "保存する" : "保存済み"}
            </Button>
          </div>
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {spec.sections.map((section) => (
          <SectionEditor
            key={section.key}
            section={section}
            items={items.filter((i) => i.section === section.key)}
            data={data}
            partners={partnerSuggestions}
            onField={setField}
            onPartner={selectPartner}
            onAdd={() => addRow(section.key)}
            onRemove={removeRow}
            onMove={moveRow}
          />
        ))}
      </div>

      {/* 印刷用紙 */}
      <div id="form-root">
        <FormSheet>
          <FormHeader
            title={data.def.title}
            clientName={data.period.clientName}
            startDate={data.period.startDate}
            endDate={data.period.endDate}
          />
          {sheets.map((sheet) => (
            <SectionSheet key={sheet.spec.key} sheet={sheet} accountName={accountName} />
          ))}
        </FormSheet>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 入力表
// ---------------------------------------------------------------------------

function SectionEditor({
  section,
  items,
  data,
  partners,
  onField,
  onPartner,
  onAdd,
  onRemove,
  onMove,
}: {
  section: ItemSectionSpec;
  items: BreakdownItem[];
  data: Data;
  partners: (PartnerOption & { sub: string })[];
  onField: (id: string, key: ItemField["key"], value: DetailValue) => void;
  onPartner: (id: string, p: PartnerOption) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className="space-y-2">
      {section.title && <h3 className="text-[15px] font-bold">{section.title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[13px] text-muted-foreground">
              {section.fields.map((f) => (
                <th key={f.key} className={`px-1.5 py-1 font-bold ${fieldWidth(f)}`}>
                  {f.group && f.group !== f.label ? `${f.group}：` : ""}
                  {f.label}
                </th>
              ))}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className="align-top">
                {section.fields.map((f) => (
                  <td key={f.key} className="px-1.5 py-1">
                    <FieldInput
                      field={f}
                      item={item}
                      data={data}
                      partners={partners}
                      onChange={(v) => onField(item.id, f.key, v)}
                      onPartner={(p) => onPartner(item.id, p)}
                    />
                  </td>
                ))}
                <td className="px-1 py-1 whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() => onMove(item.id, -1)}
                    disabled={idx === 0}
                    className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="上へ"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(item.id, 1)}
                    disabled={idx === items.length - 1}
                    className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="下へ"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    className="p-1.5 text-destructive hover:text-destructive/80"
                    title="この行を削除"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="size-4" />
          行を追加
        </Button>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {items.length}件　合計 {formatYen(total)}円
          </span>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  item,
  data,
  partners,
  onChange,
  onPartner,
}: {
  field: ItemField;
  item: BreakdownItem;
  data: Data;
  partners: (PartnerOption & { sub: string })[];
  onChange: (v: DetailValue) => void;
  onPartner: (p: PartnerOption) => void;
}) {
  const v = fieldValue(item, field.key);
  const label = field.group ? `${field.group} ${field.label}` : field.label;
  switch (field.type) {
    case "partner":
      return (
        <PartnerInput
          value={String(v ?? "")}
          partners={partners}
          placeholder="取引先名（候補から選べます）"
          onChange={(text) => onChange(text)}
          onSelect={onPartner}
        />
      );
    case "account":
      return (
        <select
          aria-label={label}
          value={String(v ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
          className={inputCls}
        >
          <option value="">（科目を選ぶ）</option>
          {data.balances.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      );
    case "amount":
      return (
        <AmountInput
          value={v == null || v === "" ? "" : String(v)}
          onChange={(s) => onChange(s === "" ? (field.key === "amount" ? 0 : null) : Number(s))}
          className={`${inputCls} text-right tabular-nums`}
        />
      );
    case "number":
      return (
        <input
          aria-label={label}
          inputMode="decimal"
          value={v == null ? "" : String(v)}
          onChange={(e) => {
            const t = e.target.value.normalize("NFKC").replace(/,/g, "");
            onChange(t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : t);
          }}
          className={`${inputCls} text-right tabular-nums`}
        />
      );
    case "date":
      return (
        <DateInput
          allowEmpty
          value={String(v ?? "")}
          onChange={(s) => onChange(s || null)}
          className={inputCls}
        />
      );
    case "select":
      return (
        <select
          aria-label={label}
          value={String(v ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
          className={inputCls}
        >
          <option value="" />
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <label className="flex items-center justify-center h-9">
          <input
            type="checkbox"
            aria-label={label}
            checked={v === true}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4"
          />
        </label>
      );
    default:
      return (
        <input
          aria-label={label}
          value={String(v ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// 印刷用紙
// ---------------------------------------------------------------------------

/** 見出しを2段に組む（「相手先」の下に名称・所在地 など） */
function headerRows(fields: ItemField[]) {
  const top: { label: string; colSpan: number; rowSpan: number }[] = [];
  const bottom: string[] = [];
  const grouped = fields.some((f) => f.group);
  for (let i = 0; i < fields.length; ) {
    const g = fields[i].group;
    if (!g) {
      top.push({ label: fields[i].label, colSpan: 1, rowSpan: grouped ? 2 : 1 });
      i++;
      continue;
    }
    let j = i;
    while (j < fields.length && fields[j].group === g) {
      bottom.push(fields[j].label);
      j++;
    }
    top.push({ label: g, colSpan: j - i, rowSpan: 1 });
    i = j;
  }
  return { top, bottom };
}

function printValue(f: ItemField, item: BreakdownItem, accountName: (id: string | null) => string): string {
  const v = fieldValue(item, f.key);
  if (f.type === "account") return accountName(item.accountId);
  if (v == null || v === "") return "";
  switch (f.type) {
    case "amount":
      return formatYen(Number(v));
    case "number":
      return typeof v === "number" ? v.toLocaleString("ja-JP") : String(v);
    case "date":
      return toWareki(String(v));
    default:
      break;
  }
  // 融通手形は摘要欄にその旨を書く（記載要領）
  if (f.key === "note" && item.details.accommodation === true) return `融通手形　${v}`;
  return String(v);
}

function SectionSheet({
  sheet,
  accountName,
}: {
  sheet: ReturnType<typeof buildSheetSection>;
  accountName: (id: string | null) => string;
}) {
  const fields = sheet.spec.fields.filter((f) => !f.printHidden);
  const { top, bottom } = headerRows(fields);
  const amountIdx = fields.findIndex((f) => f.key === "amount");
  const accountIdx = fields.findIndex((f) => f.type === "account");
  const nameIdx = Math.max(0, fields.findIndex((f) => f.type === "partner"));
  const isMain = sheet.spec.key === "main";
  const blank = isMain ? Math.max(0, 12 - sheet.rows.length) : Math.max(0, 2 - sheet.rows.length);

  // 融通手形のみ記入した行の摘要は空でも出す
  const noteIdx = fields.findIndex((f) => f.key === "note");

  return (
    <div className={isMain ? "" : "mt-6"}>
      {sheet.spec.title && <div className="mb-1 text-[14px] font-bold">{sheet.spec.title}</div>}
      <table className={`w-full ${FORM_TABLE_MIN_W} border-collapse text-[12.5px] leading-snug`}>
        <thead>
          <tr>
            {top.map((h, i) => (
              <th key={i} colSpan={h.colSpan} rowSpan={h.rowSpan} className={headCls}>
                {h.label}
              </th>
            ))}
          </tr>
          {bottom.length > 0 && (
            <tr>
              {bottom.map((label, i) => (
                <th key={i} className={headCls}>
                  {label}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={r}>
              {fields.map((f, c) => {
                const right = f.type === "amount" || f.type === "number";
                const cls = right ? numCls : cellCls;
                if (row.kind === "item") {
                  let text = printValue(f, row.item, accountName);
                  if (c === noteIdx && !text && row.item.details.accommodation === true) text = "融通手形";
                  return (
                    <td key={f.key} className={cls}>
                      {text}
                    </td>
                  );
                }
                // 一括して記入する行
                let text = "";
                if (c === amountIdx) text = formatYen(row.amount);
                else if (c === accountIdx) text = row.label || accountName(row.accountId);
                else if (c === nameIdx)
                  text = `その他${accountIdx < 0 && row.label ? `・${row.label}` : ""}（${row.count}件）`;
                return (
                  <td key={f.key} className={cls}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
          <BlankRows count={blank} cols={fields.length} />
          {isMain && (
            <tr>
              {fields.map((f, c) => (
                <td key={f.key} className={c === amountIdx ? `${numCls} font-bold` : `${cellCls} ${c === 0 ? "text-center font-bold" : ""}`}>
                  {c === 0 ? "計" : c === amountIdx ? formatYen(sheet.total) : ""}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
