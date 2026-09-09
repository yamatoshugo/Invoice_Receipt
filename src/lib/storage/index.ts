import { LocalFileStore } from "./local";
import { VercelBlobStore } from "./vercelBlob";
import { storageMode, type FileStore } from "./types";

export * from "./types";

let cached: FileStore | null = null;

/**
 * 保管先の実装を1箇所で選ぶ。
 * 別のストレージに移す場合はここだけを変える。
 */
export function getFileStore(): FileStore {
  cached ??= storageMode() === "local" ? new LocalFileStore() : new VercelBlobStore();
  return cached;
}
