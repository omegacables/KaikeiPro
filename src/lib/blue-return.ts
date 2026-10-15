/**
 * 所得税青色申告決算書（一般用）の1ページ（損益計算書）と4ページ（貸借対照表）。純粋関数。
 * 国税庁「青色申告決算書（一般用）の書き方」（令和7年分）の欄番号に合わせる。
 *
 * ■ 損益計算書
 *   ① 売上（収入）金額 … 収益の科目の合計（貸倒引当金の戻入益は ㉞ へ）
 *   ②〜⑥ 売上原価 … ② 期首・⑤ 期末の商品棚卸高は貸借対照表の棚卸資産の残高。
 *                     ③ 仕入金額は、売上原価の科目の額に棚卸資産の増減を足し戻した額（仕入の総額）
 *   ⑧〜㉔ 経費の決まった行、㉕〜㉚ 自由記入の6行（科目名10字まで）、㉛ 雑費
 *     決まった行の無い科目は金額の大きい順に自由記入行へ。7つ目からは雑費にまとめて知らせる
 *   専従者給与は ㊳、貸倒引当金の繰入は ㊴（経費には入れない）
 *   ㊸ 青色申告特別控除前の所得金額 ＝ ㉝ ＋ ㊲ − ㊷
 *   ㊹ 青色申告特別控除額 … 65万・55万・10万円のうち、㊸（赤字なら0）まで（不動産所得は無いものとする）
 *
 * ■ 貸借対照表（資産負債調）
 *   決まった行（現金〜土地／支払手形〜預り金・貸倒引当金）と自由記入の行（資産7行・負債7行・引当金7行）
 *   事業主貸・事業主借は期末だけ（毎年0から始まる）。その年の増減で書く
 *   元入金 ＝ 期首の資産の総額 − 期首の負債の総額（事業主貸・事業主借は含めない）。期首・期末とも同じ額
 *   期末の資産合計 ＝ 負債 ＋ 事業主借 ＋ 元入金 ＋ ㊸ になるはず（ならなければ記帳の誤りを知らせる）
 */

export type BlueTbRow = {
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "revenue" | "expense";
  /** 期首残高（借方をプラス） */
  prevBalance: number;
  debitTotal: number;
  creditTotal: number;
  /** 期末残高（借方をプラス） */
  currentBalance: number;
  /** 売上原価の科目か（損益計算書の区分） */
  costOfSales?: boolean;
};

export type BlueLine = { no: string; label: string; amount: number; accounts: string[] };
export type BsLine = { label: string; opening: number | null; closing: number; accounts: string[] };

export type BlueReturn = {
  pl: BlueLine[];
  bs: { assets: BsLine[]; liabilities: BsLine[]; capital: BsLine[]; assetTotal: { opening: number; closing: number }; liabilityTotal: { opening: number; closing: number } };
  /** ㊸ 青色申告特別控除前の所得金額・㊹ 控除額・㊺ 所得金額 */
  incomeBeforeDeduction: number;
  deduction: number;
  income: number;
  /** 2ページ「青色申告特別控除額の計算」 */
  deductionCalc: { limit: number; realEstate: number; business: number; deducted: number };
  warnings: string[];
};

const FREE_PL_LINES = 6;
const FREE_BS_LINES = 7;

