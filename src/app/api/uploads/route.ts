import { auth } from "@/auth";
import { getFileStore, storageMode } from "@/lib/storage";

/** 1通の請求書PDFの上限。Vercel Blob 経路（api/blob/upload）と同じ値にそろえる */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * ローカル動作確認用のアップロード受け口。
 *
 * 本番は @vercel/blob/client の upload() でブラウザから直接 Blob へ送るが、
 * ローカルでは Blob ストアが無いのでサーバー経由でファイルシステムに置く。
 * 返す形（pathname / url）を upload() とそろえてあるので、
 * この後の POST /api/invoices は本番と同じ経路をたどる。
 */
export async function POST(request: Request): Promise<Response> {
  if (storageMode() !== "local") {
    return Response.json({ error: "この環境では利用できません" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "ファイルが指定されていません" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return Response.json({ error: "PDFファイルのみ取り込めます" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return Response.json({ error: "ファイルサイズが不正です" }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const stored = await getFileStore().put(file.name, data, file.type, request.url);

  return Response.json(stored, { status: 201 });
}
