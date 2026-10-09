"use client";

/** 内訳書の画面に出す注意書きと、試算表との照合結果（画面のみ。印刷しない） */

import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { Reconciliation } from "@/lib/breakdown";
import { formatYen } from "@/lib/wareki";

export function Notice({ tone, children }: { tone: "info" | "warning" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "bg-info/10 border-info/20 text-info",
    warning: "bg-warning/10 border-warning/20 text-warning",
    success: "bg-success/10 border-success/20 text-success",
  }[tone];
  const Icon = tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={`no-print flex items-start gap-2 p-3 rounded-lg border text-sm leading-relaxed ${styles}`}>
      <Icon className="size-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** 試算表との照合結果を文章で示す */
export function CheckNotice({
  label,
  check,
  informational,
  hint,
}: {
  label: string;
  check: Reconciliation;
  informational?: boolean;
  hint?: string;
}) {
  const accounts = check.accountNames.length > 0 ? check.accountNames.join("・") : null;
  if (!accounts) {
    if (check.breakdownTotal === 0) return null;
    return (
      <Notice tone={informational ? "info" : "warning"}>
        {label}：試算表に残高のある勘定科目がありません（内訳書の合計 {formatYen(check.breakdownTotal)}円）。
        {hint}
      </Notice>
    );
  }
  if (check.matches) {
    return (
      <Notice tone="success">
        {label}：試算表の{accounts}の残高 {formatYen(check.accountTotal)}円 と一致しています。
      </Notice>
    );
  }
  const more = check.difference > 0;
  return (
    <Notice tone={informational ? "info" : "warning"}>
      {informational && "（参考）"}
      {label}：試算表の{accounts}は {formatYen(check.accountTotal)}円、内訳書の合計は{" "}
      {formatYen(check.breakdownTotal)}円 で、試算表の方が {formatYen(Math.abs(check.difference))}円{" "}
      {more ? "多く" : "少なく"}なっています。{hint}
    </Notice>
  );
}
