"use client";

/**
 * e-Tax の提出情報（顧問先ごと）。申告書を e-Tax 用ファイル（.xtx）で保存するときに入れる。
 * 提出先税務署・利用者識別番号・法人番号・名称のフリガナ・代表者。
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { FileCheck2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getClient, updateClient } from "@/actions/clients";
import { TAX_OFFICES, taxOfficeLabel } from "@/lib/tax-offices";

type Info = {
  tax_office_code: string;
  etax_user_id: string;
  corporate_number: string;
  name_kana: string;
  representative_name: string;
  representative_kana: string;
};

const EMPTY: Info = {
  tax_office_code: "",
  etax_user_id: "",
  corporate_number: "",
  name_kana: "",
  representative_name: "",
  representative_kana: "",
};

const digits = (v: string) => v.normalize("NFKC").replace(/\D/g, "");

export function EtaxSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [officeQuery, setOfficeQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(id)
      .then((c) => {
        const row = c as Partial<Record<keyof Info, string | null>> & { invoice_registration_number?: string | null };
        const next = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k as keyof Info] ?? ""])) as Info;
        setInfo(next);
        setInvoiceNo(row.invoice_registration_number ?? "");
        if (next.tax_office_code) setOfficeQuery(taxOfficeLabel(next.tax_office_code));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id]);

  const officeOptions = useMemo(() => TAX_OFFICES.map((o) => ({ code: o.code, label: taxOfficeLabel(o.code) })), []);

  if (!info) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 読み込み中...
      </div>
    );
  }

  const set = (k: keyof Info, v: string) => setInfo({ ...info, [k]: v });
  const invoiceDigits = /^T\d{13}$/.test(invoiceNo) ? invoiceNo.slice(1) : null;

  const problems: string[] = [];
  if (info.etax_user_id && info.etax_user_id.length !== 16) problems.push("利用者識別番号は16桁の数字です");
  if (info.corporate_number && info.corporate_number.length !== 13) problems.push("法人番号は13桁の数字です");
  if (officeQuery && !info.tax_office_code) problems.push("税務署は一覧から選んでください");

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const patch = Object.fromEntries(
        (Object.keys(EMPTY) as (keyof Info)[]).map((k) => [k, info[k].trim() || null])
      );
      await updateClient(id, patch);
      setMessage("保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm";
  const label = "block text-xs font-bold text-muted-foreground mb-1";

  return (
    <Card className="p-5 max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <FileCheck2 className="size-5 text-primary" />
        <h2 className="font-bold">e-Tax の提出情報</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        消費税・法人税の申告書を e-Tax 用ファイル（.xtx）で保存するときに入れます。税務署と利用者識別番号は必須です（会社名・住所は顧問先の登録から入ります）。そのほかの空の欄は、ファイルを取り込んだ後に e-Taxソフトで入力できます。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="etax-office">提出先の税務署</label>
          <input
            id="etax-office"
            className={field}
            list="etax-office-list"
            placeholder="税務署名で検索（例: 麹町）"
            value={officeQuery}
            onChange={(e) => {
              const v = e.target.value;
              setOfficeQuery(v);
              set("tax_office_code", officeOptions.find((o) => o.label === v)?.code ?? "");
            }}
          />
          <datalist id="etax-office-list">
            {officeOptions.map((o) => (
              <option key={o.code} value={o.label} />
            ))}
          </datalist>
          {info.tax_office_code && <p className="mt-1 text-xs text-muted-foreground">署番号 {info.tax_office_code}</p>}
        </div>

        <div>
          <label className={label} htmlFor="etax-user">利用者識別番号（16桁）</label>
          <input
            id="etax-user"
            className={field}
            inputMode="numeric"
            maxLength={16}
            value={info.etax_user_id}
            onChange={(e) => set("etax_user_id", digits(e.target.value).slice(0, 16))}
          />
          <p className="mt-1 text-xs text-muted-foreground">e-Tax の開始届出で通知された番号です</p>
        </div>

        <div>
          <label className={label} htmlFor="etax-corp">法人番号（13桁）</label>
          <input
            id="etax-corp"
            className={field}
            inputMode="numeric"
            maxLength={13}
            value={info.corporate_number}
            onChange={(e) => set("corporate_number", digits(e.target.value).slice(0, 13))}
          />
          {!info.corporate_number && invoiceDigits && (
            <button className="mt-1 text-xs text-primary underline" onClick={() => set("corporate_number", invoiceDigits)}>
              インボイス登録番号（{invoiceNo}）の数字を使う
            </button>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="etax-kana">名称のフリガナ</label>
          <input id="etax-kana" className={field} placeholder="カブシキガイシャ…" value={info.name_kana} onChange={(e) => set("name_kana", e.target.value)} />
        </div>

        <div>
          <label className={label} htmlFor="etax-rep">代表者氏名</label>
          <input id="etax-rep" className={field} value={info.representative_name} onChange={(e) => set("representative_name", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="etax-rep-kana">代表者氏名のフリガナ</label>
          <input id="etax-rep-kana" className={field} value={info.representative_kana} onChange={(e) => set("representative_kana", e.target.value)} />
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="mt-4 text-xs text-warning list-disc pl-5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving || problems.length > 0}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
        {message && <span className="text-xs text-foreground">{message}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </Card>
  );
}
