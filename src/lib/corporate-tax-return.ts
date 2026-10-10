/**
 * 法人税申告書（中小法人・普通法人・青色・単体）の計算。純粋関数。
 *
 * 国税庁の別表の記載要領（令和8年4月1日以後終了事業年度分）・法令、総務省・自治体の地方税の手引に合わせる。
 *   第1段階（国税）: 別表四 → 別表七(一) → 別表一（法人税・地方法人税・防衛特別法人税）→ 別表十五・別表五(一)(二)
 *   第2段階（地方税）: 法人住民税（法人税割・均等割）、法人事業税（所得割）・特別法人事業税（標準税率。変更可）
 *
 * 端数処理
 *   - 課税標準（所得の区分・課税標準法人税額など）は 1,000円未満切り捨て
 *   - 確定税額（差引所得に対する法人税額など）は 100円未満切り捨て
 *
 * 帳簿から決まらない前提（画面にも書く）
 *   - 「法人税、住民税及び事業税」など名前に「法人税」を含む費用科目は、中間納付と期末の納税充当金の繰入とみなす
 *   - 前期分の未納税額は、期首の納税充当金を取り崩して納付し（法人税等 → 道府県民税 → 市町村民税 → 事業税の順）、
 *     足りない分は当期に損金経理（租税公課など）で納付したものとする。損金経理した法人税・住民税は別表四で加算する
 */

export const SME_CAPITAL_LIMIT = 100_000_000;

export type LossCarryforward = { periodEnd: string; amount: number };
export type Adjustment = { kind: "add" | "deduct"; name: string; amount: number; treatment: "retained" | "outflow" };
export type RetainedItem = { name: string; amount: number };
/** 事務所（地方税の按分に使う）。税率は自治体の超過税率があるときだけ */
export type Office = {
  name: string;
  prefecture: string;
  municipality: string;
  /** 期末の従業者数 */
  employees: number;
  /** 事務所があった月数（均等割） */
  months: number;
  prefecturalRate?: number | null;
  municipalRate?: number | null;
};
/** 欠損金の繰戻し還付（中小法人）: 前1年以内に開始した事業年度（還付所得事業年度）の数字 */
export type Carryback = {
  /** 還付所得事業年度の所得金額 */
  priorIncome: number;
  /** 還付所得事業年度の法人税額（所得税額控除などの前） */
  priorCorporateTax: number;
  /** 還付所得事業年度の地方法人税額 */
  priorLocalCorporateTax: number;
  /** 繰り戻す欠損金額 */
  amount: number;
};

export type LocalTaxRates = {
  /** 法人税割（道府県・市町村） */
  prefectural: number;
  municipal: number;
  /** 均等割の年額（標準税率と違うとき） */
  prefecturalPerCapita?: number | null;
  municipalPerCapita?: number | null;
  /** 事業税の所得割（年400万円以下・400万円超800万円以下・800万円超） */
  enterprise: [number, number, number];
  /** 軽減税率不適用法人（3以上の都道府県に事務所等があり資本金1,000万円以上） */
  reducedRateExcluded: boolean;
};

export const STANDARD_LOCAL_RATES: LocalTaxRates = {
  prefectural: 0.01,
  municipal: 0.06,
  enterprise: [0.035, 0.053, 0.07],
  reducedRateExcluded: false,
};

export type CorporateInput = {
  period: { start: string; end: string; months: number };
  /** 期末の資本金等の額。null は不明（中小法人として扱い、注意を出す） */
  capital: number | null;
  employees: number | null;
  /** 当期利益（損益計算書。収益 − 費用） */
  netIncome: number;
  /** 名前に「法人税」を含む費用科目の当期の計上額（中間納付＋納税充当金の繰入） */
  taxExpenseBooked: number;
  /** 交際費の当期の額 */
  entertainment: number;
  /** うち接待飲食費（入力があれば50%基準と比べる） */
  entertainmentDining: number | null;
  /** 固定資産台帳の償却超過額・認容額、期首・期末の繰越償却超過額 */
  depreciation: { excess: number; allowed: number; openingExcess: number; closingExcess: number };
  /** 法人税額から控除する所得税額 */
  withholdingTax: number;
  adjustments: Adjustment[];
  losses: LossCarryforward[];
  interim: { corporate: number; localCorporate: number; prefectural: number; municipal: number; enterprise: number };
  /** 期首の利益積立金（別表五(一)①）。名前で 納税充当金・未納法人税等・未納道府県民税・未納市町村民税 を読み分ける */
  openingRetained: RetainedItem[];
  /** 期首・期末の繰越利益剰余金（貸方をプラス。期末は当期利益を振り替える前） */
  retainedEarnings: { opening: number; closingBeforeIncome: number };
  /** 前期分の事業税・特別法人事業税で、当期に納税充当金から納付した額（別表四「13」で減算） */
  priorEnterpriseTaxPaid: number;
  localRates: LocalTaxRates;
  /** 事務所が2つ以上の自治体にあるとき（無ければ1か所として計算） */
  offices?: Office[];
  carryback?: Carryback | null;
};

