/**
 * 勘定科目内訳明細書のうち、相手先ごとの明細を人が入力する様式（②③④⑥⑧⑨⑩⑮）。
 *
 * 様式ごとの欄・記載基準・照合する科目をここで定義し、入力画面と印刷用紙の
 * 両方がこの定義から作られるようにする（様式を足すときはここだけ直せばよい）。
 * 記載基準は国税庁の様式の注記（令和6年3月1日以後終了事業年度用）による。
 *
 * DBアクセスはここに置かない（テストできるようにするため）。
 */

import {
  selectListedRows,
  reconcile,
  type BalanceAccount,
  type ListingRule,
  type Reconciliation,
} from "@/lib/breakdown";

// ---------------------------------------------------------------------------
// 明細
// ---------------------------------------------------------------------------

export type DetailValue = string | number | boolean | null;

/** 明細1行（breakdown_items の1行） */
export type BreakdownItem = {
  id: string;
  section: string;
  accountId: string | null;
  partnerId: string | null;
  name: string;
  address: string;
  registrationNumber: string;
  relationship: string;
  amount: number;
  note: string;
  details: Record<string, DetailValue>;
  sortOrder: number;
};

// ---------------------------------------------------------------------------
// 様式の定義
// ---------------------------------------------------------------------------

/**
 * 欄の保存先。
 *   name 〜 note … breakdown_items の列
 *   account      … 「科目」欄（account_id）
 *   d.xxx        … details の xxx
 */
export type ItemFieldKey =
  | "account"
  | "name"
  | "address"
  | "registrationNumber"
  | "relationship"
  | "amount"
  | "note"
  | `d.${string}`;

export type ItemField = {
  key: ItemFieldKey;
  label: string;
  type: "text" | "date" | "amount" | "number" | "select" | "checkbox" | "account" | "partner";
  options?: string[];
  /** 印刷時に上段にまとめる見出し（「相手先」など） */
  group?: string;
  /** 印刷しない欄（融通手形の印など。摘要に反映する） */
  printHidden?: boolean;
  placeholder?: string;
};

export type ItemSectionSpec = {
  key: string;
  /** 様式の下段の表の見出し（主たる表は無し） */
  title?: string;
  fields: ItemField[];
  /** 各別に記入する基準。null は全件記入（100口まで） */
  rule: ListingRule | null;
  /**
   * 記載基準を何ごとの合計で判定するか。
   *   row      … 行ごと
   *   partner  … 相手先ごとの合計（手形の「一取引先に対する総額」）
   */
  thresholdBy: "row" | "partner";
  /** 金額に関わらず各別に記入する行（関連者・融通手形など） */
  mustList?: (item: BreakdownItem) => boolean;
  /** 一括して記入する分を分ける単位（科目・割引銀行など）。行の見出しになる */
  restGroup?: (item: BreakdownItem, accountName: (id: string | null) => string) => string;
  /** 試算表の科目残高と照合する明細か（下段の表は照合しない） */
  reconciled: boolean;
  /** 照合から除く行（割引した手形など、帳簿に残っていないもの） */
  excludeFromReconcile?: (item: BreakdownItem) => boolean;
};

export type ItemFormSpec = {
  key: string;
  /** 照合と「科目」欄の選択肢に使う科目 */
  isTargetAccount: ((a: BalanceAccount) => boolean) | null;
  /** 照合する科目の呼び名（試算表に該当科目が無いときの表示に使う） */
  targetLabel: string;
  /** 照合についての補足（画面に出す） */
  reconcileNote?: string;
  sections: ItemSectionSpec[];
};

const BASE_50 = (minRows?: number): ListingRule => ({
  amountThreshold: 500_000,
  maxRows: 100,
  ...(minRows ? { minRows } : {}),
});
const NOTE_RULE: ListingRule = { amountThreshold: 1_000_000, maxRows: 100, minRows: 5 };
const ALL_RULE = null;

const hasRelationship = (i: BreakdownItem) => i.relationship.trim() !== "";
const isAccommodationBill = (i: BreakdownItem) => i.details.accommodation === true;
const byAccount = (i: BreakdownItem, accountName: (id: string | null) => string) =>
  accountName(i.accountId);

