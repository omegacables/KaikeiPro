/**
 * 税区分の小さなラベル。税率ごとに色を分けて、一覧でも見分けられるようにする。
 *   10%（標準税率）… 青　／　8%（軽減税率）… 緑　／　経過措置 … 橙
 *   非課税・免税 … 紫　／　不課税 … 灰　／　費用・収益なのに未設定 … 赤枠
 */

import { taxCategoryInfo } from "@/lib/tax-category";
import { cn } from "@/lib/utils";

/** 一覧向けの短い呼び名 */
export function taxShortLabel(code: string | null | undefined): string | null {
  const info = taxCategoryInfo(code);
  if (!info) return null;
  const side = info.side === "sales" ? "売" : "仕";
  if (info.transitionRate) return `${side}${info.rate * 100}%経過${info.transitionRate * 100}`;
  if (info.rate === 0.1) return `${side}10%`;
  if (info.rate === 0.08) return `${side}8%軽`;
  if (/exempt/.test(info.code)) return `${side}非課税`;
  if (/tax_free/.test(info.code)) return `${side}免税`;
  return `${side}不課税`;
}

export function taxColorClass(code: string | null | undefined): string {
  const info = taxCategoryInfo(code);
  if (!info) return "border border-destructive/50 text-destructive";
  if (info.transitionRate) return "bg-warning/15 text-warning";
  if (info.rate === 0.1) return "bg-info/15 text-info";
  if (info.rate === 0.08) return "bg-success/15 text-success";
  if (/exempt|tax_free/.test(info.code)) return "bg-accent/15 text-accent";
  return "bg-muted text-muted-foreground";
}

/**
 * 税区分のラベル。missing を true にすると、未設定を赤枠で示す
 * （税区分が必要な費用・収益の行で使う）。
 */
export function TaxBadge({
  code,
  missing,
  className,
}: {
  code: string | null | undefined;
  missing?: boolean;
  className?: string;
}) {
  const label = taxShortLabel(code);
  if (!label && !missing) return null;
  return (
    <span
      title={taxCategoryInfo(code)?.name ?? "税区分が未設定です（消費税の集計に入りません）"}
      className={cn(
        "inline-block rounded px-1 py-px text-[10px] font-bold leading-tight whitespace-nowrap align-middle",
        taxColorClass(code),
        className
      )}
    >
      {label ?? "税未設定"}
    </span>
  );
}
