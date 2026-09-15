import { describe, expect, it } from "vitest";
import { GmailItemStatus } from "@/generated/prisma";
import {
  messageScanComplete,
  settlementOf,
  STATUS_CLASSIFICATION,
  summarizeItems,
  unsettledReasonOf,
} from "./status";
import type { ItemLike } from "./status";

const item = (over: Partial<ItemLike> = {}): ItemLike => ({
  status: "PENDING",
  invoiceId: null,
  acknowledgedAt: null,
  autoSkipped: false,
  repliedAt: null,
  ...over,
});

describe("STATUS_CLASSIFICATION", () => {
  it("GmailItemStatus のすべてのメンバーが分類表に載っている", () => {
    // 状態を足したとき、表に書き忘れれば必ずここで落ちる。
    // （以前は settlementOf の末尾がフォールスルーだったので、
    //   書き忘れても黙って「未決着」に落ちるだけでテストは通ってしまっていた）
    for (const status of Object.values(GmailItemStatus)) {
      expect(Object.keys(STATUS_CLASSIFICATION)).toContain(status);
    }
  });

  it("表に、実在しない状態が混ざっていない", () => {
    const real = Object.values(GmailItemStatus) as string[];
    for (const key of Object.keys(STATUS_CLASSIFICATION)) {
      expect(real).toContain(key);
    }
  });

  it("未決着の状態には必ず理由が付いている", () => {
    for (const [status, c] of Object.entries(STATUS_CLASSIFICATION)) {
      if (!c.settled) expect(c.reason, status).not.toBeNull();
    }
  });
});

describe("settlementOf", () => {
  it("GmailItemStatus のすべてのメンバーが settled か unsettled に分類される", () => {
    for (const status of Object.values(GmailItemStatus)) {
      expect(["settled", "unsettled"]).toContain(settlementOf(item({ status })));
    }
  });

  it("取り込み済みは決着", () => {
    expect(settlementOf(item({ status: "IMPORTED", invoiceId: "inv-1" }))).toBe("settled");
  });

  it("重複（既に同じPDFがある）も決着", () => {
    expect(settlementOf(item({ status: "DUPLICATE", invoiceId: "inv-1" }))).toBe("settled");
  });

  it("取り込んだ請求書が削除されていれば未決着に戻る", () => {
    // 「取り込んだつもりで手元に無い」請求書を見逃さないための要
    expect(settlementOf(item({ status: "IMPORTED", invoiceId: null }))).toBe("unsettled");
    expect(settlementOf(item({ status: "DUPLICATE", invoiceId: null }))).toBe("unsettled");
  });

  it("未処理・処理中・失敗は未決着", () => {
    expect(settlementOf(item({ status: "PENDING" }))).toBe("unsettled");
    expect(settlementOf(item({ status: "IMPORTING" }))).toBe("unsettled");
    expect(settlementOf(item({ status: "FAILED" }))).toBe("unsettled");
  });

  it("PDF以外・破損・サイズ超過は、自動では決着しない", () => {
    // ここを自動で「済」にすると、Excelの請求書やパスワード付きPDFが黙って消える
    expect(settlementOf(item({ status: "NOT_PDF" }))).toBe("unsettled");
    expect(settlementOf(item({ status: "UNREADABLE" }))).toBe("unsettled");
    expect(settlementOf(item({ status: "TOO_LARGE" }))).toBe("unsettled");
  });

  it("ログインが要るURLは、自動では決着しない", () => {
    // 請求書はまだ手元に無い。決着にすると
    // 「ログインが必要だったので終わり」で請求書が静かに消える
    expect(settlementOf(item({ status: "LOGIN_REQUIRED" }))).toBe("unsettled");
    expect(unsettledReasonOf(item({ status: "LOGIN_REQUIRED" }))).toBe("request-needed");
  });

  it("依頼メールを送信中のまま止まっているものは未決着", () => {
    // 送れたか分からない。必ず人の目に触れさせる
    expect(settlementOf(item({ status: "REQUEST_SENDING" }))).toBe("unsettled");
    expect(unsettledReasonOf(item({ status: "REQUEST_SENDING" }))).toBe("request-sending");
  });

  it("★依頼を送っただけでは決着しない（返信待ち）", () => {
    // 単体で決着にすると、依頼を無視された請求書が「済」の札を付けて画面から消える。
    // それは月末の支払漏れを防ぐというこのシステムの目的そのものを裏切る
    expect(settlementOf(item({ status: "REQUEST_SENT" }))).toBe("unsettled");
    expect(unsettledReasonOf(item({ status: "REQUEST_SENT" }))).toBe("request-waiting");
  });

  it("依頼への返信（添付付き）が届いていれば決着する", () => {
    expect(settlementOf(item({ status: "REQUEST_SENT", repliedAt: new Date() }))).toBe("settled");
    expect(unsettledReasonOf(item({ status: "REQUEST_SENT", repliedAt: new Date() }))).toBeNull();
  });

  it("返信が来ていても、他の状態には効かない", () => {
    // repliedAt は REQUEST_SENT の決着だけを覆す。未処理の候補を勝手に決着させない
    expect(settlementOf(item({ status: "PENDING", repliedAt: new Date() }))).toBe("unsettled");
    expect(settlementOf(item({ status: "LOGIN_REQUIRED", repliedAt: new Date() }))).toBe("unsettled");
  });

  it("依頼の送信に失敗したものは未決着", () => {
    expect(settlementOf(item({ status: "REQUEST_FAILED" }))).toBe("unsettled");
    expect(unsettledReasonOf(item({ status: "REQUEST_FAILED" }))).toBe("request-failed");
  });

  it("人が「取り込まない」と確認すれば決着する", () => {
    expect(settlementOf(item({ status: "NOT_PDF", acknowledgedAt: new Date() }))).toBe("settled");
    expect(settlementOf(item({ status: "UNREADABLE", acknowledgedAt: new Date() }))).toBe("settled");
  });

  it("署名画像として自動で脇に寄せたものは決着に数える", () => {
    expect(settlementOf(item({ status: "NOT_PDF", autoSkipped: true }))).toBe("settled");
  });
});

