/**
 * 勘定科目内訳明細書の e-Tax 用 CSV（国税庁の標準フォーム「令和6年3月1日以後終了事業年度分」の
 * 記載要領どおりの列）。純粋関数。Shift_JIS への変換は src/lib/sjis.ts（サーバー）。
 *
 * 共通の決まり
 *   - ファイル名は「様式ID_バージョン.csv」。見出し行は付けない。1行1件、項目数はちょうど既定の数
 *   - 全角の項目: 半角の英数字・記号・カナを全角にし、半角カンマは全角「，」にする。文字数で切り詰める
 *   - 金額: 半角の整数（円）、桁区切りなし
 *   - 日付: 元号コード（平成=4・令和=5）・年・月・日を別々の項目に
 *   - 登録番号（T を除く13桁）か法人番号（13桁）の、どちらか一方だけを書く
 *   - 合計行（行区分 1）は任意なので出力しない（明細行は行区分 0）
 */

import type { DetailValue } from "@/lib/breakdown-items";

/** 内訳書の1行（アプリのデータから作る） */
export type EtaxItem = {
  account: string;
  name: string;
  address: string;
  /** 登録番号（T＋13桁）または法人番号（13桁） */
  regNo: string;
  relationship: string;
  amount: number;
  note: string;
  d: Record<string, DetailValue>;
};

export type EtaxLoanRow = {
  name: string;
  address: string;
  regNo: string;
  relationship: string;
  balance: number;
  interest: number;
  rate: number | null;
  collateral: string;
};

export type EtaxMiscRow = { account: string; description: string; name: string; address: string; regNo: string; amount: number };

export type EtaxPersonnel = { officer: number; salary: number; wage: number };

// ---------------------------------------------------------------------------
// 項目の整形
// ---------------------------------------------------------------------------

/** 全角の項目: NFKC で揃えてから、半角の英数字・記号・空白を全角にする。改行は空白に */
export function zen(value: string | null | undefined, max: number): string {
  const s = (value ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/ /g, "　")
    .replace(/髙/g, "高")
    .replace(/﨑/g, "崎")
    .trim();
  return [...s].slice(0, max).join("");
}

/** 半角の項目: 英数字・記号だけを残す（カンマは取り除く） */
export function han(value: string | null | undefined, max: number): string {
  const s = (value ?? "").normalize("NFKC").replace(/[^!-~]/g, "").replace(/,/g, "");
  return s.slice(0, max);
}

/** 金額: 半角の整数（円） */
export const amt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(Math.round(n)));

/** 日付 → [元号コード, 年, 月, 日]。令和は 2019-05-01 から、平成はそれより前 */
export function era(iso: unknown): [string, string, string, string] {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ["", "", "", ""];
  const [y, m, d] = iso.split("-").map(Number);
  if (iso >= "2019-05-01") return ["5", String(y - 2018), String(m), String(d)];
  if (iso >= "1989-01-08") return ["4", String(y - 1988), String(m), String(d)];
  return ["", "", "", ""];
}
const eraYm = (iso: unknown): [string, string, string] => {
  const [e, y, m] = era(iso);
  return [e, y, m];
};

/** 明治〜令和の元号（明治1・大正2・昭和3・平成4・令和5）。売却物件・売上商品の取得年月に使う */
const ERAS: { code: string; start: string; base: number }[] = [
  { code: "5", start: "2019-05-01", base: 2018 },
  { code: "4", start: "1989-01-08", base: 1988 },
  { code: "3", start: "1926-12-25", base: 1925 },
  { code: "2", start: "1912-07-30", base: 1911 },
  { code: "1", start: "1868-01-25", base: 1867 },
];
export function eraAll(iso: string): [string, string, string] {
  const e = ERAS.find((x) => iso >= x.start);
  if (!e) return ["", "", ""];
  const [y, m] = iso.split("-").map(Number);
  return [e.code, String(y - e.base), String(m)];
}
/** 日付（YYYY-MM-DD）から 元号・年・月（明治〜令和） */
const eraAllYm = (iso: unknown): [string, string, string] =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? eraAll(iso) : ["", "", ""];
/** 西暦の年から 元号・年（その年の12月31日の元号。1989年は平成元年、2019年は令和元年） */
function eraYear(year: number | null): [string, string] {
  if (year == null || !Number.isInteger(year) || year < 1868) return ["", ""];
  const [e, y] = eraAll(`${year}-12-31`);
  return [e, y];
}
/** 「01 代表取締役」のような選択肢から先頭のコード */
const codeOf = (v: DetailValue | undefined) => (typeof v === "string" ? (v.match(/^(\d+)/)?.[1] ?? "") : "");

