// 日本の国民の祝日（2021年以降の法令に準拠）と、税務の期限計算で使う営業日判定。
// 期限が土日・祝日・年末年始（税務署閉庁: 12/29〜1/3）に当たる場合は翌営業日に繰り延べる。

function key(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}`;
}
function keyOf(d: Date): string {
  return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// 春分の日・秋分の日（1980〜2099年で有効な近似式）
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 指定月の第n月曜の「日」
function nthMonday(year: number, month: number, nth: number): number {
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=日
  const offsetToMonday = (1 - firstDow + 7) % 7;
  return 1 + offsetToMonday + (nth - 1) * 7;
}

// その年の基本の祝日（振替・国民の休日を除く）
function baseHolidays(year: number): Set<string> {
  const set = new Set<string>();
  const add = (m: number, d: number) => set.add(key(year, m, d));
  add(1, 1); // 元日
  add(1, nthMonday(year, 1, 2)); // 成人の日
  add(2, 11); // 建国記念の日
  add(2, 23); // 天皇誕生日
  add(3, vernalEquinoxDay(year)); // 春分の日
  add(4, 29); // 昭和の日
  add(5, 3); // 憲法記念日
  add(5, 4); // みどりの日
  add(5, 5); // こどもの日
  add(7, nthMonday(year, 7, 3)); // 海の日
  add(8, 11); // 山の日
  add(9, nthMonday(year, 9, 3)); // 敬老の日
  add(9, autumnalEquinoxDay(year)); // 秋分の日
  add(10, nthMonday(year, 10, 2)); // スポーツの日
  add(11, 3); // 文化の日
  add(11, 23); // 勤労感謝の日
  return set;
}

const holidayCache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const result = new Set(baseHolidays(year));

  // 振替休日: 祝日が日曜なら、翌日以降の最初の非祝日を休日にする
  for (const k of [...result]) {
    const [y, m, d] = k.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() === 0) {
      const sub = new Date(date);
      do {
        sub.setDate(sub.getDate() + 1);
      } while (result.has(keyOf(sub)));
      result.add(keyOf(sub));
    }
  }

  // 国民の休日: 前日・翌日がともに祝日の平日（日曜を除く）
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || result.has(keyOf(d))) continue;
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    if (result.has(keyOf(prev)) && result.has(keyOf(next))) {
      result.add(keyOf(d));
    }
  }

  holidayCache.set(year, result);
  return result;
}

export function isHoliday(date: Date): boolean {
  return holidaysForYear(date.getFullYear()).has(keyOf(date));
}

// 年末年始の税務署閉庁日: 12/29〜1/3
function isTaxOfficeClosed(date: Date): boolean {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return (m === 12 && d >= 29) || (m === 1 && d <= 3);
}

export function isBusinessDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false; // 土日
  if (isHoliday(date)) return false;
  if (isTaxOfficeClosed(date)) return false;
  return true;
}

// 期限が非営業日なら翌営業日へ繰り延べた Date を返す（元日付は破壊しない）
export function deferToBusinessDay(date: Date): Date {
  const d = new Date(date);
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}