/** 経費の決まった行（⑧〜㉔・㉛）。上から順に名前で当てる */
const EXPENSE_LINES: { no: string; label: string; match: RegExp }[] = [
  { no: "8", label: "租税公課", match: /租税公課/ },
  { no: "9", label: "荷造運賃", match: /荷造運賃|発送費|運賃/ },
  { no: "10", label: "水道光熱費", match: /水道光熱費|光熱費/ },
  { no: "11", label: "旅費交通費", match: /旅費交通費|交通費/ },
  { no: "12", label: "通信費", match: /通信費/ },
  { no: "13", label: "広告宣伝費", match: /広告宣伝費|広告費/ },
  { no: "14", label: "接待交際費", match: /交際費/ },
  { no: "15", label: "損害保険料", match: /損害保険料|^保険料$/ },
  { no: "16", label: "修繕費", match: /修繕費/ },
  { no: "17", label: "消耗品費", match: /消耗品費/ },
  { no: "18", label: "減価償却費", match: /減価償却費|一括償却/ },
  { no: "19", label: "福利厚生費", match: /福利厚生費|法定福利費/ },
  { no: "20", label: "給料賃金", match: /給料|賃金|雑給|賞与/ },
  { no: "21", label: "外注工賃", match: /外注/ },
  { no: "22", label: "利子割引料", match: /支払利息|割引料|利子/ },
  { no: "23", label: "地代家賃", match: /地代|家賃|賃借料/ },
  { no: "24", label: "貸倒金", match: /貸倒損失|貸倒金/ },
  { no: "31", label: "雑費", match: /^雑費$/ },
];
const SPOUSE_SALARY = /専従者給与/;
const BAD_DEBT_PROVISION = /貸倒引当金繰入/;
const BAD_DEBT_REVERSAL = /貸倒引当金戻入/;
const PERSONAL_TAX = /^所得税|住民税/;

/** 貸借対照表の決まった行 */
const ASSET_LINES: { label: string; match: RegExp }[] = [
  { label: "現金", match: /^現金$|小口現金/ },
  { label: "当座預金", match: /当座預金/ },
  { label: "定期預金", match: /定期預金|定期積金/ },
  { label: "その他の預金", match: /預金|貯金/ },
  { label: "受取手形", match: /受取手形/ },
  { label: "売掛金", match: /売掛金/ },
  { label: "有価証券", match: /有価証券/ },
  { label: "棚卸資産", match: /棚卸資産|^商品$|^製品$|原材料|仕掛品|貯蔵品/ },
  { label: "前払金", match: /前払金|前渡金/ },
  { label: "貸付金", match: /貸付金/ },
  { label: "建物", match: /^建物$/ },
  { label: "建物附属設備", match: /建物附属設備/ },
  { label: "機械装置", match: /機械装置|機械及び装置/ },
  { label: "車両運搬具", match: /車両運搬具|車両/ },
  { label: "工具 器具 備品", match: /器具備品|工具/ },
  { label: "土地", match: /^土地$/ },
];
const LIABILITY_LINES: { label: string; match: RegExp }[] = [
  { label: "支払手形", match: /支払手形/ },
  { label: "買掛金", match: /買掛金/ },
  { label: "借入金", match: /借入金/ },
  { label: "未払金", match: /^未払金$/ },
  { label: "前受金", match: /前受金/ },
  { label: "預り金", match: /預り金/ },
];
const OWNER_DRAW = /事業主貸/;
const OWNER_CONTRIB = /事業主借/;
const CAPITAL = /元入金/;
const ALLOWANCE = /貸倒引当金/;
const RESERVE = /引当金|準備金/;

const net = (r: BlueTbRow) => r.debitTotal - r.creditTotal;
/** 名前は10字まで（自由記入行） */
const short = (s: string) => [...s].slice(0, 10).join("");

