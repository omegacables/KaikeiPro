"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Printer,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getBreakdownForm,
  type BreakdownFormData,
  type LoanFormData,
  type MiscFormData,
  type MiscSection,
  type PersonnelFormData,
} from "@/actions/breakdown";
import type { Reconciliation } from "@/lib/breakdown";
import { formatYen } from "@/lib/wareki";
import { printPage } from "@/lib/export";
import {
  PrintStyles,
  FormSheet,
  FormHeader,
  BlankRows,
  cellCls,
  headCls,
  numCls,
  FORM_TABLE_MIN_W,
} from "@/components/print/form-sheet";

export default function BreakdownFormPage({
  params,
}: {
  params: Promise<{ id: string; period: string; form: string }>;
}) {
  const { id, period: periodKey, form } = use(params);
  const router = useRouter();
  const [data, setData] = useState<BreakdownFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getBreakdownForm(id, periodKey, form)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, periodKey, form]);

  const toolbar = (
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" onClick={() => router.push(`/clients/${id}/breakdown/${data?.period.startDate ?? periodKey}`)}>
        <ArrowLeft className="size-4" />
        内訳書の一覧に戻る
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => data && router.push(`/clients/${id}/breakdown/${data.period.prevKey}/${form}`)}
          disabled={!data}
          title="前の事業年度"
        >
          <ChevronLeft className="size-4" />
          前期
        </Button>
        <span className="text-[17px] font-medium tabular-nums">
          {data ? `${data.period.startDate} 〜 ${data.period.endDate}` : "読み込み中…"}
        </span>
        <Button
          variant="outline"
          onClick={() => data && router.push(`/clients/${id}/breakdown/${data.period.nextKey}/${form}`)}
          disabled={!data}
          title="次の事業年度"
        >
          翌期
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <Button onClick={printPage} disabled={!data}>
        <Printer className="size-4" />
        印刷 / PDF保存
      </Button>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {toolbar}
        <div className="flex items-center justify-center py-20 text-[17px]">
          <Loader2 className="size-5 animate-spin mr-2" />
          読み込み中...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {toolbar}
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error ?? "データがありません"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PrintStyles />
      {toolbar}

      {data.period.fromFiscalYears && (
        <Notice tone="info">
          決算月の変更などで記録された事業年度の期間（{data.period.startDate} 〜 {data.period.endDate}）を使っています。
        </Notice>
      )}

      {data.kind === "loan" && <LoanChecks data={data} />}
      {data.kind === "personnel" && <PersonnelNotes data={data} />}
      {data.kind === "misc" && <MiscChecks data={data} />}

      <div id="form-root">
        <FormSheet>
          <FormHeader
            title={data.def.title}
            clientName={data.period.clientName}
            startDate={data.period.startDate}
            endDate={data.period.endDate}
          />
          {data.kind === "loan" && <LoanTable data={data} />}
          {data.kind === "personnel" && <PersonnelTable data={data} />}
          {data.kind === "misc" && <MiscTables data={data} />}
        </FormSheet>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 照合結果・注意書き（画面のみ。印刷しない）
// ---------------------------------------------------------------------------

