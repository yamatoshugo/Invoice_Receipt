/**
 * 銀行営業日の判定
 *
 * 総合振込の「取組日」は銀行営業日でなければ受け付けられないため、
 * 土日・国民の祝日・振替休日・国民の休日・年末年始を除外する。
 *
 * 祝日は外部データに依存せず計算する（春分/秋分の近似式の有効範囲は 1980〜2099年）。
 */

const YEAR_MIN = 1980;
const YEAR_MAX = 2099;

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** その月の第n月曜日の日付 */
function nthMonday(year: number, month: number, nth: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=日
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (nth - 1) * 7;
}

/** 春分の日（近似式） */
function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分の日（近似式） */
function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

const holidayCache = new Map<number, Set<string>>();

/** 指定年の国民の祝日・振替休日・国民の休日の集合（YYYY-MM-DD） */
export function holidaysOf(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  // 固定日・ハッピーマンデー・春分秋分
  const base: string[] = [
    ymd(year, 1, 1), // 元日
    ymd(year, 1, nthMonday(year, 1, 2)), // 成人の日
    ymd(year, 2, 11), // 建国記念の日
    ymd(year, 2, 23), // 天皇誕生日
    ymd(year, 3, vernalEquinox(year)), // 春分の日
    ymd(year, 4, 29), // 昭和の日
    ymd(year, 5, 3), // 憲法記念日
    ymd(year, 5, 4), // みどりの日
    ymd(year, 5, 5), // こどもの日
    ymd(year, 7, nthMonday(year, 7, 3)), // 海の日
    ymd(year, 8, 11), // 山の日
    ymd(year, 9, nthMonday(year, 9, 3)), // 敬老の日
    ymd(year, 9, autumnalEquinox(year)), // 秋分の日
    ymd(year, 10, nthMonday(year, 10, 2)), // スポーツの日
    ymd(year, 11, 3), // 文化の日
    ymd(year, 11, 23), // 勤労感謝の日
  ];

  const set = new Set(base);

  // 振替休日: 日曜と重なった祝日は、直後の平日へ振り替える
  for (const day of base) {
    const d = new Date(`${day}T00:00:00Z`);
    if (d.getUTCDay() !== 0) continue;
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (set.has(d.toISOString().slice(0, 10)));
    set.add(d.toISOString().slice(0, 10));
  }

  // 国民の休日: 祝日に挟まれた平日（敬老の日と秋分の日の間に発生しうる）
  for (const day of [...set]) {
    const gap = new Date(`${day}T00:00:00Z`);
    gap.setUTCDate(gap.getUTCDate() + 1);
    const after = new Date(gap);
    after.setUTCDate(after.getUTCDate() + 1);

    const gapKey = gap.toISOString().slice(0, 10);
    const gapDow = gap.getUTCDay();
    const sandwiched = set.has(after.toISOString().slice(0, 10));

    if (!set.has(gapKey) && sandwiched && gapDow !== 0 && gapDow !== 6) {
      set.add(gapKey);
    }
  }

  holidayCache.set(year, set);
  return set;
}

/** 銀行の休業日（土日・祝日・振替休日・年末年始 12/31〜1/3） */
export function isBankHoliday(date: Date): boolean {
  const year = date.getFullYear();
  if (year < YEAR_MIN || year > YEAR_MAX) {
    throw new RangeError(`祝日を判定できる年の範囲外です: ${year}`);
  }

  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month === 12 && day === 31) return true;
  if (month === 1 && day <= 3) return true;

  return holidaysOf(year).has(ymd(year, month, day));
}

export function isBankBusinessDay(date: Date): boolean {
  return !isBankHoliday(date);
}

/** 指定日以降（当日を含む）で最初の銀行営業日 */
export function nextBankBusinessDay(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 30; i += 1) {
    if (isBankBusinessDay(d)) return d;
    d.setDate(d.getDate() + 1);
  }
  throw new Error("30日以内に銀行営業日が見つかりませんでした");
}

/** 取組日のCSV表記（MMDD） */
export function toMMDD(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
