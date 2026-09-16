import type { GmailItem, GmailItemStatus, GmailMessage } from "@/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFileStore } from "@/lib/storage";
import { ingestPdf } from "@/lib/ingest";
import { extractBody } from "@/lib/gmail/body";
import { getGmailClient } from "@/lib/gmail/client";
import { markSynced } from "@/lib/gmail/connection";
import { findPartById } from "@/lib/gmail/parts";
import { isEncryptedPdf, looksLikePdf } from "@/lib/gmail/pdf";
import { staleImportingBefore } from "@/lib/gmail/status";
import { GmailNotConnectedError } from "@/lib/gmail/types";
import { getLinkPicker, resolvePick } from "@/lib/linkpick";
import { classifyFetched, fetchDocument, fileNameFromDownload } from "@/lib/safefetch";
import { decodeText } from "@/lib/gmail/charset";

// LLMでの読み取りに数十秒かかる。リンク経路はさらに判定と取得が加わる
export const maxDuration = 300;

/** 1通の請求書PDFの上限。これを超えるものは請求書ではない可能性が高い */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

type ItemWithMessage = GmailItem & { message: GmailMessage };

/** 終端状態と、そこへ落とす理由 */
interface Settled {
  status: GmailItemStatus;
  message: string;
  invoiceId?: string;
  url?: string;
  linkKind?: "PDF" | "LOGIN" | "OTHER";
  linkConfidence?: number;
  autoSkipped?: boolean;
}

/**
 * 取り込み候補を1件だけ取り込む。
 *
 * 1リクエスト1件にしてあるのは、LLMの読み取りが10〜40秒かかるため。
 * まとめて処理すると実行時間の上限を超え、進捗も分からなくなる。
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const { id } = await context.params;

  // --- 占有。別タブとの二重実行を防ぐ ---
  // sha256の一意制約が最後の砦だが、自分の行同士で「重複」になると画面が意味不明になる。
  //
  // 取り残された IMPORTING も占有し直す。実行時間の上限で打ち切られたり、
  // catch に入る前に落ちたりすると IMPORTING のまま残り、
  // これが無いと未決着のまま二度と拾い直せなくなる。
  // ★時刻の条件込みで1回の updateMany に収めてあるので、占有の原子性は変わらない。
  //   先に読んで判定してから更新すると、その隙に別のリクエストが入る。
  const claimed = await prisma.gmailItem.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "IMPORTING", lastAttemptAt: { lt: staleImportingBefore() } },
      ],
    },
    data: { status: "IMPORTING", attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  });
  if (claimed.count !== 1) {
    const current = await prisma.gmailItem.findUnique({ where: { id }, select: { status: true } });
    return Response.json(
      { state: "skipped", status: current?.status ?? null, message: "対象外の状態です" },
      { status: 200 },
    );
  }

  const item = await prisma.gmailItem.findUnique({ where: { id }, include: { message: true } });
  if (!item) return Response.json({ error: "対象が見つかりません" }, { status: 404 });

  try {
    const settled = item.kind === "LINK" ? await importLink(item) : await importAttachment(item);

    const updated = await prisma.gmailItem.update({
      where: { id },
      data: {
        status: settled.status,
        message_: settled.message,
        invoiceId: settled.invoiceId ?? null,
        url: settled.url ?? item.url,
        linkKind: settled.linkKind ?? item.linkKind,
        linkConfidence: settled.linkConfidence ?? item.linkConfidence,
        autoSkipped: settled.autoSkipped ?? item.autoSkipped,
      },
    });
    await markSynced();

    return Response.json(
      { state: updated.status, message: settled.message, invoiceId: updated.invoiceId },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof GmailNotConnectedError
        ? error.message
        : error instanceof Error
          ? error.message
          : "取り込みに失敗しました";

    // どんな例外でも IMPORTING のまま放置しない。必ず再試行できる状態に落とす
    await prisma.gmailItem
      .update({ where: { id }, data: { status: "FAILED", message_: message } })
      .catch(() => undefined);

    return Response.json({ state: "FAILED", error: message }, { status: 500 });
  }
}

/** 添付PDFの取り込み（第1段からの経路。挙動は変えていない） */
async function importAttachment(item: ItemWithMessage): Promise<Settled> {
  const gmail = getGmailClient();

  // attachmentId は走査時点の値で、古くなっている可能性がある。必ず取り直す
  const detail = await gmail.getMessage(item.message.gmailMessageId);
  const part = findPartById(detail.payload, item.ref);
  const attachmentId = part?.body?.attachmentId;
  if (!attachmentId) {
    return { status: "FAILED", message: "添付が見つかりません（メールが変更された可能性があります）" };
  }

  const pdf = await gmail.getAttachment(item.message.gmailMessageId, attachmentId);
  return ingestFetchedPdf(item, pdf, item.fileName ?? "invoice.pdf");
}

