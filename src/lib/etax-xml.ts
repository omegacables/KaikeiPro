/**
 * e-Tax 用の申告書ファイル（.xtx、UTF-8 の XML）の共通部分。純粋関数。
 * 国税庁「e-Tax 仕様書」（データ形式等仕様書・XML構造設計書・XMLスキーマ）による。
 *
 *   DATA > 手続（RSH0020 など）> CATALOG（RDF）＋ CONTENTS（IT部＋帳票）
 *   - IT部: 提出者の情報。帳票からは IDREF で参照するだけ（帳票に同じ値を書かない）
 *   - 値の無い要素は書かない（空のタグ・空白も不可）。要素の順番はスキーマの順
 *   - 金額は符号付きの整数（カンマなし）。日付は 元号コード・年・月・日（令和=5）
 *   - 電子署名は入れない。e-Taxソフトで取り込んでから署名・送信する
 */

export const SOFT_NAME = "Raqto会計 Raqto";

/**
 * 文字の正規化: 改行・タブを除き、半角カナを全角に（スキーマが半角カナを受け付けないため）。
 * 全角の英数字などはそのまま（登録した名称の表記を変えない）
 */
export function etaxText(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/[\uFF61-\uFF9F]+/g, (k) => k.normalize("NFKC"))
    .replace(/[\r\n\t]+/g, " ")
    .trim();
}

/** フリガナ: 全角カタカナに（ひらがな・半角カナも直す） */
export function etaxKana(v: string | null | undefined): string {
  return etaxText(v).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type X = string | null | undefined | false;

/** 子要素を持つ要素。子が1つも無ければ要素ごと書かない */
export function group(tag: string, ...children: X[]): string | null {
  const body = children.filter(Boolean).join("");
  return body ? `<${tag}>${body}</${tag}>` : null;
}

/** 帳票の面（第一表・第二表など）。page 属性を付ける。中身が無ければ書かない */
export function page(tag: string, ...children: X[]): string | null {
  const body = children.filter(Boolean).join("");
  return body ? `<${tag} page="1">${body}</${tag}>` : null;
}

/** 値を持つ要素。値が空なら書かない */
export function value(tag: string, v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  return `<${tag}>${esc(String(v))}</${tag}>`;
}

/** 金額。0 と空は書かない（e-Tax では空と 0 は同じ扱い） */
export function amount(tag: string, v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v) || Math.round(v) === 0) return null;
  return `<${tag}>${Math.round(v)}</${tag}>`;
}

/** 区分（kubun_CD） */
export function kubun(tag: string, code: number | string | null | undefined): string | null {
  return code === null || code === undefined ? null : `<${tag}><kubun_CD>${code}</kubun_CD></${tag}>`;
}

/** 和暦の日付（gen:yymmdd）。2019-05-01 以後は令和（5）、それより前は平成（4） */
export function etaxDate(tag: string, iso: string, attrs = ""): string {
  const [y, m, d] = iso.split("-").map(Number);
  const reiwa = y > 2019 || (y === 2019 && m >= 5);
  const era = reiwa ? 5 : 4;
  const yy = reiwa ? y - 2018 : y - 1988;
  return `<${tag}${attrs}><gen:era>${era}</gen:era><gen:yy>${yy}</gen:yy><gen:mm>${m}</gen:mm><gen:dd>${d}</gen:dd></${tag}>`;
}

/** 電話番号を 市外局番・市内局番・番号 に分ける（ハイフンや括弧で区切られていないものは分けられないので書かない） */
export function splitTel(tel: string | null | undefined): [string, string, string] | null {
  const parts = (tel ?? "").normalize("NFKC").split(/[-‐－ー()（）\s]+/).filter(Boolean);
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const [a, b, c] = parts;
  return a.length <= 6 && b.length <= 4 && c.length <= 4 ? [a, b, c] : null;
}

export type Filer = {
  taxOfficeCode: string;
  taxOfficeName: string | null;
  etaxUserId: string;
  corporateNumber: string | null;
  name: string;
  nameKana: string | null;
  postalCode: string | null;
  address: string;
  telephone: string | null;
  representativeName: string | null;
  representativeKana: string | null;
};

/** 提出に必要な情報で足りないもの（足りなければファイルを作らない） */
export function missingFilerInfo(f: Partial<Filer>): string[] {
  const out: string[] = [];
  if (!f.taxOfficeCode) out.push("提出先の税務署");
  if (!f.etaxUserId) out.push("利用者識別番号");
  if (!f.name) out.push("会社名");
  if (!f.address) out.push("納税地（住所）");
  return out;
}

/**
 * IT部。書いた要素の ID を返す（帳票の IDREF は、ここにあるものだけを参照する）。
 * 要素の順番は general/ITdefinition.xsd の順。
 */
