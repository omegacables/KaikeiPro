/**
 * 消費税及び地方消費税の申告書（法人）を e-Tax 用ファイル（.xtx）にする。純粋関数。
 *   一般用: 手続 RSH0020（23.2.0）= 申告書 SHA010（第一表・第二表）＋ 付表1-3 SHB017 ＋ 付表2-3 SHB033
 *   簡易課税用: 手続 RSH0040（23.2.0）= 申告書 SHA020 ＋ 付表4-3 SHB047 ＋ 付表5-3 SHB067
 * 金額は申告書の計算（src/lib/consumption-tax-return.ts）の表から、欄番号で取り出す。
 * 要素名と順番は国税庁「XML構造設計書（消費-申告）」とスキーマ（shohi/*.xsd）のとおり。
 * 2割特例（付表6）はまだ作れない。
 */

import type { ConsumptionTaxReturn, FormTable, Pair } from "@/lib/consumption-tax-return";
import {
  amount,
  buildIT,
  form,
  group,
  kubun,
  page,
  procedureFile,
  refTo,
  value,
  type Filer,
  type X,
} from "@/lib/etax-xml";

const NS = "http://xml.e-tax.nta.go.jp/XSD/shohi";

export type ShohiXmlInput = {
  ret: ConsumptionTaxReturn;
  filer: Filer;
  period: { start: string; end: string };
  /** 基準期間の課税売上高（円） */
  basePeriodSales: number | null;
  /** 作成日（YYYY-MM-DD） */
  today: string;
};

/** 表の欄（欄番号と列）の値 */
function cells(tables: FormTable[]) {
  return (key: string, no: string, col: "a" | "b" | "c" = "c"): number | null => {
    const row = tables.find((t) => t.key === key)?.rows.find((r) => r.no === no);
    const v = row?.[col];
    return v === undefined ? null : v;
  };
}

