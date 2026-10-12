import { describe, it, expect } from "vitest";
import { buildConsumptionTaxTable, type SummaryLine } from "./tax-summary-table";

const l = (o: Partial<SummaryLine>): SummaryLine => ({ side: "sales", code: "sales_10", net: 0, tax: 0, gross: 0, ...o });
const cell = (tabs: ReturnType<typeof buildConsumptionTaxTable>, rate: "10" | "8", side: "sales" | "purchase", key: string) =>
  tabs.find((t) => t.rate === rate)![side].find((r) => r.key === key)?.cell;

describe("消費税の集計表", () => {
  const tabs = buildConsumptionTaxTable([
    l({ net: 1_000_000, tax: 100_000, gross: 1_100_000 }),
    l({ net: -10_000, tax: -1_000, gross: -11_000 }), // 返品
    l({ code: "sales_08_reduced", net: 100_000, tax: 8_000, gross: 108_000 }),
    l({ code: "sales_exempt_securities", net: 5_000_000, gross: 5_000_000 }),
    l({ code: "sales_exempt", net: 30_000, gross: 30_000 }),
    l({ code: "sales_tax_free", net: 200_000, gross: 200_000 }),
    l({ side: "purchase", code: "purchase_10", net: 500_000, tax: 50_000, gross: 550_000, purchaseUse: "taxable" }),
    l({ side: "purchase", code: "purchase_10", net: 100_000, tax: 10_000, gross: 110_000 }), // 用途区分なし → 共通
    l({ side: "purchase", code: "purchase_10", net: -20_000, tax: -2_000, gross: -22_000, purchaseUse: "taxable" }), // 仕入返還
    l({ side: "purchase", code: "purchase_import_10", net: 0, tax: 78_000, gross: 78_000, purchaseUse: "taxable" }),
    l({ side: "purchase", code: "purchase_import_local", net: 0, tax: 22_000, gross: 22_000 }),
    l({ side: "purchase", code: "purchase_10_trans_80", net: 10_000, tax: 1_000, gross: 11_000 }),
    l({ side: "purchase", code: "purchase_exempt", net: 3_000, gross: 3_000 }),
    l({ code: "sales_10", net: 999, tax: 99, gross: 1_098, needsReview: true }),
  ]);

  it("売上: 課税売上と対価の返還を分け、有価証券・免税は10%分の表に", () => {
    expect(cell(tabs, "10", "sales", "taxable")).toEqual({ count: 1, gross: 1_100_000, net: 1_000_000, tax: 100_000 });
    expect(cell(tabs, "10", "sales", "return_taxable")).toEqual({ count: 1, gross: 11_000, net: 10_000, tax: 1_000 });
    expect(cell(tabs, "8", "sales", "taxable")?.tax).toBe(8_000);
    expect(cell(tabs, "10", "sales", "exempt_securities")?.net).toBe(5_000_000);
    expect(cell(tabs, "10", "sales", "exempt_other")?.net).toBe(30_000);
    expect(cell(tabs, "10", "sales", "tax_free")?.net).toBe(200_000);
    expect(cell(tabs, "8", "sales", "tax_free")).toBeUndefined(); // 税率の無い区分は8%の表に出さない
  });

  it("仕入: 用途区分ごと（無ければ共通）、仕入返還・輸入・貨物割・経過措置", () => {
    expect(cell(tabs, "10", "purchase", "purchase:taxable")?.tax).toBe(50_000);
    expect(cell(tabs, "10", "purchase", "purchase:common")?.tax).toBe(11_000); // 用途区分なし＋経過措置
    expect(cell(tabs, "10", "purchase", "return:taxable")).toEqual({ count: 1, gross: 22_000, net: 20_000, tax: 2_000 });
    expect(cell(tabs, "10", "purchase", "import:taxable")?.tax).toBe(78_000);
    expect(cell(tabs, "10", "purchase", "import_local")?.tax).toBe(22_000);
    expect(cell(tabs, "10", "purchase", "transition")?.gross).toBe(11_000);
    expect(cell(tabs, "10", "purchase", "exempt")?.net).toBe(3_000);
  });

  it("要確認の仕訳は入れない", () => {
    expect(cell(tabs, "10", "sales", "taxable")?.count).toBe(1);
  });
});