describe("unsettledReasonOf", () => {
  it("決着していれば null", () => {
    expect(unsettledReasonOf(item({ status: "IMPORTED", invoiceId: "inv-1" }))).toBeNull();
  });

  it("請求書が削除された場合を、未処理と区別する", () => {
    expect(unsettledReasonOf(item({ status: "IMPORTED", invoiceId: null }))).toBe("invoice-deleted");
  });

  it("状態ごとの理由を返す", () => {
    expect(unsettledReasonOf(item({ status: "PENDING" }))).toBe("pending");
    expect(unsettledReasonOf(item({ status: "IMPORTING" }))).toBe("importing");
    expect(unsettledReasonOf(item({ status: "FAILED" }))).toBe("failed");
    expect(unsettledReasonOf(item({ status: "NOT_PDF" }))).toBe("needs-check");
  });
});

describe("summarizeItems", () => {
  it("空の入力ではすべて0", () => {
    const s = summarizeItems([]);
    expect(s.total).toBe(0);
    expect(s.settled).toBe(0);
    expect(s.unsettled).toBe(0);
  });

  it("決着と未決着の合計が総数と一致する", () => {
    const items = [
      item({ status: "IMPORTED", invoiceId: "a" }),
      item({ status: "DUPLICATE", invoiceId: "b" }),
      item({ status: "PENDING" }),
      item({ status: "FAILED" }),
      item({ status: "NOT_PDF" }),
      item({ status: "NOT_PDF", autoSkipped: true }),
      item({ status: "IMPORTED", invoiceId: null }),
    ];
    const s = summarizeItems(items);

    expect(s.total).toBe(7);
    expect(s.settled + s.unsettled).toBe(s.total);
  });

  it("未決着の内訳の合計が、未決着の総数と一致する", () => {
    const items = [
      item({ status: "PENDING" }),
      item({ status: "PENDING" }),
      item({ status: "IMPORTING" }),
      item({ status: "FAILED" }),
      item({ status: "UNREADABLE" }),
      item({ status: "TOO_LARGE" }),
      item({ status: "DUPLICATE", invoiceId: null }),
      item({ status: "IMPORTED", invoiceId: "x" }),
    ];
    const s = summarizeItems(items);

    expect(unsettledBreakdown(s)).toBe(s.unsettled);
    expect(s.pending).toBe(2);
    expect(s.needsCheck).toBe(2);
    expect(s.invoiceDeleted).toBe(1);
  });

  it("依頼の内訳が、状態ごとに分かれて数えられる", () => {
    const s = summarizeItems([
      item({ status: "LOGIN_REQUIRED" }),
      item({ status: "REQUEST_SENDING" }),
      item({ status: "REQUEST_SENT" }),
      item({ status: "REQUEST_SENT", repliedAt: new Date() }),
      item({ status: "REQUEST_FAILED" }),
    ]);

    expect(s.requestNeeded).toBe(1);
    expect(s.requestSending).toBe(1);
    expect(s.requestWaiting).toBe(1);
    expect(s.requestFailed).toBe(1);
    expect(s.replied).toBe(1);
    expect(s.settled).toBe(1);
    expect(unsettledBreakdown(s)).toBe(s.unsettled);
    expect(settledBreakdown(s)).toBe(s.settled);
  });

  it("決着の内訳の合計が、決着の総数と一致する", () => {
    const items = [
      item({ status: "IMPORTED", invoiceId: "a" }),
      item({ status: "DUPLICATE", invoiceId: "b" }),
      item({ status: "NOT_PDF", autoSkipped: true }),
      item({ status: "UNREADABLE", acknowledgedAt: new Date() }),
    ];
    const s = summarizeItems(items);

    expect(settledBreakdown(s)).toBe(s.settled);
    expect(s.settled).toBe(4);
  });

  it("どの状態を入れても、合計が崩れない", () => {
    // 状態を足したときに内訳の加算を書き忘れれば、ここで落ちる
    const items = Object.values(GmailItemStatus).map((status) => item({ status }));
    const s = summarizeItems(items);

    expect(s.settled + s.unsettled).toBe(s.total);
    expect(unsettledBreakdown(s)).toBe(s.unsettled);
    expect(settledBreakdown(s)).toBe(s.settled);
  });

  it("返信が来ている状態を混ぜても、合計が崩れない", () => {
    const items = Object.values(GmailItemStatus).map((status) =>
      item({ status, repliedAt: new Date() }),
    );
    const s = summarizeItems(items);

    expect(s.settled + s.unsettled).toBe(s.total);
    expect(unsettledBreakdown(s)).toBe(s.unsettled);
    expect(settledBreakdown(s)).toBe(s.settled);
  });
});