export function consumptionTaxXml(i: ShohiXmlInput): { fileName: string; xml: string } {
  const { ret } = i;
  if (ret.method === "special_20") throw new Error("2割特例（付表6）の e-Tax 用ファイルはまだ作れません。e-Taxソフトで入力してください。");
  const simplified = ret.method === "simplified";
  const proc = simplified
    ? { code: "RSH0040", name: "消費税及び地方消費税申告(簡易課税・法人)" }
    : { code: "RSH0020", name: "消費税及び地方消費税申告(一般・法人)" };
  const { xml: it, ids } = buildIT(i.filer, {
    procedureCode: proc.code,
    procedureName: proc.name,
    periodFrom: i.period.start,
    periodTo: i.period.end,
    periodKind: "kazei",
    shinkokuKbn: 1, // 確定申告
  });
  const ref = refTo(ids);
  const c = cells(ret.tables);
  const by = { name: i.filer.name, date: i.today };
  /** 税率ごとの3列（6.24%・7.8%・合計） */
  const abc = (codes: [string, string, string], key: string, no: string): X[] => [
    amount(codes[0], c(key, no, "a")),
    amount(codes[1], c(key, no, "b")),
    amount(codes[2], c(key, no, "c")),
  ];
  const f = (no: string) => c("first", no);
  const s = (no: string) => c("second", no);

  // ---- 第一表・第二表の納税者等部（IT部を参照するだけ） ----
  const header1 = (p: string) =>
    group(
      `${p}00000`,
      ref(`${p}00020`, "ZEIMUSHO"),
      ref(`${p}00030`, "NOZEISHA_ADR"),
      ref(`${p}00040`, "NOZEISHA_TEL"),
      group(`${p}00050`, ref(`${p}00060`, "NOZEISHA_NM_KN"), ref(`${p}00070`, "NOZEISHA_NM")),
      ref(`${p}00080`, "NOZEISHA_BANGO"),
      group(`${p}00090`, ref(`${p}00100`, "DAIHYO_NM_KN"), ref(`${p}00110`, "DAIHYO_NM")),
      group(`${p}00120`, ref(`${p}00130`, "KAZEI_KIKAN_FROM"), ref(`${p}00140`, "KAZEI_KIKAN_TO")),
      ref(`${p}00150`, "SHINKOKU_KBN")
    );
  const header2 = (p: string) =>
    group(
      `${p}00000`,
      ref(`${p}00010`, "NOZEISHA_ADR"),
      ref(`${p}00020`, "NOZEISHA_TEL"),
      group(`${p}00030`, ref(`${p}00040`, "NOZEISHA_NM_KN"), ref(`${p}00050`, "NOZEISHA_NM")),
      group(`${p}00060`, ref(`${p}00070`, "DAIHYO_NM_KN"), ref(`${p}00080`, "DAIHYO_NM")),
      group(`${p}00090`, ref(`${p}00100`, "KAZEI_KIKAN_FROM"), ref(`${p}00110`, "KAZEI_KIKAN_TO")),
      ref(`${p}00120`, "SHINKOKU_KBN")
    );
  /** 付表の納税者等部 */
  const fuhyoHeader = (p: string) =>
    group(
      `${p}00000`,
      group(`${p}00010`, ref(`${p}00020`, "KAZEI_KIKAN_FROM"), ref(`${p}00030`, "KAZEI_KIKAN_TO")),
      ref(`${p}00040`, "NOZEISHA_NM")
    );
  /** 第一表の税額の計算（一般 AAJ/AAK、簡易 ABI/ABJ。項目の並びは同じ） */
  const taxCalc = (n: string, l: string, tail: X[]) => [
    group(
      `${n}00000`,
      amount(`${n}00010`, f("①")),
      amount(`${n}00020`, f("②")),
      amount(`${n}00030`, f("③")),
      group(`${n}00040`, amount(`${n}00050`, f("④")), amount(`${n}00060`, f("⑤")), amount(`${n}00070`, f("⑥")), amount(`${n}00080`, f("⑦"))),
      amount(`${n}00090`, f("⑧")),
      amount(`${n}00100`, f("⑨")),
      amount(`${n}00110`, f("⑩")),
      amount(`${n}00120`, f("⑪")),
      amount(`${n}00130`, f("⑫")),
      ...tail
    ),
    group(
      `${l}00000`,
      group(`${l}00010`, amount(`${l}00020`, f("⑰")), amount(`${l}00030`, f("⑱"))),
      group(`${l}00040`, amount(`${l}00050`, f("⑲")), amount(`${l}00060`, f("⑳"))),
      amount(`${l}00070`, f("㉑")),
      amount(`${l}00080`, f("㉒")),
      amount(`${l}00090`, f("㉓")),
      amount(`${l}00130`, f("㉖")) // 還付ならマイナス
    ),
  ];
  /** 付記事項（割賦基準・延払基準等・工事進行基準・現金主義会計の適用）: いずれも「無」 */
  const notes = (p: string) => group(`${p}00000`, kubun(`${p}00010`, 2), kubun(`${p}00020`, 2), kubun(`${p}00030`, 2), kubun(`${p}00040`, 2));
  /** 第二表の税率別の内訳（一般と簡易で頭文字が1つずれる） */
  const second = (h: string, base: string, sales: string, tax: string, taxDetail: string, ret17: string, local: string) => [
    header2(h),
    amount(base, s("①")),
    group(sales, amount(`${sales.slice(0, 3)}00040`, s("⑤")), amount(`${sales.slice(0, 3)}00050`, s("⑥")), amount(`${sales.slice(0, 3)}00060`, s("⑦"))),
    amount(tax, s("⑪")),
    group(taxDetail, amount(`${taxDetail.slice(0, 3)}00040`, s("⑮")), amount(`${taxDetail.slice(0, 3)}00050`, s("⑯"))),
    amount(ret17, s("⑰")),
    group(local, amount(`${local.slice(0, 3)}00010`, s("⑳")), amount(`${local.slice(0, 3)}00040`, s("㉓"))), // 還付ならマイナス
  ];

  const forms: { id: string; xml: string }[] = [];

  if (!simplified) {
    const methodCode = ret.deductionMethod === "individual" ? 1 : ret.deductionMethod === "proportional" ? 2 : 3;
    const page1 = page(
      "SHA010-1",
      header1("AAI"),
      ...taxCalc("AAJ", "AAK", [group("AAJ00170", amount("AAJ00180", f("⑮")), amount("AAJ00190", f("⑯")))]),
      notes("AAL"),
      group(
        "AAM00000",
        kubun("AAM00010", 2), // 課税標準額に対する消費税額の計算の特例の適用: 無
        kubun("AAM00020", methodCode), // 控除税額の計算方法
        amount("AAM00030", i.basePeriodSales === null ? null : Math.floor(i.basePeriodSales / 1000)) // 千円
      )
    );
    const page2 = page("SHA010-2", ...second("AAN", "AAP00000", "AAQ00000", "AAS00000", "AAT00000", "AAU00000", "AAW00000"));
    forms.push({ id: "SHA010-1", xml: form("SHA010", "10.0", "SHA010-1", by, [page1, page2].filter(Boolean).join("")) });

    // 付表1-3
    const k1 = "fuhyo1-3";
    const fuhyo13 = [
      fuhyoHeader("DSA"),
      group("DSB00000", ...abc(["DSB00010", "DSB00020", "DSB00030"], k1, "①")),
      group("DSC00000", group("DSC00010", ...abc(["DSC00020", "DSC00030", "DSC00040"], k1, "①-1"))),
      group("DSD00000", ...abc(["DSD00010", "DSD00020", "DSD00030"], k1, "②")),
      group("DSE00000", ...abc(["DSE00010", "DSE00020", "DSE00030"], k1, "③")),
      group(
        "DSF00000",
        group("DSF00010", ...abc(["DSF00020", "DSF00030", "DSF00040"], k1, "④")),
        group("DSF00050", ...abc(["DSF00060", "DSF00070", "DSF00080"], k1, "⑤")),
        group("DSF00170", ...abc(["DSF00180", "DSF00190", "DSF00200"], k1, "⑥")),
        group("DSF00210", ...abc(["DSF00220", "DSF00230", "DSF00240"], k1, "⑦"))
      ),
      amount("DSG00000", c(k1, "⑧")),
      amount("DSH00000", c(k1, "⑨")),
      group("DSI00000", amount("DSI00010", c(k1, "⑩")), amount("DSI00020", c(k1, "⑪"))),
      group("DSJ00000", amount("DSJ00010", c(k1, "⑫")), amount("DSJ00020", c(k1, "⑬"))),
    ];
    forms.push({ id: "SHB017-1", xml: form("SHB017", "2.0", "SHB017-1", by, fuhyo13.filter(Boolean).join("")) });

    // 付表2-3
    const k2 = "fuhyo2-3";
    const ratio = ret.taxableSalesRatio === null ? null : Math.floor(ret.taxableSalesRatio * 10000) / 100;
    const fuhyo23 = [
      fuhyoHeader("DTA"),
      group(
        "DTB00000",
        group("DTB00010", ...abc(["DTB00020", "DTB00030", "DTB00040"], k2, "①")),
        amount("DTB00050", c(k2, "②")),
        amount("DTB00060", c(k2, "③")),
        amount("DTB00070", c(k2, "④"))
      ),
      group("DTC00000", amount("DTC00010", c(k2, "⑤")), amount("DTC00020", c(k2, "⑥")), amount("DTC00030", c(k2, "⑦"))),
      ratio === null ? null : value("DTD00000", ratio),
      group(
        "DTE00000",
        group("DTE00010", ...abc(["DTE00020", "DTE00030", "DTE00040"], k2, "⑨")),
        group("DTE00050", ...abc(["DTE00060", "DTE00070", "DTE00080"], k2, "⑩")),
        group("DTE00270", ...abc(["DTE00280", "DTE00290", "DTE00300"], k2, "⑪")),
        group("DTE00310", ...abc(["DTE00320", "DTE00330", "DTE00340"], k2, "⑫")),
        group("DTE00090", amount("DTE00100", c(k2, "⑬", "b")), amount("DTE00110", c(k2, "⑬"))),
        group("DTE00120", amount("DTE00130", c(k2, "⑭", "b")), amount("DTE00140", c(k2, "⑭"))),
        group("DTE00150", ...abc(["DTE00160", "DTE00170", "DTE00180"], k2, "⑮")),
        group("DTE00190", ...abc(["DTE00200", "DTE00210", "DTE00220"], k2, "⑯")),
        group("DTE00230", ...abc(["DTE00240", "DTE00250", "DTE00260"], k2, "⑰"))
      ),
      group("DTF00000", ...abc(["DTF00010", "DTF00020", "DTF00030"], k2, "⑱")),
      group(
        "DTG00000",
        group(
          "DTG00010",
          group("DTG00020", ...abc(["DTG00030", "DTG00040", "DTG00050"], k2, "⑲")),
          group("DTG00060", ...abc(["DTG00070", "DTG00080", "DTG00090"], k2, "⑳")),
          group("DTG00100", ...abc(["DTG00110", "DTG00120", "DTG00130"], k2, "㉑"))
        ),
        group("DTG00140", ...abc(["DTG00150", "DTG00160", "DTG00170"], k2, "㉒"))
      ),
      group(
        "DTI00000",
        group("DTI00010", ...abc(["DTI00020", "DTI00030", "DTI00040"], k2, "㉖")),
        group("DTI00050", ...abc(["DTI00060", "DTI00070", "DTI00080"], k2, "㉗"))
      ),
      group("DTJ00000", ...abc(["DTJ00010", "DTJ00020", "DTJ00030"], k2, "㉘")),
    ];
    forms.push({ id: "SHB033-1", xml: form("SHB033", "2.0", "SHB033-1", by, fuhyo23.filter(Boolean).join("")) });
  } else {
    const sd = ret.simplified;
    // 参考事項の事業区分（課税売上高は千円単位・売上割合は%）
    const typeRef = (t: number) => {
      const d = sd?.types.find((x) => x.type === t);
      if (!d) return null;
      const g = 30 * t; // 第1種 ABL00030（課税売上高 ABL00040・売上割合 ABL00050）、第2種 ABL00060 …
      const code = (n: number) => `ABL${String(n).padStart(5, "0")}`;
      return group(code(g), amount(code(g + 10), Math.round((d.sales.A + d.sales.B) / 1000)), value(code(g + 20), sd!.types.length > 1 ? d.sharePct : 100));
    };
    const page1 = page(
      "SHA020-1",
      header1("ABH"),
      ...taxCalc("ABI", "ABJ", [amount("ABI00170", f("⑮")), amount("ABI00180", i.basePeriodSales)]),
      notes("ABK"),
      group("ABL00000", kubun("ABL00010", 2), group("ABL00020", ...[1, 2, 3, 4, 5, 6].map(typeRef)))
    );
    const page2 = page("SHA020-2", ...second("ABM", "ABO00000", "ABP00000", "ABR00000", "ABS00000", "ABT00000", "ABV00000"));
    forms.push({ id: "SHA020-1", xml: form("SHA020", "9.0", "SHA020-1", by, [page1, page2].filter(Boolean).join("")) });

    // 付表4-3
    const k4 = "fuhyo4-3";
    const fuhyo43 = [
      fuhyoHeader("DUA"),
      group("DUB00000", ...abc(["DUB00010", "DUB00020", "DUB00030"], k4, "①")),
      group("DUC00000", ...abc(["DUC00010", "DUC00020", "DUC00030"], k4, "①-1")),
      group("DUD00000", ...abc(["DUD00010", "DUD00020", "DUD00030"], k4, "②")),
      group("DUE00000", ...abc(["DUE00010", "DUE00020", "DUE00030"], k4, "③")),
      group(
        "DUF00000",
        group("DUF00010", ...abc(["DUF00020", "DUF00030", "DUF00040"], k4, "④")),
        group("DUF00050", ...abc(["DUF00060", "DUF00070", "DUF00080"], k4, "⑤")),
        group("DUF00090", ...abc(["DUF00100", "DUF00110", "DUF00120"], k4, "⑥")),
        group("DUF00130", ...abc(["DUF00140", "DUF00150", "DUF00160"], k4, "⑦"))
      ),
      amount("DUG00000", c(k4, "⑧")),
      amount("DUH00000", c(k4, "⑨")),
      group("DUI00000", amount("DUI00010", c(k4, "⑩")), amount("DUI00020", c(k4, "⑪"))),
      group("DUJ00000", amount("DUJ00010", c(k4, "⑫")), amount("DUJ00020", c(k4, "⑬"))),
    ];
    forms.push({ id: "SHB047-1", xml: form("SHB047", "1.0", "SHB047-1", by, fuhyo43.filter(Boolean).join("")) });

    // 付表5-3
    if (sd) forms.push({ id: "SHB067-1", xml: form("SHB067", "1.0", "SHB067-1", by, fuhyo53(sd, ref)) });
  }

  const xml = procedureFile({ namespace: NS, procedureCode: proc.code, version: "23.2.0", it, forms });
  return { fileName: `${proc.code}_${i.period.start.replaceAll("-", "")}_${i.period.end.replaceAll("-", "")}.xtx`, xml };
}

