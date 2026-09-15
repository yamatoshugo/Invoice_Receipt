import { describe, expect, it } from "vitest";
import { describeDuplicateArrival, summarizeDuplicateArrivals } from "./duplicates";
import type { DuplicateArrivalSource } from "./duplicates";

const at = (day: number, hour = 10): Date => new Date(Date.UTC(2026, 8, day, hour));

const src = (over: Partial<DuplicateArrivalSource> = {}): DuplicateArrivalSource => ({
  invoiceId: "inv-1",
  receivedAt: at(1),
  fromAddress: "billing@vendor.example",
  subject: "9月分ご請求",
  ...over,
});

describe("summarizeDuplicateArrivals", () => {
  it("重複が無ければ空", () => {
    expect(summarizeDuplicateArrivals([]).size).toBe(0);
  });

  it("同じ請求書への重複をまとめて数える", () => {
    const result = summarizeDuplicateArrivals([src(), src({ receivedAt: at(5) })]);
    expect(result.get("inv-1")!.count).toBe(2);
  });

  it("請求書ごとに分けて数える", () => {
    const result = summarizeDuplicateArrivals([src(), src({ invoiceId: "inv-2" })]);
    expect(result.get("inv-1")!.count).toBe(1);
    expect(result.get("inv-2")!.count).toBe(1);
  });

  it("直近のメールの情報を表示に使う", () => {
    const result = summarizeDuplicateArrivals([
      src({ receivedAt: at(1), fromAddress: "old@example.jp", subject: "古い" }),
      src({ receivedAt: at(10), fromAddress: "new@example.jp", subject: "新しい" }),
    ]);
    const a = result.get("inv-1")!;
    expect(a.latest).toEqual(at(10));
    expect(a.from).toBe("new@example.jp");
    expect(a.subject).toBe("新しい");
  });

  it("古いメールが後から来ても直近を上書きしない", () => {
    const result = summarizeDuplicateArrivals([
      src({ receivedAt: at(10), fromAddress: "new@example.jp" }),
      src({ receivedAt: at(1), fromAddress: "old@example.jp" }),
    ]);
    expect(result.get("inv-1")!.from).toBe("new@example.jp");
  });

  it("請求書が削除されて紐づけが外れたものは数えない", () => {
    // 指す先が無い警告を出しても人が確認できない
    const result = summarizeDuplicateArrivals([src({ invoiceId: null }), src()]);
    expect(result.size).toBe(1);
    expect(result.get("inv-1")!.count).toBe(1);
  });

  it("差出人や件名が分からなくても落ちない", () => {
    const result = summarizeDuplicateArrivals([src({ fromAddress: null, subject: null })]);
    expect(result.get("inv-1")).toEqual({
      count: 1,
      latest: at(1),
      from: null,
      subject: null,
    });
  });
});

describe("describeDuplicateArrival", () => {
  it("回数・直近の日時・差出人・件名を含む", () => {
    const text = describeDuplicateArrival({
      count: 2,
      latest: at(10),
      from: "billing@vendor.example",
      subject: "9月分ご請求",
    });
    expect(text).toContain("2回");
    expect(text).toContain("billing@vendor.example");
    expect(text).toContain("9月分ご請求");
  });

  it("取り込んでいないこと（二重振込を防ぐため）を明記する", () => {
    const text = describeDuplicateArrival({ count: 2, latest: at(10), from: null, subject: null });
    expect(text).toContain("取り込んでいません");
    expect(text).toContain("二重振込");
  });

  it("差出人や件名が無くても文章が壊れない", () => {
    const text = describeDuplicateArrival({ count: 1, latest: at(1), from: null, subject: null });
    expect(text).toContain("1回");
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });
});
