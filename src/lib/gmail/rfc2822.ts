/**
 * 送信するメールのMIMEを組み立てる（純関数）。
 *
 * 依存を足さずに書く。件名も本文も外部（設定画面と取引先名）から来る文字列なので、
 * 組み立ての正しさとヘッダインジェクション対策がそのまま安全性になる。
 */

/** 1行の上限。RFC 5322 の推奨は78、上限は998。余裕を見て76で揃える */
const MAX_LINE = 76;

/** "=?UTF-8?B?" + "?=" の12文字。エンコード語1つあたりの固定費 */
const WORD_OVERHEAD = "=?UTF-8?B?".length + "?=".length;

/**
 * ヘッダに入れてよい値に均す。
 *
 * ★CR/LF を落とすのがヘッダインジェクション対策の本体。
 * 件名も差出人表示名も設定画面で人が編集できるので、改行を入れられると
 * 任意のヘッダ（Bcc: を含む）を注入できてしまう。
 *
 * 日本語の件名は後段でbase64に飲まれるので結果的に無害化されるが、
 * 純ASCIIの件名はエンコードされずそのまま行に載る。ここで落とさないと穴が開く。
 *
 * ★畳んでよいのはASCIIの空白だけ。JavaScriptの `\s` は全角スペース(U+3000)にも
 * マッチするので、それで畳むと日本語の件名が書き換わる（実際に1通送って発覚した。
 * 「請求書受け取りアプリ　テストメール」が半角スペースになっていた）。
 * 件名が1文字でも変わるとGmailは元のスレッドに入れてくれないので、
 * 返信の検出（reply.ts）が拠って立つ仕組みごと崩れる。
 */
export function sanitizeHeaderValue(raw: string): string {
  // 制御文字を落とす。CR/LF の除去がヘッダインジェクション対策の本体
  // eslint-disable-next-line no-control-regex
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    // 折り返しの跡が連続した空白として残るので、ASCIIの空白だけを1つに畳む
    .replace(/[ \t]+/g, " ")
    .replace(/^[ \t]+|[ \t]+$/g, "");
}

/** 非ASCIIを含むか。"=?" を含む場合も、復号側で誤解釈されないようエンコードに回す */
export function needsEncoding(text: string): boolean {
  return /[^\x20-\x7E]/.test(text) || text.includes("=?");
}

/**
 * 文字列をUTF-8のバイト数で切る。★切るのは base64 にする前。
 *
 * base64 にしてから長さで切ると、マルチバイト文字が2つのエンコード語にまたがり、
 * 復号時に必ず壊れる。
 * for...of で回すのはコードポイント単位にするため。text[i] だと
 * サロゲートペア（𠮷・絵文字）を半分に割る。
 */
