/**
 * 法人税の e-Tax 用ファイル（.xtx）の 別表十六（減価償却）。純粋関数。固定資産台帳（src/lib/depreciation.ts）の計算から作る。
 *   別表十六(一) 定額法 HOE315 v6.0 … 1枚に5資産（それより多ければ2枚目以降）
 *   別表十六(二) 定率法 HOE325 v6.0 … 1枚に5資産
 *   別表十六(七) 少額減価償却資産（措法67の5）HOE351 v4.0 … 1枚に15資産。当期に事業の用に供したもの
 *   別表十六(八) 一括償却資産 HOE360 v7.0 … 事業の用に供した事業年度ごと（過去5年度分＋当期分）
 * 平成19年3月31日以前に取得した資産（旧定額法・旧定率法）は台帳で計算していないので載せない（警告を返す）。
 */

import type { DepreciationKind, ScheduleRow } from "@/lib/depreciation";
import { amount, etaxDate, etaxText, group, value, type X } from "@/lib/etax-xml";

export type DepAsset = {
  name: string;
  accountName: string;
  acquisitionDate: string;
  serviceStartDate: string;
  acquisitionCost: number;
  usefulLife: number;
  kind: DepreciationKind;
  rate: { rate: number; revised: number | null; guarantee: number | null } | null;
  current: ScheduleRow | null;
  schedule: ScheduleRow[];
};

export type DepreciationForms = {
  forms: { tag: string; version: string; body: string }[];
  /** 少額減価償却資産の取得価額の合計（適用額明細書 区分番号00277 の適用額） */
  smallAssetsTotal: number;
  warnings: string[];
};

const str15 = (s: string) => [...etaxText(s)].slice(0, 15).join("");
/** gen:yymm（事業の用に供した年月） */
function yymm(tag: string, iso: string): string {
  const full = etaxDate(tag, iso); // 年月日を作ってから日を除く
  return full.replace(/<gen:dd>\d+<\/gen:dd>/, "");
}
const rate3 = (r: number | null | undefined) => (r == null ? null : String(Math.round(r * 1000) / 1000));
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n));

/** 資産の区分（種類・細目・取得年月日・事業の用に供した年月・耐用年数） */
function assetHead(p: string, a: DepAsset, withLife = true): X[] {
  const c = (n: number) => `${p}${String(n).padStart(5, "0")}`;
  return [
    group(
      c(10),
      value(c(20), str15(a.accountName)),
      value(c(40), str15(a.name)),
      etaxDate(c(50), a.acquisitionDate),
      yymm(c(60), a.serviceStartDate),
      withLife ? value(c(70), a.usefulLife) : null
    ),
  ];
}

/** 別表十六(一) 定額法の1資産 */
function straightLine(a: DepAsset, r: ScheduleRow): string | null {
  const total16 = r.closingBook + r.booked + r.openingExcess;
  const shortfall = r.limit === null ? 0 : Math.max(0, r.limit - r.booked);
  return group(
    "NZE00000",
    ...assetHead("NZE", a),
    group("NZE00080", amount("NZE00100", a.acquisitionCost), amount("NZE00130", a.acquisitionCost)),
    group(
      "NZE00140",
      amount("NZE00150", r.closingBook),
      amount("NZE00190", r.closingBook),
      amount("NZE00220", r.booked),
      amount("NZE00240", r.openingExcess),
      amount("NZE00250", total16)
    ),
    group(
      "NZE00260",
      group(
        "NZE00390",
        amount("NZE00400", a.acquisitionCost),
        value("NZE00410", rate3(a.rate?.rate)),
        amount("NZE00420", r.ordinaryLimit),
        amount("NZE00460", r.ordinaryLimit)
      )
    ),
    group(
      "NZE00470",
      amount("NZE00480", r.ordinaryLimit),
      r.specialLimit ? group("NZE00490", amount("NZE00560", r.specialLimit)) : null,
      amount("NZE00600", r.limit ?? r.ordinaryLimit)
    ),
    amount("NZE00610", r.booked),
    group("NZE00620", amount("NZE00630", shortfall), amount("NZE00640", r.excess)),
    group("NZE00650", group("NZE00660", amount("NZE00680", r.openingExcess)), group("NZE00690", amount("NZE00700", r.allowed)), amount("NZE00740", r.closingExcess)),
    r.specialShortfall ? group("NZE00750", amount("NZE00760", r.specialShortfall), amount("NZE00780", r.specialShortfall)) : null
  );
}

