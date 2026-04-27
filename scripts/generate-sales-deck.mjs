/**
 * Raqto会計（AIバージョン）営業スライド生成スクリプト
 * 実行: node scripts/generate-sales-deck.mjs
 * 出力: public/Raqto会計_営業資料.pptx
 */
import pptxgenjs from "pptxgenjs";
import { writeFileSync } from "fs";

const pptx = new pptxgenjs();

// ─── ブランドカラー ───
const C = {
  primary: "527120",
  primaryLight: "6C992F",
  primaryDark: "4F6913",
  accent: "66911B",
  cream: "F6F2C5",
  sidebar: "323736",
  slatePurple: "4E4D5C",
  white: "FFFFFF",
  gray50: "F9FAFB",
  gray100: "F3F4F6",
  gray200: "E5E7EB",
  gray600: "4B5563",
  gray800: "1F2937",
  muted: "BEC8BE",
  red: "EF4444",
  yellow: "F59E0B",
};

// ─── プレゼンテーション設定 ───
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Raqto会計";
pptx.company = "Raqto";
pptx.subject = "Raqto会計（AIバージョン）営業資料";
pptx.title = "Raqto会計（AIバージョン）- 営業資料";

// ─── ヘルパー関数 ───
function addDarkSlide() {
  return pptx.addSlide({ bkgd: { fill: C.sidebar } });
}

function addLightSlide() {
  return pptx.addSlide({ bkgd: { fill: C.gray50 } });
}

function addGreenSlide() {
  return pptx.addSlide({ bkgd: { fill: C.primary } });
}

function addCreamSlide() {
  return pptx.addSlide({ bkgd: { fill: C.cream } });
}

function sectionLabel(slide, text, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? 0.8,
    y: opts.y ?? 0.5,
    w: 4,
    h: 0.4,
    fontSize: 11,
    fontFace: "Meiryo",
    bold: true,
    color: opts.color ?? C.primaryLight,
    letterSpacing: 4,
  });
}

function heading(slide, textArr, opts = {}) {
  slide.addText(textArr, {
    x: opts.x ?? 0.8,
    y: opts.y ?? 0.9,
    w: opts.w ?? 11,
    h: opts.h ?? 0.9,
    fontSize: opts.fontSize ?? 32,
    fontFace: "Meiryo",
    bold: true,
    color: opts.color ?? C.white,
    lineSpacingMultiple: 1.2,
  });
}

function cardRect(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.15,
    fill: { color: opts.fill ?? "3D4342" },
    line: { color: opts.line ?? "4A504F", width: 1 },
    shadow: opts.shadow ?? undefined,
  });
}

function lightCard(slide, x, y, w, h) {
  cardRect(slide, x, y, w, h, {
    fill: C.white,
    line: C.gray200,
    shadow: { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.08 },
  });
}

function greenCard(slide, x, y, w, h) {
  cardRect(slide, x, y, w, h, {
    fill: "5F8320",
    line: "6E9530",
  });
}

// ════════════════════════════════════════════
// SLIDE 1: タイトル
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();

  // ロゴマーク (rounded rectangle)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.9, y: 0.8, w: 1.1, h: 1.1,
    rectRadius: 0.2,
    fill: { color: C.primary },
    shadow: { type: "outer", blur: 12, offset: 4, color: C.primary, opacity: 0.4 },
  });
  slide.addText("📖", {
    x: 5.9, y: 0.85, w: 1.1, h: 1.1,
    align: "center", valign: "middle",
    fontSize: 36,
  });

  // タイトル
  slide.addText([
    { text: "Raqto会計", options: { color: C.white, fontSize: 44, bold: true, fontFace: "Meiryo" } },
    { text: "（AIバージョン）", options: { color: C.primaryLight, fontSize: 44, bold: true, fontFace: "Meiryo" } },
  ], {
    x: 0, y: 2.2, w: 13.33, h: 0.9, align: "center",
  });

  // サブタイトル
  slide.addText("AI × 税理士事務所", {
    x: 0, y: 3.2, w: 13.33, h: 0.6,
    align: "center", fontSize: 20, fontFace: "Meiryo",
    color: "808080", letterSpacing: 6,
  });

  // 区切り線
  slide.addShape(pptx.ShapeType.line, {
    x: 4.5, y: 4.4, w: 4.33, h: 0,
    line: { color: "555555", width: 1 },
  });

  // タグライン
  slide.addText(
    "レシート撮影から仕訳完了まで、AIが自動化。\n税理士事務所の業務効率を根本から変える次世代クラウド会計。",
    {
      x: 2.5, y: 4.7, w: 8.33, h: 1.0,
      align: "center", fontSize: 14, fontFace: "Meiryo",
      color: "888888", lineSpacingMultiple: 1.6,
    }
  );
}

