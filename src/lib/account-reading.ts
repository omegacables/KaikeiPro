// 勘定科目の読み仮名（よみがな）辞書とローマ字変換。
// 「げんきん」「g」など、ひらがな／ローマ字の頭文字でも科目を検索できるようにするために使う。
// 標準（デフォルト）勘定科目を網羅。カスタム科目はここに追記すれば読み検索に対応できる。

export const ACCOUNT_READINGS: Record<string, string> = {
  // 資産
  現金: "げんきん",
  普通預金: "ふつうよきん",
  当座預金: "とうざよきん",
  売掛金: "うりかけきん",
  受取手形: "うけとりてがた",
  棚卸資産: "たなおろししさん",
  商品: "しょうひん",
  製品: "せいひん",
  仕掛品: "しかかりひん",
  原材料: "げんざいりょう",
  貯蔵品: "ちょぞうひん",
  前払費用: "まえばらいひよう",
  建物: "たてもの",
  車両運搬具: "しゃりょううんぱんぐ",
  器具備品: "きぐびひん",
  ソフトウェア: "そふとうえあ",
  仮払消費税: "かりばらいしょうひぜい",
  // 負債
  買掛金: "かいかけきん",
  支払手形: "しはらいてがた",
  短期借入金: "たんきかりいれきん",
  未払金: "みばらいきん",
  未払費用: "みばらいひよう",
  預り金: "あずかりきん",
  仮受消費税: "かりうけしょうひぜい",
  長期借入金: "ちょうきかりいれきん",
  // 純資産
  資本金: "しほんきん",
  資本剰余金: "しほんじょうよきん",
  利益剰余金: "りえきじょうよきん",
  繰越利益剰余金: "くりこしりえきじょうよきん",
  // 収益
  売上高: "うりあげだか",
  受取利息: "うけとりりそく",
  受取配当金: "うけとりはいとうきん",
  雑収入: "ざつしゅうにゅう",
  // 費用
  仕入高: "しいれだか",
  給料手当: "きゅうりょうてあて",
  法定福利費: "ほうていふくりひ",
  福利厚生費: "ふくりこうせいひ",
  旅費交通費: "りょひこうつうひ",
  通信費: "つうしんひ",
  消耗品費: "しょうもうひんひ",
  水道光熱費: "すいどうこうねつひ",
  地代家賃: "ちだいやちん",
  減価償却費: "げんかしょうきゃくひ",
  支払利息: "しはらいりそく",
  租税公課: "そぜいこうか",
  接待交際費: "せったいこうさいひ",
  会議費: "かいぎひ",
  新聞図書費: "しんぶんとしょひ",
};

const YOUON: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
};

// ひらがな → ローマ字（ヘボン式・簡易）。検索の前方一致用なので厳密でなくてよい。
export function hiraganaToRomaji(input: string): string {
  let out = "";
  const s = input;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const two = s.slice(i, i + 2);
    if (YOUON[two]) {
      out += YOUON[two];
      i++;
      continue;
    }
    if (ch === "っ") {
      // 促音: 次の子音を重ねる
      const next = s[i + 1];
      const r = next ? (YOUON[s.slice(i + 1, i + 3)] ?? KANA[next]) : "";
      if (r) out += r[0];
      continue;
    }
    if (ch === "ー") continue;
    out += KANA[ch] ?? ch;
  }
  return out;
}

// 全角数字・英字を半角に
export function toHalfWidth(v: string): string {
  return v.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 科目が検索クエリにマッチするか（コード・名前・よみ・ローマ字の前方一致）
// extraReadings: 設定画面で登録したカスタム読み（科目名→よみ）。組み込み辞書より優先。
export function matchesAccountQuery(
  query: string,
  account: { code: string; name: string; reading?: string | null },
  extraReadings?: Record<string, string>
): boolean {
  const q = toHalfWidth(query).trim().toLowerCase();
  if (!q) return true;
  if (account.code.toLowerCase().includes(q)) return true;
  if (account.name.toLowerCase().includes(q)) return true;
  const reading =
    account.reading || extraReadings?.[account.name] || ACCOUNT_READINGS[account.name] || "";
  if (reading) {
    if (reading.startsWith(q)) return true;
    if (hiraganaToRomaji(reading).startsWith(q)) return true;
  }
  return false;
}
