/**
 * 通帳や入金明細に載る相手先名を、登録済みの相手先に突き合わせる。
 *
 * 通帳の表記は「振込 アンドウ レン」「ｱﾝﾄﾞｳ ﾚﾝ」「カ)オオサカブヒン」のように
 * 揺れる。登録名（「検証用社長」「株式会社大阪部品」）とは普通一致しないため、
 * 別名（aliases）を登録して結び付ける。
 *
 * 借入金台帳の相手先と取引先マスタの両方から使う。別名を機能ごとに
 * 登録し直させると二度手間になるので、突き合わせの規則は1箇所に置く。
 *
 * 突き合わせは決定的に行う。AIに名寄せさせると、似た名前の別人に
 * 紐付けても理由が説明できず、後から検証もできない。
 */

/** 名前と別名を持つもの。借入金台帳の相手先・取引先マスタのどちらも当てはまる */
export type NamedCounterparty = {
  name: string;
  /** 通帳での表記。登録名と違う書かれ方をするときに登録する */
  aliases?: string[] | null;
};

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
export function matchesCounterparty(read: string, target: NamedCounterparty): boolean {
  const a = normalizeName(read);
  if (!a) return false;

  const candidates = [target.name, ...(target.aliases ?? [])];
  return candidates.some((c) => {
    const b = normalizeName(c);
    if (!b) return false;
    return a === b || a.includes(b) || b.includes(a);
  });
}

/**
 * 読み取った名前に当てはまる相手先を選ぶ。
 * 完全一致を優先し、無ければ部分一致。複数当てはまる場合は先頭を返す。
 *
 * 一致の強さも返すのは、呼び出し側で確信度として扱えるようにするため。
 * 部分一致は別人を拾うことがあるので、完全一致と同じ扱いにはできない。
 */
export function findCounterparty<T extends NamedCounterparty>(
  read: string,
  list: T[]
): T | null {
  return findCounterpartyWithKind(read, list).match;
}

export function findCounterpartyWithKind<T extends NamedCounterparty>(
  read: string,
  list: T[]
): { match: T | null; kind: "exact" | "partial" | "none" } {
  const a = normalizeName(read);
  if (!a) return { match: null, kind: "none" };

  const exact = list.find((l) =>
    [l.name, ...(l.aliases ?? [])].some((c) => normalizeName(c) === a)
  );
  if (exact) return { match: exact, kind: "exact" };

  const partial = list.find((l) => matchesCounterparty(read, l));
  return partial ? { match: partial, kind: "partial" } : { match: null, kind: "none" };
}
