/**
 * AIの取込箱（仕訳入力の「1つの箱」）の決まり（純粋関数）。
 *   - 入れられたファイルの種類の見分け（写真・PDF・表）
 *   - 表（CSV・Excel）の見出し行の位置と、何の表か（仕訳・通帳・カード明細・給与）
 *   - 読み取った証憑と作った仕訳から、利用者に聞くこと（要確認ボックスの質問）を決める
 */

import { isEntertainmentAccount } from "@/lib/entertainment";

export type InboxFileKind = "image" | "pdf" | "table" | "unsupported";

export function inboxFileKind(name: string, type = ""): InboxFileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["csv", "tsv", "txt", "xlsx", "xlsm"].includes(ext) || type === "text/csv") return "table";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext) || type.startsWith("image/")) return "image";
  return "unsupported";
}

/** 証憑として保存できる大きさ（receipt-storage と同じ） */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type TableKind = "journal" | "bank" | "card" | "payroll" | "unknown";

const HEADER_WORDS = /日付|年月日|取引日|利用日|ご利用日|摘要|内容|お取引内容|入金|出金|お預り|お引出|預入|引出|支払|金額|残高|借方|貸方|勘定科目|科目|利用店|ご利用先|基本給|総支給|差引支給/;

/**
 * 見出し行の位置。通帳のCSVは先頭に口座番号や期間の行があることが多いので、
 * 見出しらしい語が2つ以上ある最初の行を見出しとみる（見つからなければ先頭行）。
 */
export function findHeaderRow(grid: string[][], scan = 15): number {
  for (let i = 0; i < Math.min(grid.length, scan); i++) {
    const hits = grid[i].filter((c) => HEADER_WORDS.test(c ?? "")).length;
    if (hits >= 2) return i;
  }
  return 0;
}

/** 見出しから、何の表かを見分ける */
export function classifyTable(header: string[]): TableKind {
  const h = header.join(" ");
  if (/借方/.test(h) && /貸方/.test(h)) return "journal";
  if (/勘定科目/.test(h) && /金額/.test(h)) return "journal";
  if (/基本給|総支給|差引支給|健康保険料/.test(h)) return "payroll";
  if (/(ご)?利用(日|店|先|金額)|カード/.test(h)) return "card";
  if (/入金|出金|お預り|お引出|預入|引出|残高|お支払金額|お預入金額/.test(h)) return "bank";
  return "unknown";
}