// ════════════════════════════════════════════
// SLIDE 2: 課題
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();
  sectionLabel(slide, "課  題");
  heading(slide, [
    { text: "税理士事務所が抱える", options: { color: C.white } },
    { text: "3つの課題", options: { color: C.primaryLight } },
  ]);

  const problems = [
    { icon: "⏱", title: "手入力の膨大な工数", desc: "領収書・請求書を1枚ずつ確認し、勘定科目を判断して手入力。\n顧問先が増えるほど、スタッフの残業時間が増えていく。", color: C.red },
    { icon: "📋", title: "顧問先とのやりとりが煩雑", desc: "「領収書まだですか？」「この取引は何ですか？」──\nメール・電話・FAXが入り乱れ、確認漏れが発生。", color: C.red },
    { icon: "⚠", title: "インボイス制度への対応負荷", desc: "適格請求書の登録番号確認、経過措置の税率管理──\n制度対応だけで膨大な確認作業が発生している。", color: C.yellow },
  ];

  problems.forEach((p, i) => {
    const y = 2.1 + i * 1.7;
    // Icon circle
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.8, y, w: 0.7, h: 0.7, rectRadius: 0.12,
      fill: { color: p.color, transparency: 80 },
    });
    slide.addText(p.icon, { x: 0.8, y, w: 0.7, h: 0.7, align: "center", valign: "middle", fontSize: 24 });
    // Title
    slide.addText(p.title, { x: 1.8, y, w: 8, h: 0.45, fontSize: 18, bold: true, fontFace: "Meiryo", color: C.white });
    // Desc
    slide.addText(p.desc, { x: 1.8, y: y + 0.5, w: 9, h: 0.9, fontSize: 12, fontFace: "Meiryo", color: "AAAAAA", lineSpacingMultiple: 1.5 });
  });
}

// ════════════════════════════════════════════
// SLIDE 3: ソリューション概要
// ════════════════════════════════════════════
{
  const slide = addGreenSlide();
  sectionLabel(slide, "ソリューション", { x: 0, y: 0.5, color: C.cream });
  slide.addText([
    { text: "Raqto会計なら、", options: { color: C.white, fontSize: 36, bold: true, fontFace: "Meiryo" } },
    { text: "すべて解決", options: { color: C.cream, fontSize: 36, bold: true, fontFace: "Meiryo" } },
  ], { x: 0, y: 1.0, w: 13.33, h: 0.8, align: "center" });

  slide.addText(
    "AIが領収書を自動で読み取り、仕訳まで提案。\n顧問先はスマホで撮影するだけ。税理士はワンクリックで承認。",
    { x: 2, y: 2.0, w: 9.33, h: 0.8, align: "center", fontSize: 16, fontFace: "Meiryo", color: "DDEECC", lineSpacingMultiple: 1.6 }
  );

  // Flow steps
  const steps = [
    { icon: "📸", label: "スマホ撮影", desc: "顧問先が領収書を撮影" },
    { icon: "🤖", label: "AI-OCR", desc: "日付・金額・取引先を自動抽出" },
    { icon: "📝", label: "AI仕訳提案", desc: "勘定科目を自動判定" },
    { icon: "✅", label: "ワンクリック承認", desc: "税理士が確認・承認" },
  ];

  steps.forEach((s, i) => {
    const x = 1.0 + i * 3.15;
    greenCard(slide, x, 3.5, 2.5, 2.4);
    slide.addText(s.icon, { x, y: 3.7, w: 2.5, h: 0.8, align: "center", fontSize: 36 });
    slide.addText(s.label, { x, y: 4.5, w: 2.5, h: 0.5, align: "center", fontSize: 15, bold: true, fontFace: "Meiryo", color: C.white });
    slide.addText(s.desc, { x, y: 5.0, w: 2.5, h: 0.5, align: "center", fontSize: 10, fontFace: "Meiryo", color: "CCDDBB" });

    if (i < 3) {
      slide.addText("→", { x: x + 2.5, y: 4.2, w: 0.65, h: 0.6, align: "center", fontSize: 24, color: C.cream, bold: true });
    }
  });
}

