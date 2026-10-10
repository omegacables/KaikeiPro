/**
 * 財務諸表（貸借対照表・損益計算書・株主資本等変動計算書・個別注記表）の e-Tax 用 CSV（HOT010 Ver.3.0、勘定科目コード表 2019年版・一般商工業）。純粋関数。
 *
 *   - 1ファイル1種類: HOT010_3.0_BS.csv / _PL / _SS / _NT。全行5列、見出し行なし、Shift_JIS（src/lib/sjis.ts）
 *   - 先頭5行: A,種類 / B,法人名 / C1,期首日 / C2,期末日 / 財務諸表名
 *   - 6行目以降: 勘定科目名,金額（注記表は文）,行区分(1=金額 / 2=文 / T=タイトル),階層番号,勘定科目コード
 *   - 階層番号は1行上より大きくするとき +1 まで。e-Tax は合計を計算しないので、合計の行も自分で書く
 *   - コード表に無い科目は、その区分のタイトルのコードに枝番（-1, -2, …）を付ける。同じコードは1回しか使えない
 *   - 控除科目（貸倒引当金・減価償却累計額など）と損失はマイナス（半角「-」）。様式の決まり
 */

import { zen } from "@/lib/etax-breakdown-csv";
import type { EquityChanges, EquityColumn, EquityKind } from "@/lib/equity-changes";
import type { NoteSection } from "@/lib/financial-notes";

export type FsLine = { name: string; amount: number };
export type FsGroup = { title: string; lines: FsLine[]; total: number; subgroups?: FsGroup[] };

