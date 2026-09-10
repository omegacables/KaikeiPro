"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";
import {
  getGeminiModel,
  extractJson,
  normalizeConfidence,
  INJECTION_GUARD,
  GEMINI_MODELS,
  callGemini,
} from "@/lib/gemini";
import { currentBalance, entryTypeLabel } from "@/lib/loan-ledger";
import { downloadReceiptImage } from "@/actions/receipt-storage";
import { lookupLearnedRules } from "@/actions/learned-rules";
import type { Json } from "@/types/database";
import type {
  LoanAiDraft,
  LoanAiDocumentResult,
  LoanDirection,
  LoanEntryType,
  OfficerPaymentClassification,
  OfficerPaymentOption,
  LedgerAnswer,
  LedgerAnswerSource,
} from "@/types/index";

type DbRow = Record<string, unknown>;

// 1回のPDF読み取りで扱う行数の上限。
// 既存のCSV系（50〜100行）と同じ方針。超過は警告として返し、throw しない。
const MAX_DOCUMENT_LINES = 80;

// ---------------------------------------------------------------------------
// 台帳のコンテキスト（AIに渡す材料）
// ---------------------------------------------------------------------------

type LedgerContext = {
  loans: {
    id: string;
    name: string;
    direction: LoanDirection;
    kind: string;
    balance: number;
  }[];
  officers: { name: string; gross: number; net: number; payMonth: string }[];
  /** 返済予定。元金と利息の内訳が決まっているので、突き合えばそのまま使える */
  schedules: {
    loanId: string;
    loanName: string;
    due: string;
    principal: number;
    interest: number;
  }[];
  partners: string[];
  expenseAccounts: { id: string; name: string }[];
};

async function loadContext(clientId: string): Promise<LedgerContext> {
  const supabase = await createServerSupabaseClient();

  const [loansRes, entriesRes, payrollRes, partnersRes, accountsRes, schedulesRes] =
    await Promise.all([
    supabase.from("loans").select("*").eq("client_id", clientId),
    supabase.from("loan_entries").select("*").eq("client_id", clientId),
    supabase
      .from("payroll_records")
      .select("employee_name, gross_salary, net_pay, pay_month")
      .eq("client_id", clientId)
      .eq("employee_type", "officer")
      .order("pay_month", { ascending: false })
      .limit(24),
    supabase.from("business_partners").select("name").eq("client_id", clientId).limit(200),
    supabase
      .from("accounts")
      .select("id, name, is_default, account_categories(type)")
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .eq("is_active", true),
    supabase
      .from("loan_repayment_schedules")
      .select("loan_id, due_date, principal_amount, interest_amount")
      .eq("client_id", clientId)
      .order("due_date"),
  ]);

  const entriesByLoan = new Map<string, DbRow[]>();
  for (const e of entriesRes.data ?? []) {
    const row = e as DbRow;
    const key = row.loan_id as string;
    const list = entriesByLoan.get(key);
    if (list) list.push(row);
    else entriesByLoan.set(key, [row]);
  }

  const loans = (loansRes.data ?? []).map((l) => {
    const row = l as DbRow;
    const es = (entriesByLoan.get(row.id as string) ?? []).map((r) => ({
      id: r.id as string,
      entry_date: r.entry_date as string,
      entry_type: r.entry_type as LoanEntryType,
      amount: (r.amount as number) ?? 0,
      signed_adjustment: (r.signed_adjustment as number) ?? null,
      status: r.status as "draft" | "confirmed" | "journalized",
    }));
    return {
      id: row.id as string,
      name: (row.lender_name as string) ?? "",
      direction: ((row.direction as LoanDirection) ?? "borrow") as LoanDirection,
      kind: (row.counterparty_kind as string) ?? "institution",
      balance: currentBalance(es),
    };
  });

  // 役員報酬は同一人物の最新月だけを見れば手取額の比較に足りる
  const seen = new Set<string>();
  const officers: LedgerContext["officers"] = [];
  for (const p of payrollRes.data ?? []) {
    const row = p as DbRow;
    const name = (row.employee_name as string) ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    officers.push({
      name,
      gross: (row.gross_salary as number) ?? 0,
      net: (row.net_pay as number) ?? 0,
      payMonth: (row.pay_month as string) ?? "",
    });
  }

  const expenseAccounts = (accountsRes.data ?? [])
    .filter((a) => {
      const cat = (a as DbRow).account_categories as { type?: string } | null;
      return cat?.type === "expenses";
    })
    .map((a) => ({ id: (a as DbRow).id as string, name: (a as DbRow).name as string }));

  const loanNameById = new Map(loans.map((l) => [l.id, l.name]));
  const schedules = (schedulesRes.data ?? []).map((r) => {
    const row = r as DbRow;
    return {
      loanId: row.loan_id as string,
      loanName: loanNameById.get(row.loan_id as string) ?? "",
      due: row.due_date as string,
      principal: (row.principal_amount as number) ?? 0,
      interest: (row.interest_amount as number) ?? 0,
    };
  });

  return {
    loans,
    officers,
    partners: (partnersRes.data ?? []).map((p) => (p as DbRow).name as string),
    expenseAccounts,
    schedules,
  };
}