// ════════════════════════════════════════════
// SLIDE 4: AI機能
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();
  sectionLabel(slide, "AI 機 能");
  heading(slide, [
    { text: "AIが", options: { color: C.white } },
    { text: "経理業務", options: { color: C.primaryLight } },
    { text: "を根本から変える", options: { color: C.white } },
  ]);

  const features = [
    { icon: "🔍", title: "AI-OCR読み取り", desc: "レシート・領収書・請求書を画像\nまたはPDFでアップロード。AIが\n日付、金額、取引先名、税率、\n明細を自動で抽出。信頼度スコア\nも表示。" },
    { icon: "🧠", title: "AI仕訳自動生成", desc: "OCR結果と顧問先の勘定科目体系\nをAIに渡し、最適な勘定科目を\n自動判定。税理士はワンクリック\nで仕訳を承認。" },
    { icon: "🏦", title: "銀行明細AI照合", desc: "銀行取引ごとにAIが勘定科目を\n推定し、信頼度パーセンテージを\n表示。ワンクリックで承認、また\nはオーバーライド可能。" },
  ];

  features.forEach((f, i) => {
    const x = 0.8 + i * 4.0;
    cardRect(slide, x, 2.2, 3.6, 3.6);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.3, y: 2.5, w: 0.8, h: 0.8, rectRadius: 0.15,
      fill: { color: C.primary },
    });
    slide.addText(f.icon, { x: x + 0.3, y: 2.5, w: 0.8, h: 0.8, align: "center", valign: "middle", fontSize: 24 });
    slide.addText(f.title, { x: x + 0.3, y: 3.5, w: 3.0, h: 0.5, fontSize: 16, bold: true, fontFace: "Meiryo", color: C.white });
    slide.addText(f.desc, { x: x + 0.3, y: 4.1, w: 3.0, h: 1.5, fontSize: 11, fontFace: "Meiryo", color: "AAAAAA", lineSpacingMultiple: 1.4 });
  });

  // Highlight box
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 6.1, w: 11.73, h: 0.9,
    fill: { color: C.accent, transparency: 85 },
    line: { color: C.accent, width: 0 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 6.1, w: 0.06, h: 0.9,
    fill: { color: C.accent },
  });
  slide.addText(
    "💡 外貨取引にも自動対応 ── 外貨レシートを自動検知し、リアルタイム為替レートを取得。円換算額と為替レートを摘要に自動記載。",
    { x: 1.1, y: 6.1, w: 11.2, h: 0.9, fontSize: 12, fontFace: "Meiryo", color: "CCCCCC", valign: "middle" }
  );
}

// ════════════════════════════════════════════
// SLIDE 5: 顧問先ポータル
// ════════════════════════════════════════════
{
  const slide = addCreamSlide();
  sectionLabel(slide, "顧問先ポータル", { color: C.primary });
  heading(slide, [
    { text: "顧問先は", options: { color: C.gray800 } },
    { text: "スマホだけ", options: { color: C.primary } },
    { text: "でOK", options: { color: C.gray800 } },
  ], { color: C.gray800 });

  slide.addText(
    "アプリのインストール不要。ブラウザで事務所専用URLに\nアクセスするだけで、すべての機能が使えます。",
    { x: 0.8, y: 2.0, w: 6, h: 0.7, fontSize: 14, fontFace: "Meiryo", color: C.gray600, lineSpacingMultiple: 1.6 }
  );

  const checks = [
    "スマホカメラで領収書をその場で撮影",
    "アップロード履歴とステータスを即確認",
    "税理士への質問をチャット形式で送信",
    "請求書の閲覧とPDFダウンロード",
    "ドラッグ＆ドロップでPC対応も万全",
  ];
  checks.forEach((c, i) => {
    const y = 3.0 + i * 0.55;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 1.0, y: y + 0.05, w: 0.35, h: 0.35,
      fill: { color: C.primary },
    });
    slide.addText("✓", { x: 1.0, y: y + 0.02, w: 0.35, h: 0.35, align: "center", valign: "middle", fontSize: 12, bold: true, color: C.white });
    slide.addText(c, { x: 1.55, y, w: 5.5, h: 0.42, fontSize: 14, fontFace: "Meiryo", color: C.gray800, valign: "middle" });
  });

  // Phone mockup
  const px = 8.5, py = 0.8, pw = 3.5, ph = 6.0;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: px, y: py, w: pw, h: ph, rectRadius: 0.35,
    fill: { color: C.sidebar },
    line: { color: "555555", width: 2 },
    shadow: { type: "outer", blur: 16, offset: 6, color: "000000", opacity: 0.25 },
  });
  // Phone header
  slide.addText("Raqto会計", {
    x: px, y: py + 0.15, w: pw, h: 0.5,
    align: "center", fontSize: 12, bold: true, fontFace: "Meiryo", color: C.white,
  });
  // Phone body
  slide.addShape(pptx.ShapeType.rect, {
    x: px + 0.2, y: py + 0.7, w: pw - 0.4, h: ph - 1.5,
    fill: { color: C.gray50 },
  });
  slide.addText("📋 アップロード履歴", {
    x: px + 0.4, y: py + 0.85, w: pw - 0.8, h: 0.35,
    fontSize: 10, bold: true, fontFace: "Meiryo", color: C.gray800,
  });

  const receipts = [
    { name: "スターバックス", status: "仕訳済", sColor: C.primary, date: "2026/02/25", amt: "¥680" },
    { name: "Amazon.co.jp", status: "OCR完了", sColor: "1D4ED8", date: "2026/02/24", amt: "¥12,980" },
    { name: "JR東日本", status: "処理中", sColor: "B45309", date: "2026/02/23", amt: "¥3,200" },
    { name: "ヤマダ電機", status: "仕訳済", sColor: C.primary, date: "2026/02/22", amt: "¥54,780" },
  ];
  receipts.forEach((r, i) => {
    const ry = py + 1.3 + i * 0.85;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: px + 0.35, y: ry, w: pw - 0.7, h: 0.7,
      rectRadius: 0.08, fill: { color: C.white }, line: { color: C.gray200, width: 0.5 },
    });
    slide.addText(r.name, { x: px + 0.5, y: ry + 0.05, w: 1.6, h: 0.3, fontSize: 9, bold: true, fontFace: "Meiryo", color: C.gray800 });
    slide.addText(r.status, { x: px + pw - 1.5, y: ry + 0.08, w: 0.8, h: 0.22, fontSize: 7, bold: true, fontFace: "Meiryo", color: r.sColor, align: "center" });
    slide.addText(r.date, { x: px + 0.5, y: ry + 0.37, w: 1.2, h: 0.25, fontSize: 8, fontFace: "Meiryo", color: C.gray600 });
    slide.addText(r.amt, { x: px + pw - 1.5, y: ry + 0.37, w: 0.8, h: 0.25, fontSize: 8, fontFace: "Meiryo", color: C.gray600, align: "center" });
  });

  // Phone nav bar
  slide.addShape(pptx.ShapeType.rect, {
    x: px + 0.2, y: py + ph - 0.75, w: pw - 0.4, h: 0.55,
    fill: { color: C.white },
  });
  const navItems = ["📷 撮影", "📋 履歴", "💬 質問", "📄 請求書", "⚙ 設定"];
  navItems.forEach((n, i) => {
    const nx = px + 0.25 + i * ((pw - 0.5) / 5);
    slide.addText(n, {
      x: nx, y: py + ph - 0.72, w: (pw - 0.5) / 5, h: 0.5,
      align: "center", valign: "middle", fontSize: 7, fontFace: "Meiryo",
      color: i === 1 ? C.primary : C.gray600,
      bold: i === 1,
    });
  });
}