/** 別表十六(二) 定率法の1資産 */
function decliningBalance(a: DepAsset, r: ScheduleRow): string | null {
  const total16 = r.closingBook + r.booked + r.openingExcess;
  const shortfall = r.limit === null ? 0 : Math.max(0, r.limit - r.booked);
  const guarantee = a.rate?.guarantee ?? null;
  // 改定取得価額: 改定償却率に切り替わった最初の期の期首の帳簿価額（税務上）
  const firstRevised = a.schedule.find((x) => x.revised);
  const revisedBase = firstRevised ? firstRevised.openingBook + firstRevised.openingExcess : null;
  const beforeAdjust = Math.floor((total16 * (a.rate?.rate ?? 0) * r.months) / 12);
  return group(
    "UZE00000",
    ...assetHead("UZE", a),
    group("UZE00080", amount("UZE00100", a.acquisitionCost), amount("UZE00130", a.acquisitionCost)),
    group(
      "UZE00140",
      amount("UZE00150", r.closingBook),
      amount("UZE00190", r.closingBook),
      amount("UZE00220", r.booked),
      amount("UZE00240", r.openingExcess),
      amount("UZE00250", total16),
      amount("UZE00270", total16)
    ),
    group(
      "UZE00280",
      group(
        "UZE00390",
        value("UZE00430", rate3(a.rate?.rate)),
        amount("UZE00470", r.revised ? beforeAdjust : r.ordinaryLimit),
        guarantee !== null ? value("UZE00480", String(guarantee)) : null,
        guarantee !== null ? amount("UZE00490", Math.floor(a.acquisitionCost * guarantee)) : null,
        r.revised
          ? group("UZE00500", amount("UZE00510", revisedBase), value("UZE00520", a.rate?.revised ?? null), amount("UZE00530", r.ordinaryLimit))
          : null,
        amount("UZE00570", r.ordinaryLimit)
      )
    ),
    group(
      "UZE00580",
      amount("UZE00590", r.ordinaryLimit),
      r.specialLimit ? group("UZE00600", amount("UZE00670", r.specialLimit)) : null,
      amount("UZE00710", r.limit ?? r.ordinaryLimit)
    ),
    amount("UZE00720", r.booked),
    group("UZE00730", amount("UZE00740", shortfall), amount("UZE00750", r.excess)),
    group("UZE00760", group("UZE00770", amount("UZE00790", r.openingExcess)), group("UZE00800", amount("UZE00810", r.allowed)), amount("UZE00850", r.closingExcess)),
    r.specialShortfall ? group("UZE00860", amount("UZE00870", r.specialShortfall), amount("UZE00890", r.specialShortfall)) : null
  );
}

