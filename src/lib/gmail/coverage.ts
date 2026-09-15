/**
 * 走査済み期間の集計と、隙間の検出。
 *
 * 「前回どこまで見たか」をポインタとして保存しない。ポインタは必ずどこかでずれ、
 * ずれた分がそのまま抜け洩れになる。完了した走査の記録から毎回導出する。
 */

export interface Range {
  from: Date;
  to: Date;
}

export interface ScanLike {
  windowFrom: Date;
  windowTo: Date;
  /** COMPLETED 以外は走査済みに数えない */
  state: string;
}

/**
 * Gmailの検索インデックスは、届いた直後のメールを返さないことがある。
 * その瞬間までを「走査済み」にすると恒久的な穴になるので、
 * 上限は常にこれだけ手前に置く。
 */
export const INDEX_LAG_MARGIN_MS = 10 * 60 * 1000;

/**
 * 完了した走査だけを材料に、走査済み期間を結合して返す。
 *
 * 中断した走査（RUNNING / FAILED / ABANDONED）はページングが尽きていないので、
 * その期間を見終えた保証がない。走査済みに数えてはいけない。
 */
export function mergeCoveredRanges(scans: ScanLike[]): Range[] {
  const completed = scans
    .filter((s) => s.state === "COMPLETED")
    .map((s) => ({ from: new Date(s.windowFrom), to: new Date(s.windowTo) }))
    .filter((r) => r.to.getTime() > r.from.getTime())
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  const merged: Range[] = [];
  for (const range of completed) {
    const last = merged[merged.length - 1];
    // 半開区間なので、接している（last.to === range.from）ものも1本にまとめる
    if (last && range.from.getTime() <= last.to.getTime()) {
      if (range.to.getTime() > last.to.getTime()) last.to = range.to;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** 指定した全体期間のうち、走査済みでない部分を返す */
export function findGaps(covered: Range[], overall: Range): Range[] {
  const gaps: Range[] = [];
  let cursor = overall.from.getTime();

  for (const range of covered) {
    if (range.to.getTime() <= cursor) continue;
    if (range.from.getTime() >= overall.to.getTime()) break;
    if (range.from.getTime() > cursor) {
      gaps.push({ from: new Date(cursor), to: new Date(Math.min(range.from.getTime(), overall.to.getTime())) });
    }
    cursor = Math.max(cursor, range.to.getTime());
  }

  if (cursor < overall.to.getTime()) {
    gaps.push({ from: new Date(cursor), to: new Date(overall.to.getTime()) });
  }
  return gaps.filter((g) => g.to.getTime() > g.from.getTime());
}

/**
 * 「前回の続きから」の既定値。
 *
 * 走査済みの上端から、今 − インデックス遅延マージン まで。
 * 走査が1件も無ければ null を返し、画面は期間を人に選ばせる。
 */
export function nextScanWindow(covered: Range[], now: Date): Range | null {
  const to = new Date(now.getTime() - INDEX_LAG_MARGIN_MS);
  if (covered.length === 0) return null;

  const latest = covered.reduce((a, b) => (a.to.getTime() >= b.to.getTime() ? a : b));
  if (to.getTime() <= latest.to.getTime()) return null;
  return { from: new Date(latest.to.getTime()), to };
}