// ════════════════════════════════════════════
// SLIDE 6: 銀行連携
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();
  sectionLabel(slide, "銀 行 連 携");
  heading(slide, [
    { text: "2,500+", options: { color: C.primaryLight, fontSize: 36 } },
    { text: "の金融機関と自動連携", options: { color: C.white } },
  ]);

  slide.addText(
    "Moneytree LINK・マネーフォワード・Zaimの3つの口座アグリゲーション\nサービスに対応。銀行明細を自動取得し、AI照合で仕訳を効率化。",
    { x: 0.8, y: 2.0, w: 7, h: 0.8, fontSize: 13, fontFace: "Meiryo", color: "AAAAAA", lineSpacingMultiple: 1.6 }
  );

  // Provider cards
  const providers = [
    { abbr: "M", name: "Moneytree LINK", desc: "2,500+金融機関対応", color: C.primary },
    { abbr: "MF", name: "マネーフォワード クラウド", desc: "主要銀行対応", color: C.slatePurple },
    { abbr: "Z", name: "Zaim", desc: "家計簿連携", color: C.accent },
  ];

  cardRect(slide, 0.8, 3.0, 5.5, 3.6);
  slide.addText("対応アグリゲーション", { x: 1.2, y: 3.2, w: 4, h: 0.5, fontSize: 16, bold: true, fontFace: "Meiryo", color: C.white });
  providers.forEach((p, i) => {
    const y = 3.9 + i * 0.9;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.2, y, w: 0.6, h: 0.6, rectRadius: 0.1,
      fill: { color: p.color },
    });
    slide.addText(p.abbr, { x: 1.2, y, w: 0.6, h: 0.6, align: "center", valign: "middle", fontSize: 12, bold: true, color: C.white });
    slide.addText(p.name, { x: 2.1, y, w: 3, h: 0.35, fontSize: 13, bold: true, fontFace: "Meiryo", color: C.white });
    slide.addText(p.desc, { x: 2.1, y: y + 0.3, w: 3, h: 0.25, fontSize: 10, fontFace: "Meiryo", color: "888888" });
  });

  // Features card
  cardRect(slide, 6.8, 3.0, 5.7, 3.6);
  slide.addText("主な機能", { x: 7.2, y: 3.2, w: 4, h: 0.5, fontSize: 16, bold: true, fontFace: "Meiryo", color: C.white });

  const bankFeats = ["銀行明細の自動取得", "AIによる勘定科目推定", "CSV一括インポート", "口座別フィルター表示", "同期間隔の柔軟設定"];
  bankFeats.forEach((f, i) => {
    const y = 3.9 + i * 0.55;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 7.2, y: y + 0.05, w: 0.3, h: 0.3,
      fill: { color: C.primary },
    });
    slide.addText("✓", { x: 7.2, y: y + 0.02, w: 0.3, h: 0.3, align: "center", valign: "middle", fontSize: 10, bold: true, color: C.white });
    slide.addText(f, { x: 7.7, y, w: 4, h: 0.4, fontSize: 13, fontFace: "Meiryo", color: C.white, valign: "middle" });
  });
}