export function buildIT(
  f: Filer,
  p: { procedureCode: string; procedureName: string; periodFrom: string; periodTo: string; periodKind: "kazei" | "jigyo"; shinkokuKbn: number }
): { xml: string; ids: Set<string> } {
  const ids = new Set<string>();
  const it = (tag: string, inner: string | null, attrs = "") => {
    if (!inner) return null;
    ids.add(tag);
    return `<${tag} ID="${tag}"${attrs}>${inner}</${tag}>`;
  };
  const zip = (f.postalCode ?? "").normalize("NFKC").replace(/\D/g, "");
  const tel = splitTel(f.telephone);
  const kana = etaxKana(f.nameKana);
  const repName = etaxText(f.representativeName);
  const repKana = etaxKana(f.representativeKana);
  const period = (tag: string, iso: string) => {
    ids.add(tag);
    return etaxDate(tag, iso, ` ID="${tag}"`);
  };
  const from = p.periodKind === "kazei" ? "KAZEI_KIKAN_FROM" : "JIGYO_NENDO_FROM";
  const to = p.periodKind === "kazei" ? "KAZEI_KIKAN_TO" : "JIGYO_NENDO_TO";
  const parts: X[] = [
    it(
      "ZEIMUSHO",
      `<gen:zeimusho_CD>${f.taxOfficeCode}</gen:zeimusho_CD>${f.taxOfficeName ? `<gen:zeimusho_NM>${esc(f.taxOfficeName)}</gen:zeimusho_NM>` : ""}`
    ),
    it("NOZEISHA_ID", esc(f.etaxUserId)),
    f.corporateNumber && it("NOZEISHA_BANGO", `<gen:hojinbango>${f.corporateNumber}</gen:hojinbango>`),
    kana && it("NOZEISHA_NM_KN", esc(kana)),
    it("NOZEISHA_NM", esc(etaxText(f.name))),
    zip.length === 7 && it("NOZEISHA_ZIP", `<gen:zip1>${zip.slice(0, 3)}</gen:zip1><gen:zip2>${zip.slice(3)}</gen:zip2>`),
    it("NOZEISHA_ADR", esc(etaxText(f.address))),
    tel && it("NOZEISHA_TEL", `<gen:tel1>${tel[0]}</gen:tel1><gen:tel2>${tel[1]}</gen:tel2><gen:tel3>${tel[2]}</gen:tel3>`),
    repKana && it("DAIHYO_NM_KN", esc(repKana)),
    repName && it("DAIHYO_NM", esc(repName)),
    it("TETSUZUKI", `<procedure_CD>${p.procedureCode}</procedure_CD><procedure_NM>${esc(p.procedureName)}</procedure_NM>`),
    // 事業年度（法人税）は課税期間より前、課税期間・申告の種類はその後（スキーマの順）
    p.periodKind === "jigyo" && period(from, p.periodFrom),
    p.periodKind === "jigyo" && period(to, p.periodTo),
    p.periodKind === "kazei" && period(from, p.periodFrom),
    p.periodKind === "kazei" && period(to, p.periodTo),
    it("SHINKOKU_KBN", `<kubun_CD>${p.shinkokuKbn}</kubun_CD>`),
  ];
  return { xml: `<IT VR="1.5" id="IT">${parts.filter(Boolean).join("")}</IT>`, ids };
}

/** IT部を参照する空要素。IT部に無ければ書かない */
export function refTo(ids: Set<string>) {
  return (tag: string, id: string) => (ids.has(id) ? `<${tag} IDREF="${id}"/>` : null);
}

/** 帳票の外側（必須の属性: 版・作成ソフト・作成者・作成日） */
export function form(tag: string, version: string, id: string, by: { name: string; date: string }, body: string): string {
  return `<${tag} VR="${version}" id="${id}" page="1" sakuseiDay="${by.date}" sakuseiNM="${esc(etaxText(by.name))}" softNM="${SOFT_NAME}">${body}</${tag}>`;
}

/** 手続のファイル全体 */
export function procedureFile(p: {
  namespace: string;
  procedureCode: string;
  version: string;
  it: string;
  forms: { id: string; xml: string }[];
}): string {
  const catalog =
    `<CATALOG id="CATALOG"><rdf:RDF><rdf:description id="REPORT"><SEND_DATA/>` +
    `<IT_SEC><rdf:description about="#IT"/></IT_SEC>` +
    `<FORM_SEC><rdf:Seq>${p.forms.map((f) => `<rdf:li><rdf:description about="#${f.id}"/></rdf:li>`).join("")}</rdf:Seq></FORM_SEC>` +
    `<TENPU_SEC/><XBRL_SEC/><SOFUSHO_SEC/><ATTACH_SEC/></rdf:description></rdf:RDF></CATALOG>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<DATA xmlns="${p.namespace}" xmlns:gen="http://xml.e-tax.nta.go.jp/XSD/general" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" id="DATA">` +
    `<${p.procedureCode} VR="${p.version}" id="${p.procedureCode}">${catalog}` +
    `<CONTENTS id="CONTENTS">${p.it}${p.forms.map((f) => f.xml).join("")}</CONTENTS>` +
    `</${p.procedureCode}></DATA>`
  );
}
