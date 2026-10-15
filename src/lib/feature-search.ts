/**
 * 画面・機能を言葉で探す（ヘッダーの「機能を探す」）。純粋関数。
 * メニューの項目と、画面の中のタブ（総勘定元帳・消費税集計表など）を、名前・読み・言い換えの言葉で探す。
 * ひらがな・カタカナ・ローマ字（頭から）でも当てる。
 */

import { hiraganaToRomaji } from "@/lib/account-reading";

export type Feature = {
  label: string;
  /** 読み（ひらがな）。ひらがな・ローマ字で探すため */
  reading: string;
  /** 顧問先の中の画面は "/journals" のように顧問先より後ろ、全体の画面は "~/dashboard" */
  path: string;
  /** メニューのどこにあるか（候補に小さく出す） */
  where: string;
  /** 言い換え・中身の言葉（「内訳」「BS」「家事按分」など） */
  keywords?: string[];
  /** 個人事業主だけ／法人だけの画面 */
  only?: "individual" | "corporation";
};

const D = "日常業務";
const B = "帳簿・レポート";
const C = "決算";
const R = "台帳・取引先";
const M = "マスタ・設定";

export const FEATURES: Feature[] = [
  { label: "仕訳入力", reading: "しわけにゅうりょく", path: "/journals", where: D, keywords: ["新規仕訳", "仕訳登録", "手入力", "CSV取込", "銀行明細", "一括登録", "連想"] },
  { label: "証憑管理", reading: "しょうひょうかんり", path: "/documents", where: D, keywords: ["証憑", "アップロード", "OCR", "読み取り", "スキャン"] },
  { label: "領収書・請求書（受領）", reading: "りょうしゅうしょせいきゅうしょじゅりょう", path: "/documents?tab=received", where: `${D} ＞ 証憑管理`, keywords: ["領収書", "レシート", "受け取った請求書", "経費"] },
  { label: "領収書・請求書（発行）", reading: "りょうしゅうしょせいきゅうしょはっこう", path: "/documents?tab=issued", where: `${D} ＞ 証憑管理`, keywords: ["請求書", "請求書作成", "インボイス", "発行"] },
  { label: "受発注書類", reading: "じゅはっちゅうしょるい", path: "/documents?tab=orders", where: `${D} ＞ 証憑管理`, keywords: ["注文書", "発注書", "見積書", "納品書", "契約書"] },
  { label: "明細書", reading: "めいさいしょ", path: "/documents?tab=statements", where: `${D} ＞ 証憑管理`, keywords: ["通帳", "銀行明細", "カード明細", "利用明細"] },
  { label: "入金消込", reading: "にゅうきんけしこみ", path: "/payments", where: D, keywords: ["入金", "消込", "売掛金の回収", "未入金"] },
  { label: "カード取引", reading: "かーどとりひき", path: "/card-transactions", where: D, keywords: ["クレジットカード", "カード", "引き落とし"] },

  { label: "仕訳帳", reading: "しわけちょう", path: "/ledgers?tab=journal", where: `${B} ＞ 帳簿閲覧`, keywords: ["帳簿", "仕訳一覧", "仕訳の修正"] },
  { label: "総勘定元帳", reading: "そうかんじょうもとちょう", path: "/ledgers?tab=general", where: `${B} ＞ 帳簿閲覧`, keywords: ["元帳", "内訳", "相手先別", "税率別", "月計", "残高"] },
  { label: "補助元帳", reading: "ほじょもとちょう", path: "/ledgers?tab=subledger", where: `${B} ＞ 帳簿閲覧`, keywords: ["補助科目", "取引先別"] },
  { label: "売掛帳", reading: "うりかけちょう", path: "/ledgers?tab=receivable", where: `${B} ＞ 帳簿閲覧`, keywords: ["売掛金", "エージング", "回収", "得意先"] },
  { label: "買掛帳", reading: "かいかけちょう", path: "/ledgers?tab=payable", where: `${B} ＞ 帳簿閲覧`, keywords: ["買掛金", "仕入先", "支払"] },
  { label: "合計残高試算表", reading: "ごうけいざんだかしさんひょう", path: "/statements?tab=trial_balance", where: `${B} ＞ 試算表・財務諸表`, keywords: ["試算表", "残高試算表"] },
  { label: "貸借対照表", reading: "たいしゃくたいしょうひょう", path: "/statements?tab=bs", where: `${B} ＞ 試算表・財務諸表`, keywords: ["BS", "B/S", "バランスシート", "資産", "負債"] },
  { label: "損益計算書", reading: "そんえきけいさんしょ", path: "/statements?tab=pl", where: `${B} ＞ 試算表・財務諸表`, keywords: ["PL", "P/L", "利益", "売上", "経費"] },
  { label: "決算書（決算報告書）", reading: "けっさんしょ", path: "/statements?tab=settlement", where: `${B} ＞ 試算表・財務諸表`, keywords: ["決算報告書", "株主資本等変動計算書", "個別注記表", "財務諸表", "表紙"] },
  { label: "月次推移表", reading: "げつじすいいひょう", path: "/statements?tab=monthly_trend", where: `${B} ＞ 試算表・財務諸表`, keywords: ["推移", "前年同月比", "月別"] },
  { label: "棚卸表", reading: "たなおろしひょう", path: "/statements?tab=inventory", where: `${B} ＞ 試算表・財務諸表`, keywords: ["棚卸", "在庫", "実地棚卸"] },
  { label: "税区分ごとの一覧", reading: "ぜいくぶんごとのいちらん", path: "/tax-summary?view=category", where: `${B} ＞ 消費税の集計`, keywords: ["税区分", "税区分の確認", "税区分未設定", "消費税"] },
  { label: "科目別税区分表", reading: "かもくべつぜいくぶんひょう", path: "/tax-summary?view=account", where: `${B} ＞ 消費税の集計`, keywords: ["税区分", "科目別", "消費税"] },
  { label: "消費税集計表", reading: "しょうひぜいしゅうけいひょう", path: "/tax-summary?view=table", where: `${B} ＞ 消費税の集計`, keywords: ["10%", "8%", "軽減税率", "課税売上", "非課税", "輸入", "返還", "消費税"] },

  { label: "決算前チェック", reading: "けっさんまえちぇっく", path: "/closing-checklist", where: C, keywords: ["チェックリスト", "確認"] },
  { label: "決算処理", reading: "けっさんしょり", path: "/closing", where: C, keywords: ["決算整理仕訳", "年度締め", "ロック", "締め"] },
  { label: "期首残高設定", reading: "きしゅざんだかせってい", path: "/opening-balances", where: C, keywords: ["開始残高", "前期繰越", "繰越"] },
  { label: "貸倒れ・貸倒引当金", reading: "かしだおれかしだおれひきあてきん", path: "/bad-debts", where: C, keywords: ["貸倒", "引当金", "貸倒損失"] },
  { label: "勘定科目内訳明細書", reading: "かんじょうかもくうちわけめいさいしょ", path: "/breakdown", where: C, keywords: ["内訳書", "内訳明細書"] },
  { label: "消費税申告書", reading: "しょうひぜいしんこくしょ", path: "/tax-return", where: C, keywords: ["消費税", "申告", "付表", "簡易課税", "2割特例", "e-Tax", "中間申告"] },
  { label: "法人税申告書", reading: "ほうじんぜいしんこくしょ", path: "/corporate-tax", where: C, only: "corporation", keywords: ["法人税", "別表", "住民税", "事業税", "e-Tax", "株主名簿", "同族会社", "税額控除", "別表四", "別表十六"] },
  { label: "青色申告決算書", reading: "あおいろしんこくけっさんしょ", path: "/blue-return", where: C, only: "individual", keywords: ["青色申告", "個人事業主", "所得税", "青色申告特別控除", "65万円"] },

  { label: "給与台帳", reading: "きゅうよだいちょう", path: "/payroll", where: R, keywords: ["給与", "給料", "源泉", "賞与", "社会保険"] },
  { label: "借入金台帳", reading: "かりいれきんだいちょう", path: "/loans", where: R, keywords: ["借入金", "役員借入金", "貸付金", "認定利息", "返済"] },
  { label: "固定資産・減価償却", reading: "こていしさんげんかしょうきゃく", path: "/assets", where: R, keywords: ["固定資産", "固定資産台帳", "減価償却", "特別償却", "税額控除", "端数", "事業専用割合", "償却"] },
  { label: "取引先管理", reading: "とりひきさきかんり", path: "/partners", where: R, keywords: ["取引先", "得意先", "仕入先", "登録番号", "インボイス"] },

  { label: "勘定科目管理", reading: "かんじょうかもくかんり", path: "/accounts", where: M, keywords: ["勘定科目", "科目", "補助科目", "読み", "科目追加"] },
  { label: "仕訳学習", reading: "しわけがくしゅう", path: "/learned-rules", where: M, keywords: ["学習", "ルール", "自動仕訳", "AI"] },
  { label: "私的利用の按分", reading: "してきりようのあんぶん", path: "/allocations", where: M, keywords: ["按分", "家事按分", "役員の私的利用", "家事関連費"] },
  { label: "決算月の設定", reading: "けっさんづきのせってい", path: "/settings?tab=fiscal", where: `${M} ＞ 設定`, keywords: ["決算月", "事業年度", "決算月の変更"] },
  { label: "消費税の設定", reading: "しょうひぜいのせってい", path: "/settings?tab=tax", where: `${M} ＞ 設定`, keywords: ["課税事業者", "免税事業者", "本則課税", "簡易課税", "税率別内訳"] },
  { label: "e-Tax の提出情報", reading: "いーたっくすのていしゅつじょうほう", path: "/settings?tab=etax", where: `${M} ＞ 設定`, keywords: ["e-Tax", "税務署", "利用者識別番号", "法人番号"] },
  { label: "給与の設定", reading: "きゅうよのせってい", path: "/settings?tab=payroll", where: `${M} ＞ 設定`, keywords: ["給料日"] },
  { label: "会社書類", reading: "かいしゃしょるい", path: "/settings?tab=company_documents", where: `${M} ＞ 設定`, keywords: ["定款", "登記簿", "議事録", "許認可"] },
  { label: "メンバー・権限", reading: "めんばーけんげん", path: "/settings?tab=members", where: `${M} ＞ 設定`, keywords: ["メンバー", "権限", "閲覧専用", "招待", "ユーザー"] },
  { label: "AIの利用", reading: "えーあいのりよう", path: "/settings?tab=ai", where: `${M} ＞ 設定`, keywords: ["AI", "AIに渡す", "個人情報", "Gemini"] },
  { label: "監査ログ", reading: "かんさろぐ", path: "/settings?tab=audit", where: `${M} ＞ 設定`, keywords: ["ログ", "変更履歴", "操作履歴"] },

  { label: "ダッシュボード", reading: "だっしゅぼーど", path: "~/dashboard", where: "全体", keywords: ["ホーム", "トップ"] },
  { label: "顧問先一覧", reading: "こもんさきいちらん", path: "~/clients", where: "全体", keywords: ["顧問先", "クライアント", "会社一覧"] },
  { label: "マイアカウント", reading: "まいあかうんと", path: "~/settings", where: "全体", keywords: ["アカウント", "パスワード", "プロフィール"] },
];

