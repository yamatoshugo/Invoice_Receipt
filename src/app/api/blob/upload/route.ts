import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";

/** 1通の請求書PDFの上限。これを超えるものは請求書ではない可能性が高い */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * ブラウザから Vercel Blob へ直接アップロードするためのトークンを発行する。
 * サーバー経由にすると Vercel のリクエストボディ上限(4.5MB)に引っかかるため、
 * ファイル本体はブラウザから直接送る。
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: MAX_PDF_BYTES,
        // 同名ファイルでも上書きせず別物として保存する
        addRandomSuffix: true,
      }),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "アップロードに失敗しました" },
      { status: 400 },
    );
  }
}