// 欄の部品
const F = {
  account: (): ItemField => ({ key: "account", label: "科目", type: "account" }),
  partner: (label = "名称（氏名）", group = "相手先"): ItemField => ({
    key: "name",
    label,
    type: "partner",
    group,
  }),
  address: (label = "所在地（住所）", group: string | undefined = "相手先"): ItemField => ({
    key: "address",
    label,
    type: "text",
    group,
  }),
  regNo: (): ItemField => ({
    key: "registrationNumber",
    label: "登録番号（法人番号）",
    type: "text",
    placeholder: "T1234567890123",
  }),
  relationship: (): ItemField => ({
    key: "relationship",
    label: "法人・代表者との関係",
    type: "text",
    placeholder: "役員・株主・関係会社など",
  }),
  amount: (label = "期末現在高"): ItemField => ({ key: "amount", label, type: "amount" }),
  note: (label = "摘要", placeholder?: string): ItemField => ({
    key: "note",
    label,
    type: "text",
    placeholder,
  }),
};

const billFields = (partnerLabel: string, withDiscount: boolean): ItemField[] => [
  { key: "name", label: partnerLabel, type: "partner" },
  F.regNo(),
  { key: "d.issue_date", label: "振出年月日", type: "date" },
  { key: "d.due_date", label: "支払期日", type: "date" },
  { key: "d.bank", label: "名称", type: "text", group: "支払銀行" },
  { key: "d.branch", label: "支店名", type: "text", group: "支払銀行" },
  F.amount("金額"),
  ...(withDiscount
    ? [{ key: "d.discount_bank", label: "割引銀行名及び支店名等", type: "text" } as ItemField]
    : []),
  F.note(),
  { key: "d.accommodation", label: "融通手形", type: "checkbox", printHidden: true },
];

const notTax = (a: BalanceAccount) => !/税/.test(a.name);

/** ⑭ 役職名コード（e-Tax・OCR様式の2桁コード） */
export const OFFICER_TITLE_OPTIONS = [
  "01 代表取締役", "02 常務取締役", "03 専務取締役", "04 取締役", "05 監査役",
  "11 有限責任社員", "12 無限責任社員", "21 代表社員", "22 社員",
  "31 理事長", "32 副理事長", "33 常務理事", "34 専務理事", "35 常任理事", "36 理事",
  "41 顧問", "42 監事", "99 その他役員",
];
/** ⑭ 代表者との関係コード */
export const RELATION_OPTIONS = [
  "01 本人", "02 配偶者", "03 父", "04 母", "07 長男", "08 次男", "09 三男", "10 長女", "11 次女", "12 三女",
  "13 子", "14 孫", "15 祖父", "16 祖母", "17 兄弟", "18 姉妹", "19 子の配偶者", "22 伯父（叔父）", "23 伯母（叔母）",
  "24 従兄弟", "25 従姉妹", "26 甥", "27 姪", "90 その他",
];
/** ⑩-2 所得の種類 */
export const INCOME_KIND_OPTIONS = ["1 給与所得", "2 退職所得", "3 報酬・料金等", "4 利子所得", "5 配当所得", "6 非居住者等所得", "9 その他"];
const ALL_100: ListingRule = { amountThreshold: 0, maxRows: 100 };

