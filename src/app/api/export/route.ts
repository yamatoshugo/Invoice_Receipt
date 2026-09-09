import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildExportCsv, exportFileName } from "@/lib/export";
import { parseIsoDate } from "@/lib/invoices";

/**
 * 承認済みの請求書から総合振込CSVを生成して返す。
 *
 * 生成に成功した時点で対象を EXPORTED にし、次回以降のバッチに含まれないようにする。
 * ダウンロードが失敗しても /export の履歴から同じファイルを再取得できる。
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return new Response("ログインが必要です", { status: 401 });

  const form = await request.formData();
  const transferDate = parseIsoDate(String(form.get("transferDate") ?? ""));
  if (!transferDate) {
    return Response.redirect(new URL("/export?error=date", request.url), 303);
  }

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  if (!setting) {
    return Response.redirect(new URL("/export?error=settings", request.url), 303);
  }

  const fileName = exportFileName(transferDate);

  // CSVに載せる対象の確定と EXPORTED への更新は同一トランザクションで行う。
  // 分けてしまうと、その隙に承認が取り消された請求書がCSVにだけ残り、
  // 次のバッチでもう一度出力されて二重振込になりうる。
  let csv: Buffer;
  try {
    csv = await prisma.$transaction(async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: { status: "APPROVED" },
        orderBy: { createdAt: "asc" },
      });

      const result = buildExportCsv(setting, transferDate, invoices);
      if (!result.ok) throw new ExportError("validation");

      const batch = await tx.exportBatch.create({
        data: {
          transferDate,
          recordCount: result.recordCount,
          totalAmount: result.totalAmount,
          fileName,
          createdByEmail: email,
          csvBase64: result.buffer.toString("base64"),
        },
      });

      const { count } = await tx.invoice.updateMany({
        where: { id: { in: invoices.map((i) => i.id) }, status: "APPROVED" },
        data: { status: "EXPORTED", exportBatchId: batch.id },
      });
      // 1件でも更新できなければCSVの内容と実際の状態が食い違う。全体を巻き戻す。
      if (count !== invoices.length) throw new ExportError("conflict");

      return result.buffer;
    });
  } catch (error) {
    const reason = error instanceof ExportError ? error.reason : "unknown";
    return Response.redirect(new URL(`/export?error=${reason}`, request.url), 303);
  }

  return new Response(new Uint8Array(csv), {
    headers: {
      "Content-Type": "text/csv; charset=Shift_JIS",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(csv.length),
    },
  });
}

class ExportError extends Error {
  constructor(readonly reason: "validation" | "conflict") {
    super(reason);
  }
}