// ════════════════════════════════════════════
// SLIDE 7: 会計機能
// ════════════════════════════════════════════
{
  const slide = addLightSlide();
  sectionLabel(slide, "会 計 機 能", { color: C.primary });
  heading(slide, [
    { text: "本格的な", options: { color: C.gray800 } },
    { text: "会計機能", options: { color: C.primary } },
    { text: "をフル装備", options: { color: C.gray800 } },
  ], { color: C.gray800 });

  const features = [
    { icon: "📊", title: "財務諸表", desc: "残高試算表・B/S・P/L・\n月次推移表を自動生成" },
    { icon: "📒", title: "帳簿 6種", desc: "仕訳帳〜買掛帳まで\nCSV出力対応" },
    { icon: "🏢", title: "固定資産管理", desc: "定額法・定率法の\n減価償却を自動計算" },
    { icon: "🔒", title: "決算処理", desc: "4ステップワークフロー\n年度ロック機能" },
    { icon: "💰", title: "消費税計算", desc: "本則・簡易課税対応\nインボイス経過措置内蔵" },
    { icon: "💳", title: "入金消込", desc: "自動マッチング提案\n消込履歴を完全記録" },
    { icon: "📄", title: "請求書管理", desc: "Raqto受発注から自動取込\n支払期限アラート" },
    { icon: "👥", title: "取引先管理", desc: "インボイス登録番号管理\n適格事業者を一目で確認" },
  ];

  features.forEach((f, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.8 + col * 3.1;
    const y = 2.2 + row * 2.5;

    lightCard(slide, x, y, 2.75, 2.1);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.25, y: y + 0.25, w: 0.6, h: 0.6, rectRadius: 0.12,
      fill: { color: C.primary, transparency: 88 },
    });
    slide.addText(f.icon, { x: x + 0.25, y: y + 0.25, w: 0.6, h: 0.6, align: "center", valign: "middle", fontSize: 20 });
    slide.addText(f.title, { x: x + 0.25, y: y + 1.0, w: 2.3, h: 0.35, fontSize: 14, bold: true, fontFace: "Meiryo", color: C.gray800 });
    slide.addText(f.desc, { x: x + 0.25, y: y + 1.35, w: 2.3, h: 0.6, fontSize: 10, fontFace: "Meiryo", color: C.gray600, lineSpacingMultiple: 1.4 });
  });
}

// ════════════════════════════════════════════
// SLIDE 8: インボイス制度対応
// ════════════════════════════════════════════
{
  const slide = addGreenSlide();
  sectionLabel(slide, "インボイス制度対応", { x: 0, y: 0.5, color: C.cream });

  slide.addText([
    { text: "インボイス制度", options: { color: C.cream, fontSize: 36, bold: true, fontFace: "Meiryo" } },
    { text: "にフル対応", options: { color: C.white, fontSize: 36, bold: true, fontFace: "Meiryo" } },
  ], { x: 0, y: 1.0, w: 13.33, h: 0.8, align: "center" });

  slide.addText(
    "適格請求書の登録番号管理から経過措置の税率計算まで、\n制度対応に必要なすべてを標準搭載しています。",
    { x: 2, y: 2.0, w: 9.33, h: 0.7, align: "center", fontSize: 14, fontFace: "Meiryo", color: "DDEECC", lineSpacingMultiple: 1.6 }
  );

  const items = [
    { stat: "T+13", unit: "桁", desc: "登録番号管理", detail: "取引先ごとにインボイス登録番号\nを記録。適格発行事業者かを即時確認。" },
    { stat: "80→50→0", unit: "%", desc: "経過措置テーブル", detail: "2023〜2029年の経過措置期間の\n仕入税額控除率を自動計算。" },
    { stat: "自動", unit: "", desc: "税区分判定", detail: "登録番号の有無からAIが税区分を\n自動判定。課税/非課税/免税を分類。" },
  ];

  items.forEach((item, i) => {
    const x = 0.8 + i * 4.0;
    greenCard(slide, x, 3.2, 3.6, 3.5);
    slide.addText(item.stat, { x, y: 3.5, w: 3.6, h: 0.8, align: "center", fontSize: 36, bold: true, fontFace: "Meiryo", color: C.cream });
    slide.addText(item.unit + " " + item.desc, { x, y: 4.3, w: 3.6, h: 0.35, align: "center", fontSize: 12, fontFace: "Meiryo", color: "BBCCAA" });
    slide.addText(item.detail, { x: x + 0.3, y: 4.9, w: 3.0, h: 1.2, align: "center", fontSize: 11, fontFace: "Meiryo", color: "DDDDDD", lineSpacingMultiple: 1.5 });
  });
}

