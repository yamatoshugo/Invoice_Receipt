/**
 * HTMLメールからテキストとリンクを取り出す。
 *
 * DOMパーサは入れない。ここで必要なのは「人が読める文章」と「本文中のURL」だけで、
 * どちらも正規表現で十分に取れる。LLMに渡す材料なので、多少の取りこぼしは
 * 判定の質に響かない（逆に、依存を増やすほうが供給網のリスクになる）。
 */

export interface FoundLink {
  /** メールに書かれていた原文のURL。実際に叩くのは必ずこちら */
  url: string;
  /** <a> のテキスト。「請求書はこちら」か「配信停止」かが最大の手掛かりになる */
  anchorText: string | null;
  source: "html" | "text";
}

/** 数値文字参照と、よく出る名前付き実体を戻す */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // & は最後に戻す。先に戻すと "&amp;lt;" が "<" になってしまう
    .replace(/&amp;/gi, "&");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** script と style は中身ごと落とす。人に見えないURLを候補にしないため */
function stripInvisible(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** <a href> とアンカーテキストを取り出す */
export function extractLinks(html: string): FoundLink[] {
  const source = stripInvisible(html);
  const found: FoundLink[] = [];

  const anchor = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const m of source.matchAll(anchor)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    // href の中の &amp; を戻さないと、署名付きURLのクエリが壊れる
    const url = decodeHtmlEntities(raw).trim();
    if (!isHttpLike(url)) continue;
    const text = htmlToText(m[5] ?? "").trim();
    found.push({ url, anchorText: text || null, source: "html" });
  }
  return found;
}

function isHttpLike(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** タグを落として人が読めるテキストにする */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    stripInvisible(html)
      // ブロックの終わりは改行として残す。落とすと全部が1行になり、LLMに渡す本文が読めなくなる
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)\s*>/gi, "\n")
      .replace(/<(p|div|li|tr|h[1-6]|table|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    // 開きタグと閉じタグの両方を改行にしたので連続する。
    // LLMに渡す材料としては段落と改行を区別する必要がないので1本にまとめる
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 平文中の生URLを拾う。
 *
 * 日本語メールは「詳細はこちら https://example.jp/a。」のように全角の句読点や
 * 括弧で終わることが普通なので、それらを終端として扱う。
 */
export function extractPlainUrls(text: string): string[] {
  const urls: string[] = [];
  const re = /https?:\/\/[^\s<>"'`）】」』、。,]+/gi;
  for (const m of text.matchAll(re)) {
    urls.push(trimUrlTail(m[0]));
  }
  return urls.filter((u) => u.length > "https://".length);
}

/** 末尾に紛れ込んだ句読点や閉じ括弧を落とす */
function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last && ".,;:!?)]>\"'".includes(last)) {
      // 閉じ括弧は、URL内で開き括弧と釣り合っているなら残す（例: /wiki/A_(B)）
      if (last === ")" && countOf(out, "(") >= countOf(out, ")")) break;
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

function countOf(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}
