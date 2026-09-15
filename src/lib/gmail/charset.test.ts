import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeText, isIso2022Jp, iso2022jpToEucJp } from "./charset";

/**
 * ISO-2022-JP を組み立てる（テスト用）。
 * ESC $ B で JIS X 0208 へ、ESC ( B で ASCII へ戻る。
 * JIS X 0208 の2バイトは EUC-JP から 0x80 を落とせば作れる。
 */
function toIso2022Jp(text: string): Buffer {
  const out: number[] = [];
  let inJis = false;
  for (const ch of text) {
    const euc = iconv.encode(ch, "euc-jp");
    const isAscii = euc.length === 1 && euc[0]! < 0x80;
    if (isAscii) {
      if (inJis) {
        out.push(0x1b, 0x28, 0x42);
        inJis = false;
      }
      out.push(euc[0]!);
      continue;
    }
    if (!inJis) {
      out.push(0x1b, 0x24, 0x42);
      inJis = true;
    }
    for (const b of euc) out.push(b & 0x7f);
  }
  if (inJis) out.push(0x1b, 0x28, 0x42);
  return Buffer.from(out);
}

describe("isIso2022Jp", () => {
  it("表記ゆれを吸収する", () => {
    expect(isIso2022Jp("ISO-2022-JP")).toBe(true);
    expect(isIso2022Jp("iso-2022-jp")).toBe(true);
    expect(isIso2022Jp("iso_2022_jp")).toBe(true);
    expect(isIso2022Jp("ISO-2022-JP-MS")).toBe(true);
  });

  it("他の文字セットは false", () => {
    expect(isIso2022Jp("utf-8")).toBe(false);
    expect(isIso2022Jp("Shift_JIS")).toBe(false);
  });
});

describe("iso2022jpToEucJp", () => {
  it("日本語を EUC-JP に変換して復号できる", () => {
    // iconv-lite は ISO-2022-JP に対応していないので、この経路が無いと文字化けする
    const jis = toIso2022Jp("ご請求書");
    expect(iconv.decode(iso2022jpToEucJp(jis), "euc-jp")).toBe("ご請求書");
  });

  it("ASCIIと日本語が混ざっていても正しく戻る", () => {
    const jis = toIso2022Jp("請求書No.123のご案内");
    expect(iconv.decode(iso2022jpToEucJp(jis), "euc-jp")).toBe("請求書No.123のご案内");
  });

  it("URLが壊れない（リンク抽出がここに依存している）", () => {
    const text = "詳細は https://example.jp/invoice?id=1&sig=abc をご覧ください";
    const jis = toIso2022Jp(text);
    expect(iconv.decode(iso2022jpToEucJp(jis), "euc-jp")).toContain(
      "https://example.jp/invoice?id=1&sig=abc",
    );
  });

  it("改行が保たれる", () => {
    const jis = toIso2022Jp("一行目\n二行目");
    expect(iconv.decode(iso2022jpToEucJp(jis), "euc-jp")).toBe("一行目\n二行目");
  });

  it("ESC ( J（JIS-Roman）も ASCII として扱う", () => {
    const bytes = Buffer.from([0x1b, 0x28, 0x4a, 0x41, 0x42, 0x1b, 0x28, 0x42]);
    expect(iconv.decode(iso2022jpToEucJp(bytes), "euc-jp")).toBe("AB");
  });

  it("ESC $ @（1978年版）も JIS X 0208 として扱う", () => {
    const jis = toIso2022Jp("請求");
    const old = Buffer.from(jis);
    old[2] = 0x40; // ESC $ B → ESC $ @
    expect(iconv.decode(iso2022jpToEucJp(old), "euc-jp")).toBe("請求");
  });

  it("壊れたバイト列でも例外を投げない", () => {
    expect(() => iso2022jpToEucJp(Buffer.from([0x1b, 0x24, 0x42, 0xff, 0x00]))).not.toThrow();
  });

  it("空のバッファでも落ちない", () => {
    expect(iso2022jpToEucJp(Buffer.alloc(0)).length).toBe(0);
  });
});

describe("decodeText", () => {
  it("ISO-2022-JP を復号する", () => {
    expect(decodeText(toIso2022Jp("ご請求書"), "ISO-2022-JP")).toBe("ご請求書");
  });

  it("UTF-8 を復号する", () => {
    expect(decodeText(Buffer.from("ご請求書", "utf8"), "utf-8")).toBe("ご請求書");
  });

  it("Shift_JIS を復号する", () => {
    expect(decodeText(iconv.encode("ご請求書", "Shift_JIS"), "Shift_JIS")).toBe("ご請求書");
  });

  it("EUC-JP を復号する", () => {
    expect(decodeText(iconv.encode("ご請求書", "euc-jp"), "EUC-JP")).toBe("ご請求書");
  });

  it("charset が無ければ UTF-8 として読む", () => {
    expect(decodeText(Buffer.from("本文", "utf8"), null)).toBe("本文");
  });

  it("未知の文字セットでも例外にせず UTF-8 として読む", () => {
    expect(decodeText(Buffer.from("本文", "utf8"), "X-UNKNOWN")).toBe("本文");
  });
});