export type FsInput = {
  companyName: string;
  period: { start: string; end: string };
  bs: {
    assetGroups: FsGroup[];
    liabilityGroups: FsGroup[];
    equityGroups: FsGroup[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  pl: {
    sales: FsLine[];
    cogs: FsLine[];
    sga: FsLine[];
    nonOpRev: FsLine[];
    nonOpExp: FsLine[];
    extraGain: FsLine[];
    extraLoss: FsLine[];
    tax: FsLine[];
    salesT: number;
    cogsT: number;
    grossProfit: number;
    sgaT: number;
    operatingProfit: number;
    nonOpRevT: number;
    nonOpExpT: number;
    ordinaryProfit: number;
    extraGainT: number;
    extraLossT: number;
    pretaxProfit: number;
    taxT: number;
    netIncome: number;
  };
};

/** 科目名 → コード（一般商工業）。名前は前から順に試す */
const CODE_RULES: [RegExp, string][] = [
  // 流動資産
  [/^受取手形$/, "10A100060"],
  [/^売掛金$/, "10A100090"],
  [/^(棚卸資産|たな卸資産)$/, "10A100270"],
  [/^商品$/, "10A100280"],
  [/^製品$/, "10A100310"],
  [/^貯蔵品$/, "10A100430"],
  [/^前払費用$/, "10A100540"],
  [/^短期貸付金$/, "10A100610"],
  [/^(未収入金|未収金)$/, "10A100670"],
  [/^未収消費税等?$/, "10A100690"],
  [/^立替金$/, "10A100840"],
  [/^仮払金$/, "10A100850"],
  // 有形固定資産
  [/^建物$/, "10A210030"],
  [/^建物附属設備$/, "10A210080"],
  [/^構築物$/, "10A210130"],
  [/^機械(装置|及び装置)$/, "10A210240"],
  [/^車両運搬具$/, "10A210360"],
  [/^(工具器具備品|器具備品|工具、器具及び備品)$/, "10A210410"],
  [/^土地$/, "10A210610"],
  [/^減価償却累計額$/, "10A210920"],
  // 無形固定資産
  [/^ソフトウ[ェエ]ア$/, "10A220110"],
  // 投資その他の資産
  [/^投資有価証券$/, "10A230030"],
  [/^出資金$/, "10A230090"],
  [/^長期貸付金$/, "10A230140"],
  [/^長期前払費用$/, "10A230330"],
  [/^差入保証金$/, "10A230630"],
  [/^敷金$/, "10A230650"],
  // 繰延資産
  [/^創立費$/, "10A300020"],
  [/^開業費$/, "10A300030"],
  [/^開発費$/, "10A300060"],
  // 流動負債
  [/^支払手形$/, "10B100030"],
  [/^買掛金$/, "10B100040"],
  [/^未払費用$/, "10B100160"],
  [/^前受金$/, "10B100170"],
  [/^未払金$/, "10B100630"],
  [/^未払法人税等$/, "10B100640"],
  [/^未払消費税等?$/, "10B100660"],
  [/^預り金$/, "10B100690"],
  [/^短期借入金$/, "10B100790"],
  [/^仮受金$/, "10B100880"],
  [/^仮受消費税等?$/, "10B100890"],
  // 固定負債
  [/^長期借入金$/, "10B200080"],
  // 純資産
  [/^自己株式$/, "10C100020"],
  [/^資本金$/, "10C110010"],
  [/^資本準備金$/, "10C120020"],
  [/^利益準備金$/, "10C130020"],
  [/^繰越利益剰余金$/, "10C130370"],
  // 売上原価
  [/^期首商品棚卸高$/, "10E100100"],
  [/^(仕入高|当期商品仕入高)$/, "10E100130"],
  [/^期末商品棚卸高$/, "10E100140"],
  // 販売費及び一般管理費
  [/^広告宣伝費$/, "10E200050"],
  [/^役員報酬$/, "10E200090"],
  [/^賞与$/, "10E200130"],
  [/^福利厚生費$/, "10E200140"],
  [/^(接待交際費|交際費)$/, "10E200150"],
  [/^通信費$/, "10E200180"],
  [/^消耗品費$/, "10E200200"],
  [/^租税公課$/, "10E200210"],
  [/^減価償却費$/, "10E200220"],
  [/^修繕費$/, "10E200230"],
  [/^保険料$/, "10E200240"],
  [/^貸倒引当金繰入額$/, "10E200260"],
  [/^貸倒損失$/, "10E200270"],
  [/^給料(手当|及び手当)$/, "10E200370"],
  [/^法定福利費$/, "10E200540"],
  [/^外注費$/, "10E200660"],
  [/^支払手数料$/, "10E200690"],
  [/^地代家賃$/, "10E200720"],
  [/^水道光熱費$/, "10E201040"],
  [/^会議費$/, "10E201130"],
  [/^(新聞図書費|図書費)$/, "10E201160"],
  [/^旅費(交通費|及び交通費)$/, "10E201230"],
  [/^雑費$/, "10E201270"],
  // 営業外収益・費用
  [/^受取利息$/, "10D200020"],
  [/^受取配当金$/, "10D200040"],
  [/^雑収入$/, "10D200720"],
  [/^支払利息$/, "10E300020"],
  [/^雑損失$/, "10E300890"],
  // 特別利益・損失
  [/^固定資産売却益$/, "10D300080"],
  [/^固定資産売却損$/, "10E400080"],
  [/^固定資産除却損$/, "10E400110"],
  // 法人税等
  [/^法人税、?住民税及び事業税$/, "10F100070"],
  [/^法人税等調整額$/, "10F100090"],
];

/** 貸倒引当金は区分ごとにコードが違う（流動資産の一括表示 / 投資その他の資産の一括表示） */
const ALLOWANCE = /^貸倒引当金$/;

type Row = [string, string, string, string, string];

/** 行を積み、同じコードは2回使わない（2回目以降はタイトルに枝番） */
class Builder {
  rows: Row[] = [];
  private used = new Set<string>();
  private branch = new Map<string, number>();
  title(name: string, level: number, code: string) {
    this.used.add(code);
    this.rows.push([zen(name, 60), "", "T", String(level), code]);
  }
  amount(name: string, amount: number, level: number, code: string) {
    this.used.add(code);
    this.rows.push([zen(name, 60), String(Math.round(amount)), "1", String(level), code]);
  }
  /** 科目: 対応するコードがあればそれを、無ければ（または使用済みなら）タイトルに枝番 */
  line(l: FsLine, level: number, parentCode: string, fixedCode?: string) {
    const code = fixedCode ?? CODE_RULES.find(([re]) => re.test(l.name))?.[1];
    if (code && !this.used.has(code)) return this.amount(l.name, l.amount, level, code);
    const n = (this.branch.get(parentCode) ?? 0) + 1;
    this.branch.set(parentCode, n);
    this.amount(l.name, l.amount, level, `${parentCode}-${n}`);
  }
}

export type EtaxFinancialKind = "BS" | "PL" | "SS" | "NT";

const headerOf = (kind: EtaxFinancialKind, companyName: string, period: { start: string; end: string }, title: string): Row[] => [
  ["A", kind, "", "", ""],
  ["B", zen(companyName, 50), "", "", ""],
  ["C1", period.start, "", "", ""],
  ["C2", period.end, "", "", ""],
  [title, "", "", "", ""],
];

const group = (gs: FsGroup[], title: string) => gs.find((g) => g.title === title);

/** 貸借対照表 HOT010_3.0_BS.csv */
export function balanceSheetCsv(i: FsInput): { fileName: string; rows: string[][] } {
  const b = new Builder();
  b.title("資産の部", 2, "10A000010");
  const current = group(i.bs.assetGroups, "流動資産");
  if (current) {
    b.title("流動資産", 3, "10A100010");
    for (const l of current.lines) b.line(l, 4, "10A100010", ALLOWANCE.test(l.name) ? "10A101050" : undefined);
    b.amount("流動資産合計", current.total, 4, "10A101160");
  }
  const fixed = group(i.bs.assetGroups, "固定資産");
  if (fixed) {
    b.title("固定資産", 3, "10A200010");
    const subs: [string, string, string][] = [
      ["有形固定資産", "10A210010", "10A210950"],
      ["無形固定資産", "10A220010", "10A220330"],
      ["投資その他の資産", "10A230010", "10A230880"],
    ];
    for (const [title, tCode, totalCode] of subs) {
      const g = group(fixed.subgroups ?? [], title);
      if (!g) continue;
      b.title(title, 4, tCode);
      for (const l of g.lines)
        b.line(l, 5, tCode, ALLOWANCE.test(l.name) && title === "投資その他の資産" ? "10A230820" : undefined);
      b.amount(`${title}合計`, g.total, 5, totalCode);
    }
    b.amount("固定資産合計", fixed.total, 4, "10A200020");
  }
  const deferred = group(i.bs.assetGroups, "繰延資産");
  if (deferred) {
    b.title("繰延資産", 3, "10A300010");
    for (const l of deferred.lines) b.line(l, 4, "10A300010");
    b.amount("繰延資産合計", deferred.total, 4, "10A300080");
  }
  b.amount("資産合計", i.bs.totalAssets, 3, "10A000020");

  b.title("負債の部", 2, "10B000010");
  const liabs: [string, string, string][] = [
    ["流動負債", "10B100010", "10B101070"],
    ["固定負債", "10B200010", "10B200670"],
  ];
  for (const [title, tCode, totalCode] of liabs) {
    const g = group(i.bs.liabilityGroups, title);
    if (!g) continue;
    b.title(title, 3, tCode);
    for (const l of g.lines) b.line(l, 4, tCode);
    b.amount(`${title}合計`, g.total, 4, totalCode);
  }
  b.amount("負債合計", i.bs.totalLiabilities, 3, "10B000020");

  b.title("純資産の部", 2, "10C000010");
  b.title("株主資本", 3, "10C100010");
  for (const g of i.bs.equityGroups) for (const l of g.lines) b.line(l, 4, "10C100010");
  b.amount("株主資本合計", i.bs.totalEquity, 4, "10C100040");
  b.amount("純資産合計", i.bs.totalEquity, 3, "10C000030");
  b.amount("負債純資産合計", i.bs.totalLiabilities + i.bs.totalEquity, 2, "10C000040");

  return { fileName: "HOT010_3.0_BS.csv", rows: [...headerOf("BS", i.companyName, i.period, "貸借対照表"), ...b.rows] };
}

/** 損益計算書 HOT010_3.0_PL.csv */
export function incomeStatementCsv(i: FsInput): { fileName: string; rows: string[][] } {
  const p = i.pl;
  const b = new Builder();
  const section = (title: string, tCode: string, lines: FsLine[], totalName: string, total: number, totalCode: string) => {
    if (lines.length === 0) return;
    b.title(title, 2, tCode);
    for (const l of lines) b.line(l, 3, tCode);
    b.amount(totalName, total, 3, totalCode);
  };
  section("売上高", "10D100020", p.sales, "売上高合計", p.salesT, "10D100030");
  section("売上原価", "10E100020", p.cogs, "売上原価合計", p.cogsT, "10E100030");
  b.amount(p.grossProfit < 0 ? "売上総損失" : "売上総利益", p.grossProfit, 2, "10F000010");
  section("販売費及び一般管理費", "10E200010", p.sga, "販売費及び一般管理費合計", p.sgaT, "10E201330");
  b.amount(p.operatingProfit < 0 ? "営業損失" : "営業利益", p.operatingProfit, 2, "10F000110");
  section("営業外収益", "10D200010", p.nonOpRev, "営業外収益合計", p.nonOpRevT, "10D200740");
  section("営業外費用", "10E300010", p.nonOpExp, "営業外費用合計", p.nonOpExpT, "10E300910");
  b.amount(p.ordinaryProfit < 0 ? "経常損失" : "経常利益", p.ordinaryProfit, 2, "10F000130");
  section("特別利益", "10D300010", p.extraGain, "特別利益合計", p.extraGainT, "10D300670");
  section("特別損失", "10E400010", p.extraLoss, "特別損失合計", p.extraLossT, "10E401090");
  b.amount(p.pretaxProfit < 0 ? "税引前当期純損失" : "税引前当期純利益", p.pretaxProfit, 2, "10F000150");
  if (p.tax.length) {
    for (const l of p.tax) b.line(l, 3, "10F100060");
    b.amount("法人税等合計", p.taxT, 2, "10F100060");
  }
  b.amount(p.netIncome < 0 ? "当期純損失" : "当期純利益", p.netIncome, 2, "10F000160");
  return { fileName: "HOT010_3.0_PL.csv", rows: [...headerOf("PL", i.companyName, i.period, "損益計算書"), ...b.rows] };
}

/** 階層番号の決まり（1行上より大きくするときは +1 まで・2以上）を満たしているか */
export function checkLevels(rows: string[][]): boolean {
  let prev = 1;
  for (const r of rows.slice(5)) {
    const lv = Number(r[3]);
    if (!(lv >= 2) || lv > prev + 1) return false;
    prev = lv;
  }
  return true;
}


// ---------------------------------------------------------------------------
// 株主資本等変動計算書 HOT010_3.0_SS.csv
//   項目ごとに「タイトル → 当期首残高 → 当期変動額（T）→ 変動事由 → 当期変動額合計 → 当期末残高」を縦に並べる。
//   当期純利益以外の変動（配当・積立など）は、当期変動額のコードに枝番を付けて「その他の変動額」として書く
// ---------------------------------------------------------------------------

type SsValues = Pick<EquityColumn, "opening" | "netIncome" | "other" | "change" | "closing">;
type SsCodes = { title: string; open: string; chg: string; ni?: string; other: string; total: string; close: string };

/** コード表にある項目（SS02 → SS0200, SS0201, SS0202, SS02xx, SS0298, SS0299） */
const ssCodes = (p: string, ni?: boolean): SsCodes => ({
  title: `${p}00`,
  open: `${p}01`,
  chg: `${p}02`,
  ni: ni ? `${p}06` : undefined,
  other: `${p}02-1`,
  total: `${p}98`,
  close: `${p}99`,
});
/** コード表に無い項目（標準フォームの「追加内訳項目」と同じ枝番の付け方: SS0900-1, SS0900-1-1, …） */
const ssBranchCodes = (b: string): SsCodes => ({
  title: b,
  open: `${b}-1`,
  chg: `${b}-2`,
  ni: `${b}-2-4`,
  other: `${b}-2-15`,
  total: `${b}-2-18`,
  close: `${b}-2-19`,
});

export function changesInEquityCsv(i: {
  companyName: string;
  period: { start: string; end: string };
  ce: EquityChanges;
}): { fileName: string; rows: string[][] } {
  const rows: Row[] = [];
  const t = (name: string, level: number, code: string) => rows.push([zen(name, 60), "", "T", String(level), code]);
  const a = (name: string, v: number, level: number, code: string) =>
    rows.push([zen(name, 60), String(Math.round(v)), "1", String(level), code]);
  const item = (name: string, level: number, c: SsCodes, v: SsValues) => {
    t(name, level, c.title);
    a("当期首残高", v.opening, level + 1, c.open);
    t("当期変動額", level + 1, c.chg);
    if (c.ni && v.netIncome !== 0) a(v.netIncome < 0 ? "当期純損失" : "当期純利益", v.netIncome, level + 2, c.ni);
    if (v.other !== 0) a("その他の変動額", v.other, level + 2, c.other);
    a("当期変動額合計", v.change, level + 2, c.total);
    a("当期末残高", v.closing, level + 1, c.close);
  };
  const cols = i.ce.columns;
  const of = (...kinds: EquityKind[]) => cols.filter((c) => kinds.includes(c.kind));
  const sum = (cs: EquityColumn[]): SsValues => ({
    opening: cs.reduce((s, c) => s + c.opening, 0),
    netIncome: cs.reduce((s, c) => s + c.netIncome, 0),
    other: cs.reduce((s, c) => s + c.other, 0),
    change: cs.reduce((s, c) => s + c.change, 0),
    closing: cs.reduce((s, c) => s + c.closing, 0),
  });

  t("株主資本", 2, "SS0100");
  for (const c of of("capital")) item(c.label, 3, ssCodes("SS02"), c);
  const surplus = of("capital_reserve", "other_capital_surplus");
  if (surplus.length) {
    t("資本剰余金", 3, "SS0300");
    for (const c of of("capital_reserve")) item(c.label, 4, ssCodes("SS04"), c);
    for (const c of of("other_capital_surplus")) item(c.label, 4, ssCodes("SS05"), c);
    item("資本剰余金合計", 4, ssCodes("SS06"), sum(surplus));
  }
  const retainedAll = of("legal_reserve", "voluntary_reserve", "retained");
  t("利益剰余金", 3, "SS0700");
  for (const c of of("legal_reserve")) item(c.label, 4, ssCodes("SS08"), c);
  const otherRetained = of("voluntary_reserve", "retained");
  item("その他利益剰余金", 4, ssCodes("SS09", true), sum(otherRetained));
  of("voluntary_reserve").forEach((c, n) => item(c.label, 5, ssBranchCodes(`SS0900-${n + 1}`), c));
  for (const c of of("retained")) item(c.label, 5, ssCodes("SS20", true), c);
  item("利益剰余金合計", 4, ssCodes("SS21", true), sum(retainedAll));
  for (const c of of("treasury")) item(c.label, 3, ssCodes("SS22"), c);
  of("other").forEach((c, n) => item(c.label, 3, ssBranchCodes(`SS0100-${n + 1}`), c));
  item("株主資本合計", 3, ssCodes("SS23", true), i.ce.total);
  item("純資産合計", 2, ssCodes("SS31", true), i.ce.total);

  return { fileName: "HOT010_3.0_SS.csv", rows: [...headerOf("SS", i.companyName, i.period, "株主資本等変動計算書"), ...rows] };
}

// ---------------------------------------------------------------------------
// 個別注記表 HOT010_3.0_NT.csv（行区分 2 = 文字。内容は2列目）
// ---------------------------------------------------------------------------

/** 注記の文: 改行は使わず、カンマは全角に */
const noteText = (s: string) => s.replace(/[\r\n\t]+/g, "　").replace(/,/g, "，").trim();

export function notesCsv(i: {
  companyName: string;
  period: { start: string; end: string };
  notes: NoteSection[];
}): { fileName: string; rows: string[][] } {
  const rows: Row[] = [];
  const text = (name: string, content: string, level: number, code: string) =>
    rows.push([zen(name, 60), noteText(content), "2", String(level), code]);
  for (const sec of i.notes) {
    if (sec.key === "policies") {
      text(sec.heading, "", 2, "NT0201");
      const dep = sec.items.find((x) => x.key === "depreciation");
      if (dep) text(dep.title, dep.text, 3, "NT0205");
      // 消費税等の会計処理は「その他計算書類の作成のための基本となる重要な事項」の「その他」（項目名・内容）に書く
      const others = sec.items.filter((x) => x.key !== "depreciation");
      if (others.length) {
        text("その他計算書類の作成のための基本となる重要な事項", "", 3, "NT0208");
        for (const o of others) {
          rows.push([zen("その他", 60), "", "T", "4", "NT0210"]);
          text("項目名", o.title, 5, "NT0211");
          text("内容", o.text, 5, "NT0212");
        }
      }
    } else if (sec.key === "equity_changes") {
      text(sec.heading, "", 2, "NT0501");
      const ts = sec.items.find((x) => x.key === "treasury_stock");
      text("自己株式の種類及び株式数に関する事項", ts ? ts.text : sec.none ?? "", 3, "NT0522");
    } else if (sec.items.length) {
      for (const o of sec.items) {
        rows.push([zen(sec.heading, 60), "", "T", "2", "NT1201"]);
        text("項目名", o.title, 3, "NT1202");
        text("内容", o.text, 3, "NT1203");
      }
    }
  }
  return { fileName: "HOT010_3.0_NT.csv", rows: [...headerOf("NT", i.companyName, i.period, "個別注記表"), ...rows] };
}
