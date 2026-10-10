/**
 * 税区分の判別（純粋関数）。勘定科目と摘要から、消費税の課税・非課税・不課税を判断する。
 *
 *   strong … 法令上はっきりしているもの（給与・社会保険料・税金・利息・保険料・受取配当など）。
 *            付いている税区分と違えば直す
 *   hint   … 取引の中身で変わるもの（会費・住宅家賃・切手・商品券・国外取引など）。理由を示して確認をすすめる
 *
 * どれにも当たらなければ、科目からの初期値（defaultTaxCategory）を使う。
 */

import { defaultTaxCategory, taxCategoryInfo, type TaxCategoryCode } from "@/lib/tax-category";

export type TaxSuggestion = { code: TaxCategoryCode; strength: "strong" | "hint" | "account"; reason: string };

type Rule = {
  side: "purchase" | "sales";
  /** 科目名に当たる */
  account?: RegExp;
  /** 摘要に当たる */
  text?: RegExp;
  /** 当たっても除く（摘要・科目名） */
  unless?: RegExp;
  code: TaxCategoryCode;
  strength: "strong" | "hint";
  reason: string;
};

const RULES: Rule[] = [
  // ---- 仕入側（費用）----
  {
    side: "purchase",
    text: /通勤手当|通勤費/,
    code: "purchase_10",
    strength: "hint",
    reason: "通勤手当は、通常必要な範囲なら課税仕入れになります",
  },
  {
    side: "purchase",
    account: /給料|給与|賃金|賞与|役員報酬|役員賞与|役員給与|雑給|退職金|退職給付/,
    unless: /通勤手当|通勤費/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "給与・役員報酬・退職金は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    account: /法定福利/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "社会保険料・労働保険料は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    text: /社会保険料|健康保険料|厚生年金|雇用保険料|労働保険料|労災保険料/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "社会保険料・労働保険料は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    text: /収入印紙|印紙代/,
    code: "purchase_exempt",
    strength: "strong",
    reason: "収入印紙の購入は非課税です",
  },
  {
    side: "purchase",
    text: /住民票|印鑑証明|印鑑登録証明|戸籍|登記事項証明|登記簿|謄本|納税証明|パスポート|旅券/,
    code: "purchase_exempt",
    strength: "strong",
    reason: "国・地方公共団体の証明書などの手数料は非課税です",
  },
  {
    side: "purchase",
    account: /租税公課|法人税|住民税|事業税/,
    unless: /印紙|住民票|印鑑証明|戸籍|登記|謄本|証明/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "税金は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    text: /自動車税|自動車重量税|固定資産税|登録免許税|印紙税|事業税|住民税|法人税|源泉所得税|消費税/,
    unless: /税理士|会計|申告書作成|代行/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "税金は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    account: /支払利息|支払利子|割引料|手形売却損|支払保証料|信用保証料/,
    code: "purchase_exempt",
    strength: "strong",
    reason: "借入金の利息・保証料は非課税です",
  },
  {
    side: "purchase",
    account: /保険料/,
    unless: /法定福利/,
    code: "purchase_exempt",
    strength: "strong",
    reason: "損害保険料・生命保険料は非課税です",
  },
  {
    side: "purchase",
    account: /減価償却|貸倒引当金繰入|引当金繰入/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "減価償却費・引当金の繰入は取引ではないため、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    account: /寄付|寄附/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "寄付金は対価がないため、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    text: /香典|祝い金|祝金|御祝|お祝い|見舞金|御見舞|お見舞い|慶弔金|餞別/,
    unless: /花|供花|生花|品|ギフト|菓子/,
    code: "purchase_out_of_scope",
    strength: "strong",
    reason: "現金で渡す祝い金・香典・見舞金は、消費税の対象外（不課税）です",
  },
  {
    side: "purchase",
    text: /年会費|会費|組合費|協会費|町内会/,
    unless: /カード|クラブ|ジム|オンライン|サブスク|サービス|利用料/,
    code: "purchase_out_of_scope",
    strength: "hint",
    reason: "同業者団体などの通常の会費は不課税です。セミナー代など対価がはっきりしていれば課税になります",
  },
  {
    side: "purchase",
    text: /住宅|社宅|居住用|アパート/,
    code: "purchase_exempt",
    strength: "hint",
    reason: "住宅（居住用）の家賃は非課税です。事務所・店舗の家賃は課税です",
  },
  {
    side: "purchase",
    text: /地代|土地.*(賃借|賃料|借地)|借地料/,
    unless: /駐車場|月極|コインパーキング/,
    code: "purchase_exempt",
    strength: "hint",
    reason: "土地の貸付けは非課税です（駐車場など施設の利用は課税）",
  },
  {
    side: "purchase",
    text: /商品券|ギフトカード|ギフト券|QUOカード|クオカード|図書カード|プリペイドカード|Amazonギフト/i,
    code: "purchase_exempt",
    strength: "hint",
    reason: "商品券・プリペイドカードの購入は非課税です（使ったときに課税仕入れになります）",
  },
  {
    side: "purchase",
    text: /切手|レターパック|はがき|ハガキ/,
    code: "purchase_10",
    strength: "hint",
    reason: "自社で使う郵便切手類は、継続して購入時に課税仕入れとできます（買ったときは非課税扱いも可）",
  },
  {
    side: "purchase",
    text: /交通費精算|電車|地下鉄|新幹線|タクシー|バス代|航空券|高速道路|ETC|ガソリン|駐車場/,
    unless: /海外|国外|国際線/,
    code: "purchase_10",
    strength: "hint",
    reason: "国内の交通費・駐車場代は課税仕入れ（10%）です",
  },
  {
    side: "purchase",
    text: /海外|国外|国際線|USD|ドル建|外貨/,
    code: "purchase_out_of_scope",
    strength: "hint",
    reason: "国外での取引・国際輸送は、不課税または免税になることがあります",
  },
  // ---- 売上側（収益）----
  {
    side: "sales",
    account: /受取利息|受取利子|有価証券利息/,
    code: "sales_exempt",
    strength: "strong",
    reason: "預金・貸付金の利息は非課税売上です",
  },
  {
    side: "sales",
    account: /受取配当/,
    code: "sales_out_of_scope",
    strength: "strong",
    reason: "受取配当金は、消費税の対象外（不課税）です",
  },
  {
    side: "sales",
    account: /保険金|補助金|助成金|給付金|還付|引当金戻入|償却債権取立/,
    code: "sales_out_of_scope",
    strength: "strong",
    reason: "保険金・補助金・税金の還付金などは対価ではないため、消費税の対象外（不課税）です",
  },
  {
    side: "sales",
    text: /保険金|補助金|助成金|給付金|還付金/,
    code: "sales_out_of_scope",
    strength: "strong",
    reason: "保険金・補助金・還付金などは対価ではないため、消費税の対象外（不課税）です",
  },
  {
    side: "sales",
    text: /住宅|居住用|社宅/,
    code: "sales_exempt",
    strength: "hint",
    reason: "住宅（居住用）の貸付けは非課税売上です",
  },
  {
    side: "sales",
    text: /地代|土地.*(賃貸|賃料|貸付)/,
    unless: /駐車場|月極/,
    code: "sales_exempt",
    strength: "hint",
    reason: "土地の貸付けは非課税売上です（駐車場など施設の利用は課税）",
  },
  {
    side: "sales",
    text: /輸出|海外|国外|export/i,
    code: "sales_tax_free",
    strength: "hint",
    reason: "輸出や国外の事業者へのサービスは、免税売上になることがあります（書類の保存が必要）",
  },
];