function contextPrompt(ctx: LedgerContext): string {
  const loans =
    ctx.loans.length === 0
      ? "（登録なし）"
      : ctx.loans
          .map(
            (l) =>
              `- id=${l.id} 相手先「${l.name}」 区分:${
                l.direction === "lend" ? "役員貸付金（会社→役員）" : "借入金（役員/金融機関→会社）"
              } 現在残高:${l.balance}円`
          )
          .join("\n");

  const officers =
    ctx.officers.length === 0
      ? "（登録なし）"
      : ctx.officers
          .map(
            (o) =>
              `- ${o.name}: 役員報酬 総支給 ${o.gross}円 / 源泉控除後の手取 ${o.net}円（${o.payMonth}時点）`
          )
          .join("\n");

  const expenses =
    ctx.expenseAccounts.length === 0
      ? "（登録なし）"
      : ctx.expenseAccounts.map((a) => a.name).join(" / ");

  return `## 既存の借入金台帳
${loans}

## 役員報酬マスタ
${officers}

## 取引先マスタ
${ctx.partners.slice(0, 100).join(" / ") || "（登録なし）"}

## 選択できる費用科目（立替のとき使用）
${expenses}

## 返済予定表（元金と利息の内訳が決まっているもの）
${
  ctx.schedules.length === 0
    ? "（登録なし）"
    : ctx.schedules
        .slice(0, 60)
        .map(
          (s) =>
            `- ${s.due} 「${s.loanName}」 元金${s.principal}円 + 利息${s.interest}円 = ${
              s.principal + s.interest
            }円`
        )
        .join("\n")
}`;
}

const ENTRY_TYPE_GUIDE = `## どちらの台帳の話か（direction）
- borrow … 会社が借りている側の話（金融機関からの借入、役員借入金）
- lend   … 会社が貸している側の話（役員貸付金）
会社からお金が出ていく取引でも、借入金の返済なら borrow、
新たに役員へ貸したなら lend になる。お金の向きだけで決めないこと。

## 区分（entry_type）の判断
- borrow  : 元本の発生。direction=borrow なら「借りた」、direction=lend なら「貸した」
- advance : 立替。役員が会社の経費を個人資金・個人カードで払った。**現金は動かないが役員借入金は増える**
- repay   : 返済／回収
- interest: 利息
判断できない場合は推測せず needs_confirmation を true にすること。

## 元金と利息の分け方（返済のとき）
銀行返済は元金と利息をまとめて1回で引き落とす。通帳には合計額しか出ないため、
amount（元金）と interest_amount（利息）に分けること。
1. **返済予定表に日付と合計額が一致する行があれば、その内訳をそのまま使う。**
   これが最も確実なので必ず優先する
2. 予定表に無い場合は、台帳の残高と年利から利息を見積もる
   （利息 = 残高 × 年利 ÷ 12 のおおよそ）
3. どちらもできなければ interest_amount は 0 とし、confidence を下げること。
   推測で分けてはいけない
役員借入金は無利息が原則なので、通常 interest_amount は 0 になる。`;

// ---------------------------------------------------------------------------
// 共通のドラフト整形
// ---------------------------------------------------------------------------

