"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  CalendarRange,
  Loader2,
  Upload,
  X,
  FileText,
  Download,
  History,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  getFiscalMonthOverview,
  changeFiscalStartMonth,
  type FiscalMonthOverview,
} from "@/actions/fiscal-month";
import {
  getCompanyDocuments,
  uploadCompanyDocument,
  getCompanyDocumentUrl,
} from "@/actions/company-documents";
import { clearClientCache } from "@/lib/client-cache";
import { settlementMonth, startMonthFromSettlement, transitionalPeriodEnd, toJstDate } from "@/lib/fiscal";
import type { CompanyDocument, CompanyDocType } from "@/types/index";
import { docTypeLabel } from "../company-documents/content";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-[17px] focus:outline-none focus:ring-2 focus:ring-primary/40";

// 決算月の変更で添付する書類（会社書類に登録される）
const ATTACH_SLOTS: { key: string; docType: CompanyDocType; label: string; hint: string }[] = [
  {
    key: "minutes",
    docType: "minutes",
    label: "株主総会議事録",
    hint: "事業年度（決算月）の変更を決議したもの",
  },
  { key: "articles", docType: "articles", label: "変更後の定款", hint: "事業年度の条文を変えたもの" },
  {
    key: "filing",
    docType: "tax_filing",
    label: "異動届出書の控え",
    hint: "税務署・都道府県・市区町村へ出したもの",
  },
];

// 既存の書類から選べる種類
const LINKABLE_TYPES: CompanyDocType[] = ["minutes", "articles", "shareholder_register", "tax_filing", "ledger"];

function slashDate(d: string | null | undefined) {
  return d ? d.replaceAll("-", "/") : "";
}

