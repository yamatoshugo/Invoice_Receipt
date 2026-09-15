import iconv from "iconv-lite";
import type { GmailHeader, GmailPart } from "./types";

/**
 * MIMEツリーから添付を取り出す。
 *
 * ここは抜け洩れが実際に起きる場所。請求書は multipart/alternative の入れ子や、
 * 社内転送された message/rfc822 の中に入っていることがあり、
 * 再帰が浅いと静かに落ちる。
 */

export interface FoundAttachment {
  /**
   * MIME構造から決まるパートの位置（"1" / "2.1" / "2.1.1"）。
   *
   * Gmail が返す partId ではなく自前で組み立てる。Gmail が partId を
   * 埋めてこない場合でも決まり、手書きのJSONだけでテストできるため。
   * メールは不変なので、走査をまたいでこの値は安定している。
   */
  ref: string;
  /** 実体の取得に使う。リクエストごとに変わりうるので一意キーには使わない */
  attachmentId: string | null;
  fileName: string;
  mimeType: string;
  /** Content-Disposition の値（"inline" / "attachment"）。署名画像の判別に使う */
  disposition: string | null;
  size: number;
}

/** 添付（filename を持つパート）を、入れ子をすべて辿って列挙する */
export function collectAttachmentParts(payload: GmailPart | null | undefined): FoundAttachment[] {
  const found: FoundAttachment[] = [];
  walk(payload, "", found);
  return found;
}

function walk(part: GmailPart | null | undefined, ref: string, out: FoundAttachment[]): void {
  if (!part) return;

  const fileName = decodeMimeFilename(part.filename ?? "");
  // filename を持つパートだけが添付。本文パート（text/plain, text/html）は空文字になる
  if (fileName !== "") {
    out.push({
      ref,
      attachmentId: part.body?.attachmentId ?? null,
      fileName,
      mimeType: part.mimeType ?? "application/octet-stream",
      disposition: dispositionOf(part.headers),
      size: part.body?.size ?? 0,
    });
  }

  // 添付であっても子を辿る。message/rfc822 は filename を持ちつつ
  // 中に本物の請求書PDFを抱えていることがある
  part.parts?.forEach((child, i) => {
    walk(child, ref === "" ? String(i + 1) : `${ref}.${i + 1}`, out);
  });
}

/** 取り込み時にパートを再特定する。attachmentId は取り直すので ref から引く */
export function findPartById(payload: GmailPart | null | undefined, ref: string): GmailPart | null {
  if (!payload) return null;
  if (ref === "") return payload;

  let current: GmailPart = payload;
  for (const segment of ref.split(".")) {
    const index = Number(segment) - 1;
    const child = current.parts?.[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

/** Content-Disposition の種別を取り出す（"inline; filename=..." → "inline"） */
function dispositionOf(headers: GmailHeader[] | undefined): string | null {
  const raw = headerValue(headers, "content-disposition");
  if (!raw) return null;
  return raw.split(";")[0]!.trim().toLowerCase() || null;
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

/**
 * RFC 2047 のエンコード語を含むファイル名を復号する。
 *
 * Gmail API は多くの場合デコード済みのUTF-8を返すが、返さない実装のメールも
 * 存在しうる。素の文字列はそのまま返るので、通しておいて害はない。
 */
export function decodeMimeFilename(raw: string): string {
  if (!raw.includes("=?")) return raw;

  // 隣接するエンコード語の間の空白は、RFC2047 により無視する
  const joined = raw.replace(/\?=\s+=\?/g, "?==?");

  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, encoding, text) => {
    try {
      const bytes =
        String(encoding).toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : decodeQuotedPrintable(text);
      const cs = String(charset).split("*")[0]!;
      if (!iconv.encodingExists(cs)) return whole;
      return iconv.decode(bytes, cs);
    } catch {
      // 壊れたエンコードで名前が消えるより、生のまま残したほうが人が判断できる
      return whole;
    }
  });
}

/** RFC 2047 の Q エンコーディング（"_" が空白、=XX が16進） */
function decodeQuotedPrintable(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "_") {
      bytes.push(0x20);
    } else if (c === "=" && i + 2 < text.length) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }
  return Buffer.from(bytes);
}

/**
 * From ヘッダを表示名とアドレスに分ける。
 *
 * アドレスは第2段で「PDF送付をお願いするメール」の宛先になる。
 */
export function parseFromHeader(raw: string): { name: string | null; address: string | null } {
  const angle = /^(.*)<([^>]+)>\s*$/.exec(raw.trim());
  if (angle) {
    const name = decodeMimeFilename(angle[1]!.trim().replace(/^"(.*)"$/, "$1")).trim();
    return { name: name || null, address: angle[2]!.trim().toLowerCase() || null };
  }
  const bare = raw.trim();
  if (bare.includes("@")) return { name: null, address: bare.toLowerCase() };
  return { name: bare || null, address: null };
}
