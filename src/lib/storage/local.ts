import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStore, StoredFile } from "./types";

/** プロジェクト直下の .uploads/ に置く。実請求書が入るので .gitignore 済み */
const UPLOAD_DIR = path.join(process.cwd(), ".uploads");

/**
 * pathname はこのクラスが生成した「ディレクトリ区切りを含まない1階層の名前」しか受け付けない。
 * DB由来の値でファイルパスを組み立てるため、ここを緩めると .uploads の外を読み書きできてしまう。
 */
function isSafePathname(pathname: string): boolean {
  if (!pathname || pathname.length > 255) return false;
  if (pathname.includes("/") || pathname.includes("\\")) return false;
  if (pathname === "." || pathname === "..") return false;
  return path.basename(pathname) === pathname;
}

/** 元のファイル名を、記号を落として識別できる程度に残す */
function safeSuffix(fileName: string): string {
  const base = path.basename(fileName).replace(/[^\w.\-ぁ-んァ-ヶ一-龠々ー]/gu, "_");
  return base.slice(-80) || "file.pdf";
}

/** ローカル動作確認用の保管先。Vercel Blob の代わりにファイルシステムへ書く */
export class LocalFileStore implements FileStore {
  readonly kind = "local" as const;

  async put(fileName: string, data: Buffer, _contentType: string, baseUrl: string): Promise<StoredFile> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    // Vercel Blob の addRandomSuffix と同じく、同名ファイルでも上書きしない
    const pathname = `${randomUUID()}-${safeSuffix(fileName)}`;
    await writeFile(path.join(UPLOAD_DIR, pathname), data);
    return {
      pathname,
      url: new URL(`/api/uploads/${encodeURIComponent(pathname)}`, baseUrl).toString(),
    };
  }

  async read(pathname: string): Promise<Buffer | null> {
    if (!isSafePathname(pathname)) return null;
    try {
      return await readFile(path.join(UPLOAD_DIR, pathname));
    } catch {
      return null;
    }
  }

  async delete(pathname: string): Promise<void> {
    if (!isSafePathname(pathname)) return;
    await unlink(path.join(UPLOAD_DIR, pathname)).catch(() => {});
  }
}