function monthsBetween(start: string, end: string) {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/**
 * 決算月の設定と変更履歴。
 *
 * 税理士だけでなく顧問先ユーザーもここから決算月を変えられる。
 * 決算月の変更は定款変更（株主総会の特別決議）と異動届出書の提出を伴うため、
 * 議事録・定款・届出控えをその場で添付し、会社書類として残せるようにしている。
 */
export function FiscalMonthSettingsContent({ onOpenDocuments }: { onOpenDocuments?: () => void }) {
  const { id } = useParams<{ id: string }>();

  const [overview, setOverview] = useState<FiscalMonthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [newSettlement, setNewSettlement] = useState(3);
  const [resolutionDate, setResolutionDate] = useState("");
  const [memo, setMemo] = useState("");
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [existingDocs, setExistingDocs] = useState<CompanyDocument[]>([]);
  const [linkedDocIds, setLinkedDocIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [openingDoc, setOpeningDoc] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchData = useCallback(async () => {
    try {
      const data = await getFiscalMonthOverview(id);
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function startEditing() {
    if (!overview) return;
    setNewSettlement(settlementMonth(overview.startMonth));
    setResolutionDate("");
    setMemo("");
    setFiles({});
    setLinkedDocIds([]);
    setError(null);
    setMessage(null);
    setEditing(true);
    try {
      const docs = await getCompanyDocuments(id);
      setExistingDocs(docs.filter((d) => LINKABLE_TYPES.includes(d.doc_type)));
    } catch {
      setExistingDocs([]);
    }
  }

  async function openDocument(filePath: string, key: string) {
    setOpeningDoc(key);
    try {
      const url = await getCompanyDocumentUrl(filePath);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setError("書類を開けませんでした");
    } finally {
      setOpeningDoc(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[17px] text-foreground">
        <Loader2 className="size-5 animate-spin" />
        読み込み中...
      </div>
    );
  }
  if (!overview) {
    return <p className="text-[17px] text-destructive">{error ?? "読み込みに失敗しました"}</p>;
  }

  const currentSettlement = settlementMonth(overview.startMonth);
  const newStartMonth = startMonthFromSettlement(newSettlement);
  const changed = newStartMonth !== overview.startMonth;
  const open = overview.openYear;
  const newEnd = open && changed ? transitionalPeriodEnd(open.start_date, newStartMonth) : null;

  async function handleSave() {
    if (!overview || !changed) return;
    const lines = [
      `決算月を ${currentSettlement}月 から ${newSettlement}月 に変更します。`,
      open && newEnd
        ? `当期は ${slashDate(open.start_date)}〜${slashDate(newEnd)}（${monthsBetween(open.start_date, newEnd)}ヶ月）になります。`
        : "",
      "試算表・決算書・消費税集計など、帳票の集計期間が新しい決算月で区切られます。",
      "よろしいですか？",
    ].filter(Boolean);
    if (!window.confirm(lines.join("\n\n"))) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // 先に書類を会社書類へ登録する（途中で失敗したら決算月は変えない）
      const uploadedIds: string[] = [];
      const label = `決算月の変更（${currentSettlement}月決算→${newSettlement}月決算）`;
      for (const slot of ATTACH_SLOTS) {
        const file = files[slot.key];
        if (!file) continue;
        const fd = new FormData();
        fd.append("file", file);
        fd.append("client_id", id);
        fd.append("doc_type", slot.docType);
        fd.append("title", `${slot.label}（${label}）`);
        if (resolutionDate) fd.append("issued_date", resolutionDate);
        fd.append("memo", label);
        const doc = await uploadCompanyDocument(fd);
        uploadedIds.push(doc.id);
      }

      const result = await changeFiscalStartMonth({
        clientId: id,
        newStartMonth,
        resolutionDate: resolutionDate || null,
        memo: memo.trim() || null,
        documentIds: [...uploadedIds, ...linkedDocIds],
      });
      clearClientCache();
      setEditing(false);
      setMessage(
        `${newSettlement}月決算に変更しました。` +
          (result.newPeriodEnd ? `当期の期末日は ${slashDate(result.newPeriodEnd)} です。` : "") +
          (result.historySaved ? "" : "（変更履歴の保存先が未準備のため、履歴は残っていません）")
      );
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-5 space-y-4 max-w-2xl">
          <div className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" />
            <h2 className="text-lg font-bold">決算月</h2>
          </div>

          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[17px]">
            <span className="text-foreground/80">決算月</span>
            <span className="font-bold">{currentSettlement}月</span>
            <span className="text-foreground/80">会計年度</span>
            <span>
              {overview.startMonth}月〜{overview.startMonth === 1 ? "" : "翌"}
              {currentSettlement}月
            </span>
            {open && (
              <>
                <span className="text-foreground/80">当期</span>
                <span>
                  {slashDate(open.start_date)}〜{slashDate(open.end_date)}
                </span>
              </>
            )}
          </div>

          {message && <p className="text-[17px] text-primary">{message}</p>}
          {error && !editing && <p className="text-[17px] text-destructive">{error}</p>}

          {!editing ? (
            <Button onClick={startEditing}>決算月を変更する</Button>
          ) : (
            <div className="space-y-5 border-t border-border pt-4">
              <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-300 text-[15px] text-foreground dark:bg-amber-950/30 dark:border-amber-700">
                <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <p>
                    決算月（事業年度）を変えるには、株主総会の特別決議による定款変更と、
                    税務署・都道府県・市区町村への異動届出書の提出が必要です。
                  </p>
                  <p>会計事務所と契約している場合は、変更前にご相談ください。</p>
                  {overview.closedYearCount > 0 && (
                    <p>
                      締めた年度が{overview.closedYearCount}件あります。締めた年度の仕訳はそのまま残りますが、
                      帳票の年度の区切りは新しい決算月で表示されます。
                    </p>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[15px] font-medium text-foreground mb-1">新しい決算月</label>
                  <select
                    value={newSettlement}
                    onChange={(e) => setNewSettlement(Number(e.target.value))}
                    className={inputCls}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m}月{m === currentSettlement ? "（現在）" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[15px] font-medium text-foreground mb-1">
                    決議した日（任意）
                  </label>
                  <DateInput
                    allowEmpty
                    value={resolutionDate}
                    onChange={setResolutionDate}
                    className={inputCls}
                    placeholder="株主総会の開催日"
                  />
                </div>
              </div>

              {changed && (
                <div className="text-[17px] space-y-1">
                  <p>
                    会計年度は <span className="font-bold">{newStartMonth}月〜{newStartMonth === 1 ? "" : "翌"}{newSettlement}月</span> になります。
                  </p>
                  {open && newEnd && (
                    <p>
                      当期は{" "}
                      <span className="font-bold">
                        {slashDate(open.start_date)}〜{slashDate(newEnd)}（{monthsBetween(open.start_date, newEnd)}ヶ月）
                      </span>{" "}
                      で締めます。翌期から{newSettlement}月決算です。
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[15px] font-medium text-foreground">書類の添付（任意）</p>
                <p className="text-[15px] text-foreground/80">
                  添付した書類は「会社書類」に登録されます（PDF / JPG / PNG・最大10MB）。
                </p>
                {ATTACH_SLOTS.map((slot) => {
                  const file = files[slot.key];
                  return (
                    <div
                      key={slot.key}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[17px] font-medium">{slot.label}</p>
                        <p className="text-[15px] text-foreground/80 truncate">{file ? file.name : slot.hint}</p>
                      </div>
                      {file ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFiles((f) => ({ ...f, [slot.key]: null }));
                            const el = fileRefs.current[slot.key];
                            if (el) el.value = "";
                          }}
                        >
                          <X className="size-4" />
                          外す
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => fileRefs.current[slot.key]?.click()}>
                          <Upload className="size-4" />
                          ファイルを選ぶ
                        </Button>
                      )}
                      <input
                        ref={(el) => {
                          fileRefs.current[slot.key] = el;
                        }}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setFiles((prev) => ({ ...prev, [slot.key]: f }));
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {existingDocs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[15px] font-medium text-foreground">登録済みの書類から選ぶ</p>
                  {existingDocs.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-[17px] cursor-pointer">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={linkedDocIds.includes(d.id)}
                        onChange={(e) =>
                          setLinkedDocIds((ids) =>
                            e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)
                          )
                        }
                      />
                      <span className="text-foreground/80">［{docTypeLabel[d.doc_type]}］</span>
                      <span className="truncate">{d.title}</span>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-[15px] font-medium text-foreground mb-1">メモ（任意）</label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className={inputCls}
                  placeholder="例: 繁忙期を避けるため12月決算へ"
                />
              </div>

              {error && <p className="text-[17px] text-destructive">{error}</p>}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  キャンセル
                </Button>
                <Button onClick={handleSave} disabled={saving || !changed}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  変更する
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5 space-y-3 max-w-2xl">
          <div className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            <h2 className="text-lg font-bold">決算月の変更履歴</h2>
          </div>
          {!overview.historyAvailable ? (
            <p className="text-[17px] text-foreground/80">
              変更履歴の保存先がまだ準備されていません（決算月の変更自体はできます）。
            </p>
          ) : overview.history.length === 0 ? (
            <p className="text-[17px] text-foreground/80">変更の記録はまだありません。</p>
          ) : (
            <ul className="space-y-3">
              {overview.history.map((h) => (
                <li key={h.id} className="rounded-lg border border-border px-3 py-2.5 space-y-1">
                  <p className="text-[17px]">
                    <span className="font-bold">
                      {settlementMonth(h.old_start_month)}月決算 → {settlementMonth(h.new_start_month)}月決算
                    </span>
                    <span className="text-foreground/80">
                      {" "}
                      ・{slashDate(toJstDate(h.created_at))} 変更
                      {h.changed_by_name ? `（${h.changed_by_name}）` : ""}
                    </span>
                  </p>
                  {h.resolution_date && <p className="text-[15px]">決議日: {slashDate(h.resolution_date)}</p>}
                  {h.old_period_end && h.new_period_end && h.old_period_end !== h.new_period_end && (
                    <p className="text-[15px]">
                      当期の期末日: {slashDate(h.old_period_end)} → {slashDate(h.new_period_end)}
                    </p>
                  )}
                  {h.memo && <p className="text-[15px]">メモ: {h.memo}</p>}
                  {h.documents.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {h.documents.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => openDocument(d.file_path, `${h.id}:${d.id}`)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[15px] text-primary hover:bg-muted"
                        >
                          {openingDoc === `${h.id}:${d.id}` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <FileText className="size-4" />
                          )}
                          {d.title}
                          <Download className="size-3.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onOpenDocuments && (
            <p className="text-[15px] text-foreground/80">
              議事録・株主名簿・台帳などは{" "}
              <button onClick={onOpenDocuments} className="text-primary underline underline-offset-2">
                会社書類
              </button>{" "}
              からいつでも登録できます。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