/** 表の見出し行を取り除き、空の行を落とす */
export function splitTable(grid: string[][]): { header: string[]; rows: string[][] } {
  const at = findHeaderRow(grid);
  const header = grid[at] ?? [];
  const rows = grid.slice(at + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  return { header, rows };
}

export type StatementRowLine = {
  date: string | null;
  description: string;
  counterparty: string | null;
  amount: number;
  direction: "deposit" | "withdrawal";
  balanceAfter: number | null;
};

/** 通帳・カード明細のPDFから読んだ行を、銀行CSVと同じ形の表にする（AIの仕訳提案を共通にするため） */
export function statementLinesToTable(lines: StatementRowLine[]): { header: string[]; rows: string[][] } {
  return {
    header: ["日付", "摘要", "取引先", "出金", "入金", "残高"],
    rows: lines.map((l) => [
      l.date ?? "",
      l.description,
      l.counterparty ?? "",
      l.direction === "withdrawal" ? String(Math.abs(l.amount)) : "",
      l.direction === "deposit" ? String(Math.abs(l.amount)) : "",
      l.balanceAfter === null ? "" : String(l.balanceAfter),
    ]),
  };
}

/** 配列を n 件ずつに分ける（AIへの1回の依頼の上限に合わせる） */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// 要確認ボックスの質問
// ---------------------------------------------------------------------------

export type InboxReason =
  | "unreadable"
  | "unclear"
  | "low_confidence"
  | "entertainment"
  | "duplicate"
  | "withholding"
  | "unknown_document"
  | "consult"
  | "other";

export const INBOX_REASON_LABELS: Record<InboxReason, string> = {
  unreadable: "読み取れない",
  unclear: "読み取りにくい",
  low_confidence: "科目の確認",
  entertainment: "交際費の人数・相手",
  duplicate: "重複の可能性",
  withholding: "源泉徴収",
  unknown_document: "仕訳にしない書類",
  consult: "相談",
  other: "確認",
};

export type ReviewOcr = {
  date?: string;
  vendor_name?: string;
  amount_total?: number;
  amount_jpy?: number;
  confidence?: number;
  legibility?: "clear" | "partly_unclear" | "unreadable";
  unclear_fields?: string[];
  possible_duplicate?: boolean;
  document_type?: string;
  withholding_tax?: number;
};

export type ReviewJournal = {
  needsReview: boolean;
  description: string | null;
  question?: string | null;
  lines: { accountName: string; debit: number; credit: number; entertainmentKind: string | null; attendees: number | null }[];
} | null;

export type ReviewQuestion = { reason: InboxReason; title: string; question: string; options: string[] };

const DOC_LABELS: Record<string, string> = {
  estimate: "見積書",
  contract: "契約書",
  purchase_order: "発注書",
  delivery_note: "納品書",
  goods_receipt: "受領書",
  statement: "明細書",
  other: "その他の書類",
};

const yen = (n: number) => `${Math.round(n).toLocaleString()}円`;

/**
 * 読み取った証憑と作った仕訳から、利用者に聞くことを1つ決める（無ければ null）。
 * いちばん大事なものを先に聞く: 読めない → 重複 → 交際費の人数 → 源泉徴収 → 読み取りにくい → 科目の迷い → 仕訳にしない書類
 */
export function reviewQuestionFor(p: {
  fileName: string;
  ocr: ReviewOcr | null;
  journal: ReviewJournal;
  perPersonLimit: number;
  underLimitAccount: string;
}): ReviewQuestion | null {
  const o = p.ocr ?? {};
  const amount = o.amount_jpy ?? o.amount_total;
  const who = o.vendor_name ? `「${o.vendor_name}」` : "この証憑";
  const summary = [o.date, o.vendor_name, amount != null ? yen(amount) : null].filter(Boolean).join(" / ");

  if (!p.ocr || o.legibility === "unreadable" || (amount == null && !p.journal)) {
    return {
      reason: "unreadable",
      title: "読み取れませんでした",
      question: `「${p.fileName}」の文字が読み取れませんでした（ぼやけ・暗さ・写りきっていない など）。撮り直した写真を入れるか、日付・支払先・金額・支払方法を教えてください。例:「10月3日 セブンイレブン 1,280円 現金」`,
      options: ["撮り直します", "証憑として保存だけする"],
    };
  }
  if (o.possible_duplicate) {
    return {
      reason: "duplicate",
      title: "重複の可能性",
      question: `${summary} と同じ日付・金額の証憑がすでにあります。二重に取り込んでいませんか？`,
      options: ["別の取引です", "重複しています"],
    };
  }
  const entLine = p.journal?.lines.find((l) => isEntertainmentAccount(l.accountName) && l.entertainmentKind === "dining" && !l.attendees);
  if (entLine) {
    return {
      reason: "entertainment",
      title: "交際費の人数・相手",
      question: `${who}での飲食 ${yen(entLine.debit)} を接待交際費にしました。どなたと何人でしたか？ 取引先との飲食で1人当たり${yen(p.perPersonLimit)}以下なら「${p.underLimitAccount}」にできます（社内の人だけなら除けません）。`,
      options: ["社内の人だけです", "取引先との会食です"],
    };
  }
  if (o.withholding_tax && p.journal && !p.journal.lines.some((l) => /預り金/.test(l.accountName) && l.credit > 0)) {
    return {
      reason: "withholding",
      title: "源泉徴収",
      question: `${who}の請求書に源泉徴収税額 ${yen(o.withholding_tax)} の記載があります。預り金として差し引いて仕訳しますか？`,
      options: ["差し引いてください", "差し引きません"],
    };
  }
  if (o.legibility === "partly_unclear" || (o.confidence != null && o.confidence < 0.6)) {
    const fields = o.unclear_fields?.length ? `（${o.unclear_fields.join("・")}）` : "";
    return {
      reason: "unclear",
      title: "読み取りにくい箇所",
      question: `${who}は読み取りにくい箇所がありました${fields}。読み取った内容は「${summary || "不明"}」です。合っていますか？`,
      options: ["合っています", "違います"],
    };
  }
  if (p.journal?.needsReview) {
    const main = p.journal.lines.find((l) => l.debit > 0 && !/仮払消費税|仮受消費税/.test(l.accountName));
    const q =
      p.journal.question ||
      `「${p.journal.description ?? o.vendor_name ?? "この取引"}」を${main ? `「${main.accountName}」${yen(main.debit)}` : "この内容"}で仕訳しました。この科目で合っていますか？`;
    return { reason: "low_confidence", title: "科目の確認", question: q, options: ["合っています", "別の科目にしたい"] };
  }
  if (!p.journal) {
    const label = DOC_LABELS[o.document_type ?? ""] ?? "書類";
    return {
      reason: "unknown_document",
      title: "仕訳にしない書類",
      question: `${who}は${label}として保存しました。${label}からは仕訳を作っていません。この書類でお金を支払った・受け取った場合は、内容を教えてください。`,
      options: ["仕訳は要りません", "仕訳にしてください"],
    };
  }
  return null;
}
