export type StorageMode = "vercel-blob" | "local";

/**
 * 保存したファイルの識別子。
 * `pathname` が実体を指す唯一の鍵で、`url` は参照用に保存するだけ。
 */
export interface StoredFile {
  pathname: string;
  url: string;
}

/**
 * 請求書PDFの保管先。
 * 本番は Vercel Blob、ローカルでの動作確認はファイルシステムを使う。
 */
export interface FileStore {
  readonly kind: StorageMode;

  /**
   * ファイルを保存する。
   *
   * ブラウザからの取り込みでは、Vercel Blob 経路はブラウザが直接アップロードするため
   * サーバーからは呼ばない。Gmail取込のようにサーバー側で実体を手に入れる経路では
   * ここから保存する。
   *
   * baseUrl はローカル保管時にPDF取得用の絶対URLを組み立てるためだけに使う。
   * リクエストコンテキストが無い経路からは省略でき、その場合は APP_BASE_URL から組み立てる。
   */
  put(fileName: string, data: Buffer, contentType: string, baseUrl?: string): Promise<StoredFile>;

  /** 実体を取得する。存在しなければ null */
  read(pathname: string): Promise<Buffer | null>;

  delete(pathname: string): Promise<void>;
}

/**
 * どちらの保管先を使うかを決める。
 *
 * 本番で誤ってローカル保管になると、サーバーレス環境ではファイルが消えて
 * PDFを再確認できなくなるため、明示的に "local" と書いたときだけ切り替える。
 */
export function storageMode(): StorageMode {
  return process.env.STORAGE === "local" ? "local" : "vercel-blob";
}