/** 登録番号（T を除いた13桁）と法人番号（13桁）。どちらか一方だけ */
export function regOrCorp(value: string | null | undefined): [string, string] {
  const s = (value ?? "").normalize("NFKC").replace(/[\s-]/g, "").toUpperCase();
  if (/^T\d{13}$/.test(s)) return [s.slice(1), ""];
  if (/^\d{13}$/.test(s)) return ["", s];
  return ["", ""];
}

const text = (v: DetailValue | undefined) => (v == null || typeof v === "boolean" ? "" : String(v));
const num = (v: DetailValue | undefined) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));
/** 数量・利率: 整数部と小数部の桁数まで（正の数） */
export function decimal(v: number | null, intDigits: number, fracDigits: number): string {
  if (v == null || !Number.isFinite(v) || v < 0) return "";
  const [i, f = ""] = (Math.round(v * 10 ** fracDigits) / 10 ** fracDigits).toFixed(fracDigits).replace(/\.?0+$/, "").split(".");
  return i.slice(-intDigits) + (f ? `.${f}` : "");
}

// ---------------------------------------------------------------------------
// 様式ごとの行
// ---------------------------------------------------------------------------

export type EtaxFile = { id: string; fileName: string; title: string; rows: string[][] };

const file = (id: string, title: string, rows: string[][]): EtaxFile => ({ id, fileName: `${id}_${title}.csv`, title, rows });

/** ② 受取手形 HOI020_4.0（18項目） */
export function notesReceivable(items: EtaxItem[]): EtaxFile {
  return file("HOI020_4.0", "受取手形の内訳書", items.map((i) => {
    const [reg, corp] = regOrCorp(i.regNo);
    return ["2", "0", reg, corp, zen(i.name, 30), ...era(i.d.issue_date), ...era(i.d.due_date), zen(text(i.d.bank), 11), zen(text(i.d.branch), 11), amt(i.amount), zen(text(i.d.discount_bank), 22), zen(i.note, 50)];
  }));
}

/** ③ 売掛金（未収入金） HOI030_4.0（9項目） */
export function receivables(items: EtaxItem[]): EtaxFile {
  return file("HOI030_4.0", "売掛金（未収入金）の内訳書", items.map((i) => {
    const [reg, corp] = regOrCorp(i.regNo);
    return ["3", "0", zen(i.account, 10), reg, corp, zen(i.name, 30), zen(i.address, 100), amt(i.amount), zen(i.note, 50)];
  }));
}

/** ④ 仮払金（前渡金）4-1 ＋ 貸付金及び受取利息 4-2 HOI040_4.0 */
export function advancesAndLoans(advances: EtaxItem[], loans: EtaxLoanRow[]): EtaxFile {
  return file("HOI040_4.0", "仮払金（前渡金）、貸付金及び受取利息の内訳書", [
    ...advances.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["4-1", "0", zen(i.account, 10), reg, corp, zen(i.name, 30), zen(i.address, 100), zen(i.relationship, 10), amt(i.amount), zen(i.note, 50)];
    }),
    ...loans.map((l) => {
      const [reg, corp] = regOrCorp(l.regNo);
      return ["4-2", "0", reg, corp, zen(l.name, 30), zen(l.address, 100), zen(l.relationship, 10), amt(l.balance), amt(l.interest), decimal(l.rate, 4, 4), zen(l.collateral, 40)];
    }),
  ]);
}