/** 要素名: 3文字の頭文字＋5桁の番号 */
function code(prefix: string, n: number) {
  return `${prefix}${String(n).padStart(5, "0")}`;
}
/** 6.24%・7.8%・合計の3要素 */
function abcPair(codes: [string, string, string], p: Pair): X[] {
  return [amount(codes[0], p.A), amount(codes[1], p.B), amount(codes[2], p.A + p.B)];
}

/** 2種類の事業で75%以上のときの組合せの順番（第1種・第2種 → 第5種・第6種） */
const PAIRS: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) PAIRS.push([a, b]);

/** 付表5-3（一面: ①〜⑲、二面: ⑳〜㊲） */
function fuhyo53(
  sd: NonNullable<ConsumptionTaxReturn["simplified"]>,
  ref: (tag: string, id: string) => string | null
): string {
  const abc = abcPair;
  const D = (n: number) => code("DVD", n);
  const E = (n: number) => code("DVE", n);
  const tri = (f: (n: number) => string, n: number): [string, string, string] => [f(n), f(n + 10), f(n + 20)];
  const zero: Pair = { A: 0, B: 0 };
  const sum = (ps: Pair[]) => ps.reduce((s, p) => ({ A: s.A + p.A, B: s.B + p.B }), zero);
  const chosen = sd.candidates[sd.chosen];
  const multi = sd.types.length > 1;

  const page1 = [
    group("DVA00000", group("DVA00010", ref("DVA00020", "KAZEI_KIKAN_FROM"), ref("DVA00030", "KAZEI_KIKAN_TO")), ref("DVA00040", "NOZEISHA_NM")),
    group(
      "DVB00000",
      // ① 課税標準額に対する消費税額 ＝ ④（この画面では貸倒回収② と売上対価の返還等③ は 0）
      group("DVB00010", ...abc(["DVB00020", "DVB00030", "DVB00040"], sd.base4)),
      group("DVB00130", ...abc(["DVB00140", "DVB00150", "DVB00160"], sd.base4))
    ),
    !multi && chosen
      ? group("DVC00000", kubun("DVC00010", chosen.types[0]), ...abc(["DVC00020", "DVC00030", "DVC00040"], chosen.deduction))
      : null,
    multi
      ? group(
          "DVD00000",
          group(
            "DVD00010",
            group("DVD00020", ...abc(["DVD00030", "DVD00040", "DVD00050"], sum(sd.types.map((t) => t.sales)))),
            ...[1, 2, 3, 4, 5, 6].map((type) => {
              const t = sd.types.find((x) => x.type === type);
              if (!t) return null;
              const g = 60 * type; // 第1種 DVD00060 …
              return group(
                D(g),
                amount(D(g + 10), t.sales.A),
                amount(D(g + 20), t.sales.B),
                group(D(g + 30), amount(D(g + 40), t.sales.A + t.sales.B), value(D(g + 50), t.sharePct))
              );
            })
          ),
          group(
            "DVD00420",
            group("DVD00430", ...abc(["DVD00440", "DVD00450", "DVD00460"], sd.totalTax)),
            ...[1, 2, 3, 4, 5, 6].map((type) => {
              const t = sd.types.find((x) => x.type === type);
              return t ? group(D(470 + 40 * (type - 1)), ...abc(tri(D, 480 + 40 * (type - 1)), t.tax)) : null;
            })
          )
        )
      : null,
  ];
  const page2 = multi
    ? [
        group(
          "DVE00000",
          ...sd.candidates
            .filter((x) => x.kind === "principle")
            .map((x) => group("DVE00010", ...abc(["DVE00020", "DVE00030", "DVE00040"], x.deduction))),
          group(
            "DVE00050",
            ...sd.candidates
              .filter((x) => x.kind === "one75")
              .map((x) => group("DVE00060", kubun("DVE00070", x.types[0]), ...abc(["DVE00080", "DVE00090", "DVE00100"], x.deduction))),
            group(
              "DVE00110",
              ...PAIRS.map(([a, b], k) => {
                const x = sd.candidates.find((y) => y.kind === "two75" && Math.min(...y.types) === a && Math.max(...y.types) === b);
                return x ? group(E(120 + 40 * k), ...abc(tri(E, 130 + 40 * k), x.deduction)) : null;
              })
            )
          ),
          chosen ? group("DVE00720", ...abc(["DVE00730", "DVE00740", "DVE00750"], chosen.deduction)) : null
        ),
      ]
    : [];
  return [page("SHB067-1", ...page1), page("SHB067-2", ...page2)].filter(Boolean).join("");
}