function Notice({ tone, children }: { tone: "info" | "warning" | "success"; children: React.ReactNode }) {
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
function CheckNotice({
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
        {label}：試算表に対応する勘定科目がありません（内訳書の合計 {formatYen(check.breakdownTotal)}円）。
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

function LoanChecks({ data }: { data: LoanFormData & { period: { endDate: string } } }) {
  const borrow = data.direction === "borrow";
  return (
    <>
      <CheckNotice
        label="期末現在高"
        check={data.balanceCheck}
        hint={
          borrow
            ? "借入金台帳への登録漏れ、または台帳と仕訳の不一致がないか確認してください（借入金台帳の「台帳と仕訳の照合」で確認できます）。"
            : "借入金台帳（貸付）への登録漏れ、または台帳と仕訳の不一致がないか確認してください。"
        }
      />
      <CheckNotice
        label={borrow ? "期中の支払利子額" : "期中の受取利息額"}
        check={data.interestCheck}
        informational
        hint={
          borrow
            ? "支払利息の科目には、借入金以外（カードの分割手数料など）の利息が入ることがあるため、一致しないこともあります。"
            : "受取利息の科目には、預金の利息なども入るため、一致しないことがあります。"
        }
      />
      {data.rows.length === 0 && (
        <Notice tone="info">
          この事業年度に記入する{borrow ? "借入金" : "貸付金"}はありません。
          {borrow ? "借入金" : "貸付"}は借入金台帳で登録します。
        </Notice>
      )}
    </>
  );
}

function PersonnelNotes({ data }: { data: PersonnelFormData }) {
  const b = data.breakdown;
  const used = [...b.officer.accounts, ...b.salary.accounts, ...b.wage.accounts];
  return (
    <>
      <Notice tone="info">
        総額は試算表の科目から集計しています
        {used.length > 0 ? `（${used.map((a) => a.name).join("・")}）` : ""}。
        退職金・法定福利費・福利厚生費は含めていません。
      </Notice>
      <Notice tone="warning">
        「総額のうち代表者及びその家族分」は、役員と家族の続柄を登録する機能が未対応のため空欄です。
        印刷後に手書きで記入してください。
      </Notice>
      {used.length === 0 && (
        <Notice tone="warning">
          役員報酬・給料手当などの科目に、この事業年度の金額がありません。
        </Notice>
      )}
    </>
  );
}

function MiscChecks({ data }: { data: MiscFormData }) {
  const section = (label: string, s: MiscSection) => {
    const unknown = s.listed.filter((r) => !r.counterparty).length;
    return (
      <div key={label} className="space-y-2">
        <CheckNotice
          label={label}
          check={s.check}
          hint="要確認のままの仕訳は試算表と同じく集計から除いています。"
        />
        {s.omittedCount > 0 && (
          <Notice tone="info">
            {label}のうち、記載基準（科目別・相手先別に10万円以上）に満たない {s.omittedCount}件・
            {formatYen(s.omittedAmount)}円 は記入を省いています（税金の還付金は金額に関わらず記入）。
          </Notice>
        )}
        {unknown > 0 && (
          <Notice tone="warning">
            {label}に、相手先が分からない行が {unknown}件 あります。印刷後に手書きで記入してください。
            相手先は、証憑の読み取り結果か連携元の取引先名から補っています。
          </Notice>
        )}
      </div>
    );
  };
  return (
    <>
      {section("雑益等", data.gains)}
      {section("雑損失等", data.losses)}
    </>
  );
}

// ---------------------------------------------------------------------------
// 紙面（印刷する）
// ---------------------------------------------------------------------------

function rate(v: number | null): string {
  return v != null ? `${v}%` : "";
}

/** ⑪借入金及び支払利子の内訳書 ／ ④貸付金及び受取利息の内訳書 */
function LoanTable({ data }: { data: LoanFormData }) {
  const borrow = data.direction === "borrow";
  const cols = borrow ? 7 : 8;
  return (
    <table className={`w-full ${FORM_TABLE_MIN_W} border-collapse text-[13px]`}>
      <thead>
        <tr>
          <th colSpan={borrow ? 2 : 3} className={headCls}>
            {borrow ? "借入先" : "貸付先"}
          </th>
          <th rowSpan={2} className={headCls}>
            法人・代表者
            <br />
            との関係
          </th>
          <th rowSpan={2} className={headCls}>
            期末現在高
          </th>
          <th rowSpan={2} className={headCls}>
            {borrow ? "期中の支払利子額" : "期中の受取利息額"}
          </th>
          <th rowSpan={2} className={headCls}>
            利率
          </th>
          <th rowSpan={2} className={headCls}>
            担保の内容
            <br />
            （物件の種類、数量、所在地等）
          </th>
        </tr>
        <tr>
          {!borrow && <th className={headCls}>登録番号（法人番号）</th>}
          <th className={headCls}>名称（氏名）</th>
          <th className={headCls}>所在地（住所）</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r, i) => (
          <tr key={i}>
            {!borrow && <td className={cellCls}>{r.registration_number ?? ""}</td>}
            <td className={cellCls}>{r.lender_name}</td>
            <td className={cellCls}>{r.address ?? ""}</td>
            <td className={cellCls}>{r.relationship ?? ""}</td>
            <td className={numCls}>{formatYen(r.closing_balance)}</td>
            <td className={numCls}>{formatYen(r.interest_paid)}</td>
            <td className={numCls}>{rate(r.interest_rate)}</td>
            <td className={cellCls}>{r.collateral ?? ""}</td>
          </tr>
        ))}
        <BlankRows count={(borrow ? 14 : 7) - data.rows.length} cols={cols} />
        <tr>
          <td colSpan={borrow ? 3 : 4} className={headCls}>
            計
          </td>
          <td className={`${numCls} font-bold`}>{formatYen(data.totalBalance)}</td>
          <td className={`${numCls} font-bold`}>{formatYen(data.totalInterest)}</td>
          <td className={cellCls}></td>
          <td className={cellCls}></td>
        </tr>
      </tbody>
    </table>
  );
}

