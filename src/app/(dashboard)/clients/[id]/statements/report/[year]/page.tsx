"use client";

import { useState, useEffect, use } from "react";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getSettlementReport,
  type SettlementReport,
  type ReportLine,
  type BsGroup,
} from "@/actions/settlement-report";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #report-root, #report-root * { visibility: visible !important; }
  #report-root { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  .sheet { page-break-after: always; box-shadow: none !important; border: none !important; margin: 0 auto !important; }
  .sheet:last-child { page-break-after: auto; }
  @page { size: A4; margin: 14mm; }
}
`;

const SERIF_FONT =
  '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "MS Mincho", serif';

// 和暦表記（例: 令和8年3月31日）
function jpDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let era: string;
  if (y > 2019 || (y === 2019 && mo >= 5)) {
    const n = y - 2018;
    era = `令和${n === 1 ? "元" : n}`;
  } else if (y > 1989 || (y === 1989 && mo >= 1)) {
    const n = y - 1988;
    era = `平成${n === 1 ? "元" : n}`;
  } else {
    return `${y}年${mo}月${d}日`;
  }
  return `${era}年${mo}月${d}日`;
}

// 金額表記（マイナスは△、通貨記号なし・単位は表頭に記載）
function fmtAmt(n: number): string {
  const s = Math.abs(n).toLocaleString("ja-JP");
  return n < 0 ? `△${s}` : s;
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sheet mx-auto max-w-[820px] bg-white text-black border border-border rounded-lg shadow-sm p-12 mb-6"
      style={{ fontFamily: SERIF_FONT }}
    >
      {children}
    </div>
  );
}

// 各計算書共通のヘッダ（表題・日付/期間・会社名・単位）
function SheetHeader({
  title,
  subtitle,
  companyName,
}: {
  title: string;
  subtitle: string;
  companyName: string;
}) {
  return (
    <>
      <h2 className="text-center text-2xl tracking-[0.5em] mb-1">{title}</h2>
      <p className="text-center text-sm mb-4">{subtitle}</p>
      <div className="flex items-end justify-between text-sm mb-1">
        <span>{companyName}</span>
        <span>（単位：円）</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 貸借対照表（勘定式）
// ---------------------------------------------------------------------------

type BsRow =
  | { kind: "part"; label: string }
  | { kind: "group"; label: string; indent: number }
  | { kind: "item"; label: string; amount: number; indent: number }
  | { kind: "note"; label: string; amount: number; indent: number }
  | { kind: "subtotal"; label: string; amount: number; indent: number }
  | { kind: "total"; label: string; amount: number }
  | { kind: "blank" };

function groupToRows(g: BsGroup, depth: number): BsRow[] {
  const rows: BsRow[] = [{ kind: "group", label: g.title, indent: depth }];
  for (const sub of g.subgroups ?? []) rows.push(...groupToRows(sub, depth + 1));
  for (const l of g.lines)
    rows.push({ kind: "item", label: l.name, amount: l.amount, indent: depth + 1 });
  rows.push({ kind: "subtotal", label: `${g.title}合計`, amount: g.total, indent: depth });
  return rows;
}

function BsCells({ row }: { row: BsRow }) {
  if (row.kind === "blank") {
    return (
      <>
        <td className="px-2">&nbsp;</td>
        <td className="px-2" />
      </>
    );
  }
  if (row.kind === "part") {
    return (
      <>
        <td colSpan={2} className="px-2 py-1 text-center font-bold border-b border-black">
          【{row.label}】
        </td>
      </>
    );
  }
  if (row.kind === "total") {
    return (
      <>
        <td className="px-2 py-1 font-bold border-t-2 border-black">{row.label}</td>
        <td className="px-2 py-1 text-right tabular-nums font-bold border-t-2 border-black border-l border-l-gray-300">
          {fmtAmt(row.amount)}
        </td>
      </>
    );
  }
  const indentPad = { paddingLeft: `${0.5 + row.indent * 1}rem` };
  if (row.kind === "group") {
    return (
      <>
        <td className="px-2 py-0.5" style={indentPad}>
          {row.label}
        </td>
        <td className="px-2 py-0.5 border-l border-l-gray-300" />
      </>
    );
  }
  const isSubtotal = row.kind === "subtotal";
  const isNote = row.kind === "note";
  return (
    <>
      <td
        className={`px-2 py-0.5 ${isNote ? "text-gray-600" : ""}`}
        style={indentPad}
      >
        {isNote ? `（${row.label}）` : row.label}
      </td>
      <td
        className={`px-2 py-0.5 text-right tabular-nums border-l border-l-gray-300 ${
          isSubtotal ? "border-t border-gray-400" : ""
        } ${isNote ? "text-gray-600" : ""}`}
      >
        {isNote ? `（${fmtAmt(row.amount)}）` : fmtAmt(row.amount)}
      </td>
    </>
  );
}

function BalanceSheetTable({ bs }: { bs: SettlementReport["bs"] }) {
  // 左側：資産の部
  const left: BsRow[] = [{ kind: "part", label: "資産の部" }];
  for (const g of bs.assetGroups) left.push(...groupToRows(g, 0));

  // 右側：負債の部・純資産の部
  const right: BsRow[] = [{ kind: "part", label: "負債の部" }];
  for (const g of bs.liabilityGroups) right.push(...groupToRows(g, 0));
  right.push({ kind: "subtotal", label: "負債合計", amount: bs.totalLiabilities, indent: 0 });
  right.push({ kind: "part", label: "純資産の部" });
  for (const g of bs.equityGroups) {
    const rows = groupToRows(g, 0);
    // 繰越利益剰余金の直後に「うち当期純利益」を内書きする
    const idx = rows.findIndex((r) => r.kind === "item" && r.label.includes("繰越利益"));
    const note: BsRow = {
      kind: "note",
      label: "うち当期純利益",
      amount: bs.netIncome,
      indent: 2,
    };
    if (idx >= 0) rows.splice(idx + 1, 0, note);
    else rows.splice(rows.length - 1, 0, note);
    right.push(...rows);
  }
  right.push({ kind: "subtotal", label: "純資産合計", amount: bs.totalEquity, indent: 0 });

  // 行数を揃えて最終行に合計を置く
  const bodyLen = Math.max(left.length, right.length);
  while (left.length < bodyLen) left.push({ kind: "blank" });
  while (right.length < bodyLen) right.push({ kind: "blank" });
  left.push({ kind: "total", label: "資産合計", amount: bs.totalAssets });
  right.push({
    kind: "total",
    label: "負債・純資産合計",
    amount: bs.totalLiabilities + bs.totalEquity,
  });

  return (
    <table className="w-full text-[13px] border-collapse border-2 border-black">
      <thead>
        <tr className="border-b border-black">
          <th className="w-[30%] px-2 py-1 font-normal">科目</th>
          <th className="w-[20%] px-2 py-1 font-normal border-l border-gray-300">金額</th>
          <th className="w-0 p-0 border-l border-black" />
          <th className="w-[30%] px-2 py-1 font-normal">科目</th>
          <th className="w-[20%] px-2 py-1 font-normal border-l border-gray-300">金額</th>
        </tr>
      </thead>
      <tbody>
        {left.map((lRow, i) => (
          <tr key={i}>
            <BsCells row={lRow} />
            <td className="p-0 border-l border-black" />
            <BsCells row={right[i]} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// 損益計算書（報告式：内訳・合計の2列）
// ---------------------------------------------------------------------------

type PlRow = {
  label: string;
  detail?: number; // 内訳列
  amount?: number; // 金額列
  indent?: number;
  bold?: boolean;
  rule?: boolean; // 金額列上の罫線（小計）
};

function buildPlRows(pl: SettlementReport["pl"]): PlRow[] {
  const rows: PlRow[] = [];
  const section = (title: string, items: ReportLine[], total: number) => {
    if (items.length === 0) return;
    rows.push({ label: title });
    for (const it of items) rows.push({ label: it.name, detail: it.amount, indent: 1 });
    rows.push({ label: `${title}合計`, amount: total, indent: 1, rule: true });
  };
  const profit = (label: string, amount: number) =>
    rows.push({ label, amount, bold: true, rule: true });

  section("売上高", pl.sales, pl.salesT);
  section("売上原価", pl.cogs, pl.cogsT);
  profit("売上総利益", pl.grossProfit);
  if (pl.sga.length > 0) rows.push({ label: "販売費及び一般管理費", amount: pl.sgaT });
  profit("営業利益", pl.operatingProfit);
  section("営業外収益", pl.nonOpRev, pl.nonOpRevT);
  section("営業外費用", pl.nonOpExp, pl.nonOpExpT);
  profit("経常利益", pl.ordinaryProfit);
  section("特別利益", pl.extraGain, pl.extraGainT);
  section("特別損失", pl.extraLoss, pl.extraLossT);
  profit("税引前当期純利益", pl.pretaxProfit);
  if (pl.tax.length > 0)
    rows.push({ label: "法人税、住民税及び事業税", amount: pl.taxT, indent: 1 });
  profit("当期純利益", pl.netIncome);
  return rows;
}

function ProfitLossTable({ pl }: { pl: SettlementReport["pl"] }) {
  const rows = buildPlRows(pl);
  return (
    <table className="w-full text-[13px] border-collapse border-2 border-black">
      <thead>
        <tr className="border-b border-black">
          <th className="px-2 py-1 font-normal">科目</th>
          <th className="w-[22%] px-2 py-1 font-normal border-l border-gray-300">内訳</th>
          <th className="w-[22%] px-2 py-1 font-normal border-l border-gray-300">金額</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.bold ? "font-bold" : ""}>
            <td
              className="px-2 py-0.5"
              style={{ paddingLeft: `${0.5 + (r.indent ?? 0) * 1}rem` }}
            >
              {r.label}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums border-l border-gray-300">
              {r.detail !== undefined ? fmtAmt(r.detail) : ""}
            </td>
            <td
              className={`px-2 py-0.5 text-right tabular-nums border-l border-gray-300 ${
                r.rule ? "border-t border-gray-400" : ""
              }`}
            >
              {r.amount !== undefined ? fmtAmt(r.amount) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// 株主資本等変動計算書（横形式）
// ---------------------------------------------------------------------------

function EquityChangesTable({
  ce,
  netIncome,
}: {
  ce: SettlementReport["changesInEquity"];
  netIncome: number;
}) {
  const cols = ce.rows;
  const retainedIdx = cols.findIndex((c) => c.label.includes("利益剰余金"));
  const th = "border border-black px-2 py-1.5 font-normal";
  const td = "border border-black px-2 py-1.5 text-right tabular-nums";
  const tdL = "border border-black px-2 py-1.5 text-left";
  // その他の変動額（利益剰余金列は当期純利益を除いた分）
  const otherChange = cols.map((c, i) =>
    i === retainedIdx ? c.change - netIncome : c.change
  );
  const hasOther = otherChange.some((v) => v !== 0);
  return (
    <table className="w-full text-[13px] border-collapse border-2 border-black">
      <thead>
        <tr>
          <th className={th} />
          {cols.map((c, i) => (
            <th key={i} className={th}>
              {c.label}
            </th>
          ))}
          <th className={th}>純資産合計</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className={tdL}>当期首残高</td>
          {cols.map((c, i) => (
            <td key={i} className={td}>
              {fmtAmt(c.opening)}
            </td>
          ))}
          <td className={td}>{fmtAmt(ce.total.opening)}</td>
        </tr>
        <tr>
          <td className={tdL}>当期変動額</td>
          {cols.map((_, i) => (
            <td key={i} className={td} />
          ))}
          <td className={td} />
        </tr>
        <tr>
          <td className={tdL} style={{ paddingLeft: "1.5rem" }}>
            当期純利益
          </td>
          {cols.map((_, i) => (
            <td key={i} className={td}>
              {i === retainedIdx ? fmtAmt(netIncome) : ""}
            </td>
          ))}
          <td className={td}>{fmtAmt(netIncome)}</td>
        </tr>
        {hasOther && (
          <tr>
            <td className={tdL} style={{ paddingLeft: "1.5rem" }}>
              その他の変動額
            </td>
            {otherChange.map((v, i) => (
              <td key={i} className={td}>
                {v !== 0 ? fmtAmt(v) : ""}
              </td>
            ))}
            <td className={td}>{fmtAmt(ce.total.change - netIncome)}</td>
          </tr>
        )}
        <tr>
          <td className={tdL}>当期変動額合計</td>
          {cols.map((c, i) => (
            <td key={i} className={td}>
              {fmtAmt(c.change)}
            </td>
          ))}
          <td className={td}>{fmtAmt(ce.total.change)}</td>
        </tr>
        <tr className="font-bold">
          <td className={tdL}>当期末残高</td>
          {cols.map((c, i) => (
            <td key={i} className={td}>
              {fmtAmt(c.closing)}
            </td>
          ))}
          <td className={td}>{fmtAmt(ce.total.closing)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export default function SettlementReportPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = use(params);
  const router = useRouter();
  const [data, setData] = useState<SettlementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettlementReport(id, Number(year))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, year]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        読み込み中...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        {error ?? "データが見つかりません"}
      </div>
    );
  }

  const periodLabel = `自　${jpDate(data.period.start)}　　至　${jpDate(data.period.end)}`;
  const pl = data.pl;

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* 操作バー */}
      <div className="no-print flex items-center justify-between gap-2">
        <button
          onClick={() => router.push(`/clients/${id}/statements`)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          試算表・財務諸表に戻る
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Printer className="size-4" />
          印刷 / PDF保存
        </button>
      </div>

      {!data.bs.balanced && (
        <div className="no-print p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
          貸借対照表の貸借が一致していません。期首残高・仕訳をご確認ください。
        </div>
      )}

      <div id="report-root">
        {/* ===== 1. 表紙 ===== */}
        <Sheet>
          <div
            className="flex flex-col items-center text-center"
            style={{ minHeight: "980px" }}
          >
            <div className="mt-40">
              <h1 className="text-4xl tracking-[0.5em] mb-16 pl-[0.5em]">決算報告書</h1>
              <div className="text-base leading-9">
                <p>自　{jpDate(data.period.start)}</p>
                <p>至　{jpDate(data.period.end)}</p>
              </div>
            </div>
            <div className="mt-auto mb-10 space-y-1.5">
              <p className="text-2xl tracking-widest mb-3">{data.company.name}</p>
              {data.company.postalCode && (
                <p className="text-sm">〒{data.company.postalCode}</p>
              )}
              {data.company.address && <p className="text-sm">{data.company.address}</p>}
              {data.company.telephone && (
                <p className="text-sm">TEL　{data.company.telephone}</p>
              )}
              {data.preparer && (
                <p className="text-sm pt-6 text-gray-700">
                  作成　{data.preparer.name}
                </p>
              )}
            </div>
          </div>
        </Sheet>

        {/* ===== 2. 貸借対照表 ===== */}
        <Sheet>
          <SheetHeader
            title="貸借対照表"
            subtitle={`${jpDate(data.period.end)}　現在`}
            companyName={data.company.name}
          />
          <BalanceSheetTable bs={data.bs} />
        </Sheet>

        {/* ===== 3. 損益計算書 ===== */}
        <Sheet>
          <SheetHeader
            title="損益計算書"
            subtitle={periodLabel}
            companyName={data.company.name}
          />
          <ProfitLossTable pl={pl} />
        </Sheet>

        {/* ===== 4. 株主資本等変動計算書 ===== */}
        <Sheet>
          <SheetHeader
            title="株主資本等変動計算書"
            subtitle={periodLabel}
            companyName={data.company.name}
          />
          <EquityChangesTable ce={data.changesInEquity} netIncome={data.bs.netIncome} />
        </Sheet>

        {/* ===== 5. 個別注記表 ===== */}
        <Sheet>
          <h2 className="text-center text-2xl tracking-[0.5em] mb-1">個別注記表</h2>
          <p className="text-center text-sm mb-6">{periodLabel}</p>
          <div className="space-y-6 text-sm">
            {data.notes.map((n, i) => (
              <div key={i}>
                <p className="font-bold mb-1.5">
                  {i + 1}．{n.heading}
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed pl-4">
                  {n.body}
                </p>
              </div>
            ))}
          </div>
        </Sheet>

        {/* ===== 6. 販売費及び一般管理費の明細 ===== */}
        <Sheet>
          <SheetHeader
            title="販売費及び一般管理費の明細"
            subtitle={periodLabel}
            companyName={data.company.name}
          />
          {pl.sga.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              該当する費用はありません。
            </p>
          ) : (
            <table className="w-full max-w-[480px] mx-auto text-[13px] border-collapse border-2 border-black">
              <thead>
                <tr className="border-b border-black">
                  <th className="px-2 py-1 font-normal">科目</th>
                  <th className="w-[40%] px-2 py-1 font-normal border-l border-gray-300">
                    金額
                  </th>
                </tr>
              </thead>
              <tbody>
                {pl.sga.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-0.5">{l.name}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums border-l border-gray-300">
                      {fmtAmt(l.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="px-2 py-1 border-t-2 border-black">合計</td>
                  <td className="px-2 py-1 text-right tabular-nums border-t-2 border-black border-l border-l-gray-300">
                    {fmtAmt(pl.sgaT)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Sheet>
      </div>
    </div>
  );
}