// ════════════════════════════════════════════
// SLIDE 9: ダッシュボード
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();
  sectionLabel(slide, "ダッシュボード");
  heading(slide, [
    { text: "3つの画面", options: { color: C.primaryLight } },
    { text: "で全員の業務を最適化", options: { color: C.white } },
  ]);

  const dashboards = [
    { icon: "👑", title: "管理者", desc: "全事務所の顧問先数を俯瞰。\n新規事務所の追加もワンクリック。" },
    { icon: "📈", title: "スタッフ", desc: "顧問先ごとの進捗バーで\n「順調」「確認待ち」「要対応」\nを一目で把握。ウィジェット\nカスタマイズ可能。" },
    { icon: "📱", title: "顧問先", desc: "未確認領収書・AI仕訳確認待ち・\n未回答質問をカード表示。\n次にやることが一目瞭然。" },
  ];

  dashboards.forEach((d, i) => {
    const x = 0.8 + i * 4.0;
    cardRect(slide, x, 2.2, 3.6, 3.2);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.3, y: 2.5, w: 0.7, h: 0.7, rectRadius: 0.15,
      fill: { color: C.primary },
    });
    slide.addText(d.icon, { x: x + 0.3, y: 2.5, w: 0.7, h: 0.7, align: "center", valign: "middle", fontSize: 22 });
    slide.addText(d.title + "ダッシュボード", { x: x + 0.3, y: 3.4, w: 3.0, h: 0.4, fontSize: 15, bold: true, fontFace: "Meiryo", color: C.white });
    slide.addText(d.desc, { x: x + 0.3, y: 3.9, w: 3.0, h: 1.3, fontSize: 11, fontFace: "Meiryo", color: "AAAAAA", lineSpacingMultiple: 1.5 });
  });

  // Widget highlight
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 5.8, w: 11.73, h: 0.9,
    fill: { color: C.accent, transparency: 85 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8, y: 5.8, w: 0.06, h: 0.9,
    fill: { color: C.accent },
  });
  slide.addText(
    "🧩 ウィジェットで自分好みに ── 税務カレンダー / 口座残高サマリー / 請求書ステータス / AI仕訳レビュー の4種類から選んで配置。",
    { x: 1.1, y: 5.8, w: 11.2, h: 0.9, fontSize: 12, fontFace: "Meiryo", color: "CCCCCC", valign: "middle" }
  );
}

// ════════════════════════════════════════════
// SLIDE 10: Raqto受発注連携
// ════════════════════════════════════════════
{
  const slide = addCreamSlide();
  sectionLabel(slide, "Raqto 連 携", { color: C.primary });
  heading(slide, [
    { text: "Raqto受発注", options: { color: C.primary } },
    { text: "との完全連携", options: { color: C.gray800 } },
  ], { color: C.gray800, x: 0, w: 13.33 });
  // Center align heading
  slide.addText(
    "Raqto受発注システムとワンクリックで連携。\n受注データ・取引先情報・請求書を自動取込し、二重入力を完全に排除。",
    { x: 2, y: 2.0, w: 9.33, h: 0.7, align: "center", fontSize: 14, fontFace: "Meiryo", color: C.gray600, lineSpacingMultiple: 1.6 }
  );

  // Flow
  const flowSteps = [
    { icon: "📦", label: "Raqto受発注", desc: "受注・発注管理" },
    { icon: "🔗", label: "自動同期", desc: "メールで紐付け" },
    { icon: "📒", label: "Raqto会計", desc: "仕訳・会計処理" },
  ];
  flowSteps.forEach((s, i) => {
    const x = 1.8 + i * 3.8;
    lightCard(slide, x, 3.3, 3.2, 1.8);
    slide.addText(s.icon, { x, y: 3.4, w: 3.2, h: 0.6, align: "center", fontSize: 28 });
    slide.addText(s.label, { x, y: 4.0, w: 3.2, h: 0.4, align: "center", fontSize: 14, bold: true, fontFace: "Meiryo", color: C.gray800 });
    slide.addText(s.desc, { x, y: 4.4, w: 3.2, h: 0.35, align: "center", fontSize: 10, fontFace: "Meiryo", color: C.gray600 });
    if (i < 2) {
      slide.addText("⇄", { x: x + 3.2, y: 3.8, w: 0.6, h: 0.6, align: "center", fontSize: 22, bold: true, color: C.primary });
    }
  });

  // Bottom stats
  const stats = [
    { label: "取引先", desc: "自動インポート" },
    { label: "請求書", desc: "自動取込" },
    { label: "登録番号", desc: "自動連携" },
  ];
  stats.forEach((s, i) => {
    const x = 2.5 + i * 3.2;
    slide.addText(s.label, { x, y: 5.7, w: 2.5, h: 0.5, align: "center", fontSize: 24, bold: true, fontFace: "Meiryo", color: C.primary });
    slide.addText(s.desc, { x, y: 6.2, w: 2.5, h: 0.35, align: "center", fontSize: 12, fontFace: "Meiryo", color: C.gray600 });
  });
}

