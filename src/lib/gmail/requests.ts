import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getGmailClient } from "./client";
import { connectedAddress, sendCapability } from "./connection";
import { headerValue } from "./parts";
import { replyArrivedAt, replyWithoutAttachmentAt } from "./reply";
import type { ThreadMessageLike } from "./reply";
import { replyWaitLevel } from "./replyWait";
import type { ReplyWaitLevel } from "./replyWait";
import {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  hasUnresolvedPlaceholders,
  looksUnreplyable,
  renderTemplate,
  todayLabel,
} from "./requestTemplate";
import type { RequestVars } from "./requestTemplate";
import { buildRfc2822, isSendableAddress, sanitizeHeaderValue } from "./rfc2822";
import type { ItemLike } from "./status";
import { canThread } from "./threading";

/**
 * PDF送付の依頼メール（DBに触る層）。
 *
 * 判断はすべて純関数（reply / replyWait / requestTemplate / rfc2822 / threading）に出し、
 * ここは「DBから読む・書く」と「Gmailに投げる」だけにしてある。
 */

/** 依頼の対象になりうる状態。LINK かつこの状態の行だけが依頼画面に出る */
const REQUEST_STATUSES = [
  "LOGIN_REQUIRED",
  "REQUEST_SENDING",
  "REQUEST_SENT",
  "REQUEST_FAILED",
] as const;

/** 同じ宛先へ続けて送っていないかを見る期間。警告するだけでブロックはしない */
export const COOLDOWN_DAYS = 7;

// --- 決着判定のための返信検出 ---------------------------------------------

type ItemForSettlement = Omit<ItemLike, "repliedAt"> & {
  requestSentAt: Date | null;
  message: { gmailThreadId: string };
};

/**
 * 候補に「返信が来たか」を付けて返す。
 *
 * ItemLike.repliedAt は必須フィールドなので、この関数を通さずに集計しようとすると
 * 型エラーで止まる（渡し忘れると、依頼を無視された請求書が「済」で消えてしまう）。
 */
export async function attachReplies<T extends ItemForSettlement>(
  items: T[],
  mailboxAddress: string,
): Promise<(T & { repliedAt: Date | null })[]> {
  const waiting = items.filter((i) => i.status === "REQUEST_SENT" && i.requestSentAt !== null);
  if (waiting.length === 0) return items.map((i) => ({ ...i, repliedAt: null }));

  const messages = await threadMessagesSince(waiting);

  return items.map((item) => ({
    ...item,
    repliedAt:
      item.status === "REQUEST_SENT" && item.requestSentAt
        ? replyArrivedAt({
            threadId: item.message.gmailThreadId,
            sentAt: item.requestSentAt,
            mailboxAddress,
            messages,
          })
        : null,
  }));
}

/** 依頼を送ったスレッドの、送信後に届いたメールだけを読む */
async function threadMessagesSince(
  waiting: { requestSentAt: Date | null; message: { gmailThreadId: string } }[],
): Promise<ThreadMessageLike[]> {
  const threadIds = [...new Set(waiting.map((i) => i.message.gmailThreadId))];
  const earliest = new Date(
    Math.min(...waiting.map((i) => i.requestSentAt?.getTime() ?? Number.POSITIVE_INFINITY)),
  );

  return prisma.gmailMessage.findMany({
    where: { gmailThreadId: { in: threadIds }, internalDate: { gt: earliest } },
    select: {
      gmailThreadId: true,
      internalDate: true,
      fromAddress: true,
      labelIds: true,
      attachmentCount: true,
    },
  });
}

/**
 * 集計用。期間で絞った候補を、返信状況つきで読む。
 *
 * 併せて「14日以上返信が来ていない依頼」の件数も返す。
 * 件数の集計（status.ts）は純関数で日時を持たないので、経過日数はここで数える。
 */