/** ⑥ 有価証券 HOI060_4.0（18項目） */
export function securities(items: EtaxItem[]): EtaxFile {
  return file("HOI060_4.0", "有価証券の内訳書", items.map((i) => [
    "6",
    "0",
    zen(text(i.d.class), 10),
    zen(text(i.d.kind), 10),
    zen(text(i.d.brand), 10),
    decimal(num(i.d.quantity), 12, 3),
    amt(num(i.d.book_before)),
    amt(i.amount),
    ...era(i.d.move_date),
    zen(text(i.d.move_reason), 10),
    decimal(num(i.d.move_quantity), 12, 3),
    amt(num(i.d.move_amount)),
    zen(i.name, 30),
    zen(i.address, 100),
    zen(i.note, 50),
  ]));
}

/** ⑧ 支払手形 HOI080_4.0（17項目） */
export function notesPayable(items: EtaxItem[]): EtaxFile {
  return file("HOI080_4.0", "支払手形の内訳書", items.map((i) => {
    const [reg, corp] = regOrCorp(i.regNo);
    return ["8", "0", reg, corp, zen(i.name, 30), ...era(i.d.issue_date), ...era(i.d.due_date), zen(text(i.d.bank), 11), zen(text(i.d.branch), 11), amt(i.amount), zen(i.note, 50)];
  }));
}

/** ⑨ 買掛金（未払金・未払費用）9-1、未払配当金 9-2、未払役員賞与 9-3 HOI090_5.0 */
export function payables(main: EtaxItem[], dividends: EtaxItem[], bonuses: EtaxItem[]): EtaxFile {
  const fixed = (code: string) => (i: EtaxItem) => [code, "0", ...era(i.d.fixed_date), amt(i.amount)];
  return file("HOI090_5.0", "買掛金（未払金・未払費用）の内訳書", [
    ...main.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["9-1", "0", zen(i.account, 10), reg, corp, zen(i.name, 30), zen(i.address, 100), amt(i.amount), zen(i.note, 50)];
    }),
    ...dividends.map(fixed("9-2")),
    ...bonuses.map(fixed("9-3")),
  ]);
}

/** ⑩ 仮受金（前受金・預り金）10-1（10項目）・源泉所得税預り金 10-2（7項目） HOI100_6.0 */
export function deposits(items: EtaxItem[], withholding: EtaxItem[] = []): EtaxFile {
  return file("HOI100_6.0", "仮受金（前受金・預り金）の内訳書", [
    ...items.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["10-1", "0", zen(i.account, 10), reg, corp, zen(i.name, 30), zen(i.address, 100), zen(i.relationship, 10), amt(i.amount), zen(i.note, 50)];
    }),
    ...withholding.map((i) => ["10-2", "0", ...eraYm(i.d.paid_month), codeOf(i.d.income_kind), amt(i.amount)]),
  ]);
}

/** ⑪ 借入金及び支払利子 HOI110_3.0（9項目。登録番号・摘要の欄は無い） */
export function borrowings(loans: EtaxLoanRow[]): EtaxFile {
  return file("HOI110_3.0", "借入金及び支払利子の内訳書", loans.map((l) => [
    "11",
    "0",
    zen(l.name, 30),
    zen(l.address, 100),
    zen(l.relationship, 10),
    amt(l.balance),
    amt(l.interest),
    decimal(l.rate, 4, 4),
    zen(l.collateral, 20),
  ]));
}

/**
 * ⑭ 役員給与等 14-1（代表者・1行）・14-2（代表者以外）（15項目）と 人件費 14-3（10項目） HOI141_5.0。
 * 代表者は、役職名が代表取締役・代表社員・理事長か、代表者との関係が「本人」の最初の行。
 */
