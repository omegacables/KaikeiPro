/**
 * 勘定科目内訳明細書など、税務署に提出する様式を印刷するための紙面部品。
 *
 * 国税庁の内訳書の様式は A4 横。紙面は .paper クラスで色の変数を白地用に
 * 差し替えるので、中ではテーマ連動の色を気にせず書ける（globals.css）。
 */

import type { ReactNode } from "react";
import { toWareki } from "@/lib/wareki";

/** 印刷時は紙面だけを出す。用紙は A4 横 */
export const FORM_PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #form-root, #form-root * { visibility: visible !important; }
  #form-root { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  .sheet { page-break-after: always; box-shadow: none !important; border: none !important; margin: 0 auto !important; padding: 0 !important; max-width: none !important; }
  .sheet:last-child { page-break-after: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}
`;

export const SERIF_FONT =
  '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "MS Mincho", serif';

export function PrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: FORM_PRINT_CSS }} />;
}

/**
 * 1枚の様式。印刷対象は #form-root の中だけ。
 * 様式の表は横に広いので、狭い画面では用紙の中で横スクロールさせる
 * （はみ出しを隠すと右側の列が読めなくなる）。印刷時はスクロールしない。
 */
export function FormSheet({ children }: { children: ReactNode }) {
  return (
    <div
      className="paper sheet mx-auto w-full max-w-[1120px] bg-white text-black border border-border rounded-lg shadow-sm p-4 sm:p-10 mb-6"
      style={{ fontFamily: SERIF_FONT }}
    >
      <div className="overflow-x-auto print:overflow-visible">{children}</div>
    </div>
  );
}

/** 様式の表の最小幅。これより狭い画面では用紙の中で横スクロールする */
export const FORM_TABLE_MIN_W = "min-w-[960px]";

/** 様式の表題と、法人名・事業年度 */
export function FormHeader({
  title,
  clientName,
  startDate,
  endDate,
}: {
  title: string;
  clientName: string;
  startDate: string;
  endDate: string;
}) {
  return (
    <>
      <h1 className="text-center text-xl font-bold tracking-[0.3em]">{title}</h1>
      <div className="mt-5 mb-2 flex flex-wrap items-end justify-between gap-2 text-[14px]">
        <span>
          事業年度　{toWareki(startDate)} 〜 {toWareki(endDate)}
        </span>
        <span>
          法人名　{clientName}
          <span className="ml-6">（単位：円）</span>
        </span>
      </div>
    </>
  );
}

/** 様式の表のセル。罫線は黒、見出しは薄い灰色 */
export const cellCls = "border border-black px-2 py-1.5 align-middle";
export const headCls = `${cellCls} text-center font-bold bg-gray-100`;
export const numCls = `${cellCls} text-right tabular-nums`;

/** 用紙らしく見せるため、行が少ないときに空行で埋める */
export function BlankRows({ count, cols }: { count: number; cols: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }).map((_, i) => (
        <tr key={`blank-${i}`}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className={cellCls}>
              &nbsp;
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