export async function itemsForSummary(
  messageWhere: Prisma.GmailMessageWhereInput,
  mailboxAddress: string,
  now: Date,
): Promise<{ items: ItemLike[]; requestOverdue: number }> {
  const rows = await prisma.gmailItem.findMany({
    where: { message: messageWhere },
    select: {
      status: true,
      invoiceId: true,
      acknowledgedAt: true,
      autoSkipped: true,
      requestSentAt: true,
      message: { select: { gmailThreadId: true } },
    },
  });
  const items = await attachReplies(rows, mailboxAddress);

  const requestOverdue = items.filter(
    (i) =>
      i.status === "REQUEST_SENT" &&
      i.repliedAt === null &&
      i.requestSentAt !== null &&
      replyWaitLevel(i.requestSentAt, now) === "critical",
  ).length;

  return { items, requestOverdue };
}

/**
 * サブタブに出す件数。
 *
 * 見に行かなくてもタブに数字が出続けること自体が、
 * 「返信待ちが溜まっている」の可視化になる。
 */
export async function requestBadgeCounts(): Promise<{ unsent: number; waiting: number }> {
  let mailbox: string;
  try {
    mailbox = await connectedAddress();
  } catch {
    return { unsent: 0, waiting: 0 };
  }

  const [unsent, sentRows] = await Promise.all([
    prisma.gmailItem.count({
      where: {
        kind: "LINK",
        status: { in: ["LOGIN_REQUIRED", "REQUEST_SENDING", "REQUEST_FAILED"] },
        acknowledgedAt: null,
      },
    }),
    prisma.gmailItem.findMany({
      where: { kind: "LINK", status: "REQUEST_SENT", acknowledgedAt: null },
      select: {
        status: true,
        requestSentAt: true,
        invoiceId: true,
        acknowledgedAt: true,
        autoSkipped: true,
        message: { select: { gmailThreadId: true } },
      },
    }),
  ]);

  // 返信が届いたものはバッジから外す（人がやることはもう無い）
  const waiting = (await attachReplies(sentRows, mailbox)).filter((r) => r.repliedAt === null);
  return { unsent, waiting: waiting.length };
}

// --- 依頼画面に出す一覧 ---------------------------------------------------

export interface RequestRow {
  id: string;
  status: (typeof REQUEST_STATUSES)[number];
  /** ログインが要ると判定したURL。人がGmailで元メールを探す手がかりにもなる */
  url: string | null;
  /** 判定理由（日本語） */
  reason: string | null;

  /** 宛先の候補。元メールの差出人 */
  toAddress: string | null;
  vendorName: string;
  originalSubject: string | null;
  receivedAt: Date;
  gmailThreadId: string;

  /** ひな型を展開した既定の件名・本文。画面でそのまま編集できる */
  subject: string;
  body: string;
  /** 送ると元のスレッドへの返信になるか */
  threads: boolean;
  /** 返信を受け付けない宛先の可能性 */
  unreplyable: boolean;
  /** 同じ宛先へ COOLDOWN_DAYS 以内に送っていれば、その日時 */
  recentlySentAt: Date | null;

  // --- 送信済みのもの ---
  requestSentAt: Date | null;
  requestToAddress: string | null;
  requestError: string | null;
  requestAttemptCount: number;
  repliedAt: Date | null;
  /** 添付なしの返信だけが来ている場合。決着にはしない */
  repliedWithoutAttachmentAt: Date | null;
  waitLevel: ReplyWaitLevel | null;
}

export interface RequestQueue {
  /** まだ送っていない（LOGIN_REQUIRED / REQUEST_FAILED / 送信中のまま止まったもの） */
  unsent: RequestRow[];
  /** 送って返信を待っている。返信が来たものも、人が確認できるよう一定期間は残す */
  waiting: RequestRow[];
}

/** 差し込み変数のうち、行によらない部分 */
export interface RequestContext {
  mailboxAddress: string;
  /** 自社名。振込依頼人名（銀行に届け出ている名義）を使う */
  companyName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  now: Date;
}

export async function loadRequestContext(now: Date, mailboxAddress: string): Promise<RequestContext> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  return {
    mailboxAddress,
    companyName: setting?.requesterName ?? "",
    // null は「既定のまま」。既定文面はコード側に置いてあるので、
    // 文面を直してもマイグレーションは要らず、古い行が古い文面を持ち続けることもない
    subjectTemplate: setting?.requestMailSubject ?? DEFAULT_SUBJECT,
    bodyTemplate: setting?.requestMailBody ?? DEFAULT_BODY,
    now,
  };
}

