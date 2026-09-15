import { del, get, put } from "@vercel/blob";
import type { FileStore, StoredFile } from "./types";

/** 本番の保管先。private ブロブなので読み出しは必ず認証付きの中継経由になる */
export class VercelBlobStore implements FileStore {
  readonly kind = "vercel-blob" as const;

  /**
   * サーバー側で手に入れた実体をBlobへ置く（Gmail取込の経路）。
   *
   * ブラウザからの取り込みではここを通さない。Vercelのリクエストボディ上限(4.5MB)を
   * 避けるため、@vercel/blob/client の upload() でブラウザから直接アップロードしている。
   * その上限は「関数が受け取るリクエストボディ」の制約なので、
   * 関数からBlobへ送るこの経路には掛からない。
   */
  async put(fileName: string, data: Buffer, contentType: string): Promise<StoredFile> {
    const blob = await put(fileName, data, {
      // read() の get(..., { access: "private" }) と対になる
      access: "private",
      contentType,
      // 同名ファイルでも上書きしない（handleUpload / LocalFileStore と同じ挙動）
      addRandomSuffix: true,
      // allowOverwrite は付けない。ランダム接尾辞で衝突しない以上、
      // 付けないこと自体がバグで既存の請求書PDFを壊さない保険になる
    });
    return { pathname: blob.pathname, url: blob.url };
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
