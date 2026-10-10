/**
 * 個別注記表の中身を、会社の帳簿の状態から作る。純粋関数。
 * 決算書の画面と e-Tax 用 CSV（src/lib/etax-financial-csv.ts の notesCsv）が同じものを使う。
 *
 *   - 固定資産の減価償却の方法: 登録した固定資産の償却方法から（定率法が1つでもあれば法定の定率法の書き方）。
 *     一括償却資産・少額減価償却資産の特例を使っていれば、その旨も書く
 *   - 消費税等の会計処理: 免税事業者は税込方式。それ以外は、当期に仮受・仮払消費税の動きがあれば税抜方式
 *   - 株主資本等変動計算書に関する注記: 中小会社（非公開・会計監査人なし）は自己株式の数だけでよい（会社計算規則105条）
 */

export type NoteItemKey = "depreciation" | "consumption_tax" | "treasury_stock";

export type NoteItem = { key?: NoteItemKey; title: string; text: string };

export type NoteSection = {
  key: "policies" | "equity_changes" | "other";
  heading: string;
  items: NoteItem[];
  /** 記載する項目が無いときの文 */
  none?: string;
};

export type NotesInput = {
  /** 固定資産の償却方法（登録のある資産だけ） */
  depreciationMethods: string[];
  taxAccounting: "exclusive" | "inclusive";
  hasTreasuryStock: boolean;
};

const DECLINING_TEXT =
  "有形固定資産は定率法（ただし、平成10年4月1日以後に取得した建物並びに平成28年4月1日以後に取得した建物附属設備及び構築物は定額法）、無形固定資産は定額法によっている。";
const STRAIGHT_TEXT = "有形固定資産及び無形固定資産は、定額法によっている。";

export function depreciationNote(methods: string[]): string {
  const m = new Set(methods);
  // 資産の登録が無いときは、法人の法定償却方法（定率法）の書き方にしておく
  const base = m.has("declining_balance") || !m.has("straight_line") ? DECLINING_TEXT : STRAIGHT_TEXT;
  const extra: string[] = [];
  if (m.has("lump_sum")) extra.push("取得価額10万円以上20万円未満の減価償却資産は、3年間で均等償却している。");
  if (m.has("small_immediate"))
    extra.push("取得価額30万円未満の減価償却資産は、租税特別措置法の特例により取得時に全額を費用処理している。");
  return [base, ...extra.map((t, i) => (i === 0 ? `なお、${t}` : `また、${t}`))].join("");
}

export function buildNotes(i: NotesInput): NoteSection[] {
  return [
    {
      key: "policies",
      heading: "重要な会計方針に係る事項に関する注記",
      items: [
        { key: "depreciation", title: "固定資産の減価償却の方法", text: depreciationNote(i.depreciationMethods) },
        {
          key: "consumption_tax",
          title: "消費税等の会計処理",
          text: i.taxAccounting === "exclusive" ? "消費税等の会計処理は、税抜方式によっている。" : "消費税等の会計処理は、税込方式によっている。",
        },
      ],
    },
    {
      key: "equity_changes",
      heading: "株主資本等変動計算書に関する注記",
      items: i.hasTreasuryStock
        ? [{ key: "treasury_stock", title: "当事業年度末日における自己株式の数", text: "（株式の種類と数を記入してください）" }]
        : [],
      none: "当事業年度末日において、自己株式は保有していない。",
    },
    { key: "other", heading: "その他の注記", items: [], none: "記載すべき重要な事項はない。" },
  ];
}
