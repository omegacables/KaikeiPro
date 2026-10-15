/**
 * 法人税の e-Tax 用ファイルの、設備投資の税額控除の別表。純粋関数。計算は src/lib/investment-credit.ts。
 *   別表六(六)   HOB645 v13.0 … 法人税額の特別控除額の合計（「5」→ 別表一「3」）
 *   別表六(十五) HOB211 v19.0 … 中小企業投資促進税制（措法42条の6第2項）
 *   別表六(二十三) HOB647 v11.0 … 中小企業経営強化税制（措法42条の12の4第2項）
 * どれも手続 RHO0012 の 26.0.1 にしか無い。資産の明細は1枚に5件（それより多ければ2枚目以降に明細だけ）。
 * 前期から繰り越した税額控除限度超過額の控除（前期繰越分の欄）はまだ扱わない。
 */

import type { InvestmentCredit, CreditAsset } from "@/lib/investment-credit";
import { amount0, etaxDate, etaxText, group, kubun, value } from "@/lib/etax-xml";

type Ref = (tag: string, id: string) => string | null;
type Form = { tag: string; version: string; body: string };

const str = (s: string | null | undefined, n: number) => (s ? [...etaxText(s)].slice(0, n).join("") : null);
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.max(1, Math.ceil(xs.length / n)) }, (_, k) => xs.slice(k * n, k * n + n));

/** 経営強化法施行規則16条の類型（区分番号 → 第＿項・第＿号） */
const STRENGTHEN_CLASS: Record<string, [string, string | null]> = {
  "00712": ["2", "1"], // 生産性向上設備
  "00714": ["2", "2"], // 収益力強化設備
  "00716": ["2", "3"], // 経営資源集約化設備
  "00718": ["3", null], // 経営規模拡大設備
};