export function personnel(p: EtaxPersonnel | null, officers: EtaxItem[] = []): EtaxFile {
  const isRep = (i: EtaxItem) => ["01", "21", "31"].includes(codeOf(i.d.title)) || codeOf(i.d.relation) === "01";
  const repIndex = officers.findIndex(isRep);
  const ordered = repIndex >= 0 ? [officers[repIndex], ...officers.filter((_, n) => n !== repIndex)] : officers;
  const officerRow = (i: EtaxItem, code: string) => [
    code,
    "0",
    codeOf(i.d.title),
    zen(text(i.d.duty), 10),
    zen(i.name, 30),
    codeOf(i.d.relation),
    zen(i.address, 100),
    codeOf(i.d.fulltime),
    amt(i.amount),
    amt(num(i.d.employee_part)),
    amt(num(i.d.fixed)),
    amt(num(i.d.advance)),
    amt(num(i.d.performance)),
    amt(num(i.d.other)),
    amt(num(i.d.retirement)),
  ];
  return file("HOI141_5.0", "役員給与等の内訳書", [
    ...ordered.map((i, n) => officerRow(i, n === 0 && repIndex >= 0 ? "14-1" : "14-2")),
    ...(p ? [["14-3", "0", amt(p.officer), "", amt(p.salary), "", amt(p.wage), "", amt(p.officer + p.salary + p.wage), ""]] : []),
  ]);
}

/** ① 預貯金等 HOI010_4.0（8項目） */
export function bankDeposits(items: EtaxItem[]): EtaxFile {
  return file("HOI010_4.0", "預貯金等の内訳書", items.map((i) => [
    "1", "0", zen(text(i.d.bank), 11), zen(text(i.d.branch), 11), zen(text(i.d.kind), 10), han(text(i.d.account_no), 14), amt(i.amount), zen(i.note, 30),
  ]));
}

/** ⑤ 棚卸資産 HOI050_4.0（8項目） */
export function inventories(items: EtaxItem[]): EtaxFile {
  return file("HOI050_4.0", "棚卸資産の内訳書", items.map((i) => [
    "5", "0", zen(i.account, 10), zen(text(i.d.item), 20), decimal(num(i.d.quantity), 12, 3), decimal(num(i.d.unit_price), 12, 3), amt(i.amount), zen(i.note, 30),
  ]));
}

/** ⑦ 固定資産（土地・土地の上に存する権利・建物） HOI070_5.0（21項目） */
export function landAndBuildings(items: EtaxItem[]): EtaxFile {
  return file("HOI070_5.0", "固定資産（土地、土地の上に存する権利及び建物に限る。）の内訳書", items.map((i) => {
    const [reg, corp] = regOrCorp(i.regNo);
    return [
      "7", "0", zen(text(i.d.kind), 10), zen(text(i.d.usage), 10), decimal(num(i.d.area), 12, 3), zen(text(i.d.location), 100), amt(i.amount),
      ...era(i.d.move_date), zen(text(i.d.move_reason), 10), amt(num(i.d.move_price)), amt(num(i.d.book_before)),
      reg, corp, zen(i.name, 30), zen(i.address, 100), ...eraAllYm(i.d.acquired_month),
    ];
  }));
}

/** ⑫ 土地の売上高等 HOI120_5.0（18項目） */
export function landSales(items: EtaxItem[]): EtaxFile {
  return file("HOI120_5.0", "土地の売上高等の内訳書", items.map((i) => {
    const [reg, corp] = regOrCorp(i.regNo);
    return [
      "12", "0", zen(text(i.d.class), 10), zen(text(i.d.location), 100), zen(text(i.d.land_type), 10), decimal(num(i.d.total_area), 12, 3),
      ...eraYm(i.d.sold_month), reg, corp, zen(i.name, 30), zen(i.address, 100), decimal(num(i.d.sold_area), 12, 3),
      amt(num(i.d.total_price)), amt(i.amount), ...eraYear(num(i.d.acquired_year)),
    ];
  }));
}

/** ⑬ 売上高等の事業所別 HOI130_5.0（12項目） */
export function salesByOffice(items: EtaxItem[]): EtaxFile {
  return file("HOI130_5.0", "売上高等の事業所別内訳書", items.map((i) => [
    "13", "0", zen(i.name, 30), zen(i.address, 100), zen(text(i.d.manager), 30), zen(i.relationship, 10), zen(text(i.d.business), 30),
    amt(i.amount), amt(num(i.d.inventory)), han(text(i.d.staff), 6), zen(text(i.d.tax_office), 15), zen(i.note, 30),
  ]));
}

