import { describe, expect, it } from "vitest";
import { replyArrivedAt, replyWithoutAttachmentAt } from "./reply";
import type { ThreadMessageLike } from "./reply";

const MAILBOX = "seikyusho@example.co.jp";
const SENT_AT = new Date("2026-09-01T10:00:00Z");

const msg = (over: Partial<ThreadMessageLike> = {}): ThreadMessageLike => ({
  gmailThreadId: "t-1",
  internalDate: new Date("2026-09-02T09:00:00Z"),
  fromAddress: "keiri@torihikisaki.co.jp",
  labelIds: ["INBOX"],
  attachmentCount: 1,
  ...over,
});

const lookup = (messages: ThreadMessageLike[]) => ({
  threadId: "t-1",
  sentAt: SENT_AT,
  mailboxAddress: MAILBOX,
  messages,
});

describe("replyArrivedAt", () => {
  it("同じスレッドに届いた添付付きの返信を検出する", () => {
    expect(replyArrivedAt(lookup([msg()]))).toEqual(new Date("2026-09-02T09:00:00Z"));
  });

  it("返信が無ければ null", () => {
    expect(replyArrivedAt(lookup([]))).toBeNull();
  });

  it("別のスレッドのメールは数えない", () => {
    expect(replyArrivedAt(lookup([msg({ gmailThreadId: "t-2" })]))).toBeNull();
  });

  it("依頼を送る前のメール（元の請求書通知そのもの）は返信ではない", () => {
    // 同じスレッドには必ず元のメールが居る。時刻で切らないと必ず誤検出する
    expect(replyArrivedAt(lookup([msg({ internalDate: new Date("2026-08-31T09:00:00Z") })]))).toBeNull();
  });

  it("送信時刻ちょうどのメールは返信に数えない", () => {
    expect(replyArrivedAt(lookup([msg({ internalDate: SENT_AT })]))).toBeNull();
  });

  it("★自分が送った依頼メールの控えを返信と数えない（Fromが自分）", () => {
    // 走査クエリは送信済みを除外していないので、依頼メールは次の走査で必ず記録される。
    // 弾かないと「送った瞬間に返信が来た」ことになり、返信待ちの検出が丸ごと死ぬ
    expect(replyArrivedAt(lookup([msg({ fromAddress: MAILBOX })]))).toBeNull();
  });

  it("★自分が送った依頼メールの控えを返信と数えない（SENTラベル）", () => {
    expect(replyArrivedAt(lookup([msg({ labelIds: ["SENT"] })]))).toBeNull();
  });

  it("Fromの大文字小文字・前後の空白で判定がずれない", () => {
    expect(replyArrivedAt(lookup([msg({ fromAddress: " Seikyusho@Example.co.JP " })]))).toBeNull();
  });

  it("添付の無い返信は決着にしない", () => {
    // 「承知しました」だけの返信。請求書はまだ手元に無い
    expect(replyArrivedAt(lookup([msg({ attachmentCount: 0 })]))).toBeNull();
  });

  it("Fromが取れないメールでも、SENTが無く添付があれば返信として扱う", () => {
    // 取りこぼすより拾うほうに倒す（拾えば人が見る、落とせば誰も気付かない）
    expect(replyArrivedAt(lookup([msg({ fromAddress: null })]))).not.toBeNull();
  });

  it("複数の返信があれば、最初の1通の時刻を返す", () => {
    const first = new Date("2026-09-02T09:00:00Z");
    const second = new Date("2026-09-05T09:00:00Z");
    expect(
      replyArrivedAt(lookup([msg({ internalDate: second }), msg({ internalDate: first })])),
    ).toEqual(first);
  });

  it("送信控えと本物の返信が混ざっていても、本物だけを見る", () => {
    const own = msg({ internalDate: new Date("2026-09-01T10:00:30Z"), labelIds: ["SENT"] });
    const real = msg({ internalDate: new Date("2026-09-03T02:00:00Z") });
    expect(replyArrivedAt(lookup([own, real]))).toEqual(new Date("2026-09-03T02:00:00Z"));
  });
});

describe("replyWithoutAttachmentAt", () => {
  it("添付なしの返信を拾う", () => {
    expect(replyWithoutAttachmentAt(lookup([msg({ attachmentCount: 0 })]))).toEqual(
      new Date("2026-09-02T09:00:00Z"),
    );
  });

  it("添付付きの返信は対象外（そちらは決着として扱う）", () => {
    expect(replyWithoutAttachmentAt(lookup([msg()]))).toBeNull();
  });

  it("自分の送信控えは、添付が無くても返信と数えない", () => {
    expect(
      replyWithoutAttachmentAt(lookup([msg({ attachmentCount: 0, labelIds: ["SENT"] })])),
    ).toBeNull();
  });
});