export function creditForms(ic: InvestmentCredit, ref: Ref, businessDescription: string | null): Form[] {
  const forms: Form[] = [];
  if (!ic.promotion && !ic.strengthen) return forms;
  const head = (p: string) =>
    group(`${p}00000`, group(`${p}00010`, ref(`${p}00020`, "JIGYO_NENDO_FROM"), ref(`${p}00030`, "JIGYO_NENDO_TO")), ref(`${p}00040`, "NOZEISHA_NM"));

  // ---- 別表六(六)（合計）----
  const pc = ic.promotion?.credit ?? 0;
  const sc = ic.strengthen?.credit ?? 0;
  forms.push({
    tag: "HOB645",
    version: "13.0",
    body: [
      head("ZTA"),
      group(
        "ZTB00000",
        amount0("ZTB00010", ic.total), // 当期税額控除可能額
        amount0("ZTB00020", ic.adjustedTax), // 調整前法人税額
        amount0("ZTB00030", ic.cap20), // 当期税額基準額
        group("ZTB00040", amount0("ZTB00047", ic.total)), // 法人税額の特別控除額 → 別表一「3」
        amount0("ZTB00050", 0) // 調整前法人税額超過額
      ),
      group(
        "ZTC00000",
        ic.promotion ? group("ZTC00340", group("ZTC00380", group("ZTC00390", amount0("ZTC00400", pc), amount0("ZTC00410", 0), amount0("ZTC00415", pc)))) : null,
        ic.strengthen ? group("ZTC00810", group("ZTC00820", amount0("ZTC00830", sc), amount0("ZTC00840", 0), amount0("ZTC00845", sc))) : null,
        group("ZTC01140", amount0("ZTC01150", ic.total), amount0("ZTC01160", 0), amount0("ZTC01165", ic.total))
      ),
    ]
      .filter(Boolean)
      .join(""),
  });

  // ---- 別表六(十五) 中小企業投資促進税制 ----
  const pr = ic.promotion;
  if (pr) {
    chunk(pr.assets, 5).forEach((page, k) => {
      const detail = (a: CreditAsset) =>
        group(
          "KXB00000",
          value("KXB00020", str(businessDescription, 20)),
          group(
            "KXB00030",
            value("KXB00040", str(a.accountName, 15)),
            value("KXB00055", str(a.name, 15)),
            a.acquisitionDate ? etaxDate("KXB00060", a.acquisitionDate) : null,
            a.serviceStartDate ? etaxDate("KXB00070", a.serviceStartDate) : null
          ),
          group(
            "KXB00080",
            amount0("KXB00090", a.acquisitionCost),
            // 船舶は取得価額の75%
            amount0("KXB00110", a.code === "00040" ? Math.floor(a.acquisitionCost * 0.75) : a.acquisitionCost)
          )
        );
      const calc =
        k === 0
          ? [
              group(
                "KXC00000",
                group(
                  "KXC00010",
                  amount0("KXC00020", pr.base),
                  amount0("KXC00030", pr.limit),
                  amount0("KXC00040", ic.adjustedTax),
                  amount0("KXC00050", pr.cap),
                  amount0("KXC00060", pr.credit),
                  amount0("KXC00070", 0),
                  amount0("KXC00080", pr.credit)
                ),
                amount0("KXC00150", pr.credit)
              ),
              group(
                "KXD00000",
                group("KXD00180", amount0("KXD00190", pr.limit), amount0("KXD00200", pr.credit), amount0("KXD00210", pr.carryover)),
                group("KXD00220", amount0("KXD00230", pr.limit), amount0("KXD00240", pr.credit), group("KXD00250", amount0("KXD00270", pr.carryover))),
                amount0("KXD00280", pr.carryover)
              ),
            ]
          : [];
      forms.push({ tag: "HOB211", version: "19.0", body: [head("KXA"), ...page.map(detail), ...calc].filter(Boolean).join("") });
    });
  }

  // ---- 別表六(二十三) 中小企業経営強化税制 ----
  const st = ic.strengthen;
  if (st) {
    chunk(st.assets, 5).forEach((page, k) => {
      const detail = (a: CreditAsset) => {
        const [ko, go] = STRENGTHEN_CLASS[a.code] ?? [null, null];
        return group(
          "BLB00000",
          group("BLB00120", kubun("BLB00130", 1), ko ? group("BLB00140", value("BLB00150", ko), value("BLB00160", go)) : null),
          value("BLB00010", str(businessDescription, 20)),
          group(
            "BLB00020",
            value("BLB00030", str(a.accountName, 15)),
            value("BLB00050", str(a.name, 15)),
            a.acquisitionDate ? etaxDate("BLB00060", a.acquisitionDate) : null,
            a.serviceStartDate ? etaxDate("BLB00070", a.serviceStartDate) : null
          ),
          group("BLB00080", amount0("BLB00090", a.acquisitionCost), amount0("BLB00110", a.acquisitionCost))
        );
      };
      const calc =
        k === 0
          ? [
              group(
                "BLC00000",
                group(
                  "BLC00010",
                  amount0("BLC00020", st.base),
                  amount0("BLC00023", 0), // うち建物等
                  amount0("BLC00026", st.base),
                  amount0("BLC00030", st.rate === 0.1 ? st.base : 0), // うち特定中小企業者等に係る額
                  amount0("BLC00040", st.limit),
                  amount0("BLC00050", ic.adjustedTax),
                  amount0("BLC00060", st.cap),
                  amount0("BLC00070", st.credit),
                  amount0("BLC00080", 0),
                  amount0("BLC00090", st.credit)
                ),
                amount0("BLC00160", st.credit)
              ),
              group(
                "BLD00000",
                group("BLD00160", amount0("BLD00170", st.limit), amount0("BLD00180", st.credit), amount0("BLD00190", st.carryover)),
                group("BLD00200", amount0("BLD00210", st.limit), amount0("BLD00220", st.credit), group("BLD00230", amount0("BLD00250", st.carryover))),
                amount0("BLD00260", st.carryover)
              ),
            ]
          : [];
      forms.push({ tag: "HOB647", version: "11.0", body: [head("BLA"), ...page.map(detail), ...calc].filter(Boolean).join("") });
    });
  }
  return forms;
}
