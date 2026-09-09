import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** 出力済みバッチの再ダウンロード。状態は変更しない。 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) return new Response("ログインが必要です", { status: 401 });

  const { batchId } = await params;
  const batch = await prisma.exportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return new Response("見つかりません", { status: 404 });

  const buffer = Buffer.from(batch.csvBase64, "base64");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "text/csv; charset=Shift_JIS",
      "Content-Disposition": `attachment; filename="${batch.fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