/** 表の1行。values は列ごとの値（列の無い欄は null） */
export type TaxRow = { no: string; label: string; values: (number | null)[]; note?: string };
export type TaxTable = { key: string; title: string; columns: string[]; rows: TaxRow[] };

export type CorporateTaxReturn = {
  tables: TaxTable[];
  income: number; // 別表四「52」（マイナスは欠損）
  taxes: {
    corporate: number; // 差引確定法人税額（中間を引いた後。マイナスは還付）
    localCorporate: number;
    defense: number | null; // 防衛特別法人税（対象外は null）
    prefectural: number;
    municipal: number;
    enterprise: number;
    specialEnterprise: number;
  };
  /** 当期の確定税額の合計（中間分を含む。納税充当金の目安） */
  totalTaxForPeriod: number;
  /** この申告で納める（マイナスは還付）合計 */
  totalPayable: number;
  isSme: boolean;
  nextLosses: LossCarryforward[];
  /** 別表五(一) の期末（翌期首）の利益積立金 */
  closingRetained: RetainedItem[];
  warnings: string[];
};

const floor1000 = (x: number) => Math.floor(x / 1000) * 1000;
const floor100 = (x: number) => Math.floor(x / 100) * 100;
/** 率（小数）を掛けて 1円未満切り捨て。率は小数第4位までを想定し、誤差を避けて整数で計算する */
const mulRate = (x: number, rate: number) => Math.floor((x * Math.round(rate * 100000)) / 100000);
const pos = (x: number) => Math.max(0, x);

