import type { GmailScan } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { extractBody } from "./body";
import { getGmailClient } from "./client";
import { classifyAttachment } from "./classify";
import { connectedAddress, markRevoked, markSynced } from "./connection";
import { collectAttachmentParts, headerValue, parseFromHeader } from "./parts";
import { buildGmailQuery, inWindow } from "./query";
import { GmailAuthRevokedError } from "./types";
import type { FoundAttachment } from "./parts";

/**
 * 期間を指定してGmailを走査し、取り込み候補をDBに並べる。
 *
 * LLMは呼ばない。ここは「何があるか」を漏れなく数え上げるだけの工程で、
 * 実際の取り込み（1件ずつ・数十秒）とは分けてある。
 *
 * 1リクエストで走査しきらず、ブラウザがカーソルを渡し続ける形にしている。
 * メール数が多いと実行時間の上限を超えるため。
 */

/** 1チャンクの持ち時間。maxDuration(300秒)に対して十分な余裕を取る */
const CHUNK_BUDGET_MS = 55_000;

/** messages.get の並列度。上げるとGmailの分あたり上限(429)に触れる */
const FETCH_CONCURRENCY = 4;

const PAGE_SIZE = 500;

export interface ScanProgress {
  scanId: string;
  done: boolean;
  state: string;
  pageCount: number;
  listedMessageCount: number;
  inWindowMessageCount: number;
  inWindowThreadCount: number;
  itemCount: number;
  newItemCount: number;
  error: string | null;
}

/** 新しい走査を始める。期間は半開区間 [from, to) */
export async function startScan(params: {
  from: Date;
  to: Date;
  startedByEmail: string;
}): Promise<GmailScan> {
  const mailboxAddress = await connectedAddress();
  return prisma.gmailScan.create({
    data: {
      mailboxAddress,
      windowFrom: params.from,
      windowTo: params.to,
      query: buildGmailQuery(params.from, params.to),
      startedByEmail: params.startedByEmail,
      state: "RUNNING",
    },
  });
}

/**
 * 走査を1チャンク進める。
 *
 * 順序が命。行を書き終えてからカーソルを進めるので、途中で落ちても
 * カーソルが行より先に進むことはない。再開で同じページを読み直すが、
 * 一意制約により二重には作られない。
 */
