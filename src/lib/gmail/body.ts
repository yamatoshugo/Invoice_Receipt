import { decodeText } from "./charset";
import { extractLinks, extractPlainUrls, htmlToText } from "./html";
import { headerValue } from "./parts";
import type { FoundLink } from "./html";
import type { GmailPart } from "./types";

/**
 * メール本文の取り出し。
 *
 * 添付の列挙（collectAttachmentParts）と同じ再帰で、text/plain と text/html を集める。
 * message/rfc822 の中も辿る — 転送された請求書メールの本文は入れ子の中にある。
 */

export interface FoundBodyPart {
  /** MIME構造上の位置。findPartById で引き直せる */
  ref: string;
  mimeType: "text/plain" | "text/html";
  /** Content-Type の charset。無ければ null（utf-8 とみなす） */
  charset: string | null;
  /** base64url のまま。デコードは decodeBodyPart で行う */
  data: string | null;
  /** 本文が大きく、body.data ではなく attachmentId で返っている */
  externalAttachmentId: string | null;
}

/** LLMへ渡す本文の上限。これを超えたら先頭側を残して切る */
export const MAX_BODY_CHARS = 8_000;

/** 本文パートを再帰的に集める */
export function collectBodyParts(payload: GmailPart | null | undefined): FoundBodyPart[] {
  const out: FoundBodyPart[] = [];
  walk(payload, "", out);
  return out;
}

function walk(part: GmailPart | null | undefined, ref: string, out: FoundBodyPart[]): void {
  if (!part) return;

  const mime = (part.mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  // filename を持つパートは添付。本文ではない（添付されたHTMLを本文として読まない）
  const isBody = (part.filename ?? "") === "" && (mime === "text/plain" || mime === "text/html");
  if (isBody) {
    out.push({
      ref,
      mimeType: mime as "text/plain" | "text/html",
      charset: charsetOf(part),
      data: part.body?.data ?? null,
      externalAttachmentId: part.body?.data ? null : (part.body?.attachmentId ?? null),
    });
  }

  part.parts?.forEach((child, i) => {
    walk(child, ref === "" ? String(i + 1) : `${ref}.${i + 1}`, out);
  });
}

function charsetOf(part: GmailPart): string | null {
  const raw = headerValue(part.headers, "content-type") ?? part.mimeType ?? "";
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(raw);
  return m ? m[1]! : null;
}

/** base64url → 生バイト → charset を解いて文字列にする */
export function decodeBodyPart(part: Pick<FoundBodyPart, "charset" | "data">): string {
  if (!part.data) return "";
  try {
    return decodeText(Buffer.from(part.data, "base64url"), part.charset);
  } catch {
    return "";
  }
}

export interface ExtractedBody {
  /** 人が読める本文。text/plain を優先し、無ければ html から起こす */
  text: string;
  /** 本文中のリンク。html の href と、平文中の生URLを合わせて重複を除いたもの */
  links: FoundLink[];
  /** 本文が長すぎて後半を切った */
  truncated: boolean;
  /**
   * body.data が無く、実体の別取得が要る本文パートがあった。
   *
   * 走査では取りに行かない（走査が遅くなる）。この場合リンクの件数を数えられないので、
   * 「リンクがあるかもしれない」側に倒して候補行を作る。
   * 取りこぼすより、余分に1行作るほうが安全。
   */
  hasExternalBody: boolean;
}

export function extractBody(payload: GmailPart | null | undefined): ExtractedBody {
  const parts = collectBodyParts(payload);
  const hasExternalBody = parts.some((p) => p.externalAttachmentId !== null);

  const plains = parts.filter((p) => p.mimeType === "text/plain").map(decodeBodyPart);
  const htmls = parts.filter((p) => p.mimeType === "text/html").map(decodeBodyPart);

  // multipart/alternative では両方が入っている。plain を本文表示に使い、
  // html からはリンクを拾う（plain 側にURLが省略されていることがある）
  const plainText = plains.join("\n").trim();
  const htmlText = htmls.map(htmlToText).join("\n").trim();
  const raw = plainText || htmlText;

  const links = dedupeLinks([
    ...htmls.flatMap(extractLinks),
    ...plains.flatMap((t) => extractPlainUrls(t).map(toTextLink)),
  ]);

  const truncated = raw.length > MAX_BODY_CHARS;
  return {
    text: truncated ? raw.slice(0, MAX_BODY_CHARS) : raw,
    links,
    truncated,
    hasExternalBody,
  };
}

function toTextLink(url: string): FoundLink {
  return { url, anchorText: null, source: "text" };
}

/**
 * 同じURLを1本にまとめる。
 *
 * ここでの同一視は「LLMに同じURLを2回見せない」ためだけのもの。
 * 実際に叩くのは必ず原文のURLなので、まとめ方を誤ってもDBは壊れない。
 * アンカーテキストがあるほうを残す（判定の手掛かりになる）。
 */
function dedupeLinks(links: FoundLink[]): FoundLink[] {
  const byUrl = new Map<string, FoundLink>();
  for (const link of links) {
    const current = byUrl.get(link.url);
    if (!current) {
      byUrl.set(link.url, link);
      continue;
    }
    if (current.anchorText === null && link.anchorText !== null) byUrl.set(link.url, link);
  }
  return [...byUrl.values()];
}