export const ITEM_FORM_SPECS: ItemFormSpec[] = [
  {
    key: "1",
    targetLabel: "預貯金",
    isTargetAccount: (a) => a.category === "asset" && /預金|貯金|積金/.test(a.name),
    reconcileNote: "金融機関ごと・預貯金の種類ごとに、すべての口座を記入します（金額の基準はありません）。",
    sections: [
      {
        key: "main",
        fields: [
          // 様式に科目の欄は無い。試算表との照合のためだけに入力してもらう
          { ...F.account(), printHidden: true },
          { key: "d.bank", label: "金融機関名", type: "text" },
          { key: "d.branch", label: "支店名", type: "text" },
          { key: "d.kind", label: "種類", type: "select", options: ["普通預金", "当座預金", "定期預金", "定期積金", "通知預金", "別段預金", "貯蓄預金", "その他"] },
          { key: "d.account_no", label: "口座番号", type: "text" },
          F.amount(),
          F.note("摘要", "名義人が法人と違うときは「名義人○○」"),
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "5",
    targetLabel: "棚卸資産",
    isTargetAccount: (a) => a.category === "asset" && /商品|製品|仕掛品|原材料|貯蔵品|棚卸|半成工事/.test(a.name),
    sections: [
      {
        key: "main",
        fields: [
          F.account(),
          { key: "d.item", label: "品目", type: "text", placeholder: "紳士用革靴 など" },
          { key: "d.quantity", label: "数量", type: "number" },
          { key: "d.unit_price", label: "単価", type: "number" },
          F.amount(),
          F.note("摘要", "評価換えをしたときは「評価損○○円」"),
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "7",
    targetLabel: "土地・建物",
    isTargetAccount: (a) => a.category === "asset" && /土地|借地権|^建物$/.test(a.name),
    reconcileNote: "期中に売却・購入・評価換えをしたものは、期末に残っていなくても記入します。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.kind", label: "種類・構造", type: "text", placeholder: "土地、鉄筋コンクリート造建物 など" },
          { key: "d.usage", label: "用途", type: "text" },
          { key: "d.area", label: "面積（㎡）", type: "number" },
          { key: "d.location", label: "物件の所在地", type: "text" },
          F.amount(),
          { key: "d.move_date", label: "異動年月日", type: "date", group: "期中取得（処分）の明細" },
          { key: "d.move_reason", label: "異動事由", type: "text", group: "期中取得（処分）の明細" },
          { key: "d.move_price", label: "取得（処分）価額", type: "amount", group: "期中取得（処分）の明細" },
          { key: "d.book_before", label: "異動直前の帳簿価額", type: "amount", group: "期中取得（処分）の明細" },
          F.partner("売却（購入）先の名称（氏名）", "期中取得（処分）の明細"),
          F.address("売却（購入）先の所在地（住所）", "期中取得（処分）の明細"),
          F.regNo(),
          { key: "d.acquired_month", label: "売却物件の取得年月", type: "date", group: "期中取得（処分）の明細" },
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "10-2",
    targetLabel: "源泉所得税預り金",
    isTargetAccount: (a) => a.category === "liability" && /源泉/.test(a.name),
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.paid_month", label: "支払年月（月分）", type: "date" },
          { key: "d.income_kind", label: "所得の種類", type: "select", options: INCOME_KIND_OPTIONS },
          F.amount(),
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "12",
    targetLabel: "土地の売上高",
    isTargetAccount: null,
    reconcileNote: "棚卸資産として持つ土地を売却したとき・土地を仲介したときに記入します（固定資産の土地の売却は⑦）。多額のものから20口まで。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.class", label: "区分", type: "select", options: ["売上", "仲介手数料"] },
          { key: "d.location", label: "商品の所在地", type: "text" },
          { key: "d.land_type", label: "地目", type: "text", placeholder: "宅地・田・畑 など" },
          { key: "d.total_area", label: "総面積（㎡）", type: "number" },
          { key: "d.sold_month", label: "売上（仲介）年月", type: "date" },
          F.partner("売上（仲介）先の名称（氏名）", "売上（仲介）先"),
          F.address("所在地（住所）", "売上（仲介）先"),
          F.regNo(),
          { key: "d.sold_area", label: "売上（仲介）面積（㎡）", type: "number" },
          { key: "d.total_price", label: "土地建物を区分していない総額", type: "amount" },
          F.amount("売上金額（仲介手数料）"),
          { key: "d.acquired_year", label: "売上商品の取得年（西暦）", type: "number" },
        ],
        rule: { amountThreshold: 0, maxRows: 20 },
        thresholdBy: "row",
        reconciled: false,
      },
    ],
  },
  {
    key: "13",
    targetLabel: "売上高",
    isTargetAccount: (a) => a.category === "revenue" && /売上高|売上$/.test(a.name),
    reconcileNote: "売上高の合計は、損益計算書の売上高と一致させます。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "name", label: "事業所の名称", type: "text" },
          { key: "address", label: "所在地", type: "text" },
          { key: "d.manager", label: "責任者氏名", type: "text" },
          { key: "relationship", label: "代表者との関係", type: "text" },
          { key: "d.business", label: "事業等の内容", type: "text" },
          F.amount("売上高"),
          { key: "d.inventory", label: "期末棚卸高", type: "amount" },
          { key: "d.staff", label: "期末従事員数", type: "number" },
          { key: "d.tax_office", label: "源泉所得税納付署", type: "text", placeholder: "麹町" },
          F.note("摘要", "期中に開設・廃止した事業所はその旨と年月日"),
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "14-1",
    targetLabel: "役員給与",
    isTargetAccount: (a) => a.category === "expense" && /役員報酬|役員給与|役員賞与/.test(a.name),
    reconcileNote: "役員給与計は、賞与を含み退職給与を除いた額です。代表者は最初の行に記入します。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.title", label: "役職名", type: "select", options: OFFICER_TITLE_OPTIONS },
          { key: "d.duty", label: "担当業務", type: "text" },
          { key: "name", label: "氏名", type: "text" },
          { key: "d.relation", label: "代表者との関係", type: "select", options: RELATION_OPTIONS },
          { key: "address", label: "住所", type: "text" },
          { key: "d.fulltime", label: "常勤・非常勤", type: "select", options: ["1 常勤", "2 非常勤"] },
          F.amount("役員給与計"),
          { key: "d.employee_part", label: "使用人職務分", type: "amount", group: "内訳" },
          { key: "d.fixed", label: "定期同額給与", type: "amount", group: "内訳" },
          { key: "d.advance", label: "事前確定届出給与", type: "amount", group: "内訳" },
          { key: "d.performance", label: "業績連動給与", type: "amount", group: "内訳" },
          { key: "d.other", label: "その他", type: "amount", group: "内訳" },
          { key: "d.retirement", label: "退職給与", type: "amount" },
        ],
        rule: ALL_100,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "2",
    targetLabel: "受取手形",
    isTargetAccount: (a) => a.category === "asset" && a.name.includes("受取手形"),
    reconcileNote: "割引・裏書した手形（割引銀行名等の欄を入れた行）は帳簿から外れているため、照合から除きます。",
    sections: [
      {
        key: "main",
        fields: billFields("振出人", true),
        rule: NOTE_RULE,
        thresholdBy: "partner",
        mustList: isAccommodationBill,
        // 一括記入分のうち、割引したものは割引銀行ごとに分ける
        restGroup: (i) => {
          const bank = String(i.details.discount_bank ?? "").trim();
          return bank ? `割引分（${bank}）` : "";
        },
        reconciled: true,
        excludeFromReconcile: (i) => String(i.details.discount_bank ?? "").trim() !== "",
      },
    ],
  },
  {
    key: "3",
    targetLabel: "売掛金・未収入金",
    isTargetAccount: (a) => a.category === "asset" && /売掛金|未収入金|未収金/.test(a.name),
    sections: [
      {
        key: "main",
        fields: [F.account(), F.partner(), F.address(), F.regNo(), F.amount(), F.note("摘要", "未収入金は取引の内容")],
        rule: BASE_50(5),
        thresholdBy: "row",
        restGroup: byAccount,
        reconciled: true,
      },
    ],
  },
  {
    key: "4-1",
    targetLabel: "仮払金・前渡金",
    isTargetAccount: (a) => a.category === "asset" && /仮払金|前渡金|前払金/.test(a.name) && notTax(a),
    sections: [
      {
        key: "main",
        fields: [
          F.account(),
          F.partner(),
          F.address(),
          F.relationship(),
          F.regNo(),
          F.amount(),
          F.note("摘要", "機械設備の購入手付金 など"),
        ],
        rule: BASE_50(),
        thresholdBy: "row",
        mustList: hasRelationship,
        restGroup: byAccount,
        reconciled: true,
      },
    ],
  },
  {
    key: "6",
    targetLabel: "有価証券",
    isTargetAccount: (a) => a.category === "asset" && /有価証券|株式|出資金/.test(a.name),
    reconcileNote: "売買目的有価証券は、時価評価した後の金額（期末現在高）で照合します。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.class", label: "区分", type: "select", options: ["売買", "満期", "その他"] },
          { key: "d.kind", label: "種類", type: "text", group: "種類・銘柄" },
          { key: "d.brand", label: "銘柄", type: "text", group: "種類・銘柄" },
          { key: "d.quantity", label: "数量", type: "number", group: "期末現在高" },
          { key: "d.book_before", label: "時価評価前の帳簿価額", type: "amount", group: "期末現在高" },
          { key: "amount", label: "金額", type: "amount", group: "期末現在高" },
          { key: "d.move_date", label: "異動年月日", type: "date", group: "期中増（減）の明細" },
          { key: "d.move_reason", label: "異動事由", type: "text", group: "期中増（減）の明細" },
          { key: "d.move_quantity", label: "数量", type: "number", group: "期中増（減）の明細" },
          { key: "d.move_amount", label: "金額", type: "amount", group: "期中増（減）の明細" },
          { key: "name", label: "売却（買入）先の名称（氏名）", type: "partner", group: "期中増（減）の明細" },
          { key: "address", label: "売却（買入）先の所在地（住所）", type: "text", group: "期中増（減）の明細" },
          F.note("摘要", "関係会社のものはその旨"),
        ],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: true,
      },
    ],
  },
  {
    key: "8",
    targetLabel: "支払手形",
    isTargetAccount: (a) => a.category === "liability" && a.name.includes("支払手形"),
    sections: [
      {
        key: "main",
        fields: billFields("支払先", false),
        rule: NOTE_RULE,
        thresholdBy: "partner",
        mustList: isAccommodationBill,
        restGroup: () => "",
        reconciled: true,
      },
    ],
  },
  {
    key: "9",
    targetLabel: "買掛金・未払金・未払費用",
    isTargetAccount: (a) =>
      a.category === "liability" && /買掛金|未払金|未払費用/.test(a.name) && notTax(a) && !/配当|役員賞与/.test(a.name),
    reconcileNote: "未払法人税等・未払消費税等は記入の対象外のため、照合に含めません。",
    sections: [
      {
        key: "main",
        fields: [F.account(), F.partner(), F.address(), F.regNo(), F.amount(), F.note("摘要", "未払金は取引の内容")],
        rule: BASE_50(5),
        thresholdBy: "row",
        restGroup: byAccount,
        reconciled: true,
      },
      {
        key: "dividend",
        title: "未払配当金",
        fields: [{ key: "d.fixed_date", label: "支払確定年月日", type: "date" }, F.amount()],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: false,
      },
      {
        key: "officer_bonus",
        title: "未払役員賞与",
        fields: [{ key: "d.fixed_date", label: "支払確定年月日", type: "date" }, F.amount()],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: false,
      },
    ],
  },
  {
    key: "10-1",
    targetLabel: "仮受金・前受金・預り金",
    isTargetAccount: (a) => a.category === "liability" && /仮受金|前受金|預り金/.test(a.name) && !/消費税/.test(a.name),
    sections: [
      {
        key: "main",
        fields: [
          F.account(),
          F.partner(),
          F.address(),
          F.relationship(),
          F.regNo(),
          F.amount(),
          F.note("摘要", "受注工事の前受金、源泉所得税預り金 など"),
        ],
        rule: BASE_50(),
        thresholdBy: "row",
        mustList: hasRelationship,
        restGroup: byAccount,
        reconciled: true,
      },
    ],
  },
  {
    key: "15-1",
    targetLabel: "地代家賃",
    isTargetAccount: (a) => a.category === "expense" && /地代|家賃/.test(a.name),
    reconcileNote: "支払賃借料は当期に支払った額（年額）です。前払・未払の調整がある場合は差額が出ることがあります。",
    sections: [
      {
        key: "main",
        fields: [
          { key: "d.kind", label: "地代・家賃の区分", type: "select", options: ["地代", "家賃"] },
          { key: "d.usage", label: "用途", type: "text", group: "借地（借家）物件" },
          { key: "d.location", label: "所在地", type: "text", group: "借地（借家）物件" },
          F.partner("名称（氏名）", "貸主"),
          F.address("所在地（住所）", "貸主"),
          F.regNo(),
          { key: "d.period_from", label: "支払対象期間（自）", type: "date" },
          { key: "d.period_to", label: "支払対象期間（至）", type: "date" },
          F.amount("支払賃借料"),
          F.note(),
        ],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: true,
      },
      {
        key: "key_money",
        title: "権利金等の期中支払の内訳",
        fields: [
          F.partner("名称（氏名）", "支払先"),
          F.address("所在地（住所）", "支払先"),
          F.regNo(),
          { key: "d.paid_date", label: "支払年月日", type: "date" },
          F.amount("支払金額"),
          { key: "d.content", label: "権利金等の内容", type: "text" },
          F.note(),
        ],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: false,
      },
    ],
  },
  {
    key: "15-2",
    targetLabel: "使用料",
    isTargetAccount: null,
    reconcileNote: "使用料を計上する専用の科目が無いため、試算表との照合は行いません。",
    sections: [
      {
        key: "main",
        fields: [
          F.partner("名称（氏名）", "支払先"),
          F.address("所在地（住所）", "支払先"),
          F.regNo(),
          { key: "d.right_name", label: "名称（特許権・商標権など）", type: "text" },
          { key: "d.contract_from", label: "契約期間（自）", type: "date" },
          { key: "d.contract_to", label: "契約期間（至）", type: "date" },
          { key: "d.period_from", label: "支払対象期間（自）", type: "date" },
          { key: "d.period_to", label: "支払対象期間（至）", type: "date" },
          F.amount("支払金額"),
          F.note(),
        ],
        rule: ALL_RULE,
        thresholdBy: "row",
        reconciled: false,
      },
    ],
  },
];