/** 全角半角・カタカナひらがな・大文字小文字・空白の違いを無視 */
function norm(v: string): string {
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s・／/()（）「」-]/g, "");
}

/**
 * 言葉で機能を探す。名前の頭が当たるものを先に、言い換えの言葉で当たるものを後に並べる。
 * entityType を渡すと、その顧問先に無い画面（個人事業主の法人税申告書など）は出さない。
 * inClient が false（顧問先を選んでいない）なら、全体の画面だけ出す。
 */
export function searchFeatures(query: string, opt: { entityType?: "individual" | "corporation" | null; inClient: boolean; limit?: number }): Feature[] {
  const q = norm(query);
  if (!q) return [];
  const ascii = /^[a-z0-9]+$/.test(q);
  const scored: { f: Feature; score: number }[] = [];
  for (const f of FEATURES) {
    if (f.only && opt.entityType && f.only !== opt.entityType) continue;
    if (!opt.inClient && !f.path.startsWith("~")) continue;
    const label = norm(f.label);
    const reading = norm(f.reading);
    let score = 0;
    if (label.startsWith(q) || reading.startsWith(q)) score = 100;
    else if (label.includes(q) || reading.includes(q)) score = 60;
    else if (ascii && hiraganaToRomaji(f.reading).startsWith(q)) score = 50;
    else if ((f.keywords ?? []).some((k) => norm(k).startsWith(q))) score = 40;
    else if ((f.keywords ?? []).some((k) => norm(k).includes(q))) score = 20;
    if (score) scored.push({ f, score: score - label.length / 100 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, opt.limit ?? 8)
    .map((x) => x.f);
}

/** 移る先の URL（顧問先の中の画面は顧問先の ID をつける） */
export function featureHref(f: Feature, clientId: string | null): string {
  if (f.path.startsWith("~")) return f.path.slice(1);
  return `/clients/${clientId}${f.path}`;
}
