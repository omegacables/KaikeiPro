"use client";

import { Fragment, useState } from "react";
import { useParams } from "next/navigation";
import {
  Landmark,
  Plus,
  Search,
  ChevronDown,
  ChevronUp,
  Building2,
  Car,
  Monitor,
  Code2,
  Filter,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getAssets, createAsset } from "@/actions/assets";

type AssetCategory = "all" | "building" | "vehicle" | "equipment" | "software";

const categoryOptions: { key: AssetCategory; label: string; icon: typeof Building2 }[] = [
  { key: "all", label: "すべて", icon: Landmark },
  { key: "building", label: "建物", icon: Building2 },
  { key: "vehicle", label: "車両", icon: Car },
  { key: "equipment", label: "器具備品", icon: Monitor },
  { key: "software", label: "ソフトウェア", icon: Code2 },
];

type Asset = {
  id: number;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLife: number;
  depreciationMethod: string;
  accumulatedDepreciation: number;
  bookValue: number;
  schedule: { year: string; depreciation: number; accumulated: number; bookValue: number }[];
};


const categoryMap: Record<string, AssetCategory> = {
  "建物": "building",
  "車両運搬具": "vehicle",
  "車両": "vehicle",
  "器具備品": "equipment",
  "ソフトウェア": "software",
};

const categoryLabelMap: Record<AssetCategory, string> = {
  all: "すべて",
  building: "建物",
  vehicle: "車両",
  equipment: "器具備品",
  software: "ソフトウェア",
};

