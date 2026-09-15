import { createHash } from "node:crypto";
import type { Invoice } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getInvoiceExtractor } from "@/lib/extraction";
import { getFileStore } from "@/lib/storage";
import type { StoredFile } from "@/lib/storage";
import { digitsOnly, parseIsoDate } from "@/lib/invoices";
import { describeMatch, fillFromVendor, matchVendor } from "@/lib/vendors";

/**
 * 取り込み元。
 *
 * どの経路で来たPDFでも、保管先へ置き終えたあとの処理（ハッシュ計算・二重取込の判定・
 * 読み取り・取引先マスタとの照合）は完全に同じなので、違いはここだけに閉じる。
 */
export type IngestOrigin =
  | { source: "UPLOAD" }
  | {
      source: "GMAIL";
      gmailMessageId: string;
      gmailFrom: string | null;
      gmailSubject: string | null;
      gmailReceivedAt: Date;
    };

export interface IngestInput {
  /** PDFの実体。SHA-256はこれから計算する。クライアントの申告は一切信用しない */
  pdf: Buffer;
  fileName: string;
  /** 既に保管先へ置き終えた実体の識別子 */
  stored: StoredFile;
  fileSize: number;
  origin: IngestOrigin;
}

export type IngestResult =
  /** 同じ内容のPDFが既にあった。保管した実体はこの関数が削除済み */
  | { kind: "duplicate"; existingId: string; existingFileName: string; message: string }
  /** 請求書は作れたが読み取りに失敗した。status は EXTRACTION_FAILED */
  | { kind: "extraction_failed"; invoice: Invoice; error: string }
  /** 取り込み・読み取り・取引先照合まで成功した */
  | { kind: "created"; invoice: Invoice };

/**
 * 保管先へ置き終えたPDFを取り込み、読み取りと取引先マスタとの照合まで行う。
 *
 * SHA-256は必ずここで実体から計算する。この一意制約が、同じ請求書の
 * 二重取込＝二重振込を防ぐ最後の砦になるため。
 *
 * 請求書の行を作ってから読み取る順序を守ること。読み取りで落ちても行が残り、
 * 画面から見えて手入力で補完できる。
 */
export async function ingestPdf(input: IngestInput): Promise<IngestResult> {
  const { pdf, fileName, stored, fileSize, origin } = input;

  const sha256 = createHash("sha256").update(pdf).digest("hex");

  const duplicate = await prisma.invoice.findUnique({
    where: { sha256 },
    select: { id: true, fileName: true },
  });
  if (duplicate) {
    // 重複分のファイルは残さない。呼び出し側に任せるとどこかで必ず忘れ、
    // private ブロブにゴミが溜まり続ける
    await getFileStore().delete(stored.pathname).catch(() => {});
    return {
      kind: "duplicate",
      existingId: duplicate.id,
      existingFileName: duplicate.fileName,
      message: `同じ内容のPDFが既に取り込まれています（${duplicate.fileName}）`,
    };
  }

  const invoice = await prisma.invoice.create({
    data: {
      fileName,
      blobUrl: stored.url,
      blobPathname: stored.pathname,
      sha256,
      fileSize,
      status: "NEEDS_REVIEW",
      ...originFields(origin),
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
    return { kind: "extraction_failed", invoice: failed, error: result.error };
  }

  const d = result.data;

  // --- 取引先マスタとの照合 ---
  // 読み取った値をそのまま材料にして、空欄の項目だけをマスタから埋める。
  // 更新は下の1回にまとめ、途中で失敗して中途半端な状態が残らないようにする。
  const extracted = {
    vendorName: d.vendorName,
    bankCode: digitsOnly(d.bankCode),
    bankName: d.bankName,
    branchCode: digitsOnly(d.branchCode),
    branchName: d.branchName,
    accountType: d.accountType,
    accountNumber: digitsOnly(d.accountNumber),
    recipientName: d.recipientName,
  };
  const match = matchVendor(extracted, await prisma.vendor.findMany());
  const filled = fillFromVendor(match);
  const matchNote = describeMatch(match, extracted);

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      ...extracted,
      ...filled,
      invoiceNumber: d.invoiceNumber,
      issueDate: parseIsoDate(d.issueDate),
      dueDate: parseIsoDate(d.dueDate),
      billedAmount: d.billedAmount,
      confidence: d.confidence,
      // 読み取りのメモは消さず、マスタ照合の結果を後ろに足す
      note: [d.notes, matchNote].filter(Boolean).join("\n") || null,
      vendorId: match.vendor?.id ?? null,
      vendorFilledFields: match.fillable.filter((f) => f in filled),
      status: "NEEDS_REVIEW",
    },
  });

  return { kind: "created", invoice: updated };
}

/** 取り込み元を Invoice の列へ写す。UPLOAD は既定値のままなので source だけ */
function originFields(origin: IngestOrigin) {
  if (origin.source === "UPLOAD") return { source: "UPLOAD" as const };
  return {
    source: "GMAIL" as const,
    gmailMessageId: origin.gmailMessageId,
    gmailFrom: origin.gmailFrom,
    gmailSubject: origin.gmailSubject,
    gmailReceivedAt: origin.gmailReceivedAt,
  };
}