function unsettledBreakdown(s: ReturnType<typeof summarizeItems>): number {
  return (
    s.pending +
    s.importing +
    s.failed +
    s.needsCheck +
    s.invoiceDeleted +
    s.requestNeeded +
    s.requestSending +
    s.requestWaiting +
    s.requestFailed
  );
}

function settledBreakdown(s: ReturnType<typeof summarizeItems>): number {
  return s.imported + s.duplicate + s.autoSkipped + s.acknowledged + s.replied;
}

describe("messageScanComplete", () => {
  it("添付とリンクの両方を調べ終えていれば完了", () => {
    expect(messageScanComplete({ attachmentsScannedAt: new Date(), linksScannedAt: new Date() })).toBe(
      true,
    );
  });

  it("添付だけ調べていても完了にしない", () => {
    // 片方だけで完了にすると、URLの向こうにある請求書が
    // 「調べ終えた」扱いで画面から消える
    expect(messageScanComplete({ attachmentsScannedAt: new Date(), linksScannedAt: null })).toBe(false);
  });

  it("リンクだけ調べていても完了にしない", () => {
    expect(messageScanComplete({ attachmentsScannedAt: null, linksScannedAt: new Date() })).toBe(false);
  });

  it("どちらも調べていなければ未完了", () => {
    expect(messageScanComplete({ attachmentsScannedAt: null, linksScannedAt: null })).toBe(false);
  });
});
