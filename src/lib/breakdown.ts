/**
 * 勘定科目内訳明細書（法人税申告書の添付書類）の共通ロジック（純粋関数）。
 *
 * 記載基準は国税庁の「勘定科目内訳明細書の記載要領」（令和6年3月1日以後
 * 終了事業年度分）による。主な規則:
 *   - 一定額以上のものを相手先別に「各別に記入」し、それ以外は一括して記入する
 *   - 役員・株主・関係会社など、金額に関わらず各別に記入するものがある
 *   - 各別に記入すべき口数が100口を超える場合は、多額なものから100口のみ
 *     記入してよい（関連者を含めて100口。100口目に残額をまとめる）
 *
 * DBアクセスはここに置かない（テストできるようにするため）。
 */

import type { AccountCategory } from "@/lib/trial-balance";
import type { PlClassification } from "@/types/database";

// ---------------------------------------------------------------------------
// 様式の一覧
// ---------------------------------------------------------------------------

/**
 * 様式の作成状況。
 *   ready        … 今あるデータから作成できる
 *   needs_items  … 相手先ごとの明細を入力する画面が必要（準備中）
 *   needs_fields … 元データに入力欄の追加が必要（準備中）
 */
export type BreakdownFormStatus = "ready" | "needs_items" | "needs_fields";

export type BreakdownFormDef = {
  /** URLと照合に使うキー。国税庁のフォーマット区分に合わせる（例: "4-2"） */
  key: string;
  /** 様式番号（①〜⑯） */
  number: string;
  title: string;
  status: BreakdownFormStatus;
  /** 準備中の理由など、一覧に添える説明 */
  note?: string;
};

export const BREAKDOWN_FORMS: BreakdownFormDef[] = [
  { key: "1", number: "①", title: "預貯金等の内訳書", status: "needs_fields", note: "口座と勘定科目の紐付けが必要です" },
  { key: "2", number: "②", title: "受取手形の内訳書", status: "needs_items" },
  { key: "3", number: "③", title: "売掛金（未収入金）の内訳書", status: "needs_items" },
  { key: "4-1", number: "④", title: "仮払金（前渡金）の内訳書", status: "needs_items" },
  { key: "4-2", number: "④", title: "貸付金及び受取利息の内訳書", status: "ready" },
  { key: "5", number: "⑤", title: "棚卸資産の内訳書", status: "needs_fields", note: "科目区分・単位の入力欄が必要です" },
  { key: "6", number: "⑥", title: "有価証券の内訳書", status: "needs_items" },
  { key: "7", number: "⑦", title: "固定資産（土地、土地の上に存する権利及び建物に限る。）の内訳書", status: "needs_fields", note: "所在地・面積などの入力欄が必要です" },
  { key: "8", number: "⑧", title: "支払手形の内訳書", status: "needs_items" },
  { key: "9", number: "⑨", title: "買掛金（未払金・未払費用）の内訳書", status: "needs_items" },
  { key: "10-1", number: "⑩", title: "仮受金（前受金・預り金）の内訳書", status: "needs_items" },
  { key: "10-2", number: "⑩", title: "源泉所得税預り金の内訳", status: "needs_fields", note: "納付状況の記録が必要です" },
  { key: "11", number: "⑪", title: "借入金及び支払利子の内訳書", status: "ready" },
  { key: "12", number: "⑫", title: "土地の売上高等の内訳書", status: "needs_items" },
  { key: "13", number: "⑬", title: "売上高等の事業所別内訳書", status: "needs_items" },
  { key: "14-1", number: "⑭", title: "役員給与等の内訳書", status: "needs_fields", note: "役員の役職・続柄などの登録が必要です" },
  { key: "14-3", number: "⑭", title: "人件費の内訳書", status: "ready" },
  { key: "15-1", number: "⑮", title: "地代家賃等の内訳書", status: "needs_items" },
  { key: "15-2", number: "⑮", title: "工業所有権等の使用料の内訳書", status: "needs_items" },
  { key: "16", number: "⑯", title: "雑益、雑損失等の内訳書", status: "ready" },
];

export function findBreakdownForm(key: string): BreakdownFormDef | undefined {
  return BREAKDOWN_FORMS.find((f) => f.key === key);
}

// ---------------------------------------------------------------------------
// 各別記入の判定
// ---------------------------------------------------------------------------

export type ListingRule = {
  /** この金額以上なら各別に記入する */
  amountThreshold: number;
  /** 副次的な金額（期中の利息など）がこの額以上でも各別に記入する。無ければ使わない */
  secondaryThreshold?: number;
  /** 各別に記入する口数の上限。超えた分は最後の1行にまとめる */
  maxRows: number;
};

export type ListingFacts = {
  /** 判定に使う主な金額（期末現在高・金額） */
  amount: number;
  /** 判定に使う副次的な金額（期中の利息など） */
  secondary?: number;
  /** 金額に関わらず各別に記入するもの（関連者・税金の還付金など） */
  mustList?: boolean;
};

