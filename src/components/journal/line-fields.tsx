"use client";

/**
 * 仕訳の行に付ける「補助科目」と「税区分」の入力欄。
 * 仕訳入力画面と帳簿閲覧の修正画面で同じものを使う。
 */

import { useMemo } from "react";
import { PartnerInput } from "@/components/ui/partner-input";
import { taxCategoriesFor } from "@/lib/tax-category";
import type { SubAccount } from "@/actions/sub-accounts";
import { cn } from "@/lib/utils";

/** 行の補助科目。候補から選べば id が入り、手入力なら name だけ（保存時に作る） */
export type LineSub = { id: string | null; name: string };

export const EMPTY_SUB: LineSub = { id: null, name: "" };

/**
 * 補助科目の入力欄。その科目の補助科目を予測変換で出す。
 * 候補に無い名前もそのまま入力でき、保存時に新しい補助科目として登録される。
 */
export function SubAccountInput({
  accountId,
  subAccounts,
  value,
  onChange,
  className,
}: {
  accountId: string;
  subAccounts: SubAccount[];
  value: LineSub;
  onChange: (v: LineSub) => void;
  className?: string;
}) {
  const options = useMemo(
    () => subAccounts.filter((s) => s.accountId === accountId && s.isActive),
    [subAccounts, accountId]
  );
  return (
    <PartnerInput
      value={value.name}
      partners={options}
      placeholder={accountId ? "補助科目（任意）" : "先に科目を選択"}
      onChange={(text) => {
        // 打った名前が既存の補助科目と同じなら、それを選んだことにする
        const hit = options.find((o) => o.name === text.trim());
        onChange({ id: hit?.id ?? null, name: text });
      }}
      onSelect={(s) => onChange({ id: s.id, name: s.name })}
      className={cn("py-1 text-xs", className)}
    />
  );
}

/** 税区分の選択欄。費用・収益の行にだけ出す（それ以外の行には税区分を付けない） */
export function TaxCategorySelect({
  accountType,
  value,
  onChange,
  className,
}: {
  accountType: string;
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const options = taxCategoriesFor(accountType);
  if (options.length === 0) return null;
  return (
    <select
      aria-label="税区分"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full px-1.5 py-1 rounded-md border border-border bg-card text-foreground text-xs",
        !value && "text-warning border-warning/40",
        className
      )}
    >
      <option value="">税区分（未設定）</option>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
