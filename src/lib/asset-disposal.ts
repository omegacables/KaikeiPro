/**
 * 固定資産の売却・除却の仕訳（純粋関数）。保存と画面は src/actions/assets.ts。
 *
 * 1本の仕訳に、次の3つをまとめる。
 *   ① 当期の減価償却費 … 期首から手放した月まで（月割り・1ヶ月未満は1ヶ月）。額は償却スケジュール
 *                        （src/lib/depreciation.ts の buildDepreciationSchedule に除却日を渡した行）から受け取る
 *   ② 帳簿価額の消去   … 直接法は資産の科目の残高（＝期首の帳簿価額）を、
 *                        間接法は取得価額と減価償却累計額（＝取得価額 − 期首の帳簿価額）を消す
 *   ③ 売却なら売却代金と売却損益、除却なら固定資産除却損
 *
 * ■ 売却代金の消費税（課税売上）
 *   消費税の集計（src/lib/tax-book.ts）は、収益・費用の行の税区分だけを数える。
 *   売却で課税売上になるのは売却益ではなく「売却代金の全額」なので、売却益の行を差額だけにすると
 *   課税売上が少なく出る（納める消費税を少なく見せる）。そこで
 *     (貸)固定資産売却益 … 売却代金（税抜経理なら税抜）［課税売上10%］
 *     (借)固定資産売却益 … 帳簿価額のうち売却代金までの分［不課税売上］
 *   の2行にして、科目の残高は売却益（差額）に、課税売上は売却代金になるようにする。
 *   帳簿価額が売却代金を上回る分は固定資産売却損にする（このとき売却益の残高は0）。
 *   簡易課税の事業区分は、事業用の固定資産の譲渡なので第四種（消費税法基本通達13-2-9）。
 *
 * ■ 仕訳を作らないもの（日付だけ記録する）
 *   - 一括償却資産の除却 … 除却しても残りを3年で均等に損金にし続ける（法人税法施行令133条の2、法人税基本通達7-1-13）。
 *                          売却なら、帳簿価額は消さずに売却代金だけを収益にする
 *   - 個人事業主の売却   … 事業用資産の売却は譲渡所得で、事業所得の帳簿では事業主貸・事業主借で処理する。
 *                          課税売上の扱いも含めて手入力してもらう
 *   - 旧定額法・旧定率法 … 帳簿価額をこの仕組みで計算していない（計上額を手入力している）
 *   - 消す帳簿価額も当期の償却費も0円のもの（直接法で償却し終わった少額減価償却資産など）
 */

import type { DepreciationKind } from "@/lib/depreciation";
import { taxCategoryInfo, taxFromGross, type TaxCategoryCode } from "@/lib/tax-category";

export type DisposalType = "sale" | "retire";

export const DISPOSAL_LABELS: Record<DisposalType, string> = {
  sale: "売却",
  retire: "除却（廃棄）",
};

/** 売却代金に付けられる税区分（償却資産の売却。8%の軽減税率の対象になる資産は無い） */
export const SALE_TAX_CATEGORIES: TaxCategoryCode[] = ["sales_10", "sales_tax_free", "sales_out_of_scope"];

/** 簡易課税の事業区分: 事業用の固定資産の譲渡は第四種 */
export const DISPOSAL_BUSINESS_TYPE = 4;

/** 仕訳の行の役割（科目は呼び出し側で当てる） */
export type DisposalRole =
  | "receipt" // 入金先（普通預金・未収入金など）
  | "expense" // 減価償却費（当期分）
  | "owner_draw" // 事業主貸（個人事業主の私用分）
  | "accumulated" // 減価償却累計額（間接法）
  | "asset" // 資産の科目
  | "gain" // 固定資産売却益
  | "loss" // 固定資産売却損
  | "retire_loss" // 固定資産除却損
  | "output_tax"; // 仮受消費税

export const DISPOSAL_ACCOUNT_NAMES: Partial<Record<DisposalRole, string>> = {
  expense: "減価償却費",
  owner_draw: "事業主貸",
  accumulated: "減価償却累計額",
  gain: "固定資産売却益",
  loss: "固定資産売却損",
  retire_loss: "固定資産除却損",
  output_tax: "仮受消費税",
};

