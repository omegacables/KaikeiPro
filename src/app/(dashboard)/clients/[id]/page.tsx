import Link from "next/link";
import {
  Receipt,
  Calculator,
  BookOpen,
  BarChart3,
  FileText,
  FileCheck,
  Percent,
  Archive,
  CreditCard,
  Wallet,
  Handshake,
  Banknote,
  ArrowRight,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getClient } from "@/actions/clients";
import { getRecentJournals } from "@/actions/journals";
import { getFirms } from "@/actions/firms";
import { formatCurrency, getInitials } from "@/lib/utils";
import { ClientPortalAccountForm } from "@/components/client-portal-account-form";
import { FirmAssignment } from "@/components/firm-assignment";

const quickStats = [
  { label: "未確認領収書", value: 0, icon: Receipt, color: "text-warning" },
  { label: "AI仕訳確認待ち", value: 0, icon: Calculator, color: "text-primary-light" },
  { label: "未回答質問", value: 0, icon: MessageSquare, color: "text-destructive" },
  { label: "今月の仕訳数", value: 0, icon: BookOpen, color: "text-success" },
];

const menuItems = [
  { href: "journals", label: "仕訳入力", icon: Calculator, desc: "仕訳の作成・編集・確認" },
  { href: "documents", label: "証憑管理", icon: FileCheck, desc: "領収書・請求書の管理" },
  { href: "ledgers", label: "帳簿閲覧", icon: BookOpen, desc: "仕訳帳・総勘定元帳・出納帳" },
  { href: "statements", label: "試算表・財務諸表", icon: BarChart3, desc: "B/S・P/L・月次推移表" },
  { href: "accounts", label: "勘定科目管理", icon: FileText, desc: "科目の追加・編集・補助科目" },
  { href: "tax", label: "消費税計算", icon: Percent, desc: "税率別集計・申告データ" },
  { href: "closing", label: "決算処理", icon: Archive, desc: "減価償却・決算整理仕訳・年度締め" },
  { href: "payments", label: "入金消込", icon: Wallet, desc: "入金照合・消込処理" },
  { href: "bank-transactions", label: "口座取引", icon: Banknote, desc: "銀行口座の取引照合・仕訳連携" },
  { href: "card-transactions", label: "カード取引", icon: CreditCard, desc: "クレジットカードの利用明細・AI仕訳" },
  { href: "partners", label: "取引先管理", icon: Handshake, desc: "得意先・仕入先・インボイス登録" },
];