export function depreciationForms(
  assets: DepAsset[],
  period: { start: string; end: string; months: number },
  /** 納税者等部（事業年度と法人名）。p は様式ごとの頭文字（NZA など）、name は法人名の入れ子の要素の番号（外・内） */
  header: (p: string, name: [number, number]) => string | null
): DepreciationForms {
  const warnings: string[] = [];
  const forms: DepreciationForms["forms"] = [];
  const old = assets.filter((a) => a.kind === "unsupported" && a.current);
  if (old.length)
    warnings.push(`平成19年3月31日以前に取得した資産（${old.map((a) => a.name).join("・")}）は別表十六に載せていません。e-Taxソフトで追加してください。`);

  // 定額法・定率法（当期に償却する資産）
  const sl = assets.filter((a) => a.kind === "sl" && a.current);
  const db = assets.filter((a) => (a.kind === "db200" || a.kind === "db250") && a.current);
  for (const part of chunk(sl, 5))
    forms.push({ tag: "HOE315", version: "6.0", body: [header("NZA", [40, 50]), ...part.map((a) => straightLine(a, a.current!))].filter(Boolean).join("") });
  for (const part of chunk(db, 5))
    forms.push({ tag: "HOE325", version: "6.0", body: [header("UZA", [40, 50]), ...part.map((a) => decliningBalance(a, a.current!))].filter(Boolean).join("") });

  // 少額減価償却資産（当期に事業の用に供したもの）
  const small = assets.filter((a) => a.kind === "immediate" && a.serviceStartDate >= period.start && a.serviceStartDate <= period.end);
  const smallAssetsTotal = small.reduce((s, a) => s + a.acquisitionCost, 0);
  chunk(small, 15).forEach((part, k) =>
    forms.push({
      tag: "HOE351",
      version: "4.0",
      body: [
        header("IHA", [40, 50]),
        ...part.map((a) =>
          group(
            "IHB00000",
            group("IHB00010", value("IHB00020", str15(a.accountName)), value("IHB00040", str15(a.name)), yymm("IHB00050", a.serviceStartDate)),
            group("IHB00060", amount("IHB00070", a.acquisitionCost), amount("IHB00090", a.acquisitionCost))
          )
        ),
        k === 0 ? amount("IHC00000", smallAssetsTotal) : null, // 当期の合計は1枚目に
      ]
        .filter(Boolean)
        .join(""),
    })
  );

  // 一括償却資産（事業の用に供した事業年度ごと）
  const lumps = assets.filter((a) => a.kind === "lump" && a.current);
  if (lumps.length) {
    const byYear = new Map<string, { start: string; end: string; rows: ScheduleRow[]; cost: number }>();
    for (const a of lumps) {
      const first = a.schedule[0];
      const key = first?.start ?? a.serviceStartDate;
      const g = byYear.get(key) ?? { start: first?.start ?? a.serviceStartDate, end: first?.end ?? period.end, rows: [], cost: 0 };
      g.rows.push(a.current!);
      g.cost += a.acquisitionCost;
      byYear.set(key, g);
    }
    const sum = (rows: ScheduleRow[], f: (r: ScheduleRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const cols = (g: { rows: ScheduleRow[]; cost: number }) => {
      const limit = sum(g.rows, (r) => r.ordinaryLimit);
      const booked = sum(g.rows, (r) => r.booked);
      return { limit, booked, short: Math.max(0, limit - booked), over: Math.max(0, booked - limit), open: sum(g.rows, (r) => r.openingExcess), allowed: sum(g.rows, (r) => r.allowed), close: sum(g.rows, (r) => r.closingExcess), cost: g.cost };
    };
    const past = [...byYear.values()].filter((g) => g.start < period.start).sort((x, y) => x.start.localeCompare(y.start));
    const cur = [...byYear.values()].find((g) => g.start >= period.start);
    if (past.length > 5) warnings.push("一括償却資産の事業年度が5つを超えるため、古い年度は別表十六(八)に載せていません。");
    const c = cur ? cols(cur) : null;
    forms.push({
      tag: "HOE360",
      version: "7.0",
      body: [
        header("ENA", [35, 40]),
        ...past.slice(-5).map((g) => {
          const x = cols(g);
          return group(
            "ENB00000",
            group("ENB01000", etaxDate("ENB01100", g.start), etaxDate("ENB01200", g.end)),
            amount("ENB02000", x.cost),
            value("ENB03000", period.months),
            amount("ENB04000", x.limit),
            amount("ENB05000", x.booked),
            group("ENB06000", amount("ENB06100", x.short), amount("ENB06200", x.over)),
            group("ENB07000", amount("ENB07100", x.open), amount("ENB07200", x.allowed), amount("ENB07300", x.close))
          );
        }),
        c
          ? group(
              "ENC00000",
              amount("ENC01000", c.cost),
              value("ENC02000", period.months),
              amount("ENC03000", c.limit),
              amount("ENC04000", c.booked),
              group("ENC05000", amount("ENC05100", c.short), amount("ENC05200", c.over)),
              group("ENC06000", amount("ENC06100", c.open), amount("ENC06200", c.allowed), amount("ENC06300", c.close))
            )
          : null,
      ]
        .filter(Boolean)
        .join(""),
    });
  }
  return { forms, smallAssetsTotal, warnings };
}