export type DisposalLine = {
  role: DisposalRole;
  debit: number;
  credit: number;
  taxCategory: TaxCategoryCode | null;
  /** 簡易課税の事業区分（売却代金の行だけ） */
  businessType: number | null;
  /** 画面に出す、この行の内容 */
  note: string;
};

export type DisposalInput = {
  type: DisposalType;
  kind: DepreciationKind;
  entityType: "individual" | "corporation" | null;
  entryMethod: "direct" | "indirect";
  acquisitionCost: number;
  /** 手放した期の期首の帳簿価額（会計上） */
  openingBook: number;
  /** 期首から手放した月までの当期の償却費（償却スケジュールの計上額） */
  depreciation: number;
  /** 売却代金（税込） */
  salePrice?: number | null;
  saleTaxCategory?: TaxCategoryCode | null;
  /** 税抜経理か（売却代金の消費税を仮受消費税に立てる） */
  exclusive: boolean;
  /** 個人事業主の事業専用割合（%）。法人は100 */
  businessRatio?: number | null;
};

export type DisposalJournalPlan = {
  mode: "journal";
  lines: DisposalLine[];
  /** 当期の償却費 */
  depreciation: number;
  /** 手放した時点の帳簿価額（当期の償却費を引いた後） */
  bookValue: number;
  /** 売却代金（税込）・うち消費税（仮受消費税に立てる額）・売却益の行に立てる額 */
  salePrice: number;
  tax: number;
  netPrice: number;
  gain: number;
  loss: number;
  retireLoss: number;
  /** 事業主貸にする私用分（個人事業主の事業専用割合の残り） */
  privatePart: number;
};

export type DisposalRecordOnlyPlan = { mode: "record_only"; reason: string };

export type DisposalPlan = DisposalJournalPlan | DisposalRecordOnlyPlan;

/** 仕訳を作らずに日付だけを記録する理由。仕訳を作るなら null */
export function recordOnlyReason(
  type: DisposalType,
  kind: DepreciationKind,
  entityType: "individual" | "corporation" | null
): string | null {
  if (kind === "unsupported")
    return "2007年3月以前に取得した資産（旧定額法・旧定率法）は、帳簿価額をこの画面で計算していないため、仕訳は作りません。日付だけを記録します。売却・除却の仕訳は手入力してください。";
  if (kind === "lump" && type === "retire")
    return "一括償却資産は、除却しても残りを3年で均等に償却し続けます（法人税法施行令133条の2）。帳簿価額を消す仕訳は作らず、日付だけを記録します。";
  if (entityType === "individual" && type === "sale")
    return "個人事業主の事業用資産の売却は譲渡所得になり、事業所得の帳簿では事業主貸・事業主借で処理します（課税事業者なら売却代金は課税売上です）。この画面では仕訳を作らず、日付だけを記録します。手放した月までの減価償却費は、期末の減価償却の仕訳に入ります。";
  return null;
}

const int = (v: number | null | undefined) => Math.round(Number(v) || 0);