/** ⑭人件費の内訳書 */
function PersonnelTable({ data }: { data: PersonnelFormData }) {
  const b = data.breakdown;
  const rows: [string, string, number][] = [
    ["役員給与", "", b.officer.total],
    ["従業員給料手当", "一般管理費に含まれる事務員の給料・賞与等", b.salary.total],
    ["従業員賃金手当", "製造原価・売上原価に含まれる工員等の賃金", b.wage.total],
  ];
  return (
    <table className="w-full max-w-[820px] border-collapse text-[14px]">
      <thead>
        <tr>
          <th className={headCls}>区分</th>
          <th className={headCls}>総額</th>
          <th className={headCls}>総額のうち代表者及びその家族分</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, note, amount]) => (
          <tr key={label}>
            <td className={cellCls}>
              {label}
              {note && <span className="ml-2 text-[11px]">（{note}）</span>}
            </td>
            <td className={numCls}>{formatYen(amount)}</td>
            <td className={cellCls}>&nbsp;</td>
          </tr>
        ))}
        <tr>
          <td className={headCls}>計</td>
          <td className={`${numCls} font-bold`}>{formatYen(b.total)}</td>
          <td className={cellCls}>&nbsp;</td>
        </tr>
      </tbody>
    </table>
  );
}

/** ⑯雑益、雑損失等の内訳書 */
function MiscTables({ data }: { data: MiscFormData }) {
  const block = (heading: string, s: MiscSection) => (
    <div className="mt-4">
      <p className="mb-1 text-[14px] font-bold">{heading}</p>
      <table className={`w-full ${FORM_TABLE_MIN_W} border-collapse text-[13px]`}>
        <thead>
          <tr>
            <th rowSpan={2} className={headCls}>
              科目
            </th>
            <th rowSpan={2} className={headCls}>
              取引の内容
            </th>
            <th colSpan={3} className={headCls}>
              相手先
            </th>
            <th rowSpan={2} className={headCls}>
              金額
            </th>
          </tr>
          <tr>
            <th className={headCls}>登録番号（法人番号）</th>
            <th className={headCls}>名称（氏名）</th>
            <th className={headCls}>所在地（住所）</th>
          </tr>
        </thead>
        <tbody>
          {s.listed.map((r, i) => (
            <tr key={i}>
              <td className={cellCls}>{r.accountName}</td>
              <td className={cellCls}>{r.description}</td>
              <td className={cellCls}>{r.registrationNumber ?? ""}</td>
              <td className={cellCls}>{r.counterparty ?? ""}</td>
              <td className={cellCls}>{r.address ?? ""}</td>
              <td className={numCls}>{formatYen(r.amount)}</td>
            </tr>
          ))}
          <BlankRows count={10 - s.listed.length} cols={6} />
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      {block("雑益等", data.gains)}
      {block("雑損失等", data.losses)}
    </>
  );
}