// ════════════════════════════════════════════
// SLIDE 11: 比較表
// ════════════════════════════════════════════
{
  const slide = addCreamSlide();
  sectionLabel(slide, "比  較", { color: C.primary });
  heading(slide, [
    { text: "従来のやり方 vs ", options: { color: C.gray800 } },
    { text: "Raqto会計", options: { color: C.primary } },
  ], { color: C.gray800, h: 0.7 });

  const tableX = 0.8, tableY = 2.1;
  const colW = [3.8, 3.8, 4.13];
  const rows = [
    ["業務", "従来の方法", "Raqto会計（AI）"],
    ["領収書の入力", "手入力（1枚あたり2〜3分）", "📸 撮影 → AIが自動入力（数秒）"],
    ["仕訳の作成", "勘定科目を手動判断", "🧠 AIが科目を自動提案 → 承認"],
    ["銀行明細の処理", "CSV → 手動照合", "🏦 自動取得 → AI照合 → ワンクリック"],
    ["顧問先への確認", "メール・電話・FAXで都度連絡", "💬 ポータル内チャットで一元管理"],
    ["領収書の受け渡し", "月1回まとめて郵送 or 持参", "📱 発生都度スマホで撮影・即送信"],
    ["インボイス確認", "手動で登録番号を確認・記録", "✅ 登録番号から自動判定"],
    ["受発注データ連携", "別システムから手動で転記", "🔗 Raqto受発注から自動取込"],
  ];

  rows.forEach((row, ri) => {
    const y = tableY + ri * 0.62;
    row.forEach((cell, ci) => {
      const x = tableX + colW.slice(0, ci).reduce((a, b) => a + b, 0);
      // Background
      if (ri === 0) {
        slide.addShape(pptx.ShapeType.rect, {
          x, y, w: colW[ci], h: 0.58,
          fill: { color: C.primary },
        });
      } else if (ri % 2 === 0) {
        slide.addShape(pptx.ShapeType.rect, {
          x, y, w: colW[ci], h: 0.58,
          fill: { color: C.white },
        });
      } else {
        slide.addShape(pptx.ShapeType.rect, {
          x, y, w: colW[ci], h: 0.58,
          fill: { color: "F0EDB8" },
        });
      }
      slide.addText(cell, {
        x: x + 0.15, y, w: colW[ci] - 0.3, h: 0.58,
        fontSize: ri === 0 ? 11 : 10,
        bold: ri === 0 || ci === 2,
        fontFace: "Meiryo",
        color: ri === 0 ? C.white : ci === 2 ? C.primary : ci === 1 ? "888888" : C.gray800,
        valign: "middle",
      });
    });
  });
}

// ════════════════════════════════════════════
// SLIDE 12: 導入効果
// ════════════════════════════════════════════
{
  const slide = addDarkSlide();
  sectionLabel(slide, "導 入 効 果");
  heading(slide, [
    { text: "Raqto会計が実現する", options: { color: C.white } },
    { text: "業務効率化", options: { color: C.primaryLight } },
  ]);

  const effects = [
    { num: "90%", label: "手入力作業の削減", desc: "AI-OCR＋AI仕訳で、\n手入力はほぼゼロに" },
    { num: "24h", label: "リアルタイム連携", desc: "月1回の郵送待ちから、\n発生都度のリアルタイム処理へ" },
    { num: "0円", label: "顧問先の追加コスト", desc: "アプリ不要。ブラウザで\nすぐ使えるポータル" },
  ];

  effects.forEach((e, i) => {
    const x = 0.8 + i * 4.0;
    cardRect(slide, x, 2.4, 3.6, 3.8);
    slide.addText(e.num, { x, y: 2.8, w: 3.6, h: 1.0, align: "center", fontSize: 48, bold: true, fontFace: "Meiryo", color: C.primaryLight });
    slide.addText(e.label, { x, y: 3.8, w: 3.6, h: 0.4, align: "center", fontSize: 15, fontFace: "Meiryo", color: C.white });
    slide.addText(e.desc, { x, y: 4.5, w: 3.6, h: 1.0, align: "center", fontSize: 12, fontFace: "Meiryo", color: "AAAAAA", lineSpacingMultiple: 1.5 });
  });
}

