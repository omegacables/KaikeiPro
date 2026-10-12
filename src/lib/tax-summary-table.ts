/**
 * 消費税の集計表（10%分／8%（軽減）分）。純粋関数。
 * 売上・仕入の行を、申告書を作るときに見る区分ごとに合計する。
 *
 *   - 売上の科目の借方（返品・値引き・取消）は「対価の返還」、仕入の科目の貸方は「仕入返還」として分けて出す
 *   - 仕入は用途区分（課税売上対応・非課税売上対応・共通）ごと。用途区分の無い行は「共通」に入れる
 *   - 税率の無い取引（免税・非課税・対象外・地方消費税貨物割）は「10%分」の表に出す
 *   - 金額はすべて正の数（返還の行も正の数で、区分の名前で返還だと分かるようにする）
 */

import { taxCategoryInfo } from "@/lib/tax-category";

export type SummaryLine = {
  side: "sales" | "purchase";
  /** 税区分（"none" は未設定） */
  code: string;
  /** 税抜・消費税・税込（返還はマイナス） */
  net: number;
  tax: number;
  gross: number;
  purchaseUse?: "taxable" | "non_taxable" | "common" | null;
  needsReview?: boolean;
};

export type SummaryCell = { count: number; gross: number; net: number; tax: number };
export type SummaryRow = { key: string; label: string; group?: string; cell: SummaryCell };
export type SummaryTab = { rate: "10" | "8"; title: string; sales: SummaryRow[]; purchase: SummaryRow[] };

const USES: { key: "taxable" | "non_taxable" | "common"; label: string }[] = [
  { key: "taxable", label: "課税売上対応" },
  { key: "non_taxable", label: "非課税売上対応" },
  { key: "common", label: "共通売上対応" },
];

const SALES_ROWS: { key: string; label: string; rated?: boolean }[] = [
  { key: "taxable", label: "課税売上", rated: true },
  { key: "tax_free", label: "免税売上（輸出取引等）" },
  { key: "exempt_securities", label: "非課税売上・有価証券" },
  { key: "exempt_other", label: "非課税売上・有価証券以外" },
  { key: "exempt_export", label: "非課税資産の輸出等" },
  { key: "out_of_scope", label: "対象外売上" },
  { key: "return_taxable", label: "課税売上に係る対価の返還", rated: true },
  { key: "return_tax_free", label: "免税売上に係る対価の返還" },
  { key: "return_exempt", label: "非課税売上に係る対価の返還" },
  { key: "return_exempt_export", label: "非課税資産の輸出等の返還" },
];

type PurchaseRowDef = { key: string; label: string; group?: string; rated?: boolean };
const PURCHASE_ROWS = (rate: "10" | "8"): PurchaseRowDef[] => {
  const pct = rate === "10" ? "7.8%分" : "6.24%分";
  return [
    ...USES.map((u) => ({ key: `purchase:${u.key}`, label: u.label, group: "仕入", rated: true })),
    { key: "transition", label: "うち適格請求書発行事業者以外からの仕入（経過措置）", group: "仕入", rated: true },
    ...USES.map((u) => ({ key: `import:${u.key}`, label: `${u.label}（${pct}）`, group: "輸入仕入", rated: true })),
    { key: "import_local", label: "地方消費税貨物割", group: "輸入仕入" },
    { key: "exempt", label: "非課税仕入" },
    { key: "out_of_scope", label: "対象外仕入" },
    ...USES.map((u) => ({ key: `return:${u.key}`, label: u.label, group: "仕入返還", rated: true })),
    ...USES.map((u) => ({ key: `import_return:${u.key}`, label: `${u.label}（${pct}）`, group: "輸入仕入返還", rated: true })),
    { key: "import_local_return", label: "地方消費税貨物割", group: "輸入仕入返還" },
    { key: "bad_debt", label: "貸倒（課税売上に対する）", rated: true },
  ];
};

const empty = (): SummaryCell => ({ count: 0, gross: 0, net: 0, tax: 0 });

/** 行の置き場所（どの表のどの区分か） */
function placeOf(l: SummaryLine): { rate: "10" | "8"; side: "sales" | "purchase"; key: string } | null {
  if (l.code === "none") return null;
  const info = taxCategoryInfo(l.code);
  if (!info) return null;
  const rate: "10" | "8" = info.rate === 0.08 ? "8" : "10";
  const returned = l.gross < 0 || (l.gross === 0 && l.tax < 0);
  if (info.badDebt) return { rate, side: "purchase", key: "bad_debt" };
  if (info.side === "sales") {
    if (info.rate > 0) return { rate, side: "sales", key: returned ? "return_taxable" : "taxable" };
    if (l.code === "sales_tax_free") return { rate, side: "sales", key: returned ? "return_tax_free" : "tax_free" };
    if (info.exemptExport) return { rate, side: "sales", key: returned ? "return_exempt_export" : "exempt_export" };
    if (info.securities) return { rate, side: "sales", key: returned ? "return_exempt" : "exempt_securities" };
    if (l.code === "sales_exempt") return { rate, side: "sales", key: returned ? "return_exempt" : "exempt_other" };
    return { rate, side: "sales", key: "out_of_scope" };
  }
  const use = l.purchaseUse ?? "common";
  if (info.importTax === "local") return { rate, side: "purchase", key: returned ? "import_local_return" : "import_local" };
  if (info.importTax) return { rate, side: "purchase", key: `${returned ? "import_return" : "import"}:${use}` };
  if (info.rate > 0) return { rate, side: "purchase", key: `${returned ? "return" : "purchase"}:${use}` };
  if (l.code === "purchase_exempt") return { rate, side: "purchase", key: "exempt" };
  return { rate, side: "purchase", key: "out_of_scope" };
}

export function buildConsumptionTaxTable(lines: SummaryLine[]): SummaryTab[] {
  const cells = new Map<string, SummaryCell>();
  const add = (k: string, l: SummaryLine) => {
    const c = cells.get(k) ?? empty();
    c.count++;
    c.gross += Math.abs(l.gross);
    c.net += Math.abs(l.net);
    c.tax += Math.abs(l.tax);
    cells.set(k, c);
  };
  for (const l of lines) {
    if (l.needsReview) continue;
    const p = placeOf(l);
    if (!p) continue;
    add(`${p.rate}|${p.side}|${p.key}`, l);
    // 経過措置の仕入は、仕入の内訳としても別に出す
    if (p.side === "purchase" && taxCategoryInfo(l.code)?.transitionRate) add(`${p.rate}|purchase|transition`, l);
  }
  const rows = (rate: "10" | "8", side: "sales" | "purchase", defs: { key: string; label: string; group?: string; rated?: boolean }[]) =>
    defs
      // 8%の表には税率の無い区分を出さない（10%の表に出す）
      .filter((d) => rate === "10" || d.rated)
      .map((d) => ({ key: d.key, label: d.label, group: d.group, cell: cells.get(`${rate}|${side}|${d.key}`) ?? empty() }));
  return (["10", "8"] as const).map((rate) => ({
    rate,
    title: rate === "10" ? "10%分" : "8%（軽）分",
    sales: rows(rate, "sales", SALES_ROWS),
    purchase: rows(rate, "purchase", PURCHASE_ROWS(rate)),
  }));
}