export function computeBlueReturn(p: { tb: BlueTbRow[]; deductionLimit: 650_000 | 550_000 | 100_000 }): BlueReturn {
  const warnings: string[] = [];
  const pl = p.tb.filter((r) => r.category === "revenue" || r.category === "expense");
  const used = new Set<string>();
  const take = (r: BlueTbRow) => used.add(r.code + r.name);

  // ---- 売上・原価 ----
  const reversals = pl.filter((r) => r.category === "revenue" && BAD_DEBT_REVERSAL.test(r.name));
  reversals.forEach(take);
  const revenues = pl.filter((r) => r.category === "revenue" && !BAD_DEBT_REVERSAL.test(r.name));
  revenues.forEach(take);
  const sales = revenues.reduce((s, r) => s - net(r), 0);

  const inventories = p.tb.filter((r) => r.category === "asset" && ASSET_LINES[7].match.test(r.name));
  const openingInv = inventories.reduce((s, r) => s + r.prevBalance, 0);
  const closingInv = inventories.reduce((s, r) => s + r.currentBalance, 0);
  const costs = pl.filter((r) => r.category === "expense" && (r.costOfSales || /仕入|売上原価|製造原価/.test(r.name)));
  costs.forEach(take);
  const costNet = costs.reduce((s, r) => s + net(r), 0);
  // 原価の科目は棚卸資産の増減を織り込んだ額なので、仕入の総額に戻す（③ ＝ 原価 ＋ 期末 − 期首）
  const purchases = costNet + closingInv - openingInv;
  const subtotal4 = openingInv + purchases;
  const cost6 = subtotal4 - closingInv;
  const gross7 = sales - cost6;

  // ---- 経費 ----
  const expenses = pl.filter((r) => r.category === "expense" && !used.has(r.code + r.name));
  const spouse = expenses.filter((r) => SPOUSE_SALARY.test(r.name));
  const provision = expenses.filter((r) => BAD_DEBT_PROVISION.test(r.name));
  const personal = expenses.filter((r) => PERSONAL_TAX.test(r.name));
  if (personal.length)
    warnings.push(`「${personal.map((r) => r.name).join("・")}」は事業の経費になりません（事業主貸で処理します）。経費から外してください。`);
  const ordinary = expenses.filter((r) => !SPOUSE_SALARY.test(r.name) && !BAD_DEBT_PROVISION.test(r.name));

  const fixed = new Map<string, BlueLine>(EXPENSE_LINES.map((l) => [l.no, { no: l.no, label: l.label, amount: 0, accounts: [] }]));
  const others: BlueTbRow[] = [];
  for (const r of ordinary) {
    const hit = EXPENSE_LINES.find((l) => l.match.test(r.name));
    if (hit) {
      const line = fixed.get(hit.no)!;
      line.amount += net(r);
      line.accounts.push(r.name);
    } else if (net(r) !== 0) others.push(r);
  }
  others.sort((a, b) => Math.abs(net(b)) - Math.abs(net(a)));
  const free: BlueLine[] = others.slice(0, FREE_PL_LINES).map((r, k) => ({ no: String(25 + k), label: short(r.name), amount: net(r), accounts: [r.name] }));
  const overflow = others.slice(FREE_PL_LINES);
  if (overflow.length) {
    const misc = fixed.get("31")!;
    for (const r of overflow) {
      misc.amount += net(r);
      misc.accounts.push(r.name);
    }
    warnings.push(`自由記入の行（㉕〜㉚）は6行までのため、「${overflow.map((r) => r.name).join("・")}」を雑費にまとめました。`);
  }
  const expenseLines = [...EXPENSE_LINES.filter((l) => l.no !== "31").map((l) => fixed.get(l.no)!), ...free, fixed.get("31")!];
  const total32 = expenseLines.reduce((s, l) => s + l.amount, 0);
  const diff33 = gross7 - total32;

  const reversal34 = reversals.reduce((s, r) => s - net(r), 0);
  const total37 = reversal34;
  const spouse38 = spouse.reduce((s, r) => s + net(r), 0);
  const provision39 = provision.reduce((s, r) => s + net(r), 0);
  const total42 = spouse38 + provision39;
  const before43 = diff33 + total37 - total42;
  // 青色申告特別控除（不動産所得は無いものとして事業所得から）
  const deduction = Math.min(p.deductionLimit, Math.max(0, before43));
  const income45 = before43 - deduction;

  const plLines: BlueLine[] = [
    { no: "1", label: "売上（収入）金額（雑収入を含む）", amount: sales, accounts: revenues.map((r) => r.name) },
    { no: "2", label: "期首商品（製品）棚卸高", amount: openingInv, accounts: inventories.map((r) => r.name) },
    { no: "3", label: "仕入金額（製品製造原価）", amount: purchases, accounts: costs.map((r) => r.name) },
    { no: "4", label: "小計（②＋③）", amount: subtotal4, accounts: [] },
    { no: "5", label: "期末商品（製品）棚卸高", amount: closingInv, accounts: inventories.map((r) => r.name) },
    { no: "6", label: "差引原価（④－⑤）", amount: cost6, accounts: [] },
    { no: "7", label: "差引金額（①－⑥）", amount: gross7, accounts: [] },
    ...expenseLines,
    { no: "32", label: "計", amount: total32, accounts: [] },
    { no: "33", label: "差引金額（⑦－㉜）", amount: diff33, accounts: [] },
    { no: "34", label: "繰戻額等 貸倒引当金", amount: reversal34, accounts: reversals.map((r) => r.name) },
    { no: "37", label: "繰戻額等 計", amount: total37, accounts: [] },
    { no: "38", label: "繰入額等 専従者給与", amount: spouse38, accounts: spouse.map((r) => r.name) },
    { no: "39", label: "繰入額等 貸倒引当金", amount: provision39, accounts: provision.map((r) => r.name) },
    { no: "42", label: "繰入額等 計", amount: total42, accounts: [] },
    { no: "43", label: "青色申告特別控除前の所得金額（㉝＋㊲－㊷）", amount: before43, accounts: [] },
    { no: "44", label: "青色申告特別控除額", amount: deduction, accounts: [] },
    { no: "45", label: "所得金額（㊸－㊹）", amount: income45, accounts: [] },
  ];

  // ---- 貸借対照表 ----
  const bsRows = p.tb.filter((r) => r.category === "asset" || r.category === "liability" || r.category === "equity");
  // 貸倒引当金は資産の科目（評価勘定）でも負債の側に書く
  const assetsRows = bsRows.filter((r) => r.category === "asset" && !OWNER_DRAW.test(r.name) && !ALLOWANCE.test(r.name));
  const assetLines: BsLine[] = ASSET_LINES.map((l) => ({ label: l.label, opening: 0, closing: 0, accounts: [] }));
  const assetOthers: BsLine[] = [];
  for (const r of assetsRows) {
    if (r.prevBalance === 0 && r.currentBalance === 0) continue;
    const k = ASSET_LINES.findIndex((l) => l.match.test(r.name));
    const line = k >= 0 ? assetLines[k] : null;
    if (line) {
      line.opening! += r.prevBalance;
      line.closing += r.currentBalance;
      line.accounts.push(r.name);
    } else assetOthers.push({ label: short(r.name), opening: r.prevBalance, closing: r.currentBalance, accounts: [r.name] });
  }
  const draw = bsRows.filter((r) => OWNER_DRAW.test(r.name));
  const drawLine: BsLine = { label: "事業主貸", opening: null, closing: draw.reduce((s, r) => s + net(r), 0), accounts: draw.map((r) => r.name) };
  const assetsAll = [...assetLines, ...fold(assetOthers, FREE_BS_LINES, "その他の資産", warnings), drawLine];

  const liabRows = bsRows.filter((r) => r.category === "liability" && !OWNER_CONTRIB.test(r.name));
  const liabLines: BsLine[] = LIABILITY_LINES.map((l) => ({ label: l.label, opening: 0, closing: 0, accounts: [] }));
  const liabOthers: BsLine[] = [];
  const reserveOthers: BsLine[] = [];
  const allowance: BsLine = { label: "貸倒引当金", opening: 0, closing: 0, accounts: [] };
  // 貸倒引当金は資産のマイナス（評価勘定）として科目が資産に入っていることもある
  for (const r of [...liabRows, ...bsRows.filter((x) => x.category === "asset" && ALLOWANCE.test(x.name))]) {
    if (r.prevBalance === 0 && r.currentBalance === 0) continue;
    const opening = -r.prevBalance;
    const closing = -r.currentBalance;
    if (ALLOWANCE.test(r.name)) {
      allowance.opening! += opening;
      allowance.closing += closing;
      allowance.accounts.push(r.name);
      continue;
    }
    const k = LIABILITY_LINES.findIndex((l) => l.match.test(r.name));
    if (k >= 0) {
      liabLines[k].opening! += opening;
      liabLines[k].closing += closing;
      liabLines[k].accounts.push(r.name);
    } else (RESERVE.test(r.name) ? reserveOthers : liabOthers).push({ label: short(r.name), opening, closing, accounts: [r.name] });
  }
  const contrib = bsRows.filter((r) => OWNER_CONTRIB.test(r.name));
  const contribLine: BsLine = { label: "事業主借", opening: null, closing: contrib.reduce((s, r) => s - net(r), 0), accounts: contrib.map((r) => r.name) };

  const assetOpening = assetsAll.reduce((s, l) => s + (l.opening ?? 0), 0);
  const liabilityItems = [...liabLines, ...fold(liabOthers, FREE_BS_LINES, "その他の負債", warnings), allowance, ...fold(reserveOthers, FREE_BS_LINES, "その他の引当金", warnings)];
  const liabOpening = liabilityItems.reduce((s, l) => s + (l.opening ?? 0), 0);
  const capitalAmount = assetOpening - liabOpening;
  const capitalBooks = bsRows.filter((r) => CAPITAL.test(r.name));
  const capitalLine: BsLine = { label: "元入金", opening: capitalAmount, closing: capitalAmount, accounts: capitalBooks.map((r) => r.name) };
  const booked = capitalBooks.reduce((s, r) => s - r.prevBalance, 0);
  if (capitalBooks.length && booked !== capitalAmount)
    warnings.push(
      `帳簿の元入金（${booked.toLocaleString()}円）が、期首の資産−負債（${capitalAmount.toLocaleString()}円）と合いません。前年の事業主貸・事業主借・所得を元入金に振り替えたか確かめてください（決算書は期首の資産−負債で書きます）。`
    );
  const otherEquity = bsRows.filter((r) => r.category === "equity" && !CAPITAL.test(r.name) && !OWNER_CONTRIB.test(r.name) && (r.prevBalance !== 0 || r.currentBalance !== 0));
  if (otherEquity.length) warnings.push(`「${otherEquity.map((r) => r.name).join("・")}」は個人事業の貸借対照表に無い科目です。元入金に振り替えてください。`);

  const incomeLine: BsLine = { label: "青色申告特別控除前の所得金額", opening: null, closing: before43, accounts: [] };
  const capital = [contribLine, capitalLine, incomeLine];
  const assetTotal = { opening: assetOpening, closing: assetsAll.reduce((s, l) => s + l.closing, 0) };
  const liabilityTotal = {
    opening: liabOpening + capitalAmount,
    closing: liabilityItems.reduce((s, l) => s + l.closing, 0) + capital.reduce((s, l) => s + l.closing, 0),
  };
  if (assetTotal.closing !== liabilityTotal.closing)
    warnings.push(
      `期末の資産合計（${assetTotal.closing.toLocaleString()}円）と負債・資本合計（${liabilityTotal.closing.toLocaleString()}円）が合いません。損益の期間と貸借対照表の日付がそろっているか、記帳に誤りが無いか確かめてください。`
    );

  return {
    pl: plLines,
    bs: { assets: assetsAll, liabilities: liabilityItems, capital, assetTotal, liabilityTotal },
    incomeBeforeDeduction: before43,
    deduction,
    income: income45,
    deductionCalc: { limit: p.deductionLimit, realEstate: 0, business: Math.max(0, before43), deducted: deduction },
    warnings,
  };
}

/** 自由記入の行に収まらない分を最後の行にまとめる */
function fold(lines: BsLine[], max: number, label: string, warnings: string[]): BsLine[] {
  if (lines.length <= max) return lines;
  const keep = lines.slice(0, max - 1);
  const rest = lines.slice(max - 1);
  warnings.push(`貸借対照表の自由記入の行が足りないため、「${rest.flatMap((l) => l.accounts).join("・")}」を「${label}」にまとめました。`);
  return [
    ...keep,
    {
      label,
      opening: rest.reduce((s, l) => s + (l.opening ?? 0), 0),
      closing: rest.reduce((s, l) => s + l.closing, 0),
      accounts: rest.flatMap((l) => l.accounts),
    },
  ];
}