export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch real data (no fallback mock)
  let clientData = {
    id,
    name: "",
    business_type: "",
    postal_code: "",
    address: "",
    telephone: "",
    email: "",
    fiscal_year_start_month: 4,
    tax_method: "standard" as "standard" | "simplified",
    invoice_registration_number: "",
    firm_id: null as string | null,
  };
  let recentJournals: { date: string; description: string; debit: string; credit: string; amount: number; source: string }[] = [];
  let firms: { id: string; name: string }[] = [];
  try {
    const [client, allFirms] = await Promise.all([
      getClient(id),
      getFirms(),
    ]);
    firms = allFirms.map((f) => ({ id: f.id, name: f.name }));
    clientData = {
      id: client.id,
      name: client.name,
      business_type: client.business_type ?? "",
      postal_code: client.postal_code ?? "",
      address: client.address ?? "",
      telephone: client.telephone ?? "",
      email: client.email ?? "",
      fiscal_year_start_month: client.fiscal_year_start_month,
      tax_method: client.tax_method,
      invoice_registration_number: client.invoice_registration_number ?? "",
      firm_id: client.firm_id,
    };

    const journals = await getRecentJournals(id, 4);
    if (journals && journals.length > 0) {
      recentJournals = journals.map((j) => {
        const lines = (j as { journal_entry_lines?: Array<{ debit_amount: number; credit_amount: number; accounts?: { name: string } | null }> }).journal_entry_lines ?? [];
        const debitLine = lines.find((l) => l.debit_amount > 0);
        const creditLine = lines.find((l) => l.credit_amount > 0);
        const totalAmount = lines.reduce((s, l) => s + l.debit_amount, 0);
        return {
          date: j.entry_date.replace(/-/g, "/"),
          description: j.description ?? "",
          debit: debitLine?.accounts?.name ?? "-",
          credit: creditLine?.accounts?.name ?? "-",
          amount: totalAmount,
          source: j.source,
        };
      });
    }
  } catch {
    // DB not available - show empty
  }

  return (
    <>
      {/* Client header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="size-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
            {getInitials(clientData.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {clientData.name}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <Badge variant="muted">{clientData.business_type}</Badge>
              <span className="text-muted-foreground text-sm">
                決算月: {clientData.fiscal_year_start_month + 11 > 12 ? clientData.fiscal_year_start_month - 1 : clientData.fiscal_year_start_month + 11}月
              </span>
              <span className="text-muted-foreground text-sm">•</span>
              <span className="text-muted-foreground text-sm">
                {clientData.tax_method === "standard" ? "本則課税" : "簡易課税"}
              </span>
              <span className="text-muted-foreground text-sm">•</span>
              <span className="text-muted-foreground text-sm">
                {clientData.invoice_registration_number}
              </span>
            </div>
            <div className="mt-2">
              <FirmAssignment
                clientId={id}
                currentFirmId={clientData.firm_id}
                currentFirmName={firms.find((f) => f.id === clientData.firm_id)?.name ?? null}
                firms={firms}
              />
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickStats.map((stat) => (
            <Card key={stat.label} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className={`size-4 ${stat.color}`} />
                <span className="text-muted-foreground text-xs">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Monthly progress */}
      <Card className="mb-8 p-6">
        <h3 className="text-foreground font-bold mb-4 flex items-center gap-2">
          <Clock className="size-4 text-primary-light" />
          今月の月次進捗
        </h3>
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "領収書提出", progress: 0, status: "pending" },
            { label: "OCR処理", progress: 0, status: "pending" },
            { label: "AI仕訳提案", progress: 0, status: "pending" },
            { label: "税理士確認", progress: 0, status: "pending" },
            { label: "月次完了", progress: 0, status: "pending" },
          ].map((step) => (
            <div key={step.label} className="text-center">
              <div
                className={`size-10 rounded-full flex items-center justify-center mx-auto mb-2 ${
                  step.status === "done"
                    ? "bg-success/20 text-success"
                    : step.status === "progress"
                      ? "bg-warning/20 text-warning"
                      : "bg-muted/30 text-muted-foreground"
                }`}
              >
                {step.status === "done" ? (
                  <CheckCircle className="size-5" />
                ) : step.status === "progress" ? (
                  <AlertTriangle className="size-5" />
                ) : (
                  <Clock className="size-5" />
                )}
              </div>
              <p className="text-xs font-medium text-foreground">{step.label}</p>
              <ProgressBar value={step.progress} className="mt-2" showPercent={false} />
            </div>
          ))}
        </div>
      </Card>

      {/* Portal account creation */}
      <div className="mb-8">
        <ClientPortalAccountForm clientId={id} />
      </div>

      {/* Menu grid */}
      <h3 className="text-foreground text-lg font-bold mb-4">業務メニュー</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {menuItems.map((item) => (
          <Link key={item.href} href={`/clients/${id}/${item.href}`}>
            <Card className="p-4 hover:shadow-md transition-all hover:border-primary/30 cursor-pointer group h-full">
              <div className="flex items-start justify-between">
                <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-cream transition-colors">
                  <item.icon className="size-5" />
                </div>
              </div>
              <h4 className="text-foreground font-bold mt-3">{item.label}</h4>
              <p className="text-muted-foreground text-xs mt-1">{item.desc}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent journals */}
      <h3 className="text-foreground text-lg font-bold mb-4">最近の仕訳</h3>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">日付</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">摘要</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">借方</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">貸方</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">金額</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">ソース</th>
              </tr>
            </thead>
            <tbody>
              {recentJournals.map((j, idx) => (
                <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-3 text-muted-foreground">{j.date}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{j.description}</td>
                  <td className="px-4 py-3">{j.debit}</td>
                  <td className="px-4 py-3">{j.credit}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    ¥{j.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={j.source === "ai" ? "accent" : "muted"}>
                      {j.source === "ai" ? "AI" : "手動"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
