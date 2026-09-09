import { describe, expect, it } from "vitest";
import { isBankBusinessDay, nextBankBusinessDay, toMMDD } from "./businessDay";

/** ローカルタイムの日付を作る（Dateのmonthは0始まり） */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("isBankBusinessDay", () => {
  it("平日は営業日", () => {
    expect(isBankBusinessDay(d(2025, 12, 25))).toBe(true); // 木
    expect(isBankBusinessDay(d(2026, 9, 24))).toBe(true); // 木
  });

  it("土日は休業日", () => {
    expect(isBankBusinessDay(d(2025, 12, 27))).toBe(false); // 土
    expect(isBankBusinessDay(d(2025, 12, 28))).toBe(false); // 日
  });

  it("年末年始（12/31〜1/3）は休業日", () => {
    expect(isBankBusinessDay(d(2025, 12, 31))).toBe(false);
    expect(isBankBusinessDay(d(2026, 1, 1))).toBe(false);
    expect(isBankBusinessDay(d(2026, 1, 2))).toBe(false); // 金だが銀行は休み
    expect(isBankBusinessDay(d(2026, 1, 3))).toBe(false);
  });

  it("固定日の祝日を判定できる", () => {
    expect(isBankBusinessDay(d(2026, 2, 11))).toBe(false); // 建国記念の日
    expect(isBankBusinessDay(d(2026, 2, 23))).toBe(false); // 天皇誕生日(月)
    expect(isBankBusinessDay(d(2026, 11, 3))).toBe(false); // 文化の日
  });

  it("ハッピーマンデーの祝日を判定できる", () => {
    expect(isBankBusinessDay(d(2026, 1, 12))).toBe(false); // 成人の日(1月第2月曜)
    expect(isBankBusinessDay(d(2026, 9, 21))).toBe(false); // 敬老の日(9月第3月曜)
  });

  it("春分・秋分の日を判定できる", () => {
    expect(isBankBusinessDay(d(2026, 3, 20))).toBe(false); // 春分の日
    expect(isBankBusinessDay(d(2026, 9, 23))).toBe(false); // 秋分の日
  });

  it("振替休日を判定できる", () => {
    // 2026-05-03(日) 憲法記念日 → 5/4,5/5 も祝日のため振替は 5/6(水)
    expect(isBankBusinessDay(d(2026, 5, 6))).toBe(false);
  });

  it("国民の休日を判定できる", () => {
    // 2026-09-21(敬老の日) と 09-23(秋分の日) に挟まれた 09-22(火)
    expect(isBankBusinessDay(d(2026, 9, 22))).toBe(false);
  });

  it("判定可能な年の範囲外は例外を投げる", () => {
    expect(() => isBankBusinessDay(d(2100, 5, 1))).toThrow(RangeError);
  });
});

describe("nextBankBusinessDay", () => {
  it("当日が営業日ならその日を返す", () => {
    expect(toMMDD(nextBankBusinessDay(d(2025, 12, 25)))).toBe("1225");
  });

  it("土曜からは翌月曜を返す", () => {
    expect(toMMDD(nextBankBusinessDay(d(2025, 12, 27)))).toBe("1229");
  });

  it("年末年始をまたぐと1/5を返す", () => {
    // 2026-01-04 は日曜のため 01-05(月)
    expect(toMMDD(nextBankBusinessDay(d(2025, 12, 31)))).toBe("0105");
  });
});

describe("toMMDD", () => {
  it("先頭を0埋めした MMDD を返す", () => {
    expect(toMMDD(d(2026, 1, 5))).toBe("0105");
    expect(toMMDD(d(2026, 12, 25))).toBe("1225");
  });
});
