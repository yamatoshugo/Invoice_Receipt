/**
 * 「同じ請求書が再度メールで届いた」ことの集計。
 *
 * 再送・催促で同じPDFが2回届くのは毎月それなりに起きる。
 * 重複分は新しい請求書を作らない（sha256の一意制約が二重振込を防ぐ最後の砦なので外さない）が、
 * 「同じ請求書が2回来た」という事実は請求書そのものの情報なので、請求書一覧に出す。
 *
 * 取り込みの画面ではなく請求書側に出すのは、月末に振込を判断するときに
 * 目に入る場所が請求書一覧だから。
 */

export interface DuplicateArrivalSource {
  /** 重複として弾かれた添付が指している既存の請求書 */
  invoiceId: string | null;
  /** そのメールの受信日時 */
  receivedAt: Date;
  fromAddress: string | null;
  subject: string | null;
}

export interface DuplicateArrival {
  /** 同じ請求書に対して、メールで何回届いたか */
  count: number;
  /** 直近に届いた日時 */
  latest: Date;
  /** 直近の差出人。分からなければ null */
  from: string | null;
  /** 直近の件名。分からなければ null */
  subject: string | null;
}

/**
 * 重複として弾かれた添付を、請求書IDごとにまとめる。
 *
 * 請求書が削除されていて紐づけが外れているもの（invoiceId が null）は数えない。
 * 指す先が無い警告を出しても人が確認できないため。
 */
export function summarizeDuplicateArrivals(
  sources: DuplicateArrivalSource[],
): Map<string, DuplicateArrival> {
  const byInvoice = new Map<string, DuplicateArrival>();

  for (const source of sources) {
    if (!source.invoiceId) continue;

    const current = byInvoice.get(source.invoiceId);
    if (!current) {
      byInvoice.set(source.invoiceId, {
        count: 1,
        latest: source.receivedAt,
        from: source.fromAddress,
        subject: source.subject,
      });
      continue;
    }

    current.count += 1;
    // 表示するのは直近の1件。古いメールで上書きしない
    if (source.receivedAt.getTime() > current.latest.getTime()) {
      current.latest = source.receivedAt;
      current.from = source.fromAddress;
      current.subject = source.subject;
    }
  }

  return byInvoice;
}

/** バッジに添える説明文。マウスを乗せたときに何が起きたか分かるようにする */
export function describeDuplicateArrival(arrival: DuplicateArrival): string {
  const when = arrival.latest.toLocaleString("ja-JP");
  const who = arrival.from ? `${arrival.from} から` : "";
  const subject = arrival.subject ? `「${arrival.subject}」` : "";
  return (
    `同じ内容のPDFが、メールで${arrival.count}回届いています。\n` +
    `直近: ${when} ${who}${subject}\n` +
    `重複分は取り込んでいません（二重振込を防ぐため）。本当に2件の請求なら、送信元に別の請求書を出してもらってください。`
  );
}