/** 科目と摘要から税区分の候補を出す。収益・費用以外は null */
export function suggestTaxCategory(accountType: string, accountName: string, description: string | null | undefined): TaxSuggestion | null {
  if (accountType !== "revenue" && accountType !== "expenses") return null;
  const side = accountType === "revenue" ? "sales" : "purchase";
  const text = description ?? "";
  // 貸倒れは専用の税区分（課税売上の売掛金が貸し倒れたとき）を人が付ける
  if (/貸倒損失/.test(accountName)) return null;
  for (const r of RULES) {
    if (r.side !== side) continue;
    const hit = (r.account && r.account.test(accountName)) || (r.text && r.text.test(text));
    if (!hit) continue;
    if (r.unless && (r.unless.test(text) || r.unless.test(accountName))) continue;
    return { code: r.code, strength: r.strength, reason: r.reason };
  }
  const code = defaultTaxCategory(accountType, accountName);
  return code ? { code, strength: "account", reason: "科目からの標準の税区分です" } : null;
}

/** 課税（10%・8%・経過措置）か */
const isTaxable = (code: string | null) => (taxCategoryInfo(code)?.rate ?? 0) > 0;

export type TaxCheck =
  | { kind: "ok" }
  /** 税区分が付いていない */
  | { kind: "missing"; suggestion: TaxSuggestion }
  /** 付いている税区分が、はっきりした決まりと違う */
  | { kind: "conflict"; suggestion: TaxSuggestion }
  /** 確認をすすめる（取引の中身で変わる） */
  | { kind: "review"; suggestion: TaxSuggestion };

/** 付いている税区分を確かめる */
export function checkTaxCategory(
  accountType: string,
  accountName: string,
  description: string | null | undefined,
  current: string | null | undefined
): TaxCheck {
  const s = suggestTaxCategory(accountType, accountName, description);
  if (!s) return { kind: "ok" };
  const cur = taxCategoryInfo(current) ? (current as string) : null;
  if (!cur) return { kind: "missing", suggestion: s };
  if (cur === s.code) return { kind: "ok" };
  // 課税どうし（10%・8%軽減・経過措置）の違いは、税率や仕入先で変わるので問題にしない
  if (isTaxable(cur) && isTaxable(s.code)) return { kind: "ok" };
  // 貸倒れの税区分は人が付けたもの
  if (taxCategoryInfo(cur)?.badDebt) return { kind: "ok" };
  // 仕入側の非課税・不課税どうしの違いは、控除の対象外であることに変わりなく税額に影響しないので確認だけにする
  // （売上側は非課税売上が課税売上割合に入るので、違いがそのまま税額に響く）
  if (accountType === "expenses" && !isTaxable(cur) && !isTaxable(s.code))
    return { kind: "review", suggestion: { ...s, reason: `${s.reason}（どちらでも納める消費税額は変わりません）` } };
  if (s.strength === "strong") return { kind: "conflict", suggestion: s };
  if (s.strength === "hint") return { kind: "review", suggestion: s };
  return { kind: "ok" };
}

/**
 * AIや自動の仕訳で、保存する税区分を決める。
 * はっきりした決まりに当たればそれを、未設定なら候補を、それ以外は付いている税区分のままにする。
 */
export function resolveTaxCategory(
  accountType: string,
  accountName: string,
  description: string | null | undefined,
  current: string | null | undefined
): TaxCategoryCode | null {
  const check = checkTaxCategory(accountType, accountName, description, current);
  if (check.kind === "missing" || check.kind === "conflict") return check.suggestion.code;
  return taxCategoryInfo(current) ? (current as TaxCategoryCode) : null;
}
