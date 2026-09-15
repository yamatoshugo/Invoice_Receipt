import { describe, expect, it } from "vitest";
import { CRITICAL_DAYS, OVERDUE_DAYS, daysElapsed, describeWait, replyWaitLevel } from "./replyWait";

const SENT = new Date("2026-09-01T10:00:00Z");
const plusDays = (days: number, hours = 0) =>
  new Date(SENT.getTime() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000);

describe("daysElapsed", () => {
  it("丸1日を1と数える", () => {
    expect(daysElapsed(SENT, plusDays(0, 23))).toBe(0);
    expect(daysElapsed(SENT, plusDays(1))).toBe(1);
    expect(daysElapsed(SENT, plusDays(1, 23))).toBe(1);
  });

  it("送信より前の「今」は0に丸める（時計のずれで負の日数を出さない）", () => {
    expect(daysElapsed(SENT, plusDays(-3))).toBe(0);
  });
});

describe("replyWaitLevel", () => {
  it("6日目までは fresh", () => {
    expect(replyWaitLevel(SENT, plusDays(0))).toBe("fresh");
    expect(replyWaitLevel(SENT, plusDays(6, 23))).toBe("fresh");
  });

  it("7日ちょうどで overdue（橙）", () => {
    expect(replyWaitLevel(SENT, plusDays(OVERDUE_DAYS))).toBe("overdue");
    expect(replyWaitLevel(SENT, plusDays(13, 23))).toBe("overdue");
  });

  it("14日ちょうどで critical（赤）", () => {
    expect(replyWaitLevel(SENT, plusDays(CRITICAL_DAYS))).toBe("critical");
    expect(replyWaitLevel(SENT, plusDays(60))).toBe("critical");
  });
});

describe("describeWait", () => {
  it("当日は「本日」", () => {
    expect(describeWait(SENT, plusDays(0, 5))).toBe("本日");
  });

  it("経過した日数を出す", () => {
    expect(describeWait(SENT, plusDays(13))).toBe("13日経過");
  });
});
