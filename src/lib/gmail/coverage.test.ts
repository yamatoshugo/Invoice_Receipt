import { describe, expect, it } from "vitest";
import { findGaps, INDEX_LAG_MARGIN_MS, mergeCoveredRanges, nextScanWindow } from "./coverage";
import type { Range, ScanLike } from "./coverage";

/** UTCの日付を作る */
const d = (day: number, hour = 0) => new Date(Date.UTC(2026, 7, day, hour));

const scan = (fromDay: number, toDay: number, state = "COMPLETED"): ScanLike => ({
  windowFrom: d(fromDay),
  windowTo: d(toDay),
  state,
});

/** 比較しやすいよう日だけ取り出す */
const days = (ranges: Range[]) =>
  ranges.map((r) => [r.from.getUTCDate(), r.to.getUTCDate()] as const);

describe("mergeCoveredRanges", () => {
  it("走査が1件も無ければ空", () => {
    expect(mergeCoveredRanges([])).toEqual([]);
  });

  it("隣接する期間は1本に結合する（半開区間なので接点は重複しない）", () => {
    expect(days(mergeCoveredRanges([scan(1, 10), scan(10, 20)]))).toEqual([[1, 20]]);
  });

  it("重なる期間は結合する", () => {
    expect(days(mergeCoveredRanges([scan(1, 15), scan(10, 20)]))).toEqual([[1, 20]]);
  });

  it("入力の順序に依存しない", () => {
    expect(days(mergeCoveredRanges([scan(10, 20), scan(1, 10)]))).toEqual([[1, 20]]);
  });

  it("包含関係にある期間を正しくまとめる", () => {
    expect(days(mergeCoveredRanges([scan(1, 30), scan(10, 15)]))).toEqual([[1, 30]]);
  });

  it("間が空いていれば別々に返す", () => {
    expect(days(mergeCoveredRanges([scan(1, 10), scan(20, 25)]))).toEqual([
      [1, 10],
      [20, 25],
    ]);
  });

  it("COMPLETED でない走査は走査済みに数えない", () => {
    // ページングが尽きていない＝その期間を見終えた保証がない。
    // ここを数えると中断した分がそのまま恒久的な抜け洩れになる
    expect(mergeCoveredRanges([scan(1, 10, "RUNNING")])).toEqual([]);
    expect(mergeCoveredRanges([scan(1, 10, "FAILED")])).toEqual([]);
    expect(mergeCoveredRanges([scan(1, 10, "ABANDONED")])).toEqual([]);
  });

  it("完了した走査だけを拾い、中断した走査は無視する", () => {
    const merged = mergeCoveredRanges([scan(1, 10), scan(10, 20, "FAILED"), scan(20, 25)]);
    expect(days(merged)).toEqual([
      [1, 10],
      [20, 25],
    ]);
  });

  it("幅ゼロの期間は無視する", () => {
    expect(mergeCoveredRanges([scan(5, 5)])).toEqual([]);
  });
});

describe("findGaps", () => {
  const overall = { from: d(1), to: d(31) };

  it("走査が1件も無ければ全体が隙間になる", () => {
    expect(days(findGaps([], overall))).toEqual([[1, 31]]);
  });

  it("全体を覆っていれば隙間は無い", () => {
    expect(findGaps([{ from: d(1), to: d(31) }], overall)).toEqual([]);
  });

  it("真ん中が抜けていれば、その分を隙間として返す", () => {
    const covered = [
      { from: d(1), to: d(10) },
      { from: d(20), to: d(31) },
    ];
    expect(days(findGaps(covered, overall))).toEqual([[10, 20]]);
  });

  it("先頭と末尾の抜けも隙間として返す", () => {
    expect(days(findGaps([{ from: d(10), to: d(20) }], overall))).toEqual([
      [1, 10],
      [20, 31],
    ]);
  });

  it("全体期間の外側にある走査は隙間の計算に影響しない", () => {
    const covered = [
      { from: new Date(Date.UTC(2026, 6, 1)), to: new Date(Date.UTC(2026, 6, 20)) },
      { from: d(1), to: d(31) },
    ];
    expect(findGaps(covered, overall)).toEqual([]);
  });

  it("走査済みの右端より後ろは隙間として報告しない", () => {
    // 走査の上限は常に「今より10分前」で止めるので、右端を「今」にすると
    // 10分ぶんの隙間が永久に残り、同じ日付の幻の隙間として表示されてしまう。
    // 全体範囲の右端を走査済みの右端にすることで、本物の穴だけが残る。
    const covered = [{ from: d(1), to: d(20, 10) }];
    const overall = { from: covered[0]!.from, to: covered[0]!.to };
    expect(findGaps(covered, overall)).toEqual([]);
  });

  it("右端を「今」にすると幻の隙間が出る（この形にしないことの確認）", () => {
    const covered = [{ from: d(1), to: d(20, 10) }];
    const gaps = findGaps(covered, { from: covered[0]!.from, to: d(20, 11) });
    expect(gaps).toHaveLength(1); // ← これが画面に出ていた不具合
  });

  it("7月分と9月分だけ走査した状態で、8月が隙間として出る", () => {
    const july = { from: new Date(Date.UTC(2026, 6, 1)), to: new Date(Date.UTC(2026, 7, 1)) };
    const sept = { from: new Date(Date.UTC(2026, 8, 1)), to: new Date(Date.UTC(2026, 9, 1)) };
    const gaps = findGaps([july, sept], { from: july.from, to: sept.to });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(gaps[0]!.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("nextScanWindow", () => {
  it("走査が1件も無ければ null（期間を人に選ばせる）", () => {
    expect(nextScanWindow([], d(31))).toBeNull();
  });

  it("走査済みの上端から始まる（隙間を作らない）", () => {
    const now = d(20);
    const window = nextScanWindow([{ from: d(1), to: d(10) }], now)!;
    expect(window.from.toISOString()).toBe(d(10).toISOString());
  });

  it("上限は「今」より手前に置く（Gmailの検索インデックス遅延で穴を空けないため）", () => {
    const now = d(20);
    const window = nextScanWindow([{ from: d(1), to: d(10) }], now)!;
    expect(window.to.getTime()).toBe(now.getTime() - INDEX_LAG_MARGIN_MS);
  });

  it("最も新しい走査の上端を起点にする", () => {
    const covered = [
      { from: d(1), to: d(5) },
      { from: d(10), to: d(15) },
    ];
    expect(nextScanWindow(covered, d(20))!.from.toISOString()).toBe(d(15).toISOString());
  });

  it("走査済みが「今」に追いついていれば null（走るべき期間が無い）", () => {
    const now = d(20);
    expect(nextScanWindow([{ from: d(1), to: now }], now)).toBeNull();
  });
});