/** ⑪借入金・④貸付金: 期末現在高50万円以上／期中の利息3万円以上／関連者は全て */
export const LOAN_LISTING_RULE: ListingRule = {
  amountThreshold: 500_000,
  secondaryThreshold: 30_000,
  maxRows: 100,
};

/** ⑯雑益・雑損失等: 科目別かつ相手先別に10万円以上／税金の還付金は全て */
export const MISC_LISTING_RULE: ListingRule = {
  amountThreshold: 100_000,
  maxRows: 100,
};

export function isListed(f: ListingFacts, rule: ListingRule): boolean {
  if (f.mustList) return true;
  if (f.amount >= rule.amountThreshold) return true;
  if (rule.secondaryThreshold != null && (f.secondary ?? 0) >= rule.secondaryThreshold) {
    return true;
  }
  return false;
}

export type ListingResult<T> = {
  /** 各別に記入する行（金額に関わらず記入するものを先頭に、残りは金額の多い順） */
  listed: T[];
  /** 一括して記入する分（各別記入にならなかったもの＋100口を超えた分） */
  rest: { amount: number; secondary: number; count: number };
};

/**
 * 各別に記入する行と、一括して記入する分に分ける。
 *
 * 100口を超える場合は、金額に関わらず記入するもの（関連者など）を必ず
 * 枠内に残し、100行目を残額用に空ける（記載要領）。
 */
export function selectListedRows<T>(
  items: T[],
  rule: ListingRule,
  factsOf: (item: T) => ListingFacts
): ListingResult<T> {
  const listed: { item: T; facts: ListingFacts }[] = [];
  const rest = { amount: 0, secondary: 0, count: 0 };
  const addRest = (f: ListingFacts) => {
    rest.amount += f.amount;
    rest.secondary += f.secondary ?? 0;
    rest.count++;
  };

  for (const item of items) {
    const facts = factsOf(item);
    if (isListed(facts, rule)) listed.push({ item, facts });
    else addRest(facts);
  }

  listed.sort((a, b) => {
    const am = Boolean(a.facts.mustList);
    const bm = Boolean(b.facts.mustList);
    if (am !== bm) return am ? -1 : 1;
    return b.facts.amount - a.facts.amount;
  });

  if (listed.length > rule.maxRows) {
    for (const x of listed.splice(rule.maxRows - 1)) addRest(x.facts);
  }

  return { listed: listed.map((x) => x.item), rest };
}

// ---------------------------------------------------------------------------
// 試算表の科目との対応
// ---------------------------------------------------------------------------

/** 試算表（getTrialBalance）の行のうち、内訳書の照合に使う項目 */
export type BalanceAccount = {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  plClassification: PlClassification | null;
  /** 借方をプラスとした符号付き残高（当期の損益科目は当期発生額） */
  currentBalance: number;
};

/**
 * 科目の性質に応じた向きの残高（正の値が通常の残高）。
 * 資産・費用は借方残高、負債・純資産・収益は貸方残高を正とする。
 */
export function naturalBalance(a: Pick<BalanceAccount, "category" | "currentBalance">): number {
  return a.category === "asset" || a.category === "expense" ? a.currentBalance : -a.currentBalance;
}

export const isBorrowingAccount = (a: BalanceAccount) =>
  a.category === "liability" && a.name.includes("借入金");

export const isLendingAccount = (a: BalanceAccount) =>
  a.category === "asset" && a.name.includes("貸付金");

export const isInterestExpenseAccount = (a: BalanceAccount) =>
  a.category === "expense" && /支払利息|支払利子/.test(a.name);

export const isInterestIncomeAccount = (a: BalanceAccount) =>
  a.category === "revenue" && a.name.includes("受取利息");

/** 人件費の内訳書の区分 */
export type PersonnelKind = "officer" | "salary" | "wage";

// 人件費の内訳書に含めないもの（退職金は役員給与等の内訳書の退職給与欄、
// 法定福利費・福利厚生費は給与ではない）
const NOT_PAY = /退職|法定福利|福利厚生|引当/;

/**
 * 人件費の内訳書のどの区分に入る科目か。
 *   officer … 役員給与（役員報酬・役員賞与）
 *   wage    … 従業員賃金手当（工員等の賃金で、製造原価・売上原価に入るもの）
 *   salary  … 従業員給料手当（事務員の給料・賞与等で、一般管理費に入るもの）
 */
export function personnelKindOf(a: BalanceAccount): PersonnelKind | null {
  if (a.category !== "expense") return null;
  if (NOT_PAY.test(a.name)) return null;
  if (/役員(報酬|給与|賞与)/.test(a.name)) return "officer";
  if (!/(給料|給与|賃金|賞与|手当|雑給)/.test(a.name)) return null;
  return a.plClassification === "cogs" ? "wage" : "salary";
}

export type PersonnelLine = { total: number; accounts: { name: string; amount: number }[] };