/**
 * 本文のリンクから取り込む。
 *
 * 本文中の全URLを叩かない。先にLLMに絞らせて、選ばれた1〜2本だけを取得する。
 * 配信停止・退会リンクをサーバーが勝手に押すのを防ぐため。
 */
async function importLink(item: ItemWithMessage): Promise<Settled> {
  const gmail = getGmailClient();

  // 走査時の値は使わず、本文を取り直す
  const detail = await gmail.getMessage(item.message.gmailMessageId);
  const body = extractBody(detail.payload);

  if (body.links.length === 0) {
    return {
      status: "NOT_PDF",
      message: "本文にリンクがありませんでした",
      linkKind: "OTHER",
      autoSkipped: true,
    };
  }

  const picked = await getLinkPicker().pick({
    subject: item.message.subject,
    fromRaw: item.message.fromRaw,
    bodyText: body.text,
    links: body.links.map((l) => ({ url: l.url, anchorText: l.anchorText })),
  });
  if (!picked.ok) return { status: "FAILED", message: `リンクの判定に失敗しました: ${picked.error}` };

  const resolved = resolvePick(picked.data, body.links);
  if (resolved.kind === "invalid") {
    return { status: "FAILED", message: `リンクの判定結果が不正です: ${resolved.reason}` };
  }
  if (resolved.kind === "none") {
    // 請求書のリンクが無いメールは自動で脇に寄せる。
    // こうしないとURLを含むメールほぼ全部が「要確認」になり、本当に見るべきものが埋もれる。
    // 判断の理由は残すので、後から監査できる
    return {
      status: "NOT_PDF",
      message: `請求書のリンクはありませんでした（${resolved.reason}）`,
      linkKind: "OTHER",
      linkConfidence: resolved.confidence,
      autoSkipped: true,
    };
  }
  if (resolved.kind === "login-required") {
    return {
      status: "LOGIN_REQUIRED",
      message: `ログインが必要なリンクです。取引先にPDFでの送付を依頼してください（${resolved.reason}）`,
      url: resolved.url,
      linkKind: "LOGIN",
      linkConfidence: resolved.confidence,
    };
  }

  // 第1候補が外れたら第2候補を試す
  const urls = [resolved.url, resolved.fallbackUrl].filter((u): u is string => u !== null);
  let last: Settled | null = null;
  for (const url of urls) {
    const outcome = await tryDownload(item, url, resolved.confidence);
    if (outcome.status === "IMPORTED" || outcome.status === "DUPLICATE") return outcome;
    last = outcome;
  }
  return last ?? { status: "FAILED", message: "取得できませんでした" };
}