const addYears = (iso: string, years: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** 均等割の年額（標準税率） */
export function perCapitaTax(capital: number, employees: number): { prefectural: number; municipal: number } {
  const over50 = employees > 50;
  if (capital <= 10_000_000) return { prefectural: 20_000, municipal: over50 ? 120_000 : 50_000 };
  if (capital <= 100_000_000) return { prefectural: 50_000, municipal: over50 ? 150_000 : 130_000 };
  if (capital <= 1_000_000_000) return { prefectural: 130_000, municipal: over50 ? 400_000 : 160_000 };
  if (capital <= 5_000_000_000) return { prefectural: 540_000, municipal: over50 ? 1_750_000 : 410_000 };
  return { prefectural: 800_000, municipal: over50 ? 3_000_000 : 410_000 };
}

/** 防衛特別法人税の対象か（2026年4月1日以後に開始する事業年度） */
export const defenseTaxApplies = (periodStart: string) => periodStart >= "2026-04-01";

const NAMES = {
  provision: "納税充当金",
  unpaidCorporate: "未納法人税等",
  unpaidPrefectural: "未納道府県民税",
  unpaidMunicipal: "未納市町村民税",
  retainedEarnings: "繰越損益金",
  depreciation: "減価償却超過額",
};
const SPECIAL = new Set(Object.values(NAMES));

export function computeCorporateTaxReturn(i: CorporateInput): CorporateTaxReturn {
  const warnings: string[] = [];
  const m = i.period.months;
  const isSme = i.capital === null || i.capital <= SME_CAPITAL_LIMIT;
  if (i.capital === null) warnings.push("資本金が登録されていないため、中小法人（資本金1億円以下）として計算しています。顧問先の設定で資本金を入れてください。");

  const opening = (name: string) => i.openingRetained.find((r) => r.name === name)?.amount ?? 0;
  const openingProvision = opening(NAMES.provision);
  // 前期分の未納税額の納付: 納税充当金の取崩し（③）と損金経理（⑤）に分ける
  let provisionLeft = openingProvision;
  const settlePrior = (unpaid: number) => {
    const fromProvision = Math.min(pos(provisionLeft), unpaid);
    provisionLeft -= fromProvision;
    return { unpaid, fromProvision, expensed: unpaid - fromProvision };
  };
  const priorCorp = settlePrior(-opening(NAMES.unpaidCorporate));
  const priorPref = settlePrior(-opening(NAMES.unpaidPrefectural));
  const priorMuni = settlePrior(-opening(NAMES.unpaidMunicipal));
  const priorEnt = settlePrior(i.priorEnterpriseTaxPaid);
  const provisionUsed = openingProvision - provisionLeft;
  const interimNationalLocal = i.interim.corporate + i.interim.localCorporate + i.interim.prefectural + i.interim.municipal;
  const interimAll = interimNationalLocal + i.interim.enterprise;

  // ===================== 別表十五 交際費等 =====================
  const fixedLimit = isSme ? Math.min(i.entertainment, Math.floor((8_000_000 * m) / 12)) : 0;
  const diningLimit = i.entertainmentDining !== null ? Math.floor((i.entertainmentDining * 50) / 100) : 0;
  const entLimit = Math.max(fixedLimit, diningLimit);
  const entDisallowed = pos(i.entertainment - entLimit);

  // ===================== 別表四 所得の金額の計算 =====================
  // 列: ①総額 ②留保 ③社外流出
  type L = { no: string; label: string; total: number; retained: number; outflow: number; note?: string };
  const adds: L[] = [];
  const deducts: L[] = [];
  const add = (arr: L[], no: string, label: string, amount: number, treatment: "retained" | "outflow", note?: string) => {
    if (amount === 0) return;
    arr.push({ no, label, total: amount, retained: treatment === "retained" ? amount : 0, outflow: treatment === "outflow" ? amount : 0, note });
  };
  // 損金経理をした法人税・住民税（中間分）と、納税充当金の繰入
  const interimBookedAddBack = Math.min(i.taxExpenseBooked, interimNationalLocal);
  const provisionBooked = pos(i.taxExpenseBooked - interimAll);
  add(adds, "2・3", "損金経理をした法人税・地方法人税・住民税（中間分）", interimBookedAddBack, "retained");
  add(adds, "4", "損金経理をした納税充当金", provisionBooked, "retained", "別表五(二)「31」");
  add(adds, "6", "減価償却の償却超過額", i.depreciation.excess, "retained", "固定資産台帳（別表十六）");
  add(adds, "8", "交際費等の損金不算入額", entDisallowed, "outflow", "別表十五「5」");
  for (const a of i.adjustments.filter((x) => x.kind === "add")) add(adds, "10", a.name, a.amount, a.treatment);
  add(deducts, "12", "減価償却超過額の当期認容額", i.depreciation.allowed, "retained", "固定資産台帳（別表十六）");
  add(
    adds,
    "2・3",
    "損金経理をした法人税・住民税（前期分）",
    priorCorp.expensed + priorPref.expensed + priorMuni.expensed,
    "retained",
    "期首の納税充当金で足りない分を当期の経費で納付"
  );
  add(deducts, "13", "納税充当金から支出した事業税等の金額", priorEnt.fromProvision, "retained", "別表五(二)「35」");
  for (const a of i.adjustments.filter((x) => x.kind === "deduct")) add(deducts, "21", a.name, a.amount, a.treatment);

  const sum = (arr: L[], k: "total" | "retained" | "outflow") => arr.reduce((s, x) => s + x[k], 0);
  const addTotal = { total: sum(adds, "total"), retained: sum(adds, "retained"), outflow: sum(adds, "outflow") };
  const dedTotal = { total: sum(deducts, "total"), retained: sum(deducts, "retained"), outflow: sum(deducts, "outflow") };
  // 当期利益は留保（配当は無いものとする）
  const line26 = {
    total: i.netIncome + addTotal.total - dedTotal.total,
    retained: i.netIncome + addTotal.retained - dedTotal.retained,
    outflow: addTotal.outflow - dedTotal.outflow,
  };
  const withholdingCredit = i.withholdingTax; // 「29」法人税額から控除される所得税額（加算・社外流出）
  const line43 = line26.total + withholdingCredit;

  // ===================== 別表七(一) 欠損金 =====================
  const limit7 = line43 > 0 ? (isSme ? line43 : Math.floor(line43 / 2)) : 0;
  const sortedLosses = [...i.losses].filter((l) => l.amount > 0).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  let room = limit7;
  const lossRows = sortedLosses.map((l) => {
    // 2018年4月1日以後に開始した事業年度の欠損金は10年、それより前は9年
    const years = l.periodEnd >= "2019-03-31" ? 10 : 9;
    const expired = i.period.start > addYears(l.periodEnd, years);
    const used = expired ? 0 : Math.min(l.amount, room);
    room -= used;
    return { ...l, used, carry: expired ? 0 : l.amount - used, expired };
  });
  if (lossRows.some((r) => r.expired)) warnings.push("繰越期限（10年・2018年3月以前に開始した事業年度は9年）を過ぎた欠損金があります。控除していません。");
  const lossUsed = lossRows.reduce((s, r) => s + r.used, 0);
  const income = line43 - lossUsed; // 「52」
  let nextLosses: LossCarryforward[] = [
    ...lossRows.filter((r) => r.carry > 0).map((r) => ({ periodEnd: r.periodEnd, amount: r.carry })),
    ...(income < 0 ? [{ periodEnd: i.period.end, amount: -income }] : []),
  ];

  // ===================== 別表一 法人税・地方法人税 =====================
  const taxable = pos(income);
  const annualIncome = m > 0 && m < 12 ? (taxable * 12) / m : taxable;
  const smeBracket = isSme ? Math.floor((8_000_000 * m) / 12) : 0;
  const line74 = floor1000(Math.min(taxable, smeBracket));
  const line76 = floor1000(taxable - line74);
  const lowRate = annualIncome > 1_000_000_000 ? 0.17 : 0.15;
  const line77 = mulRate(line74, lowRate);
  const line79 = mulRate(line76, 0.232);
  const line2 = line77 + line79;
  const line9 = line2;
  const line12 = Math.min(line9, i.withholdingTax);
  const line13 = floor100(line9 - line12);
  const line15 = line13 - i.interim.corporate; // マイナスは中間納付額の還付「22」
  const line21 = i.withholdingTax - line12;
  const line30 = floor1000(line2); // 課税標準法人税額（所得税額控除の前）
  const line31 = mulRate(line30, 0.103);
  const line38 = floor100(line31);
  const line40 = line38 - i.interim.localCorporate;

  // 防衛特別法人税
  let defense: { base: number; deduction: number; taxBase: number; tax: number; final: number } | null = null;
  if (defenseTaxApplies(i.period.start)) {
    const deduction = Math.floor((5_000_000 * m) / 12);
    const taxBase = floor1000(pos(line2 - deduction));
    const tax = mulRate(taxBase, 0.04);
    defense = { base: line2, deduction, taxBase, tax, final: floor100(tax) };
  }

  // ===================== 地方税（第2段階） =====================
  const r = i.localRates;
  // 事務所の一覧（入力が無ければ1か所）
  const offices: Office[] =
    i.offices && i.offices.length > 0
      ? i.offices
      : [{ name: "本店", prefecture: "", municipality: "", employees: i.employees ?? 0, months: m }];
  const multi = offices.length > 1;
  const totalEmployees = offices.reduce((t, o) => t + Math.max(0, o.employees), 0);
  /** 従業者数で按分（従業者が0人なら事務所の数で均等に） */
  const share = (amount: number, emp: number) =>
    totalEmployees > 0 ? Math.floor((amount * emp) / totalEmployees) : Math.floor(amount / offices.length);
  const prefectures = [...new Set(offices.map((o) => o.prefecture))];
  const reducedRateExcluded = r.reducedRateExcluded || (prefectures.length >= 3 && (i.capital ?? 0) >= 10_000_000);
  if (reducedRateExcluded && !r.reducedRateExcluded)
    warnings.push("3つ以上の都道府県に事務所があり資本金1,000万円以上のため、事業税は軽減税率不適用法人（全額7.0%）として計算しています。");
  if (multi && totalEmployees === 0) warnings.push("事務所ごとの従業者数が入っていないため、事務所の数で均等に按分しています。");

  // 法人税割: 課税標準＝法人税額計（所得税額控除の前）。防衛特別法人税は含めない
  const residentBase = floor1000(line9);
  const capitalForPerCapita = i.capital ?? 0;
  type PrefUnit = { prefecture: string; base: number; levy: number; perCapita: number; rate: number; months: number };
  type MuniUnit = { label: string; base: number; levy: number; perCapita: number; rate: number; employees: number; months: number };
  const prefUnits: PrefUnit[] = prefectures.map((pref) => {
    const os = offices.filter((o) => o.prefecture === pref);
    const emp = os.reduce((t, o) => t + Math.max(0, o.employees), 0);
    const base = multi ? floor1000(share(residentBase, totalEmployees > 0 ? emp : os.length)) : residentBase;
    const rate = os.find((o) => o.prefecturalRate != null)?.prefecturalRate ?? r.prefectural;
    const months = Math.max(...os.map((o) => o.months));
    const annual = r.prefecturalPerCapita ?? perCapitaTax(capitalForPerCapita, 0).prefectural;
    return { prefecture: pref, base, levy: floor100(mulRate(base, rate)), perCapita: floor100(Math.floor((annual * months) / 12)), rate, months };
  });
  const muniUnits: MuniUnit[] = offices.map((o) => {
    const base = multi ? floor1000(share(residentBase, totalEmployees > 0 ? o.employees : 1)) : residentBase;
    const rate = o.municipalRate ?? r.municipal;
    const annual = r.municipalPerCapita ?? perCapitaTax(capitalForPerCapita, o.employees).municipal;
    return {
      label: [o.prefecture, o.municipality].filter(Boolean).join(" ") || o.name,
      base,
      levy: floor100(mulRate(base, rate)),
      perCapita: floor100(Math.floor((annual * o.months) / 12)),
      rate,
      employees: o.employees,
      months: o.months,
    };
  });
  const prefecturalLevy = prefUnits.reduce((t, u) => t + u.levy, 0);
  const municipalLevy = muniUnits.reduce((t, u) => t + u.levy, 0);
  const prefPerCapita = prefUnits.reduce((t, u) => t + u.perCapita, 0);
  const muniPerCapita = muniUnits.reduce((t, u) => t + u.perCapita, 0);
  const prefectural = prefecturalLevy + prefPerCapita;
  const municipal = municipalLevy + muniPerCapita;

  // 事業税（所得割）: 所得を年400万円・800万円（月割り）で区分し、各区分は1,000円未満切り捨て。
  // 2以上の都道府県に事務所があれば、各区分を従業者数で都道府県ごとに分ける
  const eIncome = taxable;
  const b1 = Math.floor((4_000_000 * m) / 12);
  const b2 = Math.floor((8_000_000 * m) / 12);
  const seg1 = reducedRateExcluded ? 0 : floor1000(Math.min(eIncome, b1));
  const seg2 = reducedRateExcluded ? 0 : floor1000(pos(Math.min(eIncome, b2) - b1));
  const seg3 = reducedRateExcluded ? floor1000(eIncome) : floor1000(pos(eIncome - b2));
  type EntUnit = { prefecture: string; segs: [number, number, number]; tax: number; standardTax: number; special: number };
  const entUnits: EntUnit[] = prefectures.map((pref) => {
    const emp = offices.filter((o) => o.prefecture === pref).reduce((t, o) => t + Math.max(0, o.employees), 0);
    const part = (x: number) => (prefectures.length > 1 ? floor1000(share(x, totalEmployees > 0 ? emp : 1)) : x);
    const segs: [number, number, number] = [part(seg1), part(seg2), part(seg3)];
    const taxOf = (rates: [number, number, number]) =>
      floor100(floor100(mulRate(segs[0], rates[0])) + floor100(mulRate(segs[1], rates[1])) + floor100(mulRate(segs[2], rates[2])));
    const tax = taxOf(r.enterprise);
    // 特別法人事業税: 標準税率で計算した所得割額 × 37%
    const standardTax = taxOf(STANDARD_LOCAL_RATES.enterprise);
    return { prefecture: pref, segs, tax, standardTax, special: floor100(mulRate(standardTax, 0.37)) };
  });
  const enterprise = entUnits.reduce((t, u) => t + u.tax, 0);
  const standardEnterprise = entUnits.reduce((t, u) => t + u.standardTax, 0);
  const specialEnterprise = entUnits.reduce((t, u) => t + u.special, 0);

  // ===================== 欠損金の繰戻し還付（中小法人） =====================
  let carrybackRefund = 0;
  let carrybackLocalRefund = 0;
  let carrybackUsed = 0;
  const cb = i.carryback;
  if (cb && cb.amount > 0) {
    if (!isSme) warnings.push("欠損金の繰戻し還付は、中小法人等（資本金1億円以下など）だけが使えます。");
    const currentLoss = income < 0 ? -income : 0;
    carrybackUsed = Math.min(cb.amount, currentLoss, Math.max(0, cb.priorIncome));
    if (carrybackUsed < cb.amount) warnings.push("繰り戻す欠損金額が、当期の欠損金額または前期の所得金額を超えるため、超えない額にしています。");
    if (isSme && cb.priorIncome > 0 && carrybackUsed > 0) {
      carrybackRefund = Math.floor((cb.priorCorporateTax * carrybackUsed) / cb.priorIncome);
      carrybackLocalRefund = Math.floor((cb.priorLocalCorporateTax * carrybackUsed) / cb.priorIncome);
    }
  }

  // 繰り戻した欠損金は、翌期へ繰り越さない
  if (carrybackUsed > 0)
    nextLosses = nextLosses
      .map((l) => (l.periodEnd === i.period.end ? { ...l, amount: l.amount - carrybackUsed } : l))
      .filter((l) => l.amount > 0);

  // ===================== 合計 =====================
  const finalCorporate = line13 + line38 + (defense?.final ?? 0);
  const totalTaxForPeriod = finalCorporate + prefectural + municipal + enterprise + specialEnterprise;
  const taxes = {
    corporate: line15 - carrybackRefund,
    localCorporate: line40 - carrybackLocalRefund,
    defense: defense ? defense.final : null,
    prefectural: prefectural - i.interim.prefectural,
    municipal: municipal - i.interim.municipal,
    enterprise: enterprise + specialEnterprise - i.interim.enterprise,
    specialEnterprise,
  };
  const totalPayable =
    taxes.corporate + taxes.localCorporate + (taxes.defense ?? 0) + taxes.prefectural + taxes.municipal + taxes.enterprise - line21;

  // ===================== 別表五(一) 利益積立金 =====================
  // 列: ①期首 ②減 ③増 ④差引翌期首（＝①−②＋③）
  type R5 = { name: string; open: number; dec: number; inc: number };
  const rows5: R5[] = [];
  for (const o of i.openingRetained.filter((x) => !SPECIAL.has(x.name))) rows5.push({ name: o.name, open: o.amount, dec: 0, inc: 0 });
  // 手入力の加算・減算のうち留保のものは、名前ごとに増減させる
  for (const a of i.adjustments.filter((x) => x.treatment === "retained")) {
    let row = rows5.find((x) => x.name === a.name);
    if (!row) rows5.push((row = { name: a.name, open: 0, dec: 0, inc: 0 }));
    if (a.kind === "add") row.inc += a.amount;
    else row.dec += a.amount;
  }
  rows5.push({
    name: NAMES.depreciation,
    open: i.depreciation.openingExcess,
    dec: i.depreciation.allowed,
    inc: i.depreciation.excess,
  });
  const closingRetainedEarnings = i.retainedEarnings.closingBeforeIncome + i.netIncome;
  rows5.push({
    name: NAMES.retainedEarnings,
    open: i.retainedEarnings.opening,
    dec: i.retainedEarnings.opening,
    inc: closingRetainedEarnings,
  });
  rows5.push({ name: NAMES.provision, open: openingProvision, dec: provisionUsed, inc: provisionBooked });
  const unpaidRow = (name: string, interim: number, final: number) => {
    const o = opening(name); // 期首は△（マイナス）で入っている
    return { name, open: o, dec: o - interim, inc: -(interim + final) };
  };
  rows5.push(unpaidRow(NAMES.unpaidCorporate, i.interim.corporate + i.interim.localCorporate, finalCorporate));
  rows5.push(unpaidRow(NAMES.unpaidPrefectural, i.interim.prefectural, prefectural));
  rows5.push(unpaidRow(NAMES.unpaidMunicipal, i.interim.municipal, municipal));
  const close5 = (x: R5) => x.open - x.dec + x.inc;
  const total5 = rows5.reduce(
    (s, x) => ({ open: s.open + x.open, dec: s.dec + x.dec, inc: s.inc + x.inc, close: s.close + close5(x) }),
    { open: 0, dec: 0, inc: 0, close: 0 }
  );
  // 検算: 31① ＋ 別表四「52」② − 中間分・確定分の法人税等・住民税 ＝ 31④
  const taxesOfPeriod = interimNationalLocal + finalCorporate + prefectural + municipal;
  const retained52 = line26.retained; // 欠損金控除と所得税額は社外流出（※）なので留保に入らない
  const check = total5.open + retained52 - taxesOfPeriod;
  if (Math.abs(check - total5.close) > 1)
    warnings.push(
      `別表五(一)の検算が ${Math.abs(check - total5.close).toLocaleString()}円 合いません。期首の利益積立金・納税充当金の入力や、法人税等の科目の計上を確認してください。`
    );

  // ===================== 表 =====================
  const tables: TaxTable[] = [];
  const c1 = (no: string, label: string, v: number | null, note?: string): TaxRow => ({ no, label, values: [v], note });

  tables.push({
    key: "beppyo1",
    title: "別表一 各事業年度の所得に係る申告書（法人税・地方法人税）",
    columns: ["金額"],
    rows: [
      c1("1", "所得金額又は欠損金額", income, "別表四「52」"),
      c1("74", `中小法人等の年800万円相当額以下の金額${isSme ? `（800万円×${m}/12）` : ""}`, line74, "1,000円未満切り捨て"),
      c1("76", "その他の所得金額", line76, "1,000円未満切り捨て"),
      c1("77", `(74)の${lowRate === 0.17 ? "17" : "15"}%相当額`, line77),
      c1("79", "(76)の23.2%相当額", line79),
      c1("2", "法人税額（77）＋（79）", line2),
      c1("9", "法人税額計", line9),
      c1("12", "控除税額（所得税額）", line12, "別表六(一)"),
      c1("13", "差引所得に対する法人税額", line13, "100円未満切り捨て"),
      c1("14", "中間申告分の法人税額", i.interim.corporate),
      c1("15", "差引確定法人税額", pos(line15)),
      c1("21", "所得税額等の還付金額", line21),
      c1("22", "中間納付額（還付）", pos(-line15)),
      ...(carrybackUsed > 0
        ? [
            c1("23", "欠損金の繰戻しによる還付請求税額", carrybackRefund, `繰り戻す欠損金額 ${carrybackUsed.toLocaleString()}円（還付所得事業年度の法人税額 × 欠損金額 ÷ 所得金額）`),
          ]
        : []),
      c1("26", "欠損金等の当期控除額", lossUsed, "別表七(一)"),
      c1("27", "翌期へ繰り越す欠損金額", nextLosses.reduce((s, l) => s + l.amount, 0)),
      c1("28", "所得の金額に対する法人税額（地方法人税の基準）", line2),
      c1("30", "課税標準法人税額", line30, "1,000円未満切り捨て"),
      c1("31", "地方法人税額（30）×10.3%", line31),
      c1("38", "差引地方法人税額", line38, "100円未満切り捨て"),
      c1("39", "中間申告分の地方法人税額", i.interim.localCorporate),
      c1("40", "差引確定地方法人税額", pos(line40)),
      c1("42", "中間納付額（還付）", pos(-line40)),
      ...(carrybackUsed > 0 ? [c1("", "欠損金の繰戻しによる地方法人税の還付請求額", carrybackLocalRefund)] : []),
    ],
  });
  if (defense) {
    tables.push({
      key: "beppyo1-defense",
      title: "別表一次葉一 防衛特別法人税（2026年4月1日以後に開始する事業年度）",
      columns: ["金額"],
      rows: [
        c1("45", "基準法人税額", defense.base),
        c1("47", `基礎控除額（500万円×${m}/12）`, defense.deduction),
        c1("67", "課税標準法人税額（45）−（47）", defense.taxBase, "1,000円未満切り捨て"),
        c1("68", "（67）の4%相当額", defense.tax),
        c1("57", "差引防衛特別法人税額", defense.final, "税額が0円でも申告が必要です"),
      ],
    });
  }

  const r4 = (no: string, label: string, t: number, ret: number, out: number, note?: string): TaxRow => ({
    no,
    label,
    values: [t, ret, out],
    note,
  });
  tables.push({
    key: "beppyo4",
    title: "別表四（簡易様式） 所得の金額の計算に関する明細書",
    columns: ["総額①", "留保②", "社外流出③"],
    rows: [
      r4("1", "当期利益又は当期欠損の額", i.netIncome, i.netIncome, 0, "損益計算書"),
      ...adds.map((a) => r4(a.no, `加算: ${a.label}`, a.total, a.retained, a.outflow, a.note)),
      r4("11", "加算 小計", addTotal.total, addTotal.retained, addTotal.outflow),
      ...deducts.map((a) => r4(a.no, `減算: ${a.label}`, a.total, a.retained, a.outflow, a.note)),
      r4("22", "減算 小計", dedTotal.total, dedTotal.retained, dedTotal.outflow),
      r4("26", "仮計", line26.total, line26.retained, line26.outflow),
      r4("29", "法人税額から控除される所得税額", withholdingCredit, 0, withholdingCredit),
      r4("43", "差引計（欠損金控除前の所得）", line43, line26.retained, line26.outflow + withholdingCredit, "別表七(一)「1」へ"),
      r4("44", "欠損金等の当期控除額", -lossUsed, 0, -lossUsed),
      r4("52", "所得金額又は欠損金額", income, line26.retained, line26.outflow + withholdingCredit - lossUsed, "別表一「1」へ"),
    ],
  });

  tables.push({
    key: "beppyo7",
    title: "別表七(一) 欠損金の損金算入等に関する明細書",
    columns: ["控除未済欠損金額", "当期控除額", "翌期繰越額"],
    rows: [
      { no: "1", label: "控除前所得金額（別表四「43」）", values: [line43, null, null] },
      { no: "2", label: `損金算入限度額（${isSme ? "100" : "50"}/100）`, values: [limit7, null, null] },
      ...lossRows.map((l) => ({
        no: "3〜5",
        label: `${l.periodEnd} 終了事業年度の青色欠損金${l.expired ? "（期限切れ）" : ""}`,
        values: [l.amount, l.used, l.carry],
      })),
      ...(income < 0
        ? [{ no: "当期分", label: carrybackUsed > 0 ? `当期の欠損金額（うち繰戻し ${carrybackUsed.toLocaleString()}円）` : "当期の欠損金額", values: [null, carrybackUsed || null, -income - carrybackUsed] }]
        : []),
      { no: "計", label: "合計", values: [lossRows.reduce((s, l) => s + l.amount, 0), lossUsed, nextLosses.reduce((s, l) => s + l.amount, 0)] },
    ],
  });

  tables.push({
    key: "beppyo15",
    title: "別表十五 交際費等の損金算入に関する明細書",
    columns: ["金額"],
    rows: [
      c1("1", "支出交際費等の額", i.entertainment, "交際費の科目の当期の額"),
      c1("2", "支出接待飲食費損金算入基準額（接待飲食費×50%）", i.entertainmentDining === null ? null : diningLimit),
      c1("3", `中小法人等の定額控除限度額（800万円×${m}/12 と（1）の少ない方）`, isSme ? fixedLimit : null),
      c1("4", "損金算入限度額（有利な方）", entLimit),
      c1("5", "損金不算入額", entDisallowed, "別表四「8」へ"),
    ],
  });

  tables.push({
    key: "beppyo5-1",
    title: "別表五(一) 利益積立金額の計算に関する明細書",
    columns: ["期首現在①", "当期の減②", "当期の増③", "差引翌期首現在④"],
    rows: [
      ...rows5.map((x) => ({ no: "", label: x.name, values: [x.open, x.dec, x.inc, close5(x)] })),
      { no: "31", label: "差引合計額", values: [total5.open, total5.dec, total5.inc, total5.close] },
      { no: "32", label: "資本金又は出資金（Ⅱ 資本金等の額）", values: [i.capital, null, null, i.capital] },
    ],
  });

  tables.push({
    key: "beppyo5-2",
    title: "別表五(二) 租税公課の納付状況等に関する明細書",
    columns: ["期首現在未納①", "当期発生②", "充当金取崩しで納付③", "損金経理で納付⑤", "期末現在未納⑥"],
    rows: [
      { no: "1〜2", label: "法人税・地方法人税等 前期分", values: [priorCorp.unpaid, null, priorCorp.fromProvision, priorCorp.expensed, 0] },
      { no: "3", label: "法人税・地方法人税等 当期中間分", values: [null, i.interim.corporate + i.interim.localCorporate, null, i.interim.corporate + i.interim.localCorporate, 0] },
      { no: "4", label: "法人税・地方法人税等 当期確定分", values: [null, finalCorporate, null, null, finalCorporate] },
      { no: "6〜7", label: "道府県民税 前期分", values: [priorPref.unpaid, null, priorPref.fromProvision, priorPref.expensed, 0] },
      { no: "8", label: "道府県民税 当期中間分", values: [null, i.interim.prefectural, null, i.interim.prefectural, 0] },
      { no: "9", label: "道府県民税 当期確定分", values: [null, prefectural, null, null, prefectural] },
      { no: "11〜12", label: "市町村民税 前期分", values: [priorMuni.unpaid, null, priorMuni.fromProvision, priorMuni.expensed, 0] },
      { no: "13", label: "市町村民税 当期中間分", values: [null, i.interim.municipal, null, i.interim.municipal, 0] },
      { no: "14", label: "市町村民税 当期確定分", values: [null, municipal, null, null, municipal] },
      { no: "16〜17", label: "事業税及び特別法人事業税 前期分", values: [priorEnt.unpaid, null, priorEnt.fromProvision, priorEnt.expensed, 0] },
      { no: "18", label: "事業税及び特別法人事業税 当期中間分", values: [null, i.interim.enterprise, null, i.interim.enterprise, 0] },
      { no: "30", label: "期首納税充当金", values: [openingProvision, null, null, null, null] },
      { no: "31", label: "繰入額（損金経理をした納税充当金）", values: [null, provisionBooked, null, null, null], note: "別表四「4」" },
      { no: "34", label: "取崩額（法人税・住民税の納付）", values: [null, null, priorCorp.fromProvision + priorPref.fromProvision + priorMuni.fromProvision, null, null] },
      { no: "35", label: "取崩額（事業税等の納付）", values: [null, null, priorEnt.fromProvision, null, null], note: "別表四「13」" },
      { no: "41", label: "期末納税充当金", values: [null, null, null, null, openingProvision - provisionUsed + provisionBooked] },
    ],
  });

  // 地方税
  tables.push({
    key: "local-resident",
    title: "法人住民税（第六号様式・第二十号様式）",
    columns: ["課税標準", "法人税割", "均等割", "合計"],
    rows: [
      { no: "①", label: "法人税法の規定によって計算した法人税額（別表一「9」）", values: [line9, null, null, null] },
      { no: "⑤", label: `課税標準となる法人税額${multi ? "（従業者数で按分する前）" : ""}`, values: [residentBase, null, null, null], note: "1,000円未満切り捨て" },
      ...prefUnits.map((u) => ({
        no: "道府県",
        label: `${u.prefecture || "道府県民税"}（法人税割 ${(u.rate * 100).toFixed(1)}%・均等割 ${u.months}か月）`,
        values: [u.base, u.levy, u.perCapita, u.levy + u.perCapita],
      })),
      ...muniUnits.map((u) => ({
        no: "市町村",
        label: `${u.label || "市町村民税"}（法人税割 ${(u.rate * 100).toFixed(1)}%・従業者 ${u.employees}人・均等割 ${u.months}か月）`,
        values: [u.base, u.levy, u.perCapita, u.levy + u.perCapita],
      })),
      { no: "", label: "道府県民税の合計 ／ 中間納付 ／ この申告で納付（マイナスは還付）", values: [null, prefectural, i.interim.prefectural, taxes.prefectural] },
      { no: "", label: "市町村民税の合計 ／ 中間納付 ／ この申告で納付（マイナスは還付）", values: [null, municipal, i.interim.municipal, taxes.municipal] },
    ],
  });
  tables.push({
    key: "local-enterprise",
    title: "法人事業税・特別法人事業税（第六号様式）",
    columns: ["年400万円以下", "400万〜800万円", "800万円超", "事業税額", "特別法人事業税"],
    rows: [
      { no: "㉘", label: "所得金額総額", values: [eIncome, null, null, null, null] },
      {
        no: "㉙〜㉛",
        label: `課税標準（${reducedRateExcluded ? "軽減税率不適用法人: 全額を800万円超の欄で7.0%" : `${m}/12で月割り`}）`,
        values: [seg1, seg2, seg3, null, null],
      },
      ...entUnits.map((u) => ({
        no: "",
        label: `${u.prefecture || "都道府県"}${prefectures.length > 1 ? "（従業者数で按分）" : ""}`,
        values: [u.segs[0], u.segs[1], u.segs[2], u.tax, u.special],
        note: `税率 ${r.enterprise.map((x) => (x * 100).toFixed(2)).join("・")}%`,
      })),
      { no: "㊹・⑤⑧", label: "合計（100円未満切り捨て）", values: [null, null, null, enterprise, specialEnterprise], note: `特別法人事業税＝標準税率の所得割額 ${standardEnterprise.toLocaleString()}円 × 37%` },
      { no: "", label: "中間申告で納付の確定した額（事業税＋特別法人事業税）", values: [null, null, null, i.interim.enterprise, null] },
      { no: "㊼・⑥①", label: "この申告により納付すべき額（マイナスは還付）", values: [null, null, null, taxes.enterprise, null] },
    ],
  });

  const closingRetained: RetainedItem[] = rows5.map((x) => ({ name: x.name, amount: close5(x) }));

  return {
    tables,
    income,
    taxes,
    totalTaxForPeriod,
    totalPayable,
    isSme,
    nextLosses,
    closingRetained,
    warnings,
  };
}
