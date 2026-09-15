import { describe, expect, it } from "vitest";
import { INDEX_LAG_MARGIN_MS } from "./coverage";
import { buildGmailQuery, clampScanWindow, inWindow, jstDayRangeToInstants, toJstDay } from "./query";

/** JSTの日時から絶対時刻を作る */
const jst = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h - 9, min));

describe("buildGmailQuery", () => {
  it("epoch秒で出力する（日付形式はタイムゾーン解釈が曖昧なので使わない）", () => {
    const q = buildGmailQuery(jst(2026, 8, 1), jst(2026, 9, 1));
    expect(q).toMatch(/^after:\d+ before:\d+$/);
    expect(q).not.toContain("/");
  });

  it("指定期間の前後に1日のマージンを付ける", () => {
    const from = jst(2026, 8, 1);
    const to = jst(2026, 9, 1);
    const m = /^after:(\d+) before:(\d+)$/.exec(buildGmailQuery(from, to))!;

    expect(Number(m[1])).toBe(from.getTime() / 1000 - 86400);
    expect(Number(m[2])).toBe(to.getTime() / 1000 + 86400);
  });

  it("Gmail側の境界解釈がどちらでも吸収できるだけ広く引く", () => {
    // 期間の端ちょうどに届いたメールが、クエリの範囲に確実に入っていること
    const from = jst(2026, 8, 1);
    const to = jst(2026, 9, 1);
    const m = /^after:(\d+) before:(\d+)$/.exec(buildGmailQuery(from, to))!;

    expect(Number(m[1]) * 1000).toBeLessThan(from.getTime());
    expect(Number(m[2]) * 1000).toBeGreaterThan(to.getTime());
  });
});

describe("inWindow", () => {
  const from = jst(2026, 8, 1);
  const to = jst(2026, 9, 1);

  it("開始時刻ちょうどのメールは期間内", () => {
    expect(inWindow(from.getTime(), from, to)).toBe(true);
  });

  it("終了時刻ちょうどのメールは期間外（次の走査が拾う）", () => {
    expect(inWindow(to.getTime(), from, to)).toBe(false);
  });

  it("終了時刻の1ミリ秒前は期間内", () => {
    expect(inWindow(to.getTime() - 1, from, to)).toBe(true);
  });

  it("開始時刻の1ミリ秒前は期間外", () => {
    expect(inWindow(from.getTime() - 1, from, to)).toBe(false);
  });

  it("隣接する2つの期間で、どのメールもちょうど1回だけ拾われる", () => {
    const mid = jst(2026, 8, 15);
    const moments = [from.getTime(), mid.getTime() - 1, mid.getTime(), to.getTime() - 1];

    for (const t of moments) {
      const hits = [inWindow(t, from, mid), inWindow(t, mid, to)].filter(Boolean).length;
      expect(hits).toBe(1);
    }
  });
});

describe("jstDayRangeToInstants", () => {
  it("JSTの0時はUTCの前日15時になる", () => {
    const { from } = jstDayRangeToInstants("2026-08-01", "2026-08-31");
    expect(from.toISOString()).toBe("2026-07-31T15:00:00.000Z");
  });

  it("終了日当日に届いたメールを含む（翌日0時を上限にする）", () => {
    const { to } = jstDayRangeToInstants("2026-08-01", "2026-08-31");
    expect(to.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    // JST 8/31 23:59 のメールが期間内であること
    expect(inWindow(jst(2026, 8, 31, 23, 59).getTime(), jst(2026, 8, 1), to)).toBe(true);
  });

  it("開始日と終了日が同じなら、その1日分になる", () => {
    const { from, to } = jstDayRangeToInstants("2026-09-14", "2026-09-14");
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("月末・年をまたいでもずれない", () => {
    const { from, to } = jstDayRangeToInstants("2026-12-31", "2027-01-01");
    expect(from.toISOString()).toBe("2026-12-30T15:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T15:00:00.000Z");
  });

  it("うるう年の2/29を扱える", () => {
    const { from } = jstDayRangeToInstants("2028-02-29", "2028-02-29");
    expect(toJstDay(from)).toBe("2028-02-29");
  });

  it("存在しない日付は例外を投げる", () => {
    expect(() => jstDayRangeToInstants("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => jstDayRangeToInstants("2026-13-01", "2026-13-02")).toThrow(RangeError);
  });

  it("終了日が開始日より前なら例外を投げる", () => {
    expect(() => jstDayRangeToInstants("2026-09-10", "2026-09-01")).toThrow(RangeError);
  });
});

describe("clampScanWindow", () => {
  const now = jst(2026, 9, 14, 15, 0);

  it("過去の期間はそのまま通す", () => {
    const from = jst(2026, 8, 1);
    const to = jst(2026, 9, 1);
    expect(clampScanWindow(from, to, now)).toEqual({ from, to });
  });

  it("今日を指定したとき、上限が未来へはみ出さない", () => {
    // ここを切り詰めないと、走査したあとに今日届いたメールが
    // 「走査済みの期間」に入ったまま読まれず、次回の走査が飛ばしてしまう
    const { from, to } = jstDayRangeToInstants("2026-09-14", "2026-09-14");
    const clamped = clampScanWindow(from, to, now)!;

    expect(to.getTime()).toBeGreaterThan(now.getTime()); // 指定どおりなら明日0時
    expect(clamped.to.getTime()).toBeLessThan(now.getTime());
  });

  it("上限はインデックス遅延のマージンだけ手前に置く", () => {
    const { from, to } = jstDayRangeToInstants("2026-09-14", "2026-09-14");
    const clamped = clampScanWindow(from, to, now)!;
    expect(clamped.to.getTime()).toBe(now.getTime() - INDEX_LAG_MARGIN_MS);
  });

  it("開始日は切り詰めない", () => {
    const { from, to } = jstDayRangeToInstants("2026-09-14", "2026-09-14");
    expect(clampScanWindow(from, to, now)!.from.toISOString()).toBe(from.toISOString());
  });

  it("走査できる範囲が残らなければ null", () => {
    // 未来の期間、または「今」から10分以内しか無い期間
    const { from, to } = jstDayRangeToInstants("2026-09-20", "2026-09-20");
    expect(clampScanWindow(from, to, now)).toBeNull();
  });

  it("開始が「今」の直前なら null（マージンに食われる）", () => {
    const from = new Date(now.getTime() - 60_000);
    const to = new Date(now.getTime() + 60_000);
    expect(clampScanWindow(from, to, now)).toBeNull();
  });

  it("切り詰めた期間は、次の走査が続きから拾える形になっている", () => {
    // 半開区間なので、上限ちょうどのメールは次の走査が拾う
    const { from, to } = jstDayRangeToInstants("2026-09-14", "2026-09-14");
    const clamped = clampScanWindow(from, to, now)!;
    expect(inWindow(clamped.to.getTime(), clamped.from, clamped.to)).toBe(false);
  });
});

describe("toJstDay", () => {
  it("UTC15時はJSTの翌日になる", () => {
    expect(toJstDay(new Date("2026-08-31T15:00:00.000Z"))).toBe("2026-09-01");
  });

  it("UTC14時59分はJSTの同日中", () => {
    expect(toJstDay(new Date("2026-08-31T14:59:00.000Z"))).toBe("2026-08-31");
  });
});
