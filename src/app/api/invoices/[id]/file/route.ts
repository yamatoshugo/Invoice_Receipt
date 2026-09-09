import { get } from "@vercel/blob";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * PDFの実体を認証付きで中継する。
 * Blobは private のため、ブラウザからは必ずこのルート経由でしか閲覧できない。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) return new Response("ログインが必要です", { status: 401 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { blobPathname: true, fileName: true },
  });
  if (!invoice) return new Response("見つかりません", { status: 404 });

  try {
    const blob = await get(invoice.blobPathname, { access: "private" });
    if (!blob) return new Response("ファイルが存在しません", { status: 404 });
    return new Response(blob.stream, {
      headers: {
        "Content-Type": "application/pdf",
        // ダウンロードではなくブラウザ内で表示させる
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(invoice.fileName)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("ファイルを取得できませんでした", { status: 502 });
  }
}
