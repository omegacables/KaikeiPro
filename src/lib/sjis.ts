/**
 * Shift_JIS への変換（e-Tax の CSV 用）。サーバーでだけ使う。
 *
 * 外部の部品を足さず、実行環境の TextDecoder（Shift_JIS を読める）で2バイト文字を一度ずつ読み、
 * 「文字 → バイト列」の対応表を作る。対象は e-Tax が認める JIS X 0208（第1・第2水準と記号）の範囲だけ。
 * NEC特殊文字（0x87）・IBM拡張文字（0xED〜0xEE・0xFA〜0xFC）は含めない（①・㈱・髙 などは使えない）。
 */

let table: Map<string, number[]> | null = null;

function buildTable(): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  // 1バイト: ASCII（0x20〜0x7E）と半角カナ（0xA1〜0xDF）
  for (let b = 0x20; b <= 0x7e; b++) map.set(String.fromCharCode(b), [b]);
  for (let b = 0xa1; b <= 0xdf; b++) {
    try {
      map.set(decoder.decode(new Uint8Array([b])), [b]);
    } catch {
      /* 対応なし */
    }
  }
  // 2バイト: JIS X 0208 の範囲
  const leads = [...range(0x81, 0x84), ...range(0x88, 0x9f), ...range(0xe0, 0xea)];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      try {
        const ch = decoder.decode(new Uint8Array([lead, trail]));
        if (ch.length === 1 && ch !== "�" && !map.has(ch)) map.set(ch, [lead, trail]);
      } catch {
        /* 未定義の位置 */
      }
    }
  }
  return map;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Shift_JIS（JIS X 0208 の範囲）で表せる文字か */
export function isSjisEncodable(ch: string): boolean {
  table ??= buildTable();
  return ch === "\r" || ch === "\n" || table.has(ch);
}

/** Shift_JIS に変換する。表せない文字は「〓」にして、その文字を返す */
export function encodeSjis(text: string): { bytes: Uint8Array; unsupported: string[] } {
  table ??= buildTable();
  const out: number[] = [];
  const unsupported = new Set<string>();
  for (const ch of text) {
    if (ch === "\r" || ch === "\n") {
      out.push(ch.charCodeAt(0));
      continue;
    }
    const b = table.get(ch);
    if (b) out.push(...b);
    else {
      unsupported.add(ch);
      out.push(...table.get("〓")!);
    }
  }
  return { bytes: Uint8Array.from(out), unsupported: [...unsupported] };
}