/** 売却・除却の仕訳の行を決める */
export function planDisposal(input: DisposalInput): DisposalPlan {
  const reason = recordOnlyReason(input.type, input.kind, input.entityType);
  if (reason) return { mode: "record_only", reason };

  const cost = int(input.acquisitionCost);
  // 一括償却資産は売却しても帳簿価額を消さない（残りの償却を続ける）。売却代金だけを収益にする
  const lump = input.kind === "lump";
  const openingBook = lump ? 0 : int(input.openingBook);
  const depreciation = lump ? 0 : int(input.depreciation);
  if (openingBook < 0 || depreciation < 0) throw new Error("帳簿価額・償却費が正しくありません");
  if (depreciation > openingBook) throw new Error("当期の償却費が期首の帳簿価額を超えています");
  if (openingBook > cost) throw new Error("期首の帳簿価額が取得価額を超えています");
  const bookValue = openingBook - depreciation;

  // 個人事業主の家事と共用の資産は、事業専用割合の分だけを経費にし、残りは事業主貸（1円未満は切り捨て。減価償却の仕訳と同じ）
  const ratio = input.entityType === "individual" ? Number(input.businessRatio ?? 100) : 100;
  const business = (v: number) => (ratio < 100 ? Math.floor((v * ratio) / 100) : v);

  // --- 金額を先に決める ---
  let salePrice = 0;
  let tax = 0;
  let netPrice = 0;
  let saleCode: TaxCategoryCode = "sales_10";
  let saleName = "";
  if (input.type === "sale") {
    salePrice = int(input.salePrice);
    if (!(salePrice > 0)) throw new Error("売却代金を入力してください（無償で手放したときは除却を選んでください）");
    saleCode = input.saleTaxCategory ?? "sales_10";
    const info = taxCategoryInfo(saleCode);
    if (!info || info.side !== "sales" || !SALE_TAX_CATEGORIES.includes(saleCode)) throw new Error("売却代金の税区分を選び直してください");
    saleName = info.name;
    // 税抜経理なら税込の売却代金から消費税を取り出して仮受消費税に。税込経理なら売却益の行は税込のまま
    tax = input.exclusive && (info.rate === 0.1 || info.rate === 0.08) ? taxFromGross(salePrice, info.rate) : 0;
    netPrice = salePrice - tax;
  }
  const expense = business(depreciation);
  // 売却: 帳簿価額のうち売却代金までは売却益の行で消し（不課税）、上回る分は売却損
  const offset = input.type === "sale" ? Math.min(netPrice, bookValue) : 0;
  const loss = input.type === "sale" ? bookValue - offset : 0;
  const gain = input.type === "sale" ? netPrice - offset : 0;
  const retireLoss = input.type === "retire" ? business(bookValue) : 0;
  const privatePart = depreciation - expense + (input.type === "retire" ? bookValue - retireLoss : 0);

  // --- 行を並べる（借方 → 貸方） ---
  const lines: DisposalLine[] = [];
  const push = (l: Omit<DisposalLine, "taxCategory" | "businessType"> & Partial<Pick<DisposalLine, "taxCategory" | "businessType">>) => {
    if (l.debit === 0 && l.credit === 0) return;
    lines.push({ taxCategory: null, businessType: null, ...l });
  };
  const indirect = input.entryMethod === "indirect";

  push({ role: "receipt", debit: salePrice, credit: 0, note: "売却代金（税込）" });
  // ① 当期の減価償却費
  push({ role: "expense", debit: expense, credit: 0, taxCategory: "purchase_out_of_scope", note: "当期の減価償却費（期首から手放した月まで）" });
  push({ role: "owner_draw", debit: privatePart, credit: 0, note: `私用分（事業専用割合 ${ratio}% の残り）` });
  // ② 帳簿価額の消去（間接法は前期までの累計額を取り崩す）
  if (!lump && indirect) push({ role: "accumulated", debit: cost - openingBook, credit: 0, note: "減価償却累計額の取り崩し（前期までの分）" });
  // ③ 売却損益・除却損
  push({ role: "gain", debit: offset, credit: 0, taxCategory: "sales_out_of_scope", note: "手放した時点の帳簿価額（売却代金までの分。不課税）" });
  push({ role: "loss", debit: loss, credit: 0, taxCategory: "purchase_out_of_scope", note: "売却損（帳簿価額 − 売却代金）" });
  push({ role: "retire_loss", debit: retireLoss, credit: 0, taxCategory: "purchase_out_of_scope", note: "除却損（手放した時点の帳簿価額）" });

  if (!lump) push({ role: "asset", debit: 0, credit: indirect ? cost : openingBook, note: indirect ? "取得価額" : "期首の帳簿価額" });
  push({
    role: "gain",
    debit: 0,
    credit: netPrice,
    taxCategory: saleCode,
    businessType: DISPOSAL_BUSINESS_TYPE,
    note: `売却代金${tax > 0 ? "（税抜）" : ""}。消費税の${saleName}はこの額で数えます`,
  });
  push({ role: "output_tax", debit: 0, credit: tax, note: "売却代金の消費税" });

  // 直接法で償却し終わった少額減価償却資産など、消す帳簿価額も償却費も無いもの
  if (lines.length === 0)
    return { mode: "record_only", reason: "帳簿価額も当期の償却費も0円のため、仕訳は作らず日付だけを記録します。" };

  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit) throw new Error(`売却・除却の仕訳の貸借が合いません（借方 ${debit} / 貸方 ${credit}）`);

  return { mode: "journal", lines, depreciation, bookValue, salePrice, tax, netPrice, gain, loss, retireLoss, privatePart };
}
