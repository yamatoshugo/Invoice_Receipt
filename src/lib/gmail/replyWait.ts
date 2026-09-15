/**
 * 依頼メールを送ってからの経過。
 *
 * 請求書の支払期日は使えない。請求書が手元に無いことがこの状態の本質なので、
 * 期日そのものが分からない。経過日数だけで人に判断させる。
 */

export type ReplyWaitLevel =
  /** 待ってよい */
  | "fresh"
  /** そろそろ確認したほうがよい（橙） */
  | "overdue"
  /** 月末の支払に間に合わない恐れがある（赤） */
  | "critical";

export const OVERDUE_DAYS = 7;
export const CRITICAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 経過日数（丸1日を1と数える）。
 *
 * 時刻の差をそのまま日で切るので、月をまたいでもサマータイムの無い日本では素直に働く。
 * 送信より前の「今」（時計のずれ）は 0 に丸める。負の経過を画面に出さないため。
 */
export function daysElapsed(sentAt: Date, now: Date): number {
  const diff = now.getTime() - sentAt.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

export function replyWaitLevel(sentAt: Date, now: Date): ReplyWaitLevel {
  const days = daysElapsed(sentAt, now);
  if (days >= CRITICAL_DAYS) return "critical";
  if (days >= OVERDUE_DAYS) return "overdue";
  return "fresh";
}

/** 画面にそのまま出す文言（「3日経過」） */
export function describeWait(sentAt: Date, now: Date): string {
  const days = daysElapsed(sentAt, now);
  return days === 0 ? "本日" : `${days}日経過`;
}
