import { del, get } from "@vercel/blob";
import type { FileStore, StoredFile } from "./types";

/** 本番の保管先。private ブロブなので読み出しは必ず認証付きの中継経由になる */
export class VercelBlobStore implements FileStore {
  readonly kind = "vercel-blob" as const;

  async put(): Promise<StoredFile> {
    // Vercelのリクエストボディ上限(4.5MB)を避けるため、
    // Vercel Blob 経路ではブラウザから直接アップロードする（@vercel/blob/client の upload）。
    throw new Error("Vercel Blob へのアップロードはブラウザから直接行います");
  }

  async read(pathname: string): Promise<Buffer | null> {
    const blob = await get(pathname, { access: "private" });
    if (!blob?.stream) return null;
    return Buffer.from(await new Response(blob.stream).arrayBuffer());
  }

  async delete(pathname: string): Promise<void> {
    await del(pathname);
  }
}