async function tryDownload(item: ItemWithMessage, url: string, confidence: number): Promise<Settled> {
  const fetched = await fetchDocument(url);

  if (fetched.kind === "blocked") {
    // 内部アドレスへの到達を止めた。攻撃か、単に壊れたURLか区別できないので理由を残す
    return { status: "FAILED", message: `このURLは取得できません: ${fetched.reason}`, url, linkKind: "OTHER" };
  }
  if (fetched.kind === "too-large") {
    return { status: "TOO_LARGE", message: "リンク先のファイルが上限(20MB)を超えています", url, linkKind: "PDF" };
  }
  if (fetched.kind === "network") {
    return { status: "FAILED", message: `リンク先に接続できませんでした: ${fetched.reason}`, url };
  }

  const bodyText = fetched.body.length > 0 ? decodeText(fetched.body.subarray(0, 64 * 1024), fetched.charset) : null;
  const klass = classifyFetched({
    status: fetched.status,
    contentType: fetched.contentType,
    hops: fetched.hops,
    body: fetched.body,
    bodyText,
  });

  if (klass.kind === "login-required") {
    return {
      status: "LOGIN_REQUIRED",
      message: `${klass.reason}。取引先にPDFでの送付を依頼してください`,
      url,
      linkKind: "LOGIN",
      linkConfidence: confidence,
    };
  }
  if (klass.kind === "not-pdf") {
    return { status: "NOT_PDF", message: klass.reason, url, linkKind: "OTHER", linkConfidence: confidence };
  }
  if (klass.kind === "failed") {
    return { status: "FAILED", message: klass.reason, url, linkKind: "PDF", linkConfidence: confidence };
  }

  const fileName = fileNameFromDownload({
    contentDisposition: fetched.contentDisposition,
    finalUrl: fetched.finalUrl,
    fallback: "invoice.pdf",
  });
  const settled = await ingestFetchedPdf(item, fetched.body, fileName);
  return { ...settled, url, linkKind: "PDF", linkConfidence: confidence };
}

/**
 * 手に入れたPDFを取り込む。添付経路とリンク経路で共通。
 *
 * MIMEタイプや拡張子は送信側の申告にすぎないので、必ず実体で判定してからLLMに渡す。
 * ここで落としたものは黙って消えず、人の確認待ちとして残る。
 */
async function ingestFetchedPdf(
  item: ItemWithMessage,
  pdf: Buffer,
  fileName: string,
): Promise<Settled> {
  if (pdf.length > MAX_PDF_BYTES) {
    return {
      status: "TOO_LARGE",
      message: `サイズが上限(20MB)を超えています（${Math.round(pdf.length / 1024 / 1024)}MB）`,
    };
  }
  if (!looksLikePdf(pdf)) {
    return { status: "NOT_PDF", message: "PDFとして読めませんでした（中身がPDFではありません）" };
  }
  if (isEncryptedPdf(pdf)) {
    return {
      status: "UNREADABLE",
      message: "パスワードが掛かっていて開けません。送信元に解除をご依頼ください",
    };
  }

  const stored = await getFileStore().put(fileName, pdf, "application/pdf");
  const result = await ingestPdf({
    pdf,
    fileName,
    stored,
    fileSize: pdf.length,
    origin: {
      source: "GMAIL",
      gmailMessageId: item.message.gmailMessageId,
      gmailFrom: item.message.fromAddress,
      gmailSubject: item.message.subject,
      gmailReceivedAt: item.message.internalDate,
    },
  });

  switch (result.kind) {
    case "duplicate":
      return {
        status: "DUPLICATE",
        message: `同じ内容のPDFが既に取り込まれています（${result.existingFileName}）`,
        invoiceId: result.existingId,
      };
    case "extraction_failed":
      // 請求書としては取り込めている（画面で手入力できる）ので IMPORTED にする。
      // 読み取り失敗そのものは請求書側の status が示す
      return {
        status: "IMPORTED",
        message: `取り込みましたが読み取りに失敗しました: ${result.error}`,
        invoiceId: result.invoice.id,
      };
    case "created":
      return { status: "IMPORTED", message: "取り込みました", invoiceId: result.invoice.id };
  }
}
