/**
 * 送付依頼メールに返信が来たかを判定する。
 *
 * 依頼を送っただけでは決着にしない（status.ts）。決着させるのはこの判定だけ。
 * DBの列にせず、画面を出すたびに走査済みのメールから導出する
 * （「決着をDBに保存しない」という既存方針のまま）。
 */

/** 判定に使う、走査済みメール1通ぶんの情報。すべて GmailMessage に既にある列 */
export interface ThreadMessageLike {
  gmailThreadId: string;
  /** Gmailが記録した受信時刻 */
  internalDate: Date;
  /** 差出人。Gmail側で取れなかった場合は null */
  fromAddress: string | null;
  /** Gmailのラベル。自分が送ったメールには SENT が付く */
  labelIds: string[];
  /** 添付（filenameを持つパート）の件数。走査時に必ず埋まる */
  attachmentCount: number;
}

export interface ReplyLookup {
  /** 依頼メールを送ったスレッド */
  threadId: string;
  /** 依頼メールを送った時刻。これより後に届いたものだけが返信 */
  sentAt: Date;
  /** 接続中の受信専用アドレス（＝自分）。送信控えを弾くのに使う */
  mailboxAddress: string;
  /** 走査済みメール。スレッドで絞り込み済みでなくてよい */
  messages: ThreadMessageLike[];
}

/**
 * 添付付きの返信が届いた時刻。届いていなければ null。
 *
 * 引数をオブジェクトにしてあるのは、threadId と mailboxAddress がどちらも string で、
 * 位置を取り違えても型では捕まらないため（取り違えると返信を永久に検出しない）。
 */
export function replyArrivedAt(lookup: ReplyLookup): Date | null {
  return earliest(lookup, (m) => m.attachmentCount > 0);
}

/**
 * 添付が無い返信が届いた時刻。「承知しました」だけの返信がこれ。
 *
 * ★決着には使わない（請求書はまだ手元に無い）。
 * 画面で「返事は来ているが請求書が付いていない」と出し分けるためのもの。
 */
export function replyWithoutAttachmentAt(lookup: ReplyLookup): Date | null {
  return earliest(lookup, (m) => m.attachmentCount === 0);
}

function earliest(lookup: ReplyLookup, extra: (m: ThreadMessageLike) => boolean): Date | null {
  const mailbox = lookup.mailboxAddress.trim().toLowerCase();

  let found: Date | null = null;
  for (const m of lookup.messages) {
    if (m.gmailThreadId !== lookup.threadId) continue;
    if (m.internalDate.getTime() <= lookup.sentAt.getTime()) continue;
    if (isOwnCopy(m, mailbox)) continue;
    if (!extra(m)) continue;
    if (found === null || m.internalDate.getTime() < found.getTime()) found = m.internalDate;
  }
  return found;
}

/**
 * 自分が送った依頼メールの控えか。
 *
 * ★ここが無いと機能全体が無意味になる。走査クエリ(buildGmailQuery)は after:/before: だけで
 * 送信済みを除外していないので、依頼メールは次の走査で必ず GmailMessage として記録される。
 * 弾かないと「送った瞬間に返信が来た」ことになり、返信待ちの検出が丸ごと死ぬ。
 *
 * 走査クエリ側は変えない。変えると走査済み期間の意味が変わり、
 * 抜け洩れゼロの不変条件に触ることになる。検出側で弾くのが正しい。
 *
 * From とラベルの両方で見るのは、どちらか一方が欠ける場合があるため
 * （From が取れないメールがあり、SENT ラベルは受信箱側の都合で付かない場合がある）。
 */
function isOwnCopy(m: ThreadMessageLike, mailbox: string): boolean {
  if (m.labelIds.includes("SENT")) return true;
  const from = m.fromAddress?.trim().toLowerCase() ?? "";
  return from !== "" && from === mailbox;
}
