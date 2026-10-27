/**
 * 給与台帳・給与明細の取り込み（表の読み取り）。
 *
 * CSV・Excel・文字の入ったPDFは、いったん「行×セルの文字」（grid）にしてからここで読む。
 * 形はいろいろあるので、次の2つの向きを見分ける。
 *
 *   横型（台帳）: 見出し行に「氏名・基本給・総支給額・所得税…」が並び、1行が1人
 *   縦型（明細・賃金台帳）: 1列目に項目名が並び、右の列に金額。
 *                          金額の列が1つなら1人分（給与明細）、複数なら列ごとに1人（または1か月）
 *
 * 項目名は言い方が多いので、意味ごとにまとめて見分ける（社会保険料・介護保険・その他の控除など）。
 * 合計（総支給額・控除合計・差引支給額）はファイルの値が無ければ計算し、あれば突き合わせて食い違いを知らせる。
 * 推測で金額を作らない：見分けられない項目は数えず、知らせる。
 */

export type PayrollDraft = {
  employee_name: string;
  employee_type: "employee" | "officer";
  /** YYYY-MM。分からなければ null（画面で選んでもらう） */
  pay_month: string | null;
  /** YYYY-MM-DD */
  pay_date: string | null;
  gross_salary: number;
  income_tax: number;
  resident_tax: number;
  health_insurance: number;
  pension_insurance: number;
  employment_insurance: number;
  other_deduction: number;
  /** 総支給 − 控除の合計 */
  net_pay: number;
  warnings: string[];
};

export type PayrollParseResult = { records: PayrollDraft[]; warnings: string[] };

type Field =
  | "section_earning"
  | "section_deduction"
  | "name"
  | "month"
  | "pay_date"
  | "role"
  | "gross"
  | "earning"
  | "officer_pay"
  | "income_tax"
  | "resident_tax"
  | "health"
  | "pension"
  | "employment"
  | "social_lump"
  | "other_deduction"
  | "deduction_total"
  | "net"
  | "ignore";

const META: Field[] = ["name", "month", "pay_date", "role"];

/** 項目名を比べやすくする（全角→半角・空白を除く） */
function norm(s: string): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, "");
}

/** 項目名がどの意味か。分からなければ null */
export function classifyLabel(raw: string): Field | null {
  const s = norm(raw);
  if (!s) return null;
  if (/^(支給|支給項目|支給の部|支給額)$/.test(s)) return "section_earning";
  if (/^(控除|控除項目|控除の部|控除額)$/.test(s)) return "section_deduction";
  if (/差引|手取|振込額|振込金額|実支給|支払金額/.test(s)) return "net";
  if (/控除(額)?(合計|計)|総控除|控除総額/.test(s)) return "deduction_total";
  if (/総支給|支給(額)?(合計|計)|支給総額/.test(s)) return "gross";
  if (/氏名|社員名|従業員名|名前|受給者|^従業員$|^社員$/.test(s)) return "name";
  if (/対象(年)?月|支給月|給与月|^年月$|計算月|支給対象/.test(s)) return "month";
  if (/支給日|支払日|支給年月日|支払年月日/.test(s)) return "pay_date";
  if (/役職|雇用区分|雇用形態|^区分$/.test(s)) return "role";
  if (/所得税/.test(s)) return "income_tax";
  if (/住民税|市民税|県民税|都民税|特別徴収/.test(s)) return "resident_tax";
  if (/雇用保険/.test(s)) return "employment";
  if (/厚生年金|年金保険/.test(s)) return "pension";
  if (/健康保険|健保|介護保険/.test(s)) return "health";
  if (/社会保険|社保/.test(s)) return "social_lump";
  // 金額でない列（時間・日数・単価・番号など）。「時間外手当」は手当なので除かない
  if (/(時間|日数|回数|単価|時給|日給|番号|コード|所属|部門|部署)$|^No\.?$|^(社員|従業員)(番号|コード|No)/i.test(s)) return "ignore";
  if (/財形|組合費|社宅|寮費|互助会|積立|貸付|返済|立替|その他控除|控除/.test(s)) return "other_deduction";
  if (/役員報酬|役員給与/.test(s)) return "officer_pay";
  if (/基本給|手当|残業|時間外|休日|深夜|賞与|報酬|給与|給料|賃金|歩合|調整/.test(s)) return "earning";
  return null;
}

