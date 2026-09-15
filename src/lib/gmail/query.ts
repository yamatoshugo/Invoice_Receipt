/**
 * 期間の指定と、Gmail検索クエリの組み立て。
 *
 * ここは「抜け洩れゼロ」の要になる。Gmail の after:/before: を日付形式で書くと
 * アカウントのタイムゾーン依存で境界の解釈が変わり、境界のメールが落ちうる。
 * epoch秒で書いても、境界を含むかどうかは明文化されていない。
 *
 * そこで、Gmailにはわざと広く引かせ、余剰を internalDate で落とす方式にする。
 * Gmail側の解釈が UTC でも PST でも inclusive でも exclusive でも、
 * マージンが全部吸収する。
 */

import { INDEX_LAG_MARGIN_MS } from "./coverage";

/** Gmailに広く引かせるためのマージン（片側）。多く拾う分には害がない */
const BOUNDARY_MARGIN_SEC = 24 * 60 * 60;

/** JSTの固定オフセット。日本には夏時間が無いので固定値で安全 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 期間から Gmail の検索クエリを組み立てる。
 *
 * 日付形式（after:2026/08/01）は使わない。タイムゾーンの解釈がアカウント依存になるため。
 * 前後にマージンを付けるので、ここで返す範囲は指定期間より必ず広い。
 * 余剰は inWindow() が落とす。
 */
export function buildGmailQuery(from: Date, to: Date): string {
  const after = Math.floor(from.getTime() / 1000) - BOUNDARY_MARGIN_SEC;
  const before = Math.ceil(to.getTime() / 1000) + BOUNDARY_MARGIN_SEC;
  return `after:${after} before:${before}`;
}

/**
 * 期間内かどうかの唯一の正。半開区間 [from, to)。
 *
 * 上限を含めないので、to ちょうどに届いたメールは次の走査 [to, to2) が拾う。
 * 隣接する走査に重なりも隙間も原理的に生じない。
 */
export function inWindow(internalDateMs: number, from: Date, to: Date): boolean {
  return internalDateMs >= from.getTime() && internalDateMs < to.getTime();
}

/**
 * JSTの日付（YYYY-MM-DD）で指定された期間を、絶対時刻の半開区間に変換する。
 *
 * 終了日は「その日を含む」ように、翌日の0時を上限にする。
 * 画面で 8/1〜8/31 と入れたら 8/31 に届いたメールが入る、という素直な挙動にするため。
 */
export function jstDayRangeToInstants(fromDay: string, toDay: string): { from: Date; to: Date } {
  const from = jstMidnight(fromDay);
  const to = new Date(jstMidnight(toDay).getTime() + 24 * 60 * 60 * 1000);
  if (to.getTime() <= from.getTime()) {
    throw new RangeError("終了日は開始日以降にしてください");
  }
  return { from, to };
}

/** JSTのその日の0時を絶対時刻で返す（JST 0:00 = UTC 前日15:00） */
function jstMidnight(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`日付の形式が不正です: ${day}`);
  const [, y, mo, d] = m;
  const utcMidnight = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const instant = new Date(utcMidnight - JST_OFFSET_MS);
  // Date.UTC は 2026-02-30 のような存在しない日を繰り上げてしまうので、往復で検算する
  if (toJstDay(instant) !== day) throw new RangeError(`存在しない日付です: ${day}`);
  return instant;
}

/**
 * 走査する期間の上限を「今」より手前へ切り詰める。
 *
 * 今日の日付を指定すると上限は「明日の0時」になるが、そのまま走査して完了にすると、
 * **走査したあとに今日届いたメールが「走査済みの期間」に入ったまま読まれない**状態になる。
 * 次回の「前回の続きから」は明日以降を提案するので、その分が恒久的な抜け洩れになる。
 *
 * さらに、Gmailの検索インデックスは届いた直後のメールを返さないことがあるため、
 * 「今」ちょうどではなくインデックス遅延のマージンだけ手前で止める。
 *
 * 走査できる範囲が残らない場合は null を返す（呼び出し側が人に伝える）。
 */
export function clampScanWindow(from: Date, to: Date, now: Date): { from: Date; to: Date } | null {
  const limit = now.getTime() - INDEX_LAG_MARGIN_MS;
  const clamped = Math.min(to.getTime(), limit);
  if (clamped <= from.getTime()) return null;
  return { from, to: new Date(clamped) };
}

/** 絶対時刻を JST の YYYY-MM-DD に落とす */
export function toJstDay(instant: Date): string {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
