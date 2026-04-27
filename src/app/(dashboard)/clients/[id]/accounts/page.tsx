"use client";

import { Fragment, useState } from "react";
import { useParams } from "next/navigation";
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getAccounts, getAccountCategories, createAccount } from "@/actions/accounts";

type SubAccount = {
  code: string;
  name: string;
  is_active: boolean;
};

type Account = {
  code: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  sub_accounts: SubAccount[];
};

type CategoryKey = "assets" | "liabilities" | "equity" | "revenue" | "expenses";

const tabs: { key: CategoryKey; label: string }[] = [
  { key: "assets", label: "資産" },
  { key: "liabilities", label: "負債" },
  { key: "equity", label: "純資産" },
  { key: "revenue", label: "収益" },
  { key: "expenses", label: "費用" },
];

const emptyAccounts: Record<CategoryKey, Account[]> = {
  assets: [], liabilities: [], equity: [], revenue: [], expenses: [],
};

export default function AccountsPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<CategoryKey>("assets");
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAccount, setNewAccount] = useState({ code: "", name: "", category_id: "" });
  const [categories, setCategories] = useState<{ id: string; type: string; name: string }[]>([]);

  async function loadCategories() {
    try {
      const cats = await getAccountCategories();
      setCategories(cats as { id: string; type: string; name: string }[]);
    } catch { /* ignore */ }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createAccount({
        client_id: id,
        code: newAccount.code,
        name: newAccount.name,
        category_id: newAccount.category_id,
        is_active: true,
        is_default: false,
      });
      setShowNewForm(false);
      setNewAccount({ code: "", name: "", category_id: "" });
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const { data: allAccounts } = useData(
    () =>
      getAccounts(id).then((rows) => {
        const grouped: Record<CategoryKey, Account[]> = {
          assets: [], liabilities: [], equity: [], revenue: [], expenses: [],
        };
        for (const r of rows) {
          const cat = (r as unknown as { account_categories?: { type?: string } }).account_categories?.type as CategoryKey | undefined;
          if (!cat || !(cat in grouped)) continue;
          grouped[cat].push({
            code: r.code,
            name: r.name,
            is_active: r.is_active,
            is_default: r.is_default,
            sub_accounts: [],
          });
        }
        return grouped;
      }),
    emptyAccounts
  );

  const toggleRow = (code: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const accounts = allAccounts[activeTab].filter((account) => {
    if (!showInactive && !account.is_active) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        account.code.includes(q) ||
        account.name.toLowerCase().includes(q) ||
        account.sub_accounts.some(
          (sa) => sa.code.includes(q) || sa.name.toLowerCase().includes(q)
        )
      );
    }
    return true;
  });

  const totalActive = allAccounts[activeTab].filter((a) => a.is_active).length;
  const totalInactive = allAccounts[activeTab].filter((a) => !a.is_active).length;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">勘定科目管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            勘定科目の一覧・追加・編集を行います
          </p>
        </div>
        <Button onClick={() => { setShowNewForm(!showNewForm); if (!showNewForm) loadCategories(); }}>
          <Plus className="size-4" />
          科目追加
        </Button>
      </div>

      {showNewForm && (
        <Card className="mb-6 p-6">
          <h3 className="text-sm font-bold text-foreground mb-4">新規勘定科目追加</h3>
          <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">科目コード *</label>
              <input type="text" required value={newAccount.code} onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })} placeholder="5900" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">科目名 *</label>
              <input type="text" required value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">カテゴリ *</label>
              <select required value={newAccount.category_id} onChange={(e) => setNewAccount({ ...newAccount, category_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="">選択してください</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewForm(false)}>キャンセル</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <><Loader2 className="size-4 animate-spin" />保存中...</> : "追加"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Search and filter */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="科目コード・科目名で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              showInactive
                ? "bg-primary/10 text-primary"
                : "bg-muted/30 text-muted-foreground hover:text-foreground"
            )}
          >
            {showInactive ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {showInactive ? "無効科目を表示中" : "無効科目を非表示"}
          </button>
          <div className="text-xs text-muted-foreground">
            有効: {totalActive}件 / 無効: {totalInactive}件
          </div>
        </div>
      </Card>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 bg-muted/20 p-1 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-bold transition-all",
              activeTab === tab.key
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Accounts table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground w-8"></th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  コード
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  科目名
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  ステータス
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  種別
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  補助科目数
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <Fragment key={account.code}>
                  <tr
                    className={cn(
                      "border-b border-border hover:bg-muted/10 cursor-pointer",
                      !account.is_active && "opacity-50"
                    )}
                    onClick={() =>
                      account.sub_accounts.length > 0 && toggleRow(account.code)
                    }
                  >
                    <td className="px-4 py-3">
                      {account.sub_accounts.length > 0 ? (
                        expandedRows.has(account.code) ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {account.code}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {account.name}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs font-medium",
                          account.is_active ? "text-success" : "text-muted-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            account.is_active ? "bg-green-500" : "bg-muted-foreground/40"
                          )}
                        />
                        {account.is_active ? "有効" : "無効"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {account.is_default ? (
                        <Badge variant="muted">既定</Badge>
                      ) : (
                        <Badge variant="accent">カスタム</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {account.sub_accounts.length > 0
                        ? `${account.sub_accounts.length}件`
                        : "-"}
                    </td>
                  </tr>
                  {expandedRows.has(account.code) &&
                    account.sub_accounts
                      .filter((sa) => showInactive || sa.is_active)
                      .map((sub) => (
                        <tr
                          key={sub.code}
                          className={cn(
                            "border-b border-border bg-muted/10",
                            !sub.is_active && "opacity-50"
                          )}
                        >
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 pl-12 font-mono text-muted-foreground text-xs">
                            {sub.code}
                          </td>
                          <td className="px-4 py-2 text-foreground text-xs flex items-center gap-2">
                            <FileText className="size-3 text-muted-foreground" />
                            {sub.name}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 text-xs",
                                sub.is_active
                                  ? "text-success"
                                  : "text-muted-foreground"
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  sub.is_active
                                    ? "bg-green-500"
                                    : "bg-muted-foreground/40"
                                )}
                              />
                              {sub.is_active ? "有効" : "無効"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Badge variant="muted">補助</Badge>
                          </td>
                          <td className="px-4 py-2"></td>
                        </tr>
                      ))}
                </Fragment>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    該当する勘定科目が見つかりません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
