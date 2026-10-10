/**
 * 株主資本等変動計算書の列（純資産の項目）を、純資産科目の期首・期末残高から作る。純粋関数。
 *
 *   - 科目名から項目を決める（資本金・資本準備金・その他資本剰余金・利益準備金・任意積立金・繰越利益剰余金・自己株式）
 *   - 当期純利益は繰越利益剰余金の変動にだけ入れる（試算表の繰越利益剰余金には、まだ当期の利益が入っていない）
 *   - 当期純利益以外の増減（配当・積立など）は「その他の変動額」にまとめる
 *   - 金額は貸方をプラスにした値。自己株式は借方残高なのでマイナスになる
 */

export type EquityKind =
  | "capital"
  | "capital_reserve"
  | "other_capital_surplus"
  | "legal_reserve"
  | "voluntary_reserve"
  | "retained"
  | "treasury"
  | "other";

export type EquityColumn = {
  kind: EquityKind;
  label: string;
  opening: number;
  /** 当期純利益（繰越利益剰余金の列だけ） */
  netIncome: number;
  /** 当期純利益以外の変動 */
  other: number;
  /** 当期変動額合計 */
  change: number;
  closing: number;
};

export type EquityTotals = Omit<EquityColumn, "kind" | "label">;

export type EquityChanges = { columns: EquityColumn[]; total: EquityTotals };

/** 表示の順番（純資産の部の並び） */
const ORDER: EquityKind[] = [
  "capital",
  "capital_reserve",
  "other_capital_surplus",
  "legal_reserve",
  "voluntary_reserve",
  "retained",
  "treasury",
  "other",
];

const LABEL: Record<EquityKind, string> = {
  capital: "資本金",
  capital_reserve: "資本準備金",
  other_capital_surplus: "その他資本剰余金",
  legal_reserve: "利益準備金",
  voluntary_reserve: "任意積立金",
  retained: "繰越利益剰余金",
  treasury: "自己株式",
  other: "その他",
};

export function equityKind(name: string): EquityKind {
  if (/^資本金$/.test(name)) return "capital";
  if (/資本準備金/.test(name)) return "capital_reserve";
  if (/その他資本剰余金/.test(name)) return "other_capital_surplus";
  if (/利益準備金/.test(name)) return "legal_reserve";
  if (/自己株式/.test(name)) return "treasury";
  if (/繰越利益|^利益剰余金$/.test(name)) return "retained";
  if (/積立金|準備金/.test(name)) return "voluntary_reserve";
  return "other";
}

export function buildEquityChanges(
  accounts: { name: string; opening: number; closing: number }[],
  netIncome: number
): EquityChanges {
  // 任意積立金・その他は科目ごとに列を分ける（別途積立金と圧縮積立金を混ぜない）
  const map = new Map<string, EquityColumn>();
  for (const a of accounts) {
    const kind = equityKind(a.name);
    const perAccount = kind === "voluntary_reserve" || kind === "other";
    const key = perAccount ? `${kind}:${a.name}` : kind;
    const c = map.get(key) ?? { kind, label: perAccount ? a.name : LABEL[kind], opening: 0, netIncome: 0, other: 0, change: 0, closing: 0 };
    c.opening += a.opening;
    c.closing += a.closing;
    map.set(key, c);
  }
  // 繰越利益剰余金の列は必ず置く（当期純利益を入れる先）
  if (![...map.values()].some((c) => c.kind === "retained"))
    map.set("retained", { kind: "retained", label: LABEL.retained, opening: 0, netIncome: 0, other: 0, change: 0, closing: 0 });

  const columns = [...map.values()]
    .map((c) => {
      const ni = c.kind === "retained" ? netIncome : 0;
      const closing = c.closing + ni;
      return { ...c, netIncome: ni, other: closing - c.opening - ni, change: closing - c.opening, closing };
    })
    .filter((c) => c.kind === "retained" || c.opening !== 0 || c.closing !== 0)
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const sum = (f: (c: EquityColumn) => number) => columns.reduce((s, c) => s + f(c), 0);
  return {
    columns,
    total: {
      opening: sum((c) => c.opening),
      netIncome: sum((c) => c.netIncome),
      other: sum((c) => c.other),
      change: sum((c) => c.change),
      closing: sum((c) => c.closing),
    },
  };
}