export function findItemFormSpec(key: string): ItemFormSpec | undefined {
  return ITEM_FORM_SPECS.find((s) => s.key === key);
}

// ---------------------------------------------------------------------------
// 欄の値の読み書き
// ---------------------------------------------------------------------------

export function fieldValue(item: BreakdownItem, key: ItemFieldKey): DetailValue {
  if (key === "account") return item.accountId;
  if (key.startsWith("d.")) return item.details[key.slice(2)] ?? null;
  return item[key as "name" | "address" | "registrationNumber" | "relationship" | "amount" | "note"];
}

export function withFieldValue(item: BreakdownItem, key: ItemFieldKey, value: DetailValue): BreakdownItem {
  if (key === "account") return { ...item, accountId: (value as string) || null };
  if (key.startsWith("d.")) return { ...item, details: { ...item.details, [key.slice(2)]: value } };
  if (key === "amount") return { ...item, amount: Number(value) || 0 };
  return { ...item, [key]: value == null ? "" : String(value) };
}

// ---------------------------------------------------------------------------
// 印刷用紙の行
// ---------------------------------------------------------------------------

export type SheetRow =
  | { kind: "item"; item: BreakdownItem }
  /** 一括して記入する分。label は科目名・割引銀行など */
  | { kind: "rest"; label: string; amount: number; count: number; accountId: string | null };