/** ⑮ 地代家賃 15-1・権利金等 15-2・工業所有権等の使用料 15-3 HOI150_4.0 */
export function rents(rentItems: EtaxItem[], keyMoney: EtaxItem[], royalties: EtaxItem[]): EtaxFile {
  return file("HOI150_4.0", "地代家賃等の内訳書", [
    ...rentItems.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["15-1", "0", zen(text(i.d.kind), 10), zen(text(i.d.usage), 10), zen(text(i.d.location), 100), reg, corp, zen(i.name, 30), zen(i.address, 100), ...era(i.d.period_from), ...era(i.d.period_to), amt(i.amount), zen(i.note, 40)];
    }),
    ...keyMoney.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["15-2", "0", reg, corp, zen(i.name, 30), zen(i.address, 100), ...era(i.d.paid_date), amt(i.amount), zen(text(i.d.content), 30), zen(i.note, 40)];
    }),
    ...royalties.map((i) => {
      const [reg, corp] = regOrCorp(i.regNo);
      return ["15-3", "0", zen(text(i.d.right_name), 10), reg, corp, zen(i.name, 30), zen(i.address, 100), ...eraYm(i.d.contract_from), ...eraYm(i.d.contract_to), ...eraYm(i.d.period_from), ...eraYm(i.d.period_to), amt(i.amount), zen(i.note, 40)];
    }),
  ]);
}

/** ⑯ 雑益等 16-1・雑損失等 16-2 HOI160_4.0（9項目） */
export function miscGainsLosses(gains: EtaxMiscRow[], losses: EtaxMiscRow[]): EtaxFile {
  const row = (code: string) => (r: EtaxMiscRow) => {
    const [reg, corp] = regOrCorp(r.regNo);
    return [code, "0", zen(r.account, 10), zen(r.description, 30), reg, corp, zen(r.name, 30), zen(r.address, 100), amt(r.amount)];
  };
  return file("HOI160_4.0", "雑益、雑損失等の内訳書", [...gains.map(row("16-1")), ...losses.map(row("16-2"))]);
}

/** CSV の文字列（改行は CRLF、最終行の後にも改行）。値は整形済みなのでカンマ・改行を含まない */
export function toCsvText(f: EtaxFile): string {
  return f.rows.map((r) => r.join(",")).join("\r\n") + (f.rows.length ? "\r\n" : "");
}

/** 出力できるファイルと、元にする内訳書 */
export const ETAX_FILES: { id: string; title: string; forms: string[] }[] = [
  { id: "HOI010_4.0", title: "① 預貯金等", forms: ["1"] },
  { id: "HOI020_4.0", title: "② 受取手形", forms: ["2"] },
  { id: "HOI030_4.0", title: "③ 売掛金（未収入金）", forms: ["3"] },
  { id: "HOI040_4.0", title: "④ 仮払金（前渡金）・貸付金及び受取利息", forms: ["4-1", "4-2"] },
  { id: "HOI050_4.0", title: "⑤ 棚卸資産", forms: ["5"] },
  { id: "HOI060_4.0", title: "⑥ 有価証券", forms: ["6"] },
  { id: "HOI070_5.0", title: "⑦ 固定資産（土地・建物）", forms: ["7"] },
  { id: "HOI080_4.0", title: "⑧ 支払手形", forms: ["8"] },
  { id: "HOI090_5.0", title: "⑨ 買掛金（未払金・未払費用）", forms: ["9"] },
  { id: "HOI100_6.0", title: "⑩ 仮受金（前受金・預り金）・源泉所得税預り金", forms: ["10-1", "10-2"] },
  { id: "HOI110_3.0", title: "⑪ 借入金及び支払利子", forms: ["11"] },
  { id: "HOI120_5.0", title: "⑫ 土地の売上高等", forms: ["12"] },
  { id: "HOI130_5.0", title: "⑬ 売上高等の事業所別", forms: ["13"] },
  { id: "HOI141_5.0", title: "⑭ 役員給与等・人件費", forms: ["14-1", "14-3"] },
  { id: "HOI150_4.0", title: "⑮ 地代家賃・権利金・工業所有権等の使用料", forms: ["15-1", "15-2"] },
  { id: "HOI160_4.0", title: "⑯ 雑益、雑損失等", forms: ["16"] },
];