export type PersonnelBreakdown = {
  officer: PersonnelLine;
  salary: PersonnelLine;
  wage: PersonnelLine;
  total: number;
};

/** 試算表の科目残高から人件費の内訳（総額）を作る */
export function buildPersonnelBreakdown(accounts: BalanceAccount[]): PersonnelBreakdown {
  const empty = (): PersonnelLine => ({ total: 0, accounts: [] });
  const r = { officer: empty(), salary: empty(), wage: empty() };
  for (const a of accounts) {
    const kind = personnelKindOf(a);
    if (!kind) continue;
    const amount = naturalBalance(a);
    if (amount === 0) continue;
    r[kind].total += amount;
    r[kind].accounts.push({ name: a.name, amount });
  }
  return { ...r, total: r.officer.total + r.salary.total + r.wage.total };
}

/** 雑益・雑損失等の内訳書の区分 */
export function miscKindOf(a: BalanceAccount): "gain" | "loss" | null {
  if (a.category === "revenue" && /雑収入|雑益|固定資産売却益|還付/.test(a.name)) return "gain";
  if (a.category === "expense" && /雑損|固定資産売却損|貸倒損/.test(a.name)) return "loss";
  return null;
}

// ---------------------------------------------------------------------------
// ⑯ 雑益・雑損失等
// ---------------------------------------------------------------------------

/** 仕訳明細1行分（雑益・雑損失の科目に立ったもの） */
export type MiscSourceLine = {
  kind: "gain" | "loss";
  accountName: string;
  /** 摘要。取引の内容の初期値にする */
  description: string;
  /** 相手先。証憑の読み取り結果や連携元の取引先名。分からなければ null */
  counterparty: string | null;
  address: string | null;
  registrationNumber: string | null;
  /** 雑益は貸方−借方、雑損失は借方−貸方 */
  amount: number;
};

export type MiscRow = {
  accountName: string;
  description: string;
  counterparty: string | null;
  address: string | null;
  registrationNumber: string | null;
  amount: number;
  /** 束ねた仕訳の件数 */
  lineCount: number;
  /** 税金の還付金（金額に関わらず各別に記入） */
  isTaxRefund: boolean;
};

const isTaxRefund = (accountName: string, description: string) =>
  /還付/.test(accountName) || /還付/.test(description);

/**
 * 雑益・雑損失の仕訳を、記載要領の「科目別かつ相手先別」に束ねて記載対象を選ぶ。
 *
 * 仕訳に取引先の記録が無いことが多いため、相手先が分からない仕訳は束ねず
 * 1件ずつ扱う（別の相手先を1行に混ぜると、内訳として誤りになる）。
 */
export function buildMiscRows(
  lines: MiscSourceLine[],
  kind: "gain" | "loss"
): ListingResult<MiscRow> {
  const groups = new Map<string, MiscRow>();
  let seq = 0;
  for (const l of lines) {
    if (l.kind !== kind) continue;
    const key = l.counterparty
      ? `${l.accountName}\u0000${l.counterparty}`
      : `\u0001${seq++}`;
    const g = groups.get(key);
    if (g) {
      g.amount += l.amount;
      g.lineCount++;
      if (g.description !== l.description && !g.description.endsWith("ほか")) {
        g.description = `${g.description}ほか`;
      }
      g.isTaxRefund ||= isTaxRefund(l.accountName, l.description);
      g.address ??= l.address;
      g.registrationNumber ??= l.registrationNumber;
    } else {
      groups.set(key, {
        accountName: l.accountName,
        description: l.description,
        counterparty: l.counterparty,
        address: l.address,
        registrationNumber: l.registrationNumber,
        amount: l.amount,
        lineCount: 1,
        isTaxRefund: isTaxRefund(l.accountName, l.description),
      });
    }
  }

  return selectListedRows([...groups.values()], MISC_LISTING_RULE, (r) => ({
    amount: r.amount,
    mustList: r.isTaxRefund,
  }));
}

// ---------------------------------------------------------------------------
// 試算表との照合
// ---------------------------------------------------------------------------

export type Reconciliation = {
  /** 照合に使った科目名 */
  accountNames: string[];
  /** 試算表の科目残高の合計 */
  accountTotal: number;
  /** 内訳書の合計 */
  breakdownTotal: number;
  /** 科目残高 − 内訳書の合計 */
  difference: number;
  matches: boolean;
};

/**
 * 内訳書の合計と、試算表の科目残高を突き合わせる。
 * 一致しないときに自動で「その他」に入れることはしない（入力漏れに気づけなくなる）。
 */
export function reconcile(
  accounts: BalanceAccount[],
  breakdownTotal: number
): Reconciliation {
  const accountTotal = accounts.reduce((s, a) => s + naturalBalance(a), 0);
  const difference = Math.round(accountTotal - breakdownTotal);
  return {
    accountNames: accounts.map((a) => a.name),
    accountTotal,
    breakdownTotal,
    difference,
    matches: difference === 0,
  };
}
