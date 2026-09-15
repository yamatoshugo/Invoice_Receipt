import type { FoundAttachment } from "./parts";

/**
 * 添付をどう扱うかの判定。
 *
 * 方針は「静かに捨てない」こと。PDFでないものを自動で「済」にすると、
 * Excelで届いた請求書やパスワード付きPDFが黙って消える。
 * ここで自動除外してよいのは、本文装飾の署名画像だけ。
 */
export type AttachmentClass =
  /** PDFとして取り込みを試みる */
  | { kind: "pdf" }
  /** PDFではない。人の確認を求める */
  | { kind: "not-pdf"; reason: string }
  /** 署名画像など。件数は表示するが人の確認は求めない */
  | { kind: "auto-skip"; reason: string };

/** 拡張子でPDFとみなす。送信側が octet-stream で送ってくるのは日常的にある */
function hasPdfExtension(fileName: string): boolean {
  return /\.pdf$/i.test(fileName.trim());
}

export function classifyAttachment(
  a: Pick<FoundAttachment, "fileName" | "mimeType" | "disposition">,
): AttachmentClass {
  const mime = (a.mimeType ?? "").toLowerCase().split(";")[0]!.trim();

  if (mime === "application/pdf" || mime === "application/x-pdf") return { kind: "pdf" };

  // MIMEが曖昧でも拡張子がPDFなら取り込みを試す。実体の先頭バイトで最終判定するので、
  // ここで拾いすぎても事故にはならない
  if (hasPdfExtension(a.fileName)) return { kind: "pdf" };

  // 本文に埋め込まれた画像（署名のロゴ、バナー）。添付として扱うと毎月大量に
  // 「要確認」が積み上がり、本当に確認すべきものが埋もれる
  if (a.disposition === "inline" && mime.startsWith("image/")) {
    return { kind: "auto-skip", reason: "本文中の画像（署名など）" };
  }

  return { kind: "not-pdf", reason: `PDF以外の添付です（${a.mimeType || "種別不明"}）` };
}
