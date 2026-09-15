import iconv from "iconv-lite";

/**
 * メール本文の文字コードを解く。
 *
 * iconv-lite は ISO-2022-JP に対応していない（エスケープで状態が変わる符号化を
 * 扱わない方針のため）。ところが ISO-2022-JP は日本語メールの定番で、
 * 取引先の請求書メールが this で届くことは普通にある。
 *
 * 依存を増やさずに済ませるため、ISO-2022-JP → EUC-JP に変換してから
 * iconv-lite に渡す。JIS X 0208 の2バイトは、各バイトに 0x80 を立てると
 * そのまま EUC-JP になるという関係を使う。
 */

const ESC = 0x1b;

/** 解けなかったときに本文を諦めず、ASCIIとして読めるところまで読むための印 */
type Mode = "ascii" | "jisx0208" | "jisx0201kana";

/**
 * ISO-2022-JP のバイト列を EUC-JP のバイト列へ変換する。
 *
 * エスケープシーケンス:
 *   ESC ( B  → ASCII
 *   ESC ( J  → JIS-Roman（ASCII とほぼ同じ。差は \ と ~ の字形だけなので同一視する）
 *   ESC ( I  → JIS X 0201 半角カナ
 *   ESC $ @  → JIS X 0208-1978
 *   ESC $ B  → JIS X 0208-1983
 */
export function iso2022jpToEucJp(input: Buffer): Buffer {
  const out: number[] = [];
  let mode: Mode = "ascii";
  let i = 0;

  while (i < input.length) {
    const b = input[i]!;

    if (b === ESC && i + 2 < input.length) {
      const a = input[i + 1]!;
      const c = input[i + 2]!;
      if (a === 0x28 && (c === 0x42 || c === 0x4a)) {
        mode = "ascii";
        i += 3;
        continue;
      }
      if (a === 0x28 && c === 0x49) {
        mode = "jisx0201kana";
        i += 3;
        continue;
      }
      if (a === 0x24 && (c === 0x40 || c === 0x42)) {
        mode = "jisx0208";
        i += 3;
        continue;
      }
      // ESC $ ( D のような3バイト目まで見ないと決まらないものは、
      // 解釈できないので ASCII に戻して読み進める（本文を丸ごと失わないため）
      if (a === 0x24 && c === 0x28 && i + 3 < input.length) {
        mode = "jisx0208";
        i += 4;
        continue;
      }
    }

    // 改行はどのモードでも ASCII のまま通る（ASCIIへ戻す実装のメーラーもある）
    if (b === 0x0a || b === 0x0d) {
      out.push(b);
      i += 1;
      continue;
    }

    if (mode === "jisx0208" && i + 1 < input.length) {
      const hi = input[i]!;
      const lo = input[i + 1]!;
      // JIS X 0208 の図形文字は 0x21〜0x7E。範囲外なら壊れているので1バイト送って復帰を試す
      if (hi >= 0x21 && hi <= 0x7e && lo >= 0x21 && lo <= 0x7e) {
        out.push(hi | 0x80, lo | 0x80);
        i += 2;
        continue;
      }
      out.push(hi);
      i += 1;
      continue;
    }

    if (mode === "jisx0201kana" && b >= 0x21 && b <= 0x5f) {
      // EUC-JP の半角カナは SS2(0x8e) + (値 + 0x80)
      out.push(0x8e, b + 0x80);
      i += 1;
      continue;
    }

    out.push(b);
    i += 1;
  }

  return Buffer.from(out);
}

/** 正規化した文字セット名。判定を1箇所にまとめる */
function normalize(charset: string): string {
  return charset.trim().toLowerCase().replace(/[_\s]/g, "-");
}

export function isIso2022Jp(charset: string): boolean {
  return normalize(charset).startsWith("iso-2022-jp");
}

/**
 * バイト列を文字列にする。未知の文字セットでも例外にせず、
 * UTF-8 として読めるところまで読む（本文が丸ごと消えるより良い）。
 */
export function decodeText(bytes: Buffer, charset: string | null): string {
  const cs = charset?.trim() || "utf-8";
  try {
    if (isIso2022Jp(cs)) return iconv.decode(iso2022jpToEucJp(bytes), "euc-jp");
    if (iconv.encodingExists(cs)) return iconv.decode(bytes, cs);
  } catch {
    // 下の UTF-8 フォールバックへ
  }
  return bytes.toString("utf8");
}
