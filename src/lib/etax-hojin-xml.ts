/**
 * 法人税の確定申告書（内国法人・青色）を e-Tax 用ファイル（.xtx）にする。純粋関数。
 *   手続 RHO0012（26.0.0 = 令和8年度版。2026年4月1日以後に終了する事業年度）
 *   別表一 HOA112・次葉一（防衛特別法人税）HOA114・次葉二（税率ごとの法人税額・地方法人税額）HOA116・
 *   別表四（簡易様式）HOA420・五(一) HOA511・五(二) HOA522・七(一) HOB710・十五 HOE200・
 *   十六(一)(二)(七)(八)（src/lib/etax-hojin-depreciation.ts）・適用額明細書 HOE990
 * 金額は申告書の計算（src/lib/corporate-tax-return.ts）の表から、欄番号・行の種類で取り出す。
 * 要素名と順番は国税庁「XML構造設計書（法人-申告）」とスキーマ（hojin/*.xsd）のとおり。
 *
 *   - 「△」で表示する欄（別表四「44」、別表五(一)「27」「29」「30」）は正の数で書く（様式が△を付ける）
 *   - 別表四の自由記入行は加算・減算それぞれ4行まで（それより多いと別表四次葉が要るため作らない）
 *   - 地方税（住民税・事業税）は eLTAX の手続なので含めない
 */

import type { CorporateTaxReturn, TaxRow, TaxTable } from "@/lib/corporate-tax-return";
import { depreciationForms, type DepAsset } from "@/lib/etax-hojin-depreciation";
import {
  amount,
  amount0,
  buildIT,
  etaxDate,
  etaxText,
  form,
  group,
  kubun,
  procedureFile,
  refTo,
  value,
  type Filer,
} from "@/lib/etax-xml";

const NS = "http://xml.e-tax.nta.go.jp/XSD/hojin";
/** 令和8年度版の様式を使える事業年度（終了日） */
export const HOJIN_XML_FROM = "2026-04-01";

export type HojinXmlInput = {
  ret: CorporateTaxReturn;
  filer: Filer;
  period: { start: string; end: string };
  /** 前事業年度（別表五(二) の前期分の行に書く） */
  priorPeriod: { start: string; end: string };
  /** 期末の資本金の額（不明なら null） */
  capital: number | null;
  /** 事業種目 */
  businessDescription: string | null;
  /** 防衛特別法人税の対象の事業年度か */
  defenseApplies: boolean;
  /** 固定資産台帳（別表十六に使う） */
  assets?: DepAsset[];
  today: string;
};

/**
 * 適用額明細書の区分番号（令和8年4月1日以後に終了する事業年度。国税庁「適用額明細書の記載の手引」）
 *   00380 中小企業者等の法人税率の特例（措法42条の3の2第1項 表の第1号）… 適用額＝別表一次葉二「74」
 *   00277 中小企業者等の少額減価償却資産の取得価額の損金算入の特例（措法67条の5第1項）… 適用額＝別表十六(七)「8」
 */
const TEKIYOU = {
  reducedRate: { jo: "42", eda: "の3の2", ko: "1", go: "1", no: "00380" },
  smallAssets: { jo: "67", eda: "の5", ko: "1", go: null, no: "00277" },
};

const FREE_LIMIT = 4;

function finder(tables: TaxTable[]) {
  const table = (key: string) => tables.find((t) => t.key === key);
  const row = (key: string, no: string): TaxRow | undefined => table(key)?.rows.find((r) => r.no === no);
  const v = (key: string, no: string, col = 0): number | null => row(key, no)?.values[col] ?? null;
  return { table, row, v };
}

const dayAfter = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
const yearBefore = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10);
};