// ════════════════════════════════════════════
// SLIDE 13: セキュリティ
// ════════════════════════════════════════════
{
  const slide = addLightSlide();
  sectionLabel(slide, "安心の基盤", { color: C.primary });
  heading(slide, [
    { text: "セキュリティと", options: { color: C.gray800 } },
    { text: "マルチテナント", options: { color: C.primary } },
    { text: "設計", options: { color: C.gray800 } },
  ], { color: C.gray800 });

  // Security card
  lightCard(slide, 0.8, 2.4, 5.6, 4.2);
  slide.addText("セキュリティ", { x: 1.2, y: 2.7, w: 4, h: 0.4, fontSize: 18, bold: true, fontFace: "Meiryo", color: C.gray800 });
  const secItems = [
    "Supabaseによるメール＋パスワード認証",
    "ロールベースアクセス制御（3段階）",
    "APIキーのマスキング表示",
    "年度ロックによるデータ保護",
  ];
  secItems.forEach((s, i) => {
    const y = 3.3 + i * 0.6;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 1.3, y: y + 0.05, w: 0.3, h: 0.3,
      fill: { color: C.primary },
    });
    slide.addText("✓", { x: 1.3, y: y + 0.02, w: 0.3, h: 0.3, align: "center", valign: "middle", fontSize: 10, bold: true, color: C.white });
    slide.addText(s, { x: 1.8, y, w: 4.2, h: 0.4, fontSize: 13, fontFace: "Meiryo", color: C.gray800, valign: "middle" });
  });

  // Architecture card
  lightCard(slide, 6.9, 2.4, 5.6, 4.2);
  slide.addText("アーキテクチャ", { x: 7.3, y: 2.7, w: 4, h: 0.4, fontSize: 18, bold: true, fontFace: "Meiryo", color: C.gray800 });
  const archItems = [
    "Next.js 16 + React 19（最新技術）",
    "マルチテナント：1つの基盤で複数事務所",
    "事務所専用URL（/portal/[firm]/）",
    "Server Actions でエンドツーエンド型安全",
  ];
  archItems.forEach((s, i) => {
    const y = 3.3 + i * 0.6;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 7.4, y: y + 0.05, w: 0.3, h: 0.3,
      fill: { color: C.primary },
    });
    slide.addText("✓", { x: 7.4, y: y + 0.02, w: 0.3, h: 0.3, align: "center", valign: "middle", fontSize: 10, bold: true, color: C.white });
    slide.addText(s, { x: 7.9, y, w: 4.2, h: 0.4, fontSize: 13, fontFace: "Meiryo", color: C.gray800, valign: "middle" });
  });
}

// ════════════════════════════════════════════
// SLIDE 14: CTA
// ════════════════════════════════════════════
{
  const slide = pptx.addSlide({
    bkgd: { fill: C.primaryDark },
  });

  // Logo
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 5.9, y: 0.7, w: 1.1, h: 1.1,
    rectRadius: 0.2,
    fill: { color: C.primary },
    shadow: { type: "outer", blur: 12, offset: 4, color: C.primary, opacity: 0.4 },
  });
  slide.addText("📖", { x: 5.9, y: 0.75, w: 1.1, h: 1.1, align: "center", valign: "middle", fontSize: 36 });

  // CTA box
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 3.2, y: 2.3, w: 7, h: 4.0,
    rectRadius: 0.25,
    fill: { color: C.white, transparency: 90 },
    line: { color: C.white, width: 1, transparency: 75 },
  });

  slide.addText("AI会計の新時代を、\n一緒に始めませんか？", {
    x: 3.2, y: 2.6, w: 7, h: 1.2,
    align: "center", fontSize: 26, bold: true, fontFace: "Meiryo", color: C.white, lineSpacingMultiple: 1.3,
  });

  slide.addText("まずは無料デモで、Raqto会計の\nすべての機能をお試しください。", {
    x: 3.2, y: 3.8, w: 7, h: 0.8,
    align: "center", fontSize: 14, fontFace: "Meiryo", color: "BBBBBB", lineSpacingMultiple: 1.6,
  });

  // CTA button
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 4.8, y: 4.9, w: 3.8, h: 0.8,
    rectRadius: 0.12,
    fill: { color: C.primaryLight },
    shadow: { type: "outer", blur: 8, offset: 3, color: C.accent, opacity: 0.4 },
  });
  slide.addText("無料デモを申し込む", {
    x: 4.8, y: 4.9, w: 3.8, h: 0.8,
    align: "center", valign: "middle", fontSize: 16, bold: true, fontFace: "Meiryo", color: C.white,
  });

  // Footer
  slide.addText("Raqto会計（AIバージョン）── レシート撮影から仕訳完了まで、AIにおまかせ。", {
    x: 0, y: 6.5, w: 13.33, h: 0.5,
    align: "center", fontSize: 11, fontFace: "Meiryo", color: "666666",
  });
}

// ─── 出力 ───
const outputPath = "public/Raqto会計_営業資料.pptx";
await pptx.writeFile({ fileName: outputPath });
console.log(`✅ PowerPointファイルを生成しました: ${outputPath}`);