export async function runScanChunk(scanId: string): Promise<ScanProgress> {
  const scan = await prisma.gmailScan.findUnique({ where: { id: scanId } });
  if (!scan) throw new Error("走査が見つかりません");
  if (scan.state === "COMPLETED") return progressOf(scan, true);
  if (scan.state === "ABANDONED") return progressOf(scan, true);

  const gmail = getGmailClient();
  const deadline = Date.now() + CHUNK_BUDGET_MS;

  let pageToken = scan.pageToken;
  let pageCount = scan.pageCount;
  let listed = scan.listedMessageCount;
  let newItems = scan.newItemCount;

  try {
    // RUNNING に戻す（前回 FAILED で止まっていた場合の再開）
    if (scan.state === "FAILED") {
      await prisma.gmailScan.update({ where: { id: scanId }, data: { state: "RUNNING", error: null } });
    }

    do {
      const page = await gmail.listMessages({ q: scan.query, pageToken, maxResults: PAGE_SIZE });
      listed += page.messages.length;

      const details = await mapWithConcurrency(page.messages, FETCH_CONCURRENCY, (m) =>
        gmail.getMessage(m.id),
      );

      for (const detail of details) {
        // 期間内かどうかの判定は internalDate だけで行う。
        // Gmailの検索演算子には前後1日のマージンを付けているので、余剰はここで落ちる
        if (!inWindow(detail.internalDate, scan.windowFrom, scan.windowTo)) continue;
        newItems += await upsertMessageAndItems(detail, scanId);
      }

      pageCount += 1;
      const nextToken = page.nextPageToken;

      // --- 行を書き終えた「あと」でカーソルを進める ---
      await persistCursor(scanId, {
        pageToken: nextToken,
        pageCount,
        listedMessageCount: listed,
        newItemCount: newItems,
        windowFrom: scan.windowFrom,
        windowTo: scan.windowTo,
      });

      // 同じカーソルが返ってきたら異常。偽の「完了」を作らないよう止める
      if (nextToken && nextToken === pageToken) {
        throw new Error("Gmailのページングが進みませんでした。時間をおいて再開してください");
      }
      pageToken = nextToken;

      if (!pageToken) {
        // 完了は推測ではなく「nextPageToken が尽きた」という事実でしか立てない
        const done = await prisma.gmailScan.update({
          where: { id: scanId },
          data: { state: "COMPLETED", finishedAt: new Date(), error: null },
        });
        await markSynced();
        return progressOf(done, true);
      }
    } while (Date.now() < deadline);

    const partial = await prisma.gmailScan.findUniqueOrThrow({ where: { id: scanId } });
    return progressOf(partial, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "走査に失敗しました";
    if (error instanceof GmailAuthRevokedError) await markRevoked(message);

    // カーソルは残したまま FAILED にする。黙って次へ進んで穴を空けない
    const failed = await prisma.gmailScan.update({
      where: { id: scanId },
      data: { state: "FAILED", error: message },
    });
    return progressOf(failed, false);
  }
}

/**
 * カーソルと件数を保存する。
 *
 * 期間内の件数は、走査の途中で数えた値ではなく行から数え直す。
 * 同じ期間を再走査したとき、既存の行はこの走査に付け替えないので、
 * 数えた値を足し込むと実態とずれるため。
 */
async function persistCursor(
  scanId: string,
  params: {
    pageToken: string | null;
    pageCount: number;
    listedMessageCount: number;
    newItemCount: number;
    windowFrom: Date;
    windowTo: Date;
  },
): Promise<void> {
  const counts = await countInWindow(params.windowFrom, params.windowTo);
  await prisma.gmailScan.update({
    where: { id: scanId },
    data: {
      pageToken: params.pageToken,
      pageCount: params.pageCount,
      listedMessageCount: params.listedMessageCount,
      newItemCount: params.newItemCount,
      ...counts,
    },
  });
}

async function countInWindow(from: Date, to: Date) {
  const where = { internalDate: { gte: from, lt: to } };
  const [messageCount, threads, itemCount] = await Promise.all([
    prisma.gmailMessage.count({ where }),
    prisma.gmailMessage.findMany({ where, select: { gmailThreadId: true }, distinct: ["gmailThreadId"] }),
    prisma.gmailItem.count({ where: { message: where } }),
  ]);
  return {
    inWindowMessageCount: messageCount,
    inWindowThreadCount: threads.length,
    itemCount,
  };
}

/**
 * メール1通と、その添付を書き込む。新しく作った候補の件数を返す。
 *
 * 添付が無いメールも必ず行を作る。行が無いと「添付が無かった」のか
 * 「見落とした」のかが後から区別できない。
 * （添付が無いメールは、第2段でURL請求書の候補にもなる）
 */
async function upsertMessageAndItems(
  detail: Awaited<ReturnType<ReturnType<typeof getGmailClient>["getMessage"]>>,
  scanId: string,
): Promise<number> {
  const headers = detail.payload?.headers;
  const fromRaw = headerValue(headers, "from") ?? "";
  const { name, address } = parseFromHeader(fromRaw);
  const subject = headerValue(headers, "subject");
  const attachments = collectAttachmentParts(detail.payload);

  // 本文のリンクは「何本あるか」だけ数える。どれが請求書かの判定は
  // 取り込み時にLLMで行う（走査でLLMを呼ぶと走査が遅くなり、チャンク分割を圧迫する）
  const body = extractBody(detail.payload);
  // 本文が別取得になっていて数えられなかった場合は -1。
  // 「リンクがあるかもしれない」側に倒して候補行を作る（取りこぼすより余分に作る）
  const linkCandidateCount = body.hasExternalBody && body.links.length === 0 ? -1 : body.links.length;

  const base = {
    gmailThreadId: detail.threadId,
    internalDate: new Date(detail.internalDate),
    fromRaw,
    fromName: name,
    fromAddress: address,
    subject,
    labelIds: detail.labelIds,
    attachmentCount: attachments.length,
    attachmentsScannedAt: new Date(),
    linkCandidateCount,
    linksScannedAt: new Date(),
  };

  const message = await prisma.gmailMessage.upsert({
    where: { gmailMessageId: detail.id },
    // scanId は「最初に見つけた走査」なので、再走査では書き換えない
    create: { gmailMessageId: detail.id, scanId, ...base },
    update: base,
  });

  const created = await upsertItems(message.id, attachments);
  return created + (await upsertLinkItem(message.id, linkCandidateCount));
}

/**
 * 本文のリンクを調べる作業を1行だけ作る（ref = "body" 固定）。
 *
 * URLごとに行を作らないのが要点。走査時点ではどれが請求書か分からないので、
 * URLごとに行を作ると配信停止リンクにも PENDING の行ができ、
 * 取り込みループが実際に叩きに行ってしまう。
 */
async function upsertLinkItem(messageId: string, linkCandidateCount: number): Promise<number> {
  if (linkCandidateCount === 0) return 0;

  const existing = await prisma.gmailItem.findFirst({
    where: { messageId, kind: "LINK", ref: LINK_REF },
    select: { id: true },
  });
  if (existing) {
    // 既存行の状態は触らない（判定済みのものを未処理へ戻さない）
    await prisma.gmailItem.update({ where: { id: existing.id }, data: { linkCandidateCount } });
    return 0;
  }

  await prisma.gmailItem.createMany({
    data: [{ messageId, kind: "LINK" as const, ref: LINK_REF, linkCandidateCount }],
    skipDuplicates: true,
  });
  return 1;
}

/** LINK候補の ref は定数。メール1通につき1行であることを表す */
export const LINK_REF = "body";

async function upsertItems(messageId: string, attachments: FoundAttachment[]): Promise<number> {
  if (attachments.length === 0) return 0;

  const existing = await prisma.gmailItem.findMany({
    where: { messageId, kind: "ATTACHMENT", ref: { in: attachments.map((a) => a.ref) } },
    select: { id: true, ref: true },
  });
  const byRef = new Map(existing.map((e) => [e.ref, e.id]));

  const fresh = attachments.filter((a) => !byRef.has(a.ref));
  if (fresh.length > 0) {
    await prisma.gmailItem.createMany({
      data: fresh.map((a) => {
        const klass = classifyAttachment(a);
        return {
          messageId,
          kind: "ATTACHMENT" as const,
          ref: a.ref,
          attachmentId: a.attachmentId,
          fileName: a.fileName,
          mimeType: a.mimeType,
          disposition: a.disposition,
          size: a.size,
          status: klass.kind === "pdf" ? ("PENDING" as const) : ("NOT_PDF" as const),
          message_: klass.kind === "pdf" ? null : klass.reason,
          autoSkipped: klass.kind === "auto-skip",
        };
      }),
      // 同時実行との競合に備える。一意制約が最終的な歯止め
      skipDuplicates: true,
    });
  }

  // 既存の候補は状態を触らない（取り込み済みを未処理へ戻してしまわないため）。
  // 取得用IDだけ、取り込み時に取り直せるよう最新に保つ
  for (const a of attachments) {
    const id = byRef.get(a.ref);
    if (id) await prisma.gmailItem.update({ where: { id }, data: { attachmentId: a.attachmentId } });
  }

  return fresh.length;
}

function progressOf(scan: GmailScan, done: boolean): ScanProgress {
  return {
    scanId: scan.id,
    done,
    state: scan.state,
    pageCount: scan.pageCount,
    listedMessageCount: scan.listedMessageCount,
    inWindowMessageCount: scan.inWindowMessageCount,
    inWindowThreadCount: scan.inWindowThreadCount,
    itemCount: scan.itemCount,
    newItemCount: scan.newItemCount,
    error: scan.error,
  };
}

/** 並列度を抑えて順に処理する。Gmailの分あたり上限に触れないため */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