export type SheetSection = {
  spec: ItemSectionSpec;
  rows: SheetRow[];
  total: number;
};

function groupBy<T>(xs: T[], keyOf: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = keyOf(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return m;
}

const partnerKey = (i: BreakdownItem) =>
  i.partnerId ?? (i.registrationNumber.trim() || i.name.trim() || `\u0001${i.id}`);

/**
 * 明細から、様式に記入する行を作る。
 * 記載基準を満たすものは各別に、それ以外は科目（または割引銀行）ごとに
 * 「その他」として一括する。100口を超えたときは最後の1行に残額をまとめる。
 */
export function buildSheetSection(
  spec: ItemSectionSpec,
  items: BreakdownItem[],
  accountName: (id: string | null) => string
): SheetSection {
  // 入力途中の空の行（名称も金額も、ほかの欄の入力も無いもの）は用紙に出さない。
  // 期中に売却して期末残高が0の土地（⑦）のように、金額0でも内容のある行は出す
  const isBlank = (i: BreakdownItem) =>
    i.amount === 0 &&
    !i.name.trim() &&
    !i.registrationNumber.trim() &&
    !Object.values(i.details).some((v) => v !== null && v !== "" && v !== false && v !== 0);
  const mine = items
    .filter((i) => i.section === spec.key && !isBlank(i))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const total = mine.reduce((s, i) => s + i.amount, 0);
  const rule = spec.rule ?? { amountThreshold: 0, maxRows: 100 };

  // 判定の単位（行、または相手先ごとの束）
  const units: BreakdownItem[][] =
    spec.thresholdBy === "partner"
      ? [...groupBy(mine, partnerKey).values()]
      : mine.map((i) => [i]);

  const { listed, restItems, overflowed } = selectListedRows(units, rule, (u) => ({
    amount: u.reduce((s, i) => s + i.amount, 0),
    mustList: spec.mustList ? u.some(spec.mustList) : false,
  }));

  const rows: SheetRow[] = listed.flat().map((item) => ({ kind: "item", item }));
  // 0円の相手先は「その他」の件数に数えない
  const rest = restItems.flat().filter((i) => i.amount !== 0);
  if (rest.length) {
    if (overflowed) {
      rows.push({
        kind: "rest",
        label: "",
        amount: rest.reduce((s, i) => s + i.amount, 0),
        count: rest.length,
        accountId: null,
      });
    } else {
      const groups = groupBy(rest, (i) => spec.restGroup?.(i, accountName) ?? "");
      for (const [label, g] of groups) {
        const accountIds = new Set(g.map((i) => i.accountId));
        rows.push({
          kind: "rest",
          label,
          amount: g.reduce((s, i) => s + i.amount, 0),
          count: g.length,
          accountId: accountIds.size === 1 ? [...accountIds][0] : null,
        });
      }
    }
  }
  return { spec, rows, total };
}

// ---------------------------------------------------------------------------
// 試算表との照合
// ---------------------------------------------------------------------------

export type ItemCheck = { label: string; check: Reconciliation };

/**
 * 明細の合計と試算表の科目残高を照合する。
 * 「科目」欄のある様式は科目ごとに、無い様式は対象科目の合計で照合する。
 * 科目を選んでいない明細は「科目未選択」として別に示す。
 */
export function reconcileItems(
  spec: ItemFormSpec,
  items: BreakdownItem[],
  balances: BalanceAccount[]
): ItemCheck[] {
  if (!spec.isTargetAccount) return [];
  const targets = balances.filter(spec.isTargetAccount);
  const counted = items.filter((i) => {
    const sec = spec.sections.find((s) => s.key === i.section);
    return sec?.reconciled && !sec.excludeFromReconcile?.(i);
  });
  const sum = (xs: BreakdownItem[]) => xs.reduce((s, i) => s + i.amount, 0);

  const hasAccountField = spec.sections.some((s) => s.fields.some((f) => f.key === "account"));
  if (!hasAccountField) {
    // 残高も明細も無ければ、照合するものが無い
    if (targets.every((a) => a.currentBalance === 0) && counted.length === 0) return [];
    return [{ label: targets.map((a) => a.name).join("・") || spec.targetLabel, check: reconcile(targets, sum(counted)) }];
  }

  const checks: ItemCheck[] = [];
  for (const a of targets) {
    const mine = counted.filter((i) => i.accountId === a.id);
    if (a.currentBalance === 0 && mine.length === 0) continue;
    checks.push({ label: a.name, check: reconcile([a], sum(mine)) });
  }
  const targetIds = new Set(targets.map((a) => a.id));
  const unassigned = counted.filter((i) => !i.accountId || !targetIds.has(i.accountId));
  if (unassigned.length) {
    checks.push({ label: "科目未選択", check: reconcile([], sum(unassigned)) });
  }
  return checks;
}

/** 新しい明細行の初期値 */
export function emptyItem(section: string, sortOrder: number, id: string): BreakdownItem {
  return {
    id,
    section,
    accountId: null,
    partnerId: null,
    name: "",
    address: "",
    registrationNumber: "",
    relationship: "",
    amount: 0,
    note: "",
    details: {},
    sortOrder,
  };
}