export async function loadRequestQueue(context: RequestContext): Promise<RequestQueue> {
  const rows = await prisma.gmailItem.findMany({
    where: { kind: "LINK", status: { in: [...REQUEST_STATUSES] }, acknowledgedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      url: true,
      message_: true,
      requestSentAt: true,
      requestToAddress: true,
      requestError: true,
      requestAttemptCount: true,
      message: {
        select: {
          fromAddress: true,
          fromName: true,
          subject: true,
          internalDate: true,
          gmailThreadId: true,
        },
      },
    },
  });

  const withReplies = await attachReplies(
    rows.map((r) => ({
      ...r,
      // attachReplies は決着判定の型に合わせてある。ここでは repliedAt だけが要る
      invoiceId: null,
      acknowledgedAt: null,
      autoSkipped: false,
    })),
    context.mailboxAddress,
  );

  // 添付なしの返信（「承知しました」だけ）は決着にしないが、画面では区別して出す
  const noAttachmentReplies = await noAttachmentReplyMap(rows, context.mailboxAddress);
  const recent = await recentlySentMap(rows.map((r) => r.message.fromAddress), context.now);

  const queue: RequestQueue = { unsent: [], waiting: [] };

  for (const row of withReplies) {
    const vendorName = vendorNameOf(row.message.fromName, row.message.fromAddress);
    const vars: RequestVars = {
      取引先名: vendorName,
      元の件名: row.message.subject ?? "",
      受取アドレス: context.mailboxAddress,
      自社名: context.companyName,
      今日: todayLabel(context.now),
    };
    const subject = sanitizeHeaderValue(renderTemplate(context.subjectTemplate, vars).text);
    const body = renderTemplate(context.bodyTemplate, vars).text;
    const toAddress = row.message.fromAddress;

    const entry: RequestRow = {
      id: row.id,
      status: row.status as RequestRow["status"],
      url: row.url,
      reason: row.message_,
      toAddress,
      vendorName,
      originalSubject: row.message.subject,
      receivedAt: row.message.internalDate,
      gmailThreadId: row.message.gmailThreadId,
      subject,
      body,
      threads: canThread(subject, row.message.subject),
      unreplyable: toAddress !== null && looksUnreplyable(toAddress),
      recentlySentAt: toAddress ? (recent.get(toAddress) ?? null) : null,
      requestSentAt: row.requestSentAt,
      requestToAddress: row.requestToAddress,
      requestError: row.requestError,
      requestAttemptCount: row.requestAttemptCount,
      repliedAt: row.repliedAt,
      repliedWithoutAttachmentAt: noAttachmentReplies.get(row.id) ?? null,
      waitLevel: row.requestSentAt ? replyWaitLevel(row.requestSentAt, context.now) : null,
    };

    if (row.status === "REQUEST_SENT") queue.waiting.push(entry);
    else queue.unsent.push(entry);
  }

  // 返信待ちは古い順（待たせている順）に見せる
  queue.waiting.sort((a, b) => (a.requestSentAt?.getTime() ?? 0) - (b.requestSentAt?.getTime() ?? 0));
  return queue;
}

/** 表示名が無ければアドレスのドメインを出す。空欄で「 ご担当者様」と送らないため */
function vendorNameOf(fromName: string | null, fromAddress: string | null): string {
  if (fromName && fromName.trim() !== "") return fromName.trim();
  const domain = fromAddress?.split("@")[1];
  return domain ?? fromAddress ?? "";
}

async function noAttachmentReplyMap(
  rows: { id: string; status: string; requestSentAt: Date | null; message: { gmailThreadId: string } }[],
  mailboxAddress: string,
): Promise<Map<string, Date>> {
  const waiting = rows.filter((r) => r.status === "REQUEST_SENT" && r.requestSentAt !== null);
  const map = new Map<string, Date>();
  if (waiting.length === 0) return map;

  const messages = await threadMessagesSince(waiting);
  for (const row of waiting) {
    const at = replyWithoutAttachmentAt({
      threadId: row.message.gmailThreadId,
      sentAt: row.requestSentAt!,
      mailboxAddress,
      messages,
    });
    if (at) map.set(row.id, at);
  }
  return map;
}

