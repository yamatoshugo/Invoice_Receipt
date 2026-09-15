import { describe, expect, it } from "vitest";
import { isEncryptedPdf, looksLikePdf } from "./pdf";

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}`, "latin1");

describe("looksLikePdf", () => {
  it("先頭が %PDF- なら true", () => {
    expect(looksLikePdf(pdf("trailer<</Root 1 0 R>>"))).toBe(true);
  });

  it("先頭が %PDF- でなければ false", () => {
    expect(looksLikePdf(Buffer.from("PKzipfile"))).toBe(false);
    expect(looksLikePdf(Buffer.from("<html>お使いのブラウザで開いてください</html>"))).toBe(false);
  });

  it("空のファイルは false（落ちない）", () => {
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it("5バイト未満でも落ちない", () => {
    expect(looksLikePdf(Buffer.from("%PD"))).toBe(false);
  });
});

describe("isEncryptedPdf", () => {
  it("trailer に /Encrypt への参照があれば暗号化と判定する", () => {
    expect(isEncryptedPdf(pdf("trailer<</Size 20/Root 1 0 R/Encrypt 19 0 R>>\n%%EOF"))).toBe(true);
  });

  it("/Encrypt が辞書で直接書かれていても判定する", () => {
    expect(isEncryptedPdf(pdf("trailer<</Encrypt<</Filter/Standard>>>>\n%%EOF"))).toBe(true);
  });

  it("通常のPDFは暗号化と判定しない", () => {
    expect(isEncryptedPdf(pdf("trailer<</Size 20/Root 1 0 R/Info 2 0 R>>\n%%EOF"))).toBe(false);
  });

  it("本文に Encrypt という語があるだけでは暗号化と判定しない", () => {
    expect(isEncryptedPdf(pdf("(Encrypt) Tj\ntrailer<</Root 1 0 R>>\n%%EOF"))).toBe(false);
  });

  it("空のファイルでも落ちない", () => {
    expect(isEncryptedPdf(Buffer.alloc(0))).toBe(false);
  });
});
