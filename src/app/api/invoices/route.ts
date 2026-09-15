import { z } from "zod";
import { auth } from "@/auth";
import { getFileStore } from "@/lib/storage";
import { ingestPdf } from "@/lib/ingest";

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
 * 取り込みの中身は ingestPdf() にある（Gmail取込と共通）。
 * ここは実体の取り出しと、結果をHTTPに写すことだけを行う。
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

  const store = getFileStore();
  let pdf: Buffer;
  try {
    const found = await store.read(pathname);
    if (!found) throw new Error("file not found");
    pdf = found;
  } catch {
    return Response.json({ error: "アップロードしたファイルを読み込めませんでした" }, { status: 400 });
  }

  const result = await ingestPdf({
    pdf,
    fileName,
    stored: { pathname, url },
    fileSize: size,
    origin: { source: "UPLOAD" },
  });

  switch (result.kind) {
    case "duplicate":
      return Response.json(
        { error: "duplicate", message: result.message, existingId: result.existingId },
        { status: 409 },
      );
    case "extraction_failed":
      return Response.json(
        { invoice: result.invoice, extracted: false, error: result.error },
        { status: 201 },
      );
    case "created":
      return Response.json({ invoice: result.invoice, extracted: true }, { status: 201 });
  }
}
