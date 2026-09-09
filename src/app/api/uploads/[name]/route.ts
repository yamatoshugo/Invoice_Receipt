import { auth } from "@/auth";
import { getFileStore, storageMode } from "@/lib/storage";

/**
 * ローカル保管したPDFの取得口。
 * POST /api/uploads が返す url を実在させるためのもので、
 * 画面からのPDF閲覧は /api/invoices/[id]/file を通る。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (storageMode() !== "local") return new Response("見つかりません", { status: 404 });

  const session = await auth();
  if (!session?.user?.email) return new Response("ログインが必要です", { status: 401 });

  const { name } = await params;
  const pdf = await getFileStore().read(decodeURIComponent(name));
  if (!pdf) return new Response("ファイルが存在しません", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=300",
    },
  });
}
