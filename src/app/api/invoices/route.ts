import { createHash } from "node:crypto";
import { del, get } from "@vercel/blob";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getInvoiceExtractor } from "@/lib/extraction";
import { digitsOnly, parseIsoDate } from "@/lib/invoices";

// LLMでの読み取りに数十秒かかるため、実行時間の上限を引き上げる（Vercel Proが必要）
export const maxDuration = 300;

const BodySchema = z.object({
  pathname: z.string().min(1),
  url: z.string().url(),
  fileName: z.string().min(1),
  size: z.number().int().positive(),
});

/**
 * ブラウザがBlobへ上げ終わったPDFを取り込み、読み取りまで行う。
 *
 * SHA-256はクライアントの申告を信用せず、必ずサーバーが実体から計算する。
 * ここの一意制約が同じ請求書の二重取込＝二重振込を防ぐ最後の砦になるため。
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }
  const { pathname, url, fileName, size } = parsed.data;

  // --- 実体を取得してハッシュを計算 ---
  let pdf: Buffer;
  try {
    const blob = await get(pathname, { access: "private" });
    if (!blob) throw new Error("blob not found");
    pdf = Buffer.from(await new Response(blob.stream).arrayBuffer());
  } catch {
    return Response.json({ error: "アップロードしたファイルを読み込めませんでした" }, { status: 400 });
  }

  const sha256 = createHash("sha256").update(pdf).digest("hex");

  const duplicate = await prisma.invoice.findUnique({
    where: { sha256 },
    select: { id: true, fileName: true, createdAt: true },
  });
  if (duplicate) {
    // 重複分のBlobは残さない
    await del(pathname).catch(() => {});
    return Response.json(
      {
        error: "duplicate",
        message: `同じ内容のPDFが既に取り込まれています（${duplicate.fileName}）`,
        existingId: duplicate.id,
      },
      { status: 409 },
    );
  }

  const invoice = await prisma.invoice.create({
    data: {
      fileName,
      blobUrl: url,
      blobPathname: pathname,
      sha256,
      fileSize: size,
      status: "NEEDS_REVIEW",
    },
  });

  // --- 読み取り ---
  const result = await getInvoiceExtractor().extract(pdf, fileName);

  await prisma.extractionRun.create({
    data: {
      invoiceId: invoice.id,
      model: result.meta.model,
      promptVersion: result.meta.promptVersion,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
      latencyMs: result.meta.latencyMs,
      rawResponse: result.ok ? (result.data as object) : undefined,
      error: result.ok ? undefined : result.error,
    },
  });

  if (!result.ok) {
    const failed = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "EXTRACTION_FAILED", extractionError: result.error },
    });
    return Response.json({ invoice: failed, extracted: false, error: result.error }, { status: 201 });
  }

  const d = result.data;
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      vendorName: d.vendorName,
      bankCode: digitsOnly(d.bankCode),
      bankName: d.bankName,
      branchCode: digitsOnly(d.branchCode),
      branchName: d.branchName,
      accountType: d.accountType,
      accountNumber: digitsOnly(d.accountNumber),
      recipientName: d.recipientName,
      invoiceNumber: d.invoiceNumber,
      issueDate: parseIsoDate(d.issueDate),
      dueDate: parseIsoDate(d.dueDate),
      billedAmount: d.billedAmount,
      confidence: d.confidence,
      note: d.notes,
      status: "NEEDS_REVIEW",
    },
  });

  return Response.json({ invoice: updated, extracted: true }, { status: 201 });
}