export function chunkByUtf8Bytes(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let size = 0;

  for (const ch of text) {
    const bytes = Buffer.byteLength(ch, "utf8");
    if (size + bytes > maxBytes && current !== "") {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/**
 * RFC 2047 の B エンコード。長ければ複数のエンコード語に分けて折り返す。
 *
 * 折り返しは CRLF + 空白1文字。RFC 2047 により、隣接するエンコード語の間の
 * 空白は復号時に消えるので、語の切れ目に空白が入り込むことはない。
 *
 * @param overhead 1行目でこの値より前に載る文字数（"Subject: " なら9）
 */
export function encodeHeaderWord(text: string, overhead = "Subject: ".length): string {
  // 1行に収まるバイト数。base64は3バイト→4文字なので、4文字単位に切り下げる
  const budget = MAX_LINE - Math.max(overhead, 1) - WORD_OVERHEAD;
  const maxBytes = Math.max(Math.floor(budget / 4) * 3, 3);

  return chunkByUtf8Bytes(text, maxBytes)
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

/** エンコードが要るときだけエンコードする。ASCIIの件名はそのまま読めるほうがよい */
export function encodeHeaderValue(text: string, overhead: number): string {
  const safe = sanitizeHeaderValue(text);
  return needsEncoding(safe) ? encodeHeaderWord(safe, overhead) : safe;
}

/**
 * メールアドレスとして送信に使ってよい形か。
 *
 * 厳密なRFC準拠は目指さない（実在するアドレスの網羅より、
 * ヘッダを壊す文字が1つも通らないことのほうが重要）。
 */
export function isSendableAddress(address: string): boolean {
  if (address !== address.trim() || address === "") return false;
  // 空白・改行・引用符・山括弧・カンマ・セミコロンを1つも通さない（宛先の追加を防ぐ）
  if (/[\s<>,;"\\]/.test(address)) return false;
  return /^[^@]+@[^@]+\.[^@]+$/.test(address);
}

/**
 * 本文を base64 にする。
 *
 * quoted-printable は使わない。日本語は全バイトが非ASCIIで3倍に膨らむうえ、
 * ソフト改行の処理で壊しどころが増える。base64 なら
 * 「行長・裸のCR/LF・行末の空白」の3つがまとめて消える。
 */
export function encodeBase64Body(text: string): string {
  // 改行をCRLFに揃えてから符号化する（受け側の表示が崩れないように）
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
  const base64 = Buffer.from(normalized, "utf8").toString("base64");
  // RFC 2045 により76文字で折り返す
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}

export interface Rfc2822Input {
  /** 差出人。接続中の受信専用アドレス */
  from: string;
  /** 差出人の表示名。空なら付けない */
  fromName?: string | null;
  /** 宛先。★表示名は付けない（注入面を増やさない） */
  to: string;
  subject: string;
  body: string;
  /** 元メールの Message-ID。取引先のメールソフトでスレッドにするために要る */
  inReplyTo?: string | null;
  /** 元メールの References（＋ Message-ID） */
  references?: string | null;
}

/**
 * RFC 2822 のメール1通を組み立てる。
 *
 * 意図的に付けないもの:
 *   - Message-ID … Gmailが採番する
 *   - Date … 同上。自前で作るとサーバのタイムゾーン次第で嘘の時刻になる
 *   - Reply-To … 返信は受け取り専用アドレスに戻るのが正しい
 *   - Bcc・添付・HTMLパート … 付ける理由が無く、事故の面だけ増える
 */
export function buildRfc2822(input: Rfc2822Input): string {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!isSendableAddress(from)) throw new Error(`差出人アドレスが不正です: ${from}`);
  if (!isSendableAddress(to)) throw new Error(`宛先アドレスが不正です: ${to}`);

  const lines: string[] = [];

  const fromName = sanitizeHeaderValue(input.fromName ?? "");
  if (fromName === "") {
    lines.push(`From: <${from}>`);
  } else {
    // 表示名をエンコードすると行が伸びるので、アドレスは次の行へ折る（FWSなので合法）
    lines.push(`From: ${encodeHeaderValue(fromName, "From: ".length)}`, ` <${from}>`);
  }

  lines.push(`To: <${to}>`);
  lines.push(`Subject: ${encodeHeaderValue(input.subject, "Subject: ".length)}`);

  // 元メールのヘッダをそのまま載せる箇所。外部由来なので必ず均してから入れる
  const inReplyTo = sanitizeHeaderValue(input.inReplyTo ?? "");
  if (inReplyTo !== "") lines.push(`In-Reply-To: ${inReplyTo}`);
  const references = sanitizeHeaderValue(input.references ?? "");
  if (references !== "") lines.push(foldReferences(references));

  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");

  return `${lines.join("\r\n")}\r\n\r\n${encodeBase64Body(input.body)}\r\n`;
}

/**
 * References は Message-ID が積み上がって長くなる。空白で折り返す。
 * 折り返しても意味は変わらない（複数の message-id を空白で並べる形式）。
 */
function foldReferences(value: string): string {
  const lines: string[] = [];
  let current = "References:";

  for (const id of value.split(/\s+/).filter(Boolean)) {
    if (current.length + 1 + id.length > MAX_LINE && current !== "References:") {
      lines.push(current);
      current = ` ${id}`;
    } else {
      current += ` ${id}`;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}
