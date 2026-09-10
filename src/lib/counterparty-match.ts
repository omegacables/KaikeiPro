/**
 * 通帳に載る相手先名と、台帳の相手先を突き合わせる。
 *
 * 通帳の表記は「振込 アンドウ レン」「ｱﾝﾄﾞｳ ﾚﾝ」「カ)オオサカブヒン」のように
 * 揺れる。台帳の名前（「検証用社長」）とは普通一致しないため、
 * 別名（aliases）を登録して結び付ける。
 *
 * 突き合わせは決定的に行う。AIに名寄せさせると、似た名前の別人に
 * 紐付けても理由が説明できず、後から検証もできない。
 */

/** 全角英数字・カタカナを半角に、記号や空白を落として比べられる形にする */
export function normalizeName(v: string): string {
  return (
    v
      // 全角英数字 → 半角
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // 半角カタカナ → 全角（濁点は結合されたまま扱う）
      .normalize("NFKC")
      .toLowerCase()
      // 通帳でよく付く語や記号を落とす
      .replace(/振込|振替|入金|出金|フリコミ|ﾌﾘｺﾐ/g, "")
      .replace(/株式会社|有限会社|合同会社|（株）|\(株\)|カ\)|ｶ\)|㈱|㈲/g, "")
      .replace(/[\s　・.,，、\-－ー_/\\()（）]/g, "")
  );
}

/**
 * 読み取った名前が、その台帳のものかを判定する。
 * 名前そのものと別名のいずれかに、正規化したうえで含まれ合えば一致とみなす。
 */
export function matchesCounterparty(
  read: string,
  loan: { lender_name: string; aliases?: string[] | null }
): boolean {
  const a = normalizeName(read);
  if (!a) return false;

  const candidates = [loan.lender_name, ...(loan.aliases ?? [])];
  return candidates.some((c) => {
    const b = normalizeName(c);
    if (!b) return false;
    return a === b || a.includes(b) || b.includes(a);
  });
}

/**
 * 読み取った名前に当てはまる台帳を選ぶ。
 * 完全一致を優先し、無ければ部分一致。複数当てはまる場合は先頭を返す。
 */
export function findCounterparty<T extends { lender_name: string; aliases?: string[] | null }>(
  read: string,
  loans: T[]
): T | null {
  const a = normalizeName(read);
  if (!a) return null;

  const exact = loans.find((l) =>
    [l.lender_name, ...(l.aliases ?? [])].some((c) => normalizeName(c) === a)
  );
  if (exact) return exact;

  return loans.find((l) => matchesCounterparty(read, l)) ?? null;
}
