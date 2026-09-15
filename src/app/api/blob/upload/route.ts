import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";

/** 1通の請求書PDFの上限。これを超えるものは請求書ではない可能性が高い */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Blobのトークンが実行時に見えているか。
 *
 * ★名前を変数で引く。`process.env.BLOB_READ_WRITE_TOKEN` のような静的な書き方は
 * ビルド時に値が埋め込まれることがあり、その場合「実行時には在るのに無いと判定する」。
 * 診断のための関数が誤診したのでは意味がない。
 */
function blobTokenPresent(): boolean {
  const name = "BLOB_READ_WRITE_TOKEN";
  return (process.env[name] ?? "").trim() !== "";
}

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
    // ブラウザ側には@vercel/blobの汎用メッセージしか出ないので、
    // 実際の理由をサーバーのログ（Vercelの Logs タブ）に必ず残す
    console.error("Blobのクライアントトークン発行に失敗しました:", error);

    const message = error instanceof Error ? error.message : "アップロードに失敗しました";
    // ★失敗した「あと」にだけ原因を推測する。先に自前で止めると、
    // こちらの判定が誤ったときに、本来動くアップロードまで塞いでしまう
    const hint = blobTokenPresent()
      ? ""
      : "（Vercel Blob が接続されていない可能性があります: Storage → Blob → Connect to Project → 再デプロイ）";
    return Response.json({ error: `${message}${hint}` }, { status: 400 });
  }
}