export function corporateTaxXml(i: HojinXmlInput): { fileName: string; xml: string; warnings: string[] } {
  if (i.period.end < HOJIN_XML_FROM)
    throw new Error("e-Tax 用ファイルは、令和8年4月1日以後に終了する事業年度（令和8年度版の様式）だけ作れます。");
  const { ret } = i;
  const { table, row, v } = finder(ret.tables);
  const free4 = (table("beppyo4")?.rows ?? []).filter((r) => r.key === "free");
  if (free4.filter((r) => r.label.startsWith("加算")).length > FREE_LIMIT || free4.filter((r) => r.label.startsWith("減算")).length > FREE_LIMIT)
    throw new Error("別表四の手入力の加算・減算がそれぞれ4行を超えるため、e-Tax 用ファイルを作れません（別表四次葉が必要です）。行をまとめてください。");

  const { xml: it, ids } = buildIT(i.filer, {
    procedureCode: "RHO0012",
    procedureName: "内国法人の確定申告(青色)",
    periodFrom: i.period.start,
    periodTo: i.period.end,
    periodKind: "jigyo",
    shinkokuKbn: 30, // 確定（法人税）／確定（地方法人税）
    capital: i.capital,
    businessDescription: i.businessDescription,
  });
  const ref = refTo(ids);
  const by = { name: i.filer.name, date: i.today };
  const header = (p: string) =>
    group(`${p}00000`, group(`${p}00010`, ref(`${p}00020`, "JIGYO_NENDO_FROM"), ref(`${p}00030`, "JIGYO_NENDO_TO")), ref(`${p}00040`, "NOZEISHA_NM"));
  /** 別表十六の納税者等部（法人名が入れ子になっている） */
  const nestedHeader = (p: string, [outer, inner]: [number, number]) => {
    const c = (n: number) => `${p}${String(n).padStart(5, "0")}`;
    return group(c(0), group(c(10), ref(c(20), "JIGYO_NENDO_FROM"), ref(c(30), "JIGYO_NENDO_TO")), group(c(outer), ref(c(inner), "NOZEISHA_NM")));
  };
  const forms: { id: string; xml: string }[] = [];
  const warnings: string[] = [];

  // 別表十六と適用額明細書は、別表一の「適用額明細書提出の有無」に関わるので先に作る
  const dep = depreciationForms(i.assets ?? [], { start: i.period.start, end: i.period.end, months: ret.months }, nestedHeader);
  warnings.push(...dep.warnings);
  const income1 = v("beppyo1", "1") ?? 0;
  const line74 = v("beppyo1", "74") ?? 0;
  const tekiyou: { t: (typeof TEKIYOU)[keyof typeof TEKIYOU]; amount: number }[] = [];
  if (ret.isSme && income1 > 0 && line74 > 0) tekiyou.push({ t: TEKIYOU.reducedRate, amount: line74 });
  if (dep.smallAssetsTotal > 0) tekiyou.push({ t: TEKIYOU.smallAssets, amount: dep.smallAssetsTotal });

  // ===================== 別表一 =====================
  const b1 = (no: string) => v("beppyo1", no);
  const withholding = (b1("12") ?? 0) + (b1("21") ?? 0); // 所得税額（控除した分＋控除しきれなかった分）
  const refund24 = (b1("21") ?? 0) + (b1("22") ?? 0) + (b1("23") ?? 0);
  const hoa112 = [
    group(
      "BGA00000",
      ref("BGA00020", "ZEIMUSHO"),
      ref("BGA00030", "NOZEISHA_ADR"),
      ref("BGA00040", "NOZEISHA_TEL"),
      group("BGA00050", ref("BGA00060", "NOZEISHA_NM_KN"), ref("BGA00070", "NOZEISHA_NM")),
      ref("BGA00080", "NOZEISHA_BANGO"),
      group("BGA00090", ref("BGA00100", "DAIHYO_NM_KN"), ref("BGA00110", "DAIHYO_NM")),
      kubun("BGA00130", 1), // 法人区分: 普通法人
      ref("BGA00140", "JIGYO_NAIYO"),
      ref("BGA00150", "SHIHON_KIN"),
      // 資本金1億円以下の普通法人のうち中小法人に該当しないもの: 非該当（大法人の子会社などは e-Taxソフトで直す）
      i.capital !== null && i.capital <= 100_000_000 ? kubun("BGA00160", 2) : null,
      kubun("BGA00300", tekiyou.length ? 1 : 2), // 適用額明細書提出の有無
      group("BGA00330", ref("BGA00340", "JIGYO_NENDO_FROM"), ref("BGA00350", "JIGYO_NENDO_TO")),
      ref("BGA00360", "SHINKOKU_KBN"),
      i.defenseApplies ? kubun("BGA00365", 1) : null // 申告の種類（防衛分）: 確定
    ),
    group(
      "BGB00000",
      amount("BGB00010", b1("1")),
      amount("BGB00020", b1("2")),
      group("BGB00120", amount("BGB00150", b1("9"))),
      amount("BGB00180", b1("12")),
      amount("BGB00190", b1("13")),
      amount("BGB00200", b1("14")),
      amount("BGB00210", b1("15")),
      group(
        "BGB00220",
        amount("BGB00230", withholding),
        amount("BGB00250", withholding),
        amount("BGB00260", b1("12")),
        amount("BGB00270", b1("21"))
      ),
      group(
        "BGB00320",
        amount("BGB00330", b1("21")),
        amount("BGB00340", b1("22")),
        group("BGB00350", amount("BGB00370", b1("23"))),
        group("BGB00380", amount("BGB00400", refund24))
      ),
      amount("BGB00460", b1("26")),
      amount("BGB00470", b1("27"))
    ),
    group(
      "BGC00000",
      group("BGC00010", group("BGC00020", amount("BGC00030", b1("28"))), amount("BGC00050", b1("30"))),
      amount("BGC00060", b1("31")),
      amount("BGC00080", b1("31")), // 所得地方法人税額（税額控除超過額・課税留保金額は無し）
      amount("BGC00120", b1("38")),
      amount("BGC00130", b1("39")),
      amount("BGC00140", b1("40")),
      group("BGC00150", amount("BGC00250", b1("42")), group("BGC00260", amount("BGC00280", b1("42"))))
    ),
  ];
  forms.push({ id: "HOA112-1", xml: form("HOA112", "7.0", "HOA112-1", by, hoa112.filter(Boolean).join("")) });

  // ===================== 別表一次葉一（防衛特別法人税）: 対象外の年度も必須（見出しだけ） =====================
  const d = (no: string) => v("beppyo1-defense", no);
  const defense = table("beppyo1-defense") && i.defenseApplies;
  const base45 = d("45") ?? 0;
  const deduction47 = d("47") ?? 0;
  const hoa114 = [
    header("KZA"),
    defense
      ? group(
          "KZB00000",
          group(
            "KZB00010",
            group("KZB00020", amount0("KZB00030", base45)),
            group("KZB00050", kubun("KZB00060", 1), value("KZB00070", ret.months), amount0("KZB00080", deduction47)),
            group("KZB00090", kubun("KZB00100", 1), amount0("KZB00110", Math.max(0, deduction47 - base45))),
            amount0("KZB00120", d("67"))
          ),
          amount0("KZB00130", d("68")), // 50 防衛特別法人税額（0 でも書く）
          amount0("KZB00160", d("68")), // 53 防衛特別法人税額計
          amount0("KZB00200", d("57")), // 57 差引防衛特別法人税額
          amount0("KZB00220", d("57")), // 59 差引確定防衛特別法人税額（中間申告分は無し）
          group("KZB00350", amount0("KZB00360", d("67")), amount0("KZB00370", d("68")))
        )
      : null,
  ];
  forms.push({ id: "HOA114-1", xml: form("HOA114", "1.0", "HOA114-1", by, hoa114.filter(Boolean).join("")) });

  // ===================== 別表一次葉二（法人税額・地方法人税額の計算） =====================
  const hoa116 = [
    header("QHA"),
    group(
      "QHB00000",
      ret.isSme && line74 > 0 ? group("QHB00010", kubun("QHB00015", 1), value("QHB00020", ret.months), amount("QHB00030", line74)) : null,
      amount("QHB00070", b1("76")),
      line74 > 0 ? group("QHB00080", kubun("QHB00090", ret.lowRate === 0.17 ? 3 : 1), amount("QHB00100", b1("77"))) : null,
      (b1("76") ?? 0) > 0 ? group("QHB00120", kubun("QHB00130", 2), amount("QHB00140", b1("79"))) : null
    ),
    group("QHC00000", amount("QHC00010", Math.floor((b1("28") ?? 0) / 1000) * 1000), group("QHC00030", amount("QHC00050", b1("31")))),
  ];
  forms.push({ id: "HOA116-1", xml: form("HOA116", "6.0", "HOA116-1", by, hoa116.filter(Boolean).join("")) });

  // ===================== 別表四（簡易様式） =====================
  const r4 = (no: string) => row("beppyo4", no)?.values ?? null;
  const tri = (vals: (number | null)[] | null) => ({ t: vals?.[0] ?? 0, r: vals?.[1] ?? 0, o: vals?.[2] ?? 0 });
  /** 総額・留保の2列の固定行 */
  const fixedTR = (g: string, a: string, b: string, no: string) => {
    const x = tri(r4(no));
    return group(g, amount(a, x.t), amount(b, x.r));
  };
  /** 総額・社外流出の2列の固定行 */
  const fixedTO = (g: string, a: string, b: string, no: string) => {
    const x = tri(r4(no));
    return group(g, amount(a, x.t), amount(b, x.o));
  };
  /** 社外流出（外書き・本書き）の3列の行 */
  const full = (g: string, c: [string, string, string, string, string], x: { t: number; r: number; outer: number; main: number }) =>
    group(g, amount(c[0], x.t), amount(c[1], x.r), group(c[2], amount(c[3], x.outer), amount(c[4], x.main)));
  const freeRows = (prefix: "加算" | "減算") => free4.filter((r) => r.label.startsWith(prefix)).map((r) => ({ name: r.name ?? "", ...tri(r.values) }));
  const adds = freeRows("加算");
  const deds = freeRows("減算");
  const name30 = (s: string) => [...etaxText(s)].slice(0, 30).join("");
  /** 自由記入行（社外流出は「その他」） */
  const freeRow = (g: string, c: string[], f: { name: string; t: number; r: number; o: number }) =>
    group(
      g,
      value(c[0], name30(f.name)),
      amount(c[1], f.t),
      amount(c[2], f.r),
      f.o ? value(c[3], "その他") : null,
      amount(c[4], f.o)
    );
  const l11 = tri(r4("11"));
  const l22 = tri(r4("22"));
  const l26 = tri(r4("26"));
  const withholding29 = tri(r4("29")).t;
  const l43 = tri(r4("43"));
  const lossUsed = -(tri(r4("44")).t); // 表は△（マイナス）で持っている
  const l52 = tri(r4("52"));
  const l1 = tri(r4("1"));
  const at34 = { t: l26.t + withholding29, r: l26.r, outer: 0, main: l26.o + withholding29 };
  const hoa420 = [
    header("ARA"),
    group("ARB00000", amount("ARB00010", l1.t), amount("ARB00020", l1.r)),
    group(
      "ARC00000",
      fixedTR("ARC00010", "ARC00020", "ARC00030", "2"),
      fixedTR("ARC00040", "ARC00050", "ARC00060", "3"),
      fixedTR("ARC00100", "ARC00110", "ARC00120", "4"),
      fixedTR("ARC00160", "ARC00170", "ARC00180", "6"),
      fixedTO("ARC00213", "ARC00215", "ARC00218", "8"),
      adds[0] ? freeRow("ARC00220", ["ARC00230", "ARC00240", "ARC00250", "ARC00260", "ARC00270"], adds[0]) : null,
      ...adds.slice(1).map((f) => freeRow("ARC00275", ["ARC00280", "ARC00290", "ARC00300", "ARC00310", "ARC00320"], f)),
      group("ARC00325", amount("ARC00330", l11.t), amount("ARC00340", l11.r), amount("ARC00350", l11.o))
    ),
    group(
      "ARD00000",
      fixedTR("ARD00010", "ARD00020", "ARD00030", "12"),
      fixedTR("ARD00040", "ARD00050", "ARD00060", "13"),
      deds[0] ? freeRow("ARD00160", ["ARD00170", "ARD00180", "ARD00190", "ARD00200", "ARD00210"], deds[0]) : null,
      ...deds.slice(1).map((f) => freeRow("ARD00215", ["ARD00220", "ARD00230", "ARD00240", "ARD00250", "ARD00260"], f)),
      full("ARD00280", ["ARD00290", "ARD00300", "ARD00310", "ARD00320", "ARD00330"], { t: l22.t, r: l22.r, outer: 0, main: l22.o })
    ),
    full("ARE00000", ["ARE00010", "ARE00020", "ARE00030", "ARE00040", "ARE00050"], { t: l26.t, r: l26.r, outer: 0, main: l26.o }), // 23
    full("ARZ10000", ["ARZ10010", "ARZ10020", "ARZ10030", "ARZ10040", "ARZ10050"], { t: l26.t, r: l26.r, outer: 0, main: l26.o }), // 26
    group("ARI00000", amount("ARI00010", withholding29), amount("ARI00020", withholding29)), // 29
    full("ARK00000", ["ARK00010", "ARK00020", "ARK00030", "ARK00040", "ARK00050"], at34), // 34
    full("ARM00000", ["ARM00010", "ARM00020", "ARM00030", "ARM00040", "ARM00050"], { t: l43.t - lossUsed, r: l43.r, outer: -lossUsed, main: at34.main }), // 45
    full("ARS00000", ["ARS00010", "ARS00020", "ARS00030", "ARS00040", "ARS00050"], at34), // 39
    full("ARS50000", ["ARS50010", "ARS50020", "ARS50030", "ARS50040", "ARS50050"], at34), // 43
    group("ART00000", amount("ART00010", lossUsed), amount("ART00020", lossUsed)), // 44（正の数）
    full("ARV00000", ["ARV00010", "ARV00020", "ARV00030", "ARV00040", "ARV00050"], { t: l52.t, r: l52.r, outer: -lossUsed, main: at34.main }), // 52
  ];
  forms.push({ id: "HOA420-1", xml: form("HOA420", "25.0", "HOA420-1", by, hoa420.filter(Boolean).join("")) });

  // ===================== 別表五(一) =====================
  const rows5 = table("beppyo5-1")?.rows ?? [];
  const r5 = (key: string) => rows5.find((r) => r.key === key);
  const c4 = (r: TaxRow | undefined) => ({ open: r?.values[0] ?? 0, dec: r?.values[1] ?? 0, inc: r?.values[2] ?? 0, close: r?.values[3] ?? 0 });
  const legal = rows5.find((r) => r.key === "free" && r.name === "利益準備金");
  const free5 = rows5.filter((r) => (r.key === "free" && r !== legal) || r.key === "depreciation").filter((r) => r.values.some((x) => x));
  const unpaid = (g: string, codes: string[], r: TaxRow | undefined) => {
    if (!r) return null;
    const x = c4(r);
    // 期首・減・期末は△で表示する欄なので正の数で書く
    return group(
      g,
      amount(codes[0], -x.open),
      group(codes[1], amount(codes[2], -x.dec), group(codes[3], amount(codes[4], r.detail?.interim), amount(codes[5], r.detail?.final))),
      amount(codes[6], -x.close)
    );
  };
  const re = c4(r5("retainedEarnings"));
  const pv = c4(r5("provision"));
  const tot5 = c4(row("beppyo5-1", "31"));
  const hoa511 = [
    header("ICA"),
    group(
      "ICB00000",
      legal
        ? group("ICB00010", amount("ICB00020", c4(legal).open), group("ICB00030", amount("ICB00040", c4(legal).dec), amount("ICB00050", c4(legal).inc)), amount("ICB00060", c4(legal).close))
        : null,
      ...free5.slice(0, 19).map((r) => {
        const x = c4(r);
        return group(
          "ICB00140",
          value("ICB00150", [...etaxText(r.name ?? r.label)].slice(0, 40).join("")),
          amount("ICB00160", x.open),
          group("ICB00170", amount("ICB00190", x.dec), amount("ICB00200", x.inc)),
          amount("ICB00210", x.close)
        );
      }),
      group("ICB00400", amount("ICB00410", re.open), group("ICB00420", amount("ICB00430", re.dec), amount("ICB00440", re.inc)), amount("ICB00450", re.close)),
      group("ICB00460", amount("ICB00470", pv.open), group("ICB00480", amount("ICB00490", pv.dec), amount("ICB00500", pv.inc)), amount("ICB00510", pv.close)),
      group(
        "ICB00520",
        unpaid("ICB00530", ["ICB00540", "ICB00550", "ICB00560", "ICB00570", "ICB00580", "ICB00590", "ICB00610"], r5("unpaidCorporate")),
        unpaid("ICB00620", ["ICB00630", "ICB00640", "ICB00650", "ICB00660", "ICB00670", "ICB00680", "ICB00700"], r5("unpaidPrefectural")),
        unpaid("ICB00710", ["ICB00720", "ICB00730", "ICB00740", "ICB00750", "ICB00760", "ICB00770", "ICB00790"], r5("unpaidMunicipal"))
      ),
      group("ICB00800", amount("ICB00810", tot5.open), group("ICB00820", amount("ICB00830", tot5.dec), amount("ICB00840", tot5.inc)), amount("ICB00850", tot5.close))
    ),
    i.capital
      ? group(
          "ICC00000",
          group("ICC00010", amount("ICC00020", i.capital), amount("ICC00060", i.capital)),
          group("ICC00200", amount("ICC00210", i.capital), amount("ICC00250", i.capital))
        )
      : null,
  ];
  if (free5.length > 19) throw new Error("別表五(一) の項目が19行を超えるため、e-Tax 用ファイルを作れません。");
  forms.push({ id: "HOA511-1", xml: form("HOA511", "16.0", "HOA511-1", by, hoa511.filter(Boolean).join("")) });

  // ===================== 別表五(二) =====================
  // 表の列: ①期首未納 ②当期発生 ③充当金取崩し ⑤損金経理 ⑥期末未納
  const r52 = (no: string) => {
    const x = row("beppyo5-2", no)?.values ?? [];
    return { open: x[0] ?? 0, occur: x[1] ?? 0, provision: x[2] ?? 0, expensed: x[3] ?? 0, close: x[4] ?? 0 };
  };
  const code = (p: string, n: number) => `${p}${String(n).padStart(5, "0")}`;
  /** 前期分の行の事業年度（自・至） */
  const priorDates = (p: string) => [etaxDate(code(p, 20), i.priorPeriod.start), etaxDate(code(p, 30), i.priorPeriod.end)];
  /** 法人税等・市町村民税（中間・確定の番号が同じ並び） */
  const taxBlock = (p: "IEB" | "IED", prior: string, interim: string, fin: string) => {
    const a = r52(prior);
    const b = r52(interim);
    const c = r52(fin);
    const C = (n: number) => code(p, n);
    return group(
      C(0),
      a.open || a.provision || a.expensed
        ? group(C(10), ...priorDates(p), amount(C(50), a.open), group(C(60), group(C(70), amount(C(90), a.provision)), group(C(130), amount(C(150), a.expensed))), amount(C(160), a.close))
        : null,
      group(
        C(170),
        group(C(180), amount(C(190), b.occur), group(C(200), group(C(270), amount(C(290), b.expensed))), amount(C(300), b.close)),
        group(C(310), amount(C(320), c.occur), group(C(330), amount(C(350), c.close)))
      ),
      group(
        C(360),
        amount(C(380), a.open),
        amount(C(390), b.occur + c.occur),
        group(C(400), group(C(410), amount(C(430), a.provision + b.provision)), group(C(470), amount(C(490), a.expensed + b.expensed))),
        group(C(500), amount(C(520), a.close + b.close + c.close))
      )
    );
  };
  const pref = (() => {
    const a = r52("6〜7");
    const b = r52("8");
    const c = r52("9");
    const C = (n: number) => code("IEC", n);
    return group(
      C(0),
      a.open || a.provision || a.expensed
        ? group(C(10), ...priorDates("IEC"), amount(C(50), a.open), group(C(60), group(C(70), amount(C(90), a.provision)), group(C(130), amount(C(150), a.expensed))), amount(C(160), a.close))
        : null,
      group(
        C(170),
        group(C(310), amount(C(320), b.occur), group(C(330), group(C(400), amount(C(420), b.expensed))), amount(C(430), b.close)),
        group(C(440), amount(C(450), c.occur), group(C(460), amount(C(480), c.close)))
      ),
      group(
        C(490),
        amount(C(510), a.open),
        amount(C(520), b.occur + c.occur),
        group(C(530), group(C(540), amount(C(560), a.provision + b.provision)), group(C(600), amount(C(620), a.expensed + b.expensed))),
        group(C(630), amount(C(650), a.close + b.close + c.close))
      )
    );
  })();
  const ent = (() => {
    // 前期分の事業税は「当期発生税額」に書く（事業税は前期末に未納として計上しないため）
    const a = r52("16〜17");
    const b = r52("18");
    const C = (n: number) => code("IEE", n);
    const priorOccur = a.open;
    return group(
      C(0),
      priorOccur || a.provision || a.expensed
        ? group(C(10), ...priorDates("IEE"), amount(C(50), priorOccur), group(C(60), group(C(70), amount(C(90), a.provision)), group(C(130), amount(C(150), a.expensed))), amount(C(160), a.close))
        : null,
      group(C(170), amount(C(180), b.occur), group(C(190), group(C(260), amount(C(280), b.expensed))), amount(C(290), b.close)),
      group(
        C(300),
        amount(C(320), priorOccur + b.occur),
        group(C(330), group(C(340), amount(C(360), a.provision)), group(C(400), amount(C(420), a.expensed + b.expensed))),
        amount(C(430), a.close + b.close)
      )
    );
  })();
  const p30 = r52("30").open;
  const p31 = r52("31").occur;
  const p34 = r52("34").provision;
  const p35 = r52("35").provision;
  const p41 = r52("41").close;
  const hoa522 = [
    header("IEA"),
    taxBlock("IEB", "1〜2", "3", "4"),
    pref,
    taxBlock("IED", "11〜12", "13", "14"),
    ent,
    group(
      "IEG00000",
      amount("IEG00010", p30),
      group("IEG00020", amount("IEG00030", p31), amount("IEG00070", p31)),
      group("IEG00080", amount("IEG00090", p34), amount("IEG00100", p35), amount("IEG00180", p34 + p35)),
      amount("IEG00190", p41)
    ),
  ];
  forms.push({ id: "HOA522-1", xml: form("HOA522", "10.0", "HOA522-1", by, hoa522.filter(Boolean).join("")) });

  // ===================== 別表七(一) =====================
  const rows7 = table("beppyo7")?.rows ?? [];
  const lossRows = rows7.filter((r) => r.key === "loss").filter((r) => (r.values[0] ?? 0) > 0);
  const current = rows7.find((r) => r.key === "current");
  const total7 = rows7.find((r) => r.no === "計");
  if (lossRows.length > 10) throw new Error("繰越欠損金の事業年度が10を超えるため、e-Tax 用ファイルを作れません。");
  /** 欠損金の事業年度（自・至）。記録は期末日だけなので、期首は1年前の期末日の翌日とみなす */
  const lossPeriod = (end: string, [g, from, to]: [string, string, string]) =>
    group(g, etaxDate(from, dayAfter(yearBefore(end))), etaxDate(to, end));
  // 一番古い年度の行（明細1）は翌期繰越額の欄が無い。10年度分あるときだけ使う
  const first = lossRows.length === 10 ? lossRows[0] : null;
  const rest = first ? lossRows.slice(1) : lossRows;
  const hob710 = [
    header("MCA"),
    group(
      "MCB00000",
      amount("MCB00002", v("beppyo7", "1")),
      group("MCB00004", kubun("MCB00007", ret.isSme ? 5 : 1), amount("MCB00008", v("beppyo7", "2"))),
      first
        ? group("MCB00010", lossPeriod(first.name ?? "", ["MCB00020", "MCB00030", "MCB00040"]), group("MCB00050", kubun("MCB00060", 1)), amount("MCB00090", first.values[0]), amount("MCB00100", first.values[1]))
        : null,
      ...rest.map((r) =>
        group(
          "MCB00110",
          lossPeriod(r.name ?? "", ["MCB00120", "MCB00130", "MCB00140"]),
          group("MCB00150", kubun("MCB00160", 1)),
          amount("MCB00190", r.values[0]),
          amount("MCB00200", r.values[1]),
          amount("MCB00210", r.values[2])
        )
      ),
      total7
        ? group(
            "MCB00220",
            amount("MCB00230", lossRows.reduce((s, r) => s + (r.values[0] ?? 0), 0)),
            amount("MCB00240", lossRows.reduce((s, r) => s + (r.values[1] ?? 0), 0)),
            amount("MCB00250", lossRows.reduce((s, r) => s + (r.values[2] ?? 0), 0))
          )
        : null,
      current
        ? group(
            "MCB00260",
            amount("MCB00270", current.values[0]),
            group("MCB00280", group("MCB00330", amount("MCB00340", current.values[0]), amount("MCB00350", current.values[1]), amount("MCB00360", current.values[2])))
          )
        : null,
      amount("MCB00370", total7?.values[2])
    ),
  ];
  forms.push({ id: "HOB710-1", xml: form("HOB710", "13.0", "HOB710-1", by, hob710.filter(Boolean).join("")) });

  // ===================== 別表十五 =====================
  const b15 = (no: string) => v("beppyo15", no);
  const ent1 = b15("1") ?? 0;
  if (ent1 > 0) {
    const fixed = b15("3");
    const dining = b15("2");
    const hoe200 = [
      header("EGA"),
      amount("EGB00000", ent1),
      amount("EGH00000", dining),
      ret.isSme && fixed !== null ? group("EGC00000", kubun("EGC00017", 1), value("EGC00020", ret.months), amount0("EGC00030", fixed)) : null,
      group("EGD00000", kubun("EGD00005", (fixed ?? 0) >= (dining ?? 0) ? 2 : 1), amount0("EGD00020", b15("4"))),
      amount("EGE00000", b15("5")),
      // 明細: 交際費の科目の額をそのまま交際費等の額とする（控除する費用・接待飲食費の内訳は e-Taxソフトで）
      group("EGF00000", group("EGF00010", amount("EGF00020", ent1), amount("EGF00040", ent1)), group("EGF00100", amount("EGF00110", ent1), amount("EGF00130", ent1))),
    ];
    forms.push({ id: "HOE200-1", xml: form("HOE200", "15.0", "HOE200-1", by, hoe200.filter(Boolean).join("")) });
  }

  // ===================== 別表十六（減価償却） =====================
  const counts = new Map<string, number>();
  for (const f of dep.forms) {
    const n = (counts.get(f.tag) ?? 0) + 1;
    counts.set(f.tag, n);
    forms.push({ id: `${f.tag}-${n}`, xml: form(f.tag, f.version, `${f.tag}-${n}`, by, f.body) });
  }

  // ===================== 適用額明細書 =====================
  if (tekiyou.length) {
    const hoe990 = [
      group(
        "MAA00000",
        group("MAA00010", ref("MAA00020", "JIGYO_NENDO_FROM"), ref("MAA00030", "JIGYO_NENDO_TO")),
        kubun("MAA00040", 1), // 当初提出分
        ref("MAA00060", "ZEIMUSHO"),
        ref("MAA00070", "NOZEISHA_ADR"),
        ref("MAA00080", "NOZEISHA_TEL"),
        group("MAA00090", ref("MAA00100", "NOZEISHA_NM_KN"), ref("MAA00110", "NOZEISHA_NM")),
        ref("MAA00115", "NOZEISHA_BANGO"),
        ref("MAA00120", "SHIHON_KIN"),
        amount("MAA00130", income1),
        group("MAA00140", value("MAA00150", 1), value("MAA00160", 1)),
        ref("MAA00170", "JIGYO_NAIYO")
      ),
      ...tekiyou.map(({ t, amount: a }) =>
        group(
          "MAB00000",
          group("MAB00010", value("MAB00020", t.jo), value("MAB00030", t.eda), value("MAB00040", t.ko), value("MAB00050", t.go)),
          value("MAB00070", t.no),
          amount("MAB00080", a)
        )
      ),
    ];
    forms.push({ id: "HOE990-1", xml: form("HOE990", "7.0", "HOE990-1", by, hoe990.filter(Boolean).join("")) });
    warnings.push("適用額明細書の「業種番号」は入れていません。e-Taxソフトで入力してください。");
  }

  const xml = procedureFile({ namespace: NS, procedureCode: "RHO0012", version: "26.0.0", it, forms });
  return { fileName: `RHO0012_${i.period.start.replaceAll("-", "")}_${i.period.end.replaceAll("-", "")}.xtx`, xml, warnings };
}