/** 金額を読む。「250,000」「¥250,000」「250000円」「△1,000」「(1,000)」「-」（0）。読めなければ null */
export function parseAmount(raw: string): number | null {
  let s = (raw ?? "").normalize("NFKC").trim();
  if (!s) return null;
  if (/^[-‐−ー―]$/.test(s)) return 0;
  let neg = false;
  if (/^[△▲]/.test(s)) {
    neg = true;
    s = s.slice(1);
  }
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[¥￥,円\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return neg ? -n : n;
}

/** 和暦（令和・平成）を西暦の年に */
function eraYear(era: string, y: number): number {
  return /^(令和|R)/i.test(era) ? 2018 + y : /^(平成|H)/i.test(era) ? 1988 + y : y;
}

/** 「2026年10月分」「2026/10」「2026-10-01」「令和8年10月」「R8.10」→ "2026-10" */
export function parseMonth(raw: string): string | null {
  const s = (raw ?? "").normalize("NFKC");
  let m = s.match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})/);
  let y: number | null = null;
  let mo: number | null = null;
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
  } else if ((m = s.match(/(令和|平成|R|H)\s*(\d{1,2}|元)\s*[年/\-.]\s*(\d{1,2})/i))) {
    y = eraYear(m[1], m[2] === "元" ? 1 : Number(m[2]));
    mo = Number(m[3]);
  }
  if (!y || !mo || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** 「2026年10月15日」「2026/10/15」「令和8年10月15日」→ "2026-10-15"（実在しない日は null） */
export function parseDate(raw: string): string | null {
  const s = (raw ?? "").normalize("NFKC");
  let m = s.match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = s.match(/(令和|平成|R|H)\s*(\d{1,2}|元)\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/i))) {
    [y, mo, d] = [eraYear(m[1], m[2] === "元" ? 1 : Number(m[2])), Number(m[3]), Number(m[4])];
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const OFFICER_RE = /代表取締役|取締役|役員|社長|監査役|理事|執行役/;

/** 氏名から（代表取締役）のような添え書きを外す。役員かどうかも返す */
function cleanName(raw: string): { name: string; officer: boolean } {
  const s = (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const paren = s.match(/[(（]([^)）]*)[)）]/);
  const officer = OFFICER_RE.test(s);
  const name = (paren ? s.replace(paren[0], "") : s).replace(/(様|殿)$/, "").trim();
  return { name, officer };
}

/** 1人分の値を集めるための入れ物 */
type Acc = {
  name: string[];
  month: string[];
  pay_date: string[];
  role: string[];
  earnings: number;
  hasEarnings: boolean;
  officerPay: boolean;
  gross: number | null;
  income_tax: number;
  resident_tax: number;
  health: number;
  pension: number;
  employment: number;
  social_lump: number;
  other_deduction: number;
  deduction_total: number | null;
  net: number | null;
  unknown: string[];
};

const emptyAcc = (): Acc => ({
  name: [],
  month: [],
  pay_date: [],
  role: [],
  earnings: 0,
  hasEarnings: false,
  officerPay: false,
  gross: null,
  income_tax: 0,
  resident_tax: 0,
  health: 0,
  pension: 0,
  employment: 0,
  social_lump: 0,
  other_deduction: 0,
  deduction_total: null,
  net: null,
  unknown: [],
});

function addAmount(acc: Acc, field: Field, amount: number) {
  switch (field) {
    case "gross":
      acc.gross = (acc.gross ?? 0) + amount;
      break;
    case "officer_pay":
      acc.officerPay = true;
      acc.earnings += amount;
      acc.hasEarnings = true;
      break;
    case "earning":
      acc.earnings += amount;
      acc.hasEarnings = true;
      break;
    case "income_tax":
    case "resident_tax":
    case "health":
    case "pension":
    case "employment":
    case "social_lump":
    case "other_deduction":
      acc[field] += amount;
      break;
    case "deduction_total":
      acc.deduction_total = (acc.deduction_total ?? 0) + amount;
      break;
    case "net":
      acc.net = (acc.net ?? 0) + amount;
      break;
  }
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** 集めた値を1件の下書きにする。金額が1つも無ければ null */
function finalize(acc: Acc, fallbackMonth: string | null): PayrollDraft | null {
  const warnings: string[] = [];
  const { name, officer: officerByName } = cleanName(acc.name.join(" "));
  const role = acc.role.join(" ");
  const gross = acc.gross ?? acc.earnings;
  if (acc.gross != null && acc.hasEarnings && acc.gross !== acc.earnings) {
    warnings.push(`総支給額（${yen(acc.gross)}）と支給項目の合計（${yen(acc.earnings)}）が合いません。総支給額を使いました`);
  }

  let health = acc.health;
  if (acc.social_lump) {
    health += acc.social_lump;
    warnings.push(`「社会保険料」の内訳（健康保険・厚生年金）が無いため、${yen(acc.social_lump)}を健康保険の欄に入れました。内訳が分かれば直してください`);
  }
  let other = acc.other_deduction;
  const known = acc.income_tax + acc.resident_tax + health + acc.pension + acc.employment + other;
  if (acc.deduction_total != null && acc.deduction_total !== known) {
    const diff = acc.deduction_total - known;
    if (diff > 0) {
      other += diff;
      warnings.push(`控除合計との差額 ${yen(diff)} を「その他控除」に入れました`);
    } else {
      warnings.push(`控除の項目の合計（${yen(known)}）が控除合計（${yen(acc.deduction_total)}）より多くなっています`);
    }
  }
  const deductions = acc.income_tax + acc.resident_tax + health + acc.pension + acc.employment + other;
  const net = gross - deductions;
  if (acc.net != null && acc.net !== net) {
    warnings.push(`差引支給額がファイルでは ${yen(acc.net)}、計算では ${yen(net)} です`);
  }
  if (acc.unknown.length) {
    warnings.push(`見分けられない項目を数えていません: ${[...new Set(acc.unknown)].join("、")}`);
  }

  if (gross === 0 && deductions === 0) return null;

  const payDate = acc.pay_date.map(parseDate).find(Boolean) ?? null;
  const month =
    acc.month.map(parseMonth).find(Boolean) ?? (payDate ? payDate.slice(0, 7) : null) ?? fallbackMonth;
  if (!month) warnings.push("対象月が分かりません。選んでください");
  if (!name) warnings.push("氏名が分かりません。入れてください");

  return {
    employee_name: name,
    employee_type: officerByName || acc.officerPay || OFFICER_RE.test(role) ? "officer" : "employee",
    pay_month: month,
    pay_date: payDate,
    gross_salary: gross,
    income_tax: acc.income_tax,
    resident_tax: acc.resident_tax,
    health_insurance: health,
    pension_insurance: acc.pension,
    employment_insurance: acc.employment,
    other_deduction: other,
    net_pay: net,
    warnings,
  };
}

const nonEmpty = (row: string[]) => row.map((c, i) => ({ c: (c ?? "").trim(), i })).filter((x) => x.c);

/** 横型（1行が1人）：見出し行を探す。項目名と分かるセルが一番多い行（3つ以上） */
function findHeaderRow(grid: string[][]): number {
  let best = -1;
  let bestScore = 2;
  grid.slice(0, 30).forEach((row, i) => {
    const fields = row.map(classifyLabel).filter((f): f is Field => f != null && f !== "ignore");
    const hasAmount = fields.some((f) => !META.includes(f) && !f.startsWith("section"));
    const score = new Set(fields).size;
    if (fields.includes("name") && hasAmount && score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

function parseHorizontal(grid: string[][], header: number, fallbackMonth: string | null): PayrollParseResult {
  const fields = grid[header].map(classifyLabel);
  const unknownCols = grid[header].map((h, i) => (fields[i] == null && (h ?? "").trim() ? h.trim() : null));
  const records: PayrollDraft[] = [];
  for (const row of grid.slice(header + 1)) {
    const acc = emptyAcc();
    row.forEach((cell, i) => {
      const f = fields[i];
      const v = (cell ?? "").trim();
      if (!v) return;
      if (f && META.includes(f)) (acc[f as "name" | "month" | "pay_date" | "role"] as string[]).push(v);
      else if (f && f !== "ignore" && !f.startsWith("section")) {
        const n = parseAmount(v);
        if (n != null) addAmount(acc, f, n);
      } else if (unknownCols[i] && parseAmount(v)) acc.unknown.push(unknownCols[i]!);
    });
    // 合計の行・空の行は飛ばす
    const nameText = norm(acc.name.join(""));
    if (!nameText || /^(合計|総計|計|小計)$/.test(nameText)) continue;
    const d = finalize(acc, fallbackMonth);
    if (d) records.push(d);
  }
  return { records, warnings: [] };
}

/** 縦型（1列目が項目名）。金額の列ごとに1件 */
function parseVertical(grid: string[][], fallbackMonth: string | null): PayrollParseResult {
  type Line = { field: Field | null; label: string; labelCol: number; cells: { c: string; i: number }[] };
  const lines: Line[] = [];
  for (const row of grid) {
    const cells = nonEmpty(row);
    if (!cells.length) continue;
    const first = cells[0];
    if (parseAmount(first.c) != null) continue; // 項目名の無い行
    lines.push({ field: classifyLabel(first.c), label: first.c, labelCol: first.i, cells: cells.slice(1) });
  }

  // 金額の入っている列（金額の項目で2回以上出てくる列）
  const colCount = new Map<number, number>();
  for (const l of lines) {
    if (!l.field || META.includes(l.field) || l.field === "ignore" || l.field.startsWith("section")) continue;
    for (const x of l.cells) if (parseAmount(x.c) != null) colCount.set(x.i, (colCount.get(x.i) ?? 0) + 1);
  }
  const valueCols = [...colCount.entries()].filter(([, n]) => n >= 2).map(([i]) => i).sort((a, b) => a - b);
  const multi = valueCols.length >= 2;
  const cols = multi ? valueCols : [valueCols[0] ?? -1];

  const accs = cols.map(() => emptyAcc());
  let section: "earning" | "deduction" | null = null;
  for (const l of lines) {
    if (l.field === "section_earning") section = "earning";
    if (l.field === "section_deduction") section = "deduction";
    if (l.field === "section_earning" || l.field === "section_deduction" || l.field === "ignore") continue;

    cols.forEach((col, k) => {
      const acc = accs[k];
      if (l.field && META.includes(l.field)) {
        // 列ごとの表で値が1つだけなら、全部の列に共通（1人の年間の賃金台帳の「氏名」など）
        if (multi && l.cells.length === 1) {
          (acc[l.field as "name" | "month" | "pay_date" | "role"] as string[]).push(l.cells[0].c);
          return;
        }
        // 1人分の明細は、項目名の右の文字をつなげる（「安藤」「蓮（代表取締役）」のように分かれていることがある）
        // Excel の結合セルは、結合した各セルに同じ文字が入って見えるので、続けて同じ文字は1つにする
        const texts = (multi ? l.cells.filter((x) => x.i === col) : l.cells)
          .map((x) => x.c)
          .filter((c, i, arr) => i === 0 || c !== arr[i - 1]);
        (acc[l.field as "name" | "month" | "pay_date" | "role"] as string[]).push(texts.join(" "));
        return;
      }
      const cell = multi ? l.cells.find((x) => x.i === col) : l.cells.find((x) => parseAmount(x.c) != null);
      const n = cell ? parseAmount(cell.c) : null;
      if (n == null) return;
      // 項目名で分からないものは、支給・控除の欄の中なら、その欄の項目として数える
      const field: Field | null = l.field ?? (section === "earning" ? "earning" : section === "deduction" ? "other_deduction" : null);
      if (field) addAmount(acc, field, n);
      else if (n !== 0) acc.unknown.push(l.label);
    });
  }

  // 列の見出し（その列の一番上から、金額が始まるまでの文字）から、月か氏名を読む
  if (multi) {
    accs.forEach((acc, k) => {
      for (const row of grid) {
        const v = (row[cols[k]] ?? "").trim();
        if (!v) continue;
        if (parseAmount(v) != null) break;
        if (parseMonth(v)) {
          if (!acc.month.length) acc.month.push(v);
        } else if (!acc.name.length) acc.name.push(v);
      }
    });
  }

  const records = accs.map((a) => finalize(a, fallbackMonth)).filter((d): d is PayrollDraft => d != null);
  return { records, warnings: [] };
}

/**
 * 行×セルの文字（grid）から給与の下書きを作る。
 * @param fileName 対象月の手がかり（「給与明細_2026年10月分.xlsx」など）
 */
export function parsePayrollGrid(grid: string[][], opts: { fileName?: string } = {}): PayrollParseResult {
  const fallbackMonth = opts.fileName ? parseMonth(opts.fileName) : null;
  const rows = grid.map((r) => r.map((c) => (c == null ? "" : String(c))));
  const header = findHeaderRow(rows);
  const horizontal = header >= 0 ? parseHorizontal(rows, header, fallbackMonth) : { records: [], warnings: [] };
  // 横型で読めなければ縦型で読む（給与明細の形）
  const result = horizontal.records.length ? horizontal : parseVertical(rows, fallbackMonth);
  if (!result.records.length) {
    result.warnings.push("給与の項目（氏名・支給額・控除など）が見つかりませんでした");
  }
  return result;
}

/** 文字の位置（PDF）から行×セルを作る。同じ高さの文字を1行にし、近い文字は1つのセルにつなげる */
export function gridFromPositionedText(
  items: { str: string; x: number; y: number; width: number }[],
  opts: { rowTolerance?: number; joinGap?: number } = {}
): string[][] {
  const tol = opts.rowTolerance ?? 3;
  const gap = opts.joinGap ?? 12;
  const rows: { y: number; items: typeof items }[] = [];
  for (const it of items.filter((i) => i.str.trim())) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  // PDF は下から上へ y が増える
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    const cells: { text: string; end: number }[] = [];
    for (const it of sorted) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.end <= gap) {
        // 少し離れていれば空白を挟む（「安藤」「蓮」→「安藤 蓮」）
        last.text += (it.x - last.end > 3 ? " " : "") + it.str;
        last.end = it.x + it.width;
      } else cells.push({ text: it.str, end: it.x + it.width });
    }
    return cells.map((c) => c.text.trim());
  });
}