/**
 * 同じ宛先に最近送っていないか。
 *
 * ★ブロックはしない。同じポータル経由で複数の請求が届くのは正当なので、
 * 止めると正しい依頼が出せなくなる。人が気付けるように出すだけにする。
 */
async function recentlySentMap(
  addresses: (string | null)[],
  now: Date,
): Promise<Map<string, Date>> {
  const targets = [...new Set(addresses.filter((a): a is string => a !== null))];
  const map = new Map<string, Date>();
  if (targets.length === 0) return map;

  const since = new Date(now.getTime() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const sent = await prisma.gmailRequestMail.findMany({
    where: { toAddress: { in: targets }, sentAt: { gte: since } },
    orderBy: { sentAt: "desc" },
    select: { toAddress: true, sentAt: true },
  });
  for (const row of sent) {
    if (row.sentAt && !map.has(row.toAddress)) map.set(row.toAddress, row.sentAt);
  }
  return map;
}

// --- 送信 -----------------------------------------------------------------

export interface SendRequestInput {
  itemId: string;
  to: string;
  subject: string;
  body: string;
  actorEmail: string;
}

export type SendRequestResult = { ok: boolean; message: string };

/**
 * 依頼メールを1通送る。
 *
 * 二重送信を防ぐ層は4つあり、1がこの関数の本体:
 *   1. 状態の原子的占有（updateMany の count で判定する）
 *   2. 送信APIを自動再試行しない（client.ts の sendMessage）
 *   3. 同一宛先への短期間の再送を警告（画面。ブロックはしない）
 *   4. REQUEST_FAILED を「押せば直る状態」にしない（文言で誘導）
 */
export async function sendRequestMail(input: SendRequestInput): Promise<SendRequestResult> {
  const to = input.to.trim();
  const subject = sanitizeHeaderValue(input.subject);
  const body = input.body;

  if (!isSendableAddress(to)) {
    return { ok: false, message: "宛先のメールアドレスが正しくありません" };
  }
  if (subject === "") return { ok: false, message: "件名を入力してください" };
  if (body.trim() === "") return { ok: false, message: "本文を入力してください" };
  // 展開しきれていない差し込みが残ったまま送らない（「{{取引先名}} ご担当者様」を送らない）
  if (hasUnresolvedPlaceholders(subject) || hasUnresolvedPlaceholders(body)) {
    return { ok: false, message: "本文に未展開の差し込み（{{…}}）が残っています" };
  }

  const capability = await sendCapability();
  if (!capability.canSend) return { ok: false, message: capability.message };

  // --- 1. 状態の原子的占有。ここを通れるのは1リクエストだけ ---
  const claimed = await prisma.gmailItem.updateMany({
    where: { id: input.itemId, kind: "LINK", status: { in: ["LOGIN_REQUIRED", "REQUEST_FAILED"] } },
    data: {
      status: "REQUEST_SENDING",
      requestAttemptCount: { increment: 1 },
      lastRequestAttemptAt: new Date(),
      requestError: null,
    },
  });
  if (claimed.count !== 1) {
    const current = await prisma.gmailItem.findUnique({
      where: { id: input.itemId },
      select: { status: true, requestSentAt: true },
    });
    if (current?.status === "REQUEST_SENT") {
      return {
        ok: false,
        message: `既に送信済みです（${current.requestSentAt?.toLocaleString("ja-JP") ?? "日時不明"}）`,
      };
    }
    if (current?.status === "REQUEST_SENDING") {
      return { ok: false, message: "送信処理中です。しばらくしてから画面を更新してください" };
    }
    return { ok: false, message: "この候補は依頼の対象ではありません" };
  }

  const item = await prisma.gmailItem.findUniqueOrThrow({
    where: { id: input.itemId },
    select: {
      message: { select: { subject: true, gmailMessageId: true, gmailThreadId: true } },
    },
  });

  const client = getGmailClient();

  // 元メールの Message-ID は保存していないので、送信直前に読む。
  // 列を増やすより、月に数件の送信でAPIを1回多く叩くほうが安い
  let inReplyTo: string | null = null;
  let references: string | null = null;
  try {
    const detail = await client.getMessage(item.message.gmailMessageId);
    inReplyTo = headerValue(detail.payload?.headers, "message-id");
    const priorRefs = headerValue(detail.payload?.headers, "references");
    references = [priorRefs, inReplyTo].filter(Boolean).join(" ") || null;
  } catch {
    // 読めなくても送信そのものは続ける。スレッドに入らないだけ
  }

  // Gmailは件名が一致しないとスレッドに入れない（黙って新規メールになる）。
  // 一致しないと分かっているなら threadId を渡さず、新規メールとして送る
  const threads = canThread(subject, item.message.subject);

  const raw = buildRfc2822({
    from: capability.fromAddress,
    fromName: await fromNameOf(),
    to,
    subject,
    body,
    inReplyTo: threads ? inReplyTo : null,
    references: threads ? references : null,
  });

  try {
    const sent = await client.sendMessage({
      raw,
      threadId: threads ? item.message.gmailThreadId : null,
    });
    const sentAt = new Date();

    await prisma.$transaction([
      prisma.gmailRequestMail.create({
        data: {
          itemId: input.itemId,
          fromAddress: capability.fromAddress,
          toAddress: to,
          subject,
          body,
          threadedTo: threads ? item.message.gmailThreadId : null,
          sentGmailMessageId: sent.id,
          sentGmailThreadId: sent.threadId,
          sentAt,
          sentByEmail: input.actorEmail,
        },
      }),
      prisma.gmailItem.update({
        where: { id: input.itemId },
        data: {
          status: "REQUEST_SENT",
          requestSentAt: sentAt,
          requestToAddress: to,
          requestError: null,
          message_: `${to} に請求書の送付を依頼しました`,
        },
      }),
    ]);

    return {
      ok: true,
      message: threads
        ? `${to} に送信しました（元のメールへの返信）`
        : `${to} に送信しました（新規メール）`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "送信に失敗しました";

    // ★失敗しても控えの行は残す。「送れたか分からない」こと自体が人に必要な情報になる
    await prisma.$transaction([
      prisma.gmailRequestMail.create({
        data: {
          itemId: input.itemId,
          fromAddress: capability.fromAddress,
          toAddress: to,
          subject,
          body,
          threadedTo: threads ? item.message.gmailThreadId : null,
          sentByEmail: input.actorEmail,
          error: message,
        },
      }),
      prisma.gmailItem.update({
        where: { id: input.itemId },
        data: { status: "REQUEST_FAILED", requestToAddress: to, requestError: message },
      }),
    ]);

    return {
      ok: false,
      message: `送信できませんでした: ${message}（Gmailの「送信済み」を確認してから再送してください）`,
    };
  }
}

async function fromNameOf(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({
    where: { id: "default" },
    select: { requestMailFromName: true },
  });
  return setting?.requestMailFromName ?? null;
}

/**
 * 依頼しないと人が判断した記録。
 *
 * 決着させる唯一の手動経路。LOGIN_REQUIRED のまま放置されるより、
 * 「今回は依頼しない」と記録が残るほうが、後から見て意味が分かる。
 */
export async function skipRequest(params: {
  itemId: string;
  actorEmail: string;
  reason: string;
}): Promise<SendRequestResult> {
  const updated = await prisma.gmailItem.updateMany({
    where: { id: params.itemId, kind: "LINK", status: { in: [...REQUEST_STATUSES] } },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedEmail: params.actorEmail,
      acknowledgeReason: params.reason || "依頼しないと判断",
    },
  });
  if (updated.count !== 1) return { ok: false, message: "対象が見つかりませんでした" };
  return { ok: true, message: "依頼しないものとして記録しました" };
}