const depMethodLabel: Record<string, string> = {
  straight_line: "定額法",
  declining_balance: "定率法",
};

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>("all");
  const [expandedAsset, setExpandedAsset] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAsset, setNewAsset] = useState({
    name: "",
    category: "器具備品",
    acquisition_date: "",
    acquisition_cost: "",
    useful_life: "",
    depreciation_method: "straight_line" as "straight_line" | "declining_balance",
  });

  async function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createAsset({
        client_id: id,
        name: newAsset.name,
        category: newAsset.category,
        acquisition_date: newAsset.acquisition_date,
        acquisition_cost: Number(newAsset.acquisition_cost),
        useful_life: Number(newAsset.useful_life),
        depreciation_method: newAsset.depreciation_method,
        salvage_value: 1,
      });
      setShowNewForm(false);
      setNewAsset({ name: "", category: "器具備品", acquisition_date: "", acquisition_cost: "", useful_life: "", depreciation_method: "straight_line" });
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const { data: assets } = useData(
    () =>
      getAssets(id).then((rows) =>
        rows.map((r, i) => {
          const cat = categoryMap[r.category ?? ""] ?? "equipment";
          return {
            id: i + 1,
            name: r.name,
            category: cat,
            categoryLabel: categoryLabelMap[cat],
            acquisitionDate: r.acquisition_date.replace(/-/g, "/"),
            acquisitionCost: r.acquisition_cost,
            usefulLife: r.useful_life,
            depreciationMethod: depMethodLabel[r.depreciation_method] ?? r.depreciation_method,
            accumulatedDepreciation: 0,
            bookValue: r.acquisition_cost,
            schedule: [] as Asset["schedule"],
          };
        })
      ),
    [] as Asset[]
  );

  const filteredAssets = assets.filter((asset) => {
    if (selectedCategory !== "all" && asset.category !== selectedCategory) return false;
    if (searchQuery) {
      return asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const totalAcquisition = filteredAssets.reduce(
    (sum, a) => sum + a.acquisitionCost,
    0
  );
  const totalCurrentDepreciation = filteredAssets.reduce((sum, a) => {
    const currentSchedule = a.schedule.find((s) => s.year === "2024年度");
    return sum + (currentSchedule?.depreciation || 0);
  }, 0);
  const totalBookValue = filteredAssets.reduce((sum, a) => sum + a.bookValue, 0);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">固定資産台帳</h1>
          <p className="text-muted-foreground text-sm mt-1">
            固定資産の管理と減価償却計算
          </p>
        </div>
        <Button onClick={() => setShowNewForm(!showNewForm)}>
          <Plus className="size-4" />
          資産登録
        </Button>
      </div>

      {showNewForm && (
        <Card className="mb-6 p-6">
          <h3 className="text-sm font-bold text-foreground mb-4">新規資産登録</h3>
          <form onSubmit={handleCreateAsset} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">資産名 *</label>
              <input type="text" required value={newAsset.name} onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">分類 *</label>
              <select value={newAsset.category} onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="建物">建物</option>
                <option value="車両運搬具">車両運搬具</option>
                <option value="器具備品">器具備品</option>
                <option value="ソフトウェア">ソフトウェア</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">取得日 *</label>
              <input type="date" required value={newAsset.acquisition_date} onChange={(e) => setNewAsset({ ...newAsset, acquisition_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">取得金額 *</label>
              <input type="number" required min="1" value={newAsset.acquisition_cost} onChange={(e) => setNewAsset({ ...newAsset, acquisition_cost: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">耐用年数 *</label>
              <input type="number" required min="1" value={newAsset.useful_life} onChange={(e) => setNewAsset({ ...newAsset, useful_life: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">償却方法 *</label>
              <select value={newAsset.depreciation_method} onChange={(e) => setNewAsset({ ...newAsset, depreciation_method: e.target.value as "straight_line" | "declining_balance" })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="straight_line">定額法</option>
                <option value="declining_balance">定率法</option>
              </select>
            </div>
            <div className="md:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewForm(false)}>キャンセル</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <><Loader2 className="size-4 animate-spin" />保存中...</> : "登録"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Landmark className="size-4 text-primary" />
            <span className="text-sm text-muted-foreground">資産総額</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(totalAcquisition)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {filteredAssets.length}件の資産
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <ChevronDown className="size-4 text-warning" />
            <span className="text-sm text-muted-foreground">当期償却額</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(totalCurrentDepreciation)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">2024年度</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="size-4 text-success" />
            <span className="text-sm text-muted-foreground">期末帳簿価額</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(totalBookValue)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            償却率: {((1 - totalBookValue / totalAcquisition) * 100).toFixed(1)}%
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="資産名で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg">
            {categoryOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSelectedCategory(opt.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                  selectedCategory === opt.key
                    ? "bg-card text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <opt.icon className="size-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Asset table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  資産名
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  分類
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  取得日
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  取得価額
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  耐用年数
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  償却方法
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  償却累計額
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  帳簿価額
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground w-8">
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <Fragment key={asset.id}>
                  <tr
                    className="border-b border-border hover:bg-muted/10 cursor-pointer"
                    onClick={() =>
                      setExpandedAsset(
                        expandedAsset === asset.id ? null : asset.id
                      )
                    }
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {asset.name}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="muted">{asset.categoryLabel}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.acquisitionDate}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatCurrency(asset.acquisitionCost)}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {asset.usefulLife}年
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={
                          asset.depreciationMethod === "定額法"
                            ? "default"
                            : "accent"
                        }
                      >
                        {asset.depreciationMethod}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">
                      {formatCurrency(asset.accumulatedDepreciation)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {formatCurrency(asset.bookValue)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {expandedAsset === asset.id ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                  {expandedAsset === asset.id && (
                    <tr key={`${asset.id}-schedule`}>
                      <td colSpan={9} className="p-0">
                        <div className="bg-muted/10 p-4 border-b border-border overflow-x-auto">
                          <h4 className="text-sm font-bold text-foreground mb-3">
                            償却スケジュール
                          </h4>
                          <table className="w-full text-xs min-w-[360px]">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left px-3 py-2 text-muted-foreground font-bold">
                                  年度
                                </th>
                                <th className="text-right px-3 py-2 text-muted-foreground font-bold">
                                  償却額
                                </th>
                                <th className="text-right px-3 py-2 text-muted-foreground font-bold">
                                  償却累計額
                                </th>
                                <th className="text-right px-3 py-2 text-muted-foreground font-bold">
                                  期末帳簿価額
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {asset.schedule.map((row) => (
                                <tr
                                  key={row.year}
                                  className={cn(
                                    "border-b border-border last:border-0",
                                    row.year === "2024年度" && "bg-primary/5"
                                  )}
                                >
                                  <td className="px-3 py-2 text-foreground">
                                    {row.year}
                                    {row.year === "2024年度" && (
                                      <Badge
                                        variant="default"
                                        className="ml-2 text-[10px]"
                                      >
                                        当期
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono">
                                    {formatCurrency(row.depreciation)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                    {formatCurrency(row.accumulated)}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono font-bold">
                                    {formatCurrency(row.bookValue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredAssets.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    該当する固定資産が見つかりません
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