type RawDraft = {
  counterparty_name?: string;
  /** borrow=借入金台帳の話 / lend=貸付金台帳の話。台帳が特定できないときの向きの判断に使う */
  direction?: string;
  entry_date?: string;
  entry_type?: string;
  amount?: number;
  interest_amount?: number;
  expense_account_name?: string | null;
  memo?: string | null;
  reasoning?: string;
  confidence?: number;
  source_text?: string | null;
};

const VALID_TYPES: LoanEntryType[] = ["borrow", "advance", "repay", "interest"];

function toDraft(raw: RawDraft, ctx: LedgerContext, model: string): LoanAiDraft | null {
  const amount = Math.round(Number(raw.amount) || 0);
  const entryType = (raw.entry_type ?? "") as LoanEntryType;
  const date = raw.entry_date ?? "";

  if (amount <= 0) return null;
  if (!VALID_TYPES.includes(entryType)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const name = (raw.counterparty_name ?? "").trim();
  // 相手先名から既存台帳を引き当てる（完全一致 → 部分一致）
  const matched =
    ctx.loans.find((l) => l.name === name) ??
    ctx.loans.find((l) => name && (l.name.includes(name) || name.includes(l.name))) ??
    null;

  const expenseAccount = raw.expense_account_name
    ? (ctx.expenseAccounts.find((a) => a.name === raw.expense_account_name) ??
      ctx.expenseAccounts.find((a) => a.name.includes(raw.expense_account_name!)) ??
      null)
    : null;

  // 台帳が特定できればその向きに従う。できない場合はAIの申告を使う。
  // 向きが分からないと、会社から出ていくお金を「借入」と表示してしまう
  const direction: LoanDirection =
    matched?.direction ?? (raw.direction === "lend" ? "lend" : "borrow");

  // 利息は返済のときだけ意味を持つ
  let interest = entryType === "repay" ? Math.max(0, Math.round(Number(raw.interest_amount) || 0)) : 0;
  let principal = amount;

  // 返済予定表に「日付が一致し、合計額も一致する」行があれば、その内訳をそのまま使う。
  // 予定表は契約で決まった確かな値なので、AIの見積もりより優先する。
  // 通帳には合計しか出ないため、AIが読んだ amount は合計であることが多い
  if (entryType === "repay" && matched) {
    const hit = ctx.schedules.find(
      (sc) =>
        sc.loanId === matched.id &&
        sc.due === date &&
        (sc.principal + sc.interest === amount || sc.principal + sc.interest === amount + interest)
    );
    if (hit) {
      principal = hit.principal;
      interest = hit.interest;
    } else if (interest > 0 && interest < amount) {
      // AIが合計額を amount に入れ、利息も別に返してきた場合は元金を差し引く
      principal = amount - interest;
    }
  }

  const delta = entryType === "repay" ? -principal : principal;

  return {
    loan_id: matched?.id ?? null,
    counterparty_name: name,
    direction,
    entry_date: date,
    entry_type: entryType,
    amount: principal,
    interest_amount: interest,
    expense_account_id: expenseAccount?.id ?? null,
    expense_account_name: expenseAccount?.name ?? raw.expense_account_name ?? null,
    memo: raw.memo ?? null,
    evidence: {
      reasoning: raw.reasoning ?? "",
      confidence: normalizeConfidence(raw.confidence),
      sourceText: raw.source_text ?? null,
      model,
    },
    balance_after: matched ? matched.balance + delta : null,
    journal_preview: journalPreview(direction, entryType, principal, expenseAccount?.name ?? null, interest),
  };
}

/** 確認画面に出す仕訳プレビュー。実際の科目解決は起票時に loans.ts が行う。 */
function journalPreview(
  direction: LoanDirection,
  entryType: LoanEntryType,
  amount: number,
  expenseAccountName: string | null,
  paidInterest = 0
): LoanAiDraft["journal_preview"] {
  const ledger = direction === "lend" ? "役員貸付金" : "役員借入金";
  if (direction === "borrow") {
    switch (entryType) {
      case "borrow":
        return { debit: "普通預金", credit: ledger, amount };
      case "advance":
        return { debit: expenseAccountName ?? "（費用科目）", credit: ledger, amount };
      case "repay":
        // 元金と利息を同時に払う場合は、現金の出は合計額になる
        return paidInterest > 0
          ? {
              debit: `${ledger} + 支払利息`,
              credit: "普通預金",
              amount: amount + paidInterest,
            }
          : { debit: ledger, credit: "普通預金", amount };
      case "interest":
        return { debit: "支払利息", credit: ledger, amount };
      default:
        return null;
    }
  }
  switch (entryType) {
    case "borrow":
      return { debit: ledger, credit: "普通預金", amount };
    case "repay":
      return { debit: "普通預金", credit: ledger, amount };
    case "interest":
      return { debit: ledger, credit: "受取利息", amount };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 4-3. 自然言語からの起票
// ---------------------------------------------------------------------------

/**
 * 「8月24日に社長から6万5千円借りた」のような入力から明細の下書きを作る。
 * DBには書き込まない。人間が確認画面で採用して初めて保存される。
 */
export async function draftLoanEntriesFromText(
  clientId: string,
  text: string
): Promise<LoanAiDraft[]> {
  await assertClientAccess(clientId);
  if (!text.trim()) throw new Error("内容を入力してください");

  const ctx = await loadContext(clientId);
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `あなたは日本の税理士事務所の会計スタッフです。
入力された文章から、借入金台帳（役員借入金・役員貸付金を含む）に登録する増減明細を読み取ってください。

${contextPrompt(ctx)}

${ENTRY_TYPE_GUIDE}

## 出力形式
JSONのみを返してください。説明文は不要です。
{"entries":[{"counterparty_name":"相手先名","direction":"borrow|lend","entry_date":"YYYY-MM-DD","entry_type":"borrow|advance|repay|interest","amount":元金の数値,"interest_amount":返済と同時に払った利息の数値（無ければ0）,"expense_account_name":"立替のときの費用科目名。それ以外はnull","memo":"摘要","reasoning":"そう判断した根拠","confidence":0.0-1.0,"needs_confirmation":true/false}]}

## 注意
- 今日は ${today} です。年の記載が無い日付はこれを基準に解釈してください。
- 「社長」「代表」などの呼称は、既存台帳の相手先名に該当があればその名称に寄せてください。
- 金額の「6万5千円」のような表記は 65000 に正規化してください。
- 判断できない項目は推測で埋めず、confidence を下げ needs_confirmation を true にしてください。

${INJECTION_GUARD}

## 入力
${text}`;

  const model = getGeminiModel("text");
  const result = await callGemini(() => model.generateContent(prompt));
  const parsed = extractJson<{ entries?: RawDraft[] }>(
    result.response.text(),
    "AI起票の結果"
  );

  return (parsed.entries ?? [])
    .map((raw) => toDraft(raw, ctx, GEMINI_MODELS.text))
    .filter((d): d is LoanAiDraft => d !== null);
}

// ---------------------------------------------------------------------------
// 4-4. 証憑からの一括起票（銀行連携の代替）
// ---------------------------------------------------------------------------

/**
 * 通帳明細・振込明細のPDFを読み取り、借入金台帳に関係する行だけを候補として返す。
 * 対象外と判断した行も理由付きで返し、拾い漏れを確認できるようにする。
 */
export async function draftLoanEntriesFromReceipt(
  clientId: string,
  receiptId: string
): Promise<LoanAiDocumentResult> {
  await assertClientAccess(clientId);
  const receiptClientId = await resolveClientIdForRecord("receipts", receiptId);
  if (receiptClientId !== clientId) {
    throw new Error("他の顧問先の証憑は読み取れません");
  }

  const admin = createAdminSupabaseClient();
  const { data: receipt } = await admin
    .from("receipts")
    .select("image_path")
    .eq("id", receiptId)
    .single();
  if (!receipt) throw new Error("証憑が見つかりません");

  const imagePath = (receipt as DbRow).image_path as string;
  if (imagePath.startsWith("raqto://")) {
    throw new Error("この証憑は外部連携のファイルのため読み取れません");
  }

  const { data: fileData, mimeType } = await downloadReceiptImage(imagePath);
  const base64 = Buffer.from(fileData).toString("base64");

  const ctx = await loadContext(clientId);

  const prompt = `あなたは日本の税理士事務所の会計スタッフです。
この通帳明細・振込明細から取引を読み取り、**借入金台帳に関係する行だけ**を候補として抽出してください。

借入金台帳が扱うのは次の3つです。役員のものだけではありません。
  1. 金融機関等からの借入金（銀行・信用金庫・日本政策金融公庫など）
  2. 役員借入金（会社が役員から借りている）
  3. 役員貸付金（会社が役員に貸している）

${contextPrompt(ctx)}

${ENTRY_TYPE_GUIDE}

## 台帳に関係する行の例
- **金融機関への約定返済の出金**（摘要に銀行名＋「ヘンサイ」「返済」など）
- **金融機関からの借入金の入金**（融資実行）
- 役員個人からの入金（役員借入金の増加）
- 役員個人への送金のうち、借入金の返済にあたるもの

## 台帳に関係しない行の例
- 売掛金の入金、買掛金の支払、公共料金、税金の納付、役員報酬の支払
- リース料、クレジットカードの引き落とし（借入金の返済ではないもの）

※「金融機関への返済だから対象外」という判断は誤りです。金融機関からの
　借入も、この台帳で管理します。

## 出力形式
JSONのみを返してください。説明文は不要です。
{"candidates":[{"counterparty_name":"相手先名","direction":"borrow|lend","entry_date":"YYYY-MM-DD","entry_type":"borrow|advance|repay|interest","amount":元金の数値,"interest_amount":返済と同時に払った利息の数値（無ければ0）,"expense_account_name":null,"memo":"摘要","source_text":"通帳の該当行の記載をそのまま","reasoning":"台帳に関係すると判断した根拠","confidence":0.0-1.0}],
 "excluded":[{"line":"通帳の記載をそのまま","reason":"台帳に無関係と判断した理由"}]}

## 注意
- **すべての行をどちらかに分類してください。** 候補にしなかった行は必ず excluded に入れ、理由を書いてください（拾い漏れの確認に使います）。
- 役員個人への送金は、役員報酬・借入金の返済・立替経費の精算のいずれもあり得ます。
  上記の役員報酬マスタの手取額と一致する場合は役員報酬の可能性が高いため候補に含めず excluded に入れ、その理由を書いてください。
- 読み取れる行が ${MAX_DOCUMENT_LINES} 行を超える場合は、先頭から ${MAX_DOCUMENT_LINES} 行までを対象にしてください。

${INJECTION_GUARD}`;

  const model = getGeminiModel("vision");
  const result = await callGemini(() =>
    model.generateContent([
      {
        inlineData: {
          mimeType: mimeType as "image/jpeg" | "image/png" | "application/pdf",
          data: base64,
        },
      },
      { text: prompt },
    ])
  );

  const parsed = extractJson<{
    candidates?: RawDraft[];
    excluded?: { line?: string; reason?: string }[];
  }>(result.response.text(), "証憑の読み取り結果");

  const warnings: string[] = [];
  const rawCandidates = parsed.candidates ?? [];
  if (rawCandidates.length > MAX_DOCUMENT_LINES) {
    warnings.push(
      `読み取れた候補が${rawCandidates.length}件ありました。先頭${MAX_DOCUMENT_LINES}件のみ表示しています。`
    );
  }

  const candidates = rawCandidates
    .slice(0, MAX_DOCUMENT_LINES)
    .map((raw) => toDraft(raw, ctx, GEMINI_MODELS.vision))
    .filter((d): d is LoanAiDraft => d !== null);

  if (candidates.length < rawCandidates.slice(0, MAX_DOCUMENT_LINES).length) {
    warnings.push(
      "日付・金額・区分のいずれかが読み取れなかった行は候補から除いています。除外一覧を確認してください。"
    );
  }

  const excluded = (parsed.excluded ?? []).map((x) => ({
    line: x.line ?? "",
    reason: x.reason ?? "理由の記載がありません",
  }));

  return { candidates, excluded, warnings };
}

// ---------------------------------------------------------------------------
// 4-5. 曖昧な取引の判別（対話）
// ---------------------------------------------------------------------------

/**
 * 役員個人への送金が「役員報酬 / 借入金の返済 / 立替経費の精算」のどれかを判別する。
 *
 * 役員報酬なら損金＋源泉徴収が必要、借入返済なら課税関係なしと扱いが正反対になるため、
 * 取り違えると決算が狂う。確信が持てない場合は確定させず必ず確認を求める。
 *
 * 判別の決め手は「金額が役員報酬の手取額と一致するか」なので、
 * これはAIに委ねず決定的に判定してからプロンプトに渡す。
 */
export async function classifyOfficerPayment(
  clientId: string,
  input: { date: string; amount: number; description: string }
): Promise<OfficerPaymentClassification> {
  await assertClientAccess(clientId);
  if (!(input.amount > 0)) throw new Error("金額を入力してください");

  const ctx = await loadContext(clientId);

  // 決定的な事実の検査（AIの推測に任せない部分）
  const netMatch = ctx.officers.find((o) => o.net === input.amount);
  const grossMatch = ctx.officers.find((o) => o.gross === input.amount);
  const learned = await lookupLearnedRules(clientId, {
    vendor: input.description,
    keyword: input.description,
    direction: "out",
  }).catch(() => []);

  const facts = [
    netMatch
      ? `送金額 ${input.amount}円 は役員「${netMatch.name}」の役員報酬の手取額と一致します。`
      : `送金額 ${input.amount}円 は登録されている役員報酬の手取額と一致しません。`,
    grossMatch
      ? `送金額は役員「${grossMatch.name}」の総支給額と一致します。`
      : null,
    ctx.loans.length > 0
      ? `関係しそうな台帳の残高: ${ctx.loans
          .map((l) => `「${l.name}」${l.direction === "lend" ? "貸付" : "借入"} ${l.balance}円`)
          .join(" / ")}`
      : "借入金台帳に登録がありません。",
    learned.length > 0
      ? `過去の同一摘要の分類履歴: ${learned
          .map((r) => `${r.vendorName ?? r.keyword ?? ""}（過去${r.usageCount}回）`)
          .slice(0, 3)
          .join(" / ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `あなたは日本の税理士事務所の会計スタッフです。
役員個人の口座への送金が何にあたるかを判別してください。

## 判別対象
日付: ${input.date}
金額: ${input.amount}円
摘要: ${input.description}

## 確認済みの事実（この内容は正確です。覆さないでください）
${facts}

${contextPrompt(ctx)}

## 判別の観点
- 役員報酬: 金額が役員報酬の手取額と一致する。損金算入＋源泉徴収が必要
- 役員借入金の返済: 会社が役員から借りていた分の返済。課税関係なし
- 立替経費の精算: 役員が立て替えた経費の精算

**役員報酬と借入返済では税務上の扱いが正反対**です。取り違えると決算が狂うため、
確信が持てない場合は結論を出さず conclusion を null にして確認を求めてください。

## 出力形式
JSONのみを返してください。説明文は不要です。
{"conclusion":"loan_repayment|officer_salary|expense_settlement|other または null",
 "confidence":0.0-1.0,
 "reasoning":"そう推定した根拠",
 "question":"利用者に確認する日本語の問いかけ",
 "options":[{"key":"loan_repayment|officer_salary|expense_settlement|other","label":"表示名","reason":"その可能性を検討した根拠","recommended":true/false}]}

${INJECTION_GUARD}`;

  const model = getGeminiModel("text");
  const result = await callGemini(() => model.generateContent(prompt));
  const parsed = extractJson<{
    conclusion?: string | null;
    confidence?: number;
    reasoning?: string;
    question?: string;
    options?: OfficerPaymentOption[];
  }>(result.response.text(), "取引の判別結果");

  const confidence = normalizeConfidence(parsed.confidence);
  const validKeys: OfficerPaymentOption["key"][] = [
    "loan_repayment",
    "officer_salary",
    "expense_settlement",
    "other",
  ];
  const rawConclusion = parsed.conclusion as OfficerPaymentOption["key"] | null | undefined;

  // 確信が持てない場合は確定させない（要件4-2の原則4）。
  // 金額が役員報酬の手取額と一致するのに借入返済と推定した場合も確定させない。
  const contradictsSalary = Boolean(netMatch) && rawConclusion === "loan_repayment";
  const conclusion =
    rawConclusion && validKeys.includes(rawConclusion) && confidence >= 0.7 && !contradictsSalary
      ? rawConclusion
      : null;

  const options = (parsed.options ?? []).filter((o) => validKeys.includes(o.key));

  let draft: LoanAiDraft | null = null;
  if (conclusion === "loan_repayment") {
    const target =
      ctx.loans.find((l) => l.direction === "borrow" && l.balance > 0) ?? ctx.loans[0] ?? null;
    if (target) {
      draft = {
        loan_id: target.id,
        counterparty_name: target.name,
        direction: target.direction,
        entry_date: input.date,
        entry_type: "repay",
        amount: input.amount,
        interest_amount: 0,
        expense_account_id: null,
        expense_account_name: null,
        memo: input.description,
        evidence: {
          reasoning: parsed.reasoning ?? "",
          confidence,
          sourceText: input.description,
          model: GEMINI_MODELS.text,
          candidates: options.map((o) => ({ label: o.label, reason: o.reason })),
        },
        balance_after: target.balance - input.amount,
        journal_preview: journalPreview(target.direction, "repay", input.amount, null),
      };
    }
  }

  return {
    conclusion,
    confidence,
    options,
    reasoning: parsed.reasoning ?? "",
    question:
      parsed.question ||
      (contradictsSalary
        ? `送金額が役員報酬の手取額と一致しています。役員報酬の支払と借入金の返済のどちらでしょうか？`
        : `この ${input.amount.toLocaleString()}円 の送金はどれにあたりますか？`),
    draft,
  };
}

// ---------------------------------------------------------------------------
// 下書きの採用（人間の確定操作）
// ---------------------------------------------------------------------------

/**
 * 確認画面で人間が採用した下書きを loan_entries に保存する。
 * AIが直接呼ぶことはなく、必ず利用者の操作を経由する（要件4-2の原則1・3）。
 * AIが起票したことは source='ai_draft' と ai_evidence に残す。
 */
export async function commitLoanAiDrafts(
  clientId: string,
  drafts: LoanAiDraft[]
): Promise<{ created: number; errors: { index: number; message: string }[] }> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();

  const errors: { index: number; message: string }[] = [];
  let created = 0;

  // 既存のAI一括処理と同じく逐次で流す（並列はレート制限/タイムアウトの原因になる）
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    try {
      if (!d.loan_id) {
        // 通帳に載る名前（「アンドウ レン」など）と台帳の名前は普通ちがうため、
        // 突き合わせに失敗すること自体はよくある。画面で選び直せるよう促す
        throw new Error(
          `「${d.counterparty_name}」に対応する台帳が選ばれていません。` +
            `一覧の「相手先」欄で台帳を選ぶか、「台帳を作る」で登録してください。`
        );
      }
      // 台帳がこの顧問先のものであることを都度確認する
      const loanClientId = await resolveClientIdForRecord("loans", d.loan_id);
      if (loanClientId !== clientId) throw new Error("他の顧問先の台帳には登録できません");

      if (d.entry_type === "advance" && !d.expense_account_id) {
        throw new Error("立替には費用科目の指定が必要です");
      }

      const { error } = await supabase.from("loan_entries").insert({
        loan_id: d.loan_id,
        client_id: clientId,
        entry_date: d.entry_date,
        entry_type: d.entry_type,
        amount: Math.round(d.amount),
        interest_amount: Math.max(0, Math.round(d.interest_amount ?? 0)),
        signed_adjustment: null,
        expense_account_id: d.expense_account_id,
        payment_account_id: null,
        // 人間が確認して採用したので confirmed。由来は source に残す
        status: "confirmed",
        source: "ai_draft",
        ai_evidence: d.evidence as unknown as Json,
        memo: d.memo,
      });
      if (error) throw new Error(error.message);
      created += 1;
    } catch (e) {
      errors.push({
        index: i,
        message: e instanceof Error ? e.message : "登録に失敗しました",
      });
    }
  }

  return { created, errors };
}

/** 確認画面の表示用ラベル（サーバー側の区分定義と揃えるため公開する）。 */
export async function loanEntryTypeLabel(
  type: LoanEntryType,
  direction: LoanDirection
): Promise<string> {
  return entryTypeLabel(type, direction);
}

// ---------------------------------------------------------------------------
// 4-7. 質問応答
// ---------------------------------------------------------------------------

/**
 * 「いま役員借入金はいくら？」「この10万円は何？」といった質問に、
 * 台帳を根拠として答える。
 *
 * 金額の計算はAIに任せない。残高や集計はサーバー側で確定させてから
 * プロンプトに渡し、AIには「その事実をもとに日本語で説明する」役だけを持たせる。
 * AIに足し算をさせると、もっともらしく間違えた金額を返すため。
 */
export async function askLoanLedger(
  clientId: string,
  question: string
): Promise<LedgerAnswer> {
  await assertClientAccess(clientId);
  if (!question.trim()) throw new Error("質問を入力してください");

  const supabase = await createServerSupabaseClient();
  const ctx = await loadContext(clientId);

  // 明細も根拠として渡す（直近のものに絞る）
  const { data: entryRows } = await supabase
    .from("loan_entries")
    .select("*")
    .eq("client_id", clientId)
    .order("entry_date", { ascending: false })
    .limit(200);

  const loanNameById = new Map(ctx.loans.map((l) => [l.id, l.name]));
  const entries = (entryRows ?? []).map((r) => {
    const row = r as DbRow;
    return {
      id: row.id as string,
      loan_id: row.loan_id as string,
      loanName: loanNameById.get(row.loan_id as string) ?? "",
      date: row.entry_date as string,
      type: row.entry_type as LoanEntryType,
      amount: (row.amount as number) ?? 0,
      memo: (row.memo as string) ?? "",
      status: row.status as string,
    };
  });

  const entryLines = entries
    .slice(0, 120)
    .map(
      (e) =>
        `- id=${e.id} ${e.date} 「${e.loanName}」 ${e.type} ${e.amount}円 ${
          e.memo ? `摘要:${e.memo}` : ""
        }${e.status === "draft" ? " ※AIの下書き（残高に未算入）" : ""}`
    )
    .join("\n");

  const prompt = `あなたは日本の税理士事務所の会計スタッフです。
借入金台帳について質問に答えてください。

${contextPrompt(ctx)}

## 台帳の増減明細（直近）
${entryLines || "（明細なし）"}

## 守ること
- **残高や合計は上に示した値をそのまま使い、自分で計算し直さないでください。**
  上に無い数字を新たに作らないこと。
- 回答の根拠にした明細の id を必ず sources に入れてください。根拠が無い回答はしないでください。
- 台帳から答えられない質問（税額の計算、他機能の話など）は out_of_scope を true にし、
  何なら答えられるかを添えてください。
- 金額は円単位で、3桁区切りにしてください。

## 出力形式
JSONのみを返してください。説明文は不要です。
{"answer":"日本語の回答","sources":[{"entry_id":"根拠にした明細のid","label":"その明細を指す短い説明"}],"out_of_scope":true/false}

${INJECTION_GUARD}

## 質問
${question}`;

  const model = getGeminiModel("text");
  const result = await callGemini(() => model.generateContent(prompt));
  const parsed = extractJson<{
    answer?: string;
    sources?: { entry_id?: string; label?: string }[];
    out_of_scope?: boolean;
  }>(result.response.text(), "質問への回答");

  const byId = new Map(entries.map((e) => [e.id, e]));

  // AIが挙げた根拠のうち、実在する明細だけを残す（存在しないidを出させない）
  const sources: LedgerAnswerSource[] = (parsed.sources ?? [])
    .map((s): LedgerAnswerSource | null => {
      const e = s.entry_id ? byId.get(s.entry_id) : undefined;
      if (!e) return null;
      return {
        label: s.label || `${e.date} ${e.loanName} ${e.amount}円`,
        loan_id: e.loan_id,
        entry_id: e.id,
        entry_date: e.date,
        amount: e.amount,
      };
    })
    .filter((s): s is LedgerAnswerSource => s !== null);

  return {
    answer: parsed.answer ?? "",
    sources,
    outOfScope: Boolean(parsed.out_of_scope),
  };
}
