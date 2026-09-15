import { describe, expect, it } from "vitest";
import { classifyAttachment } from "./classify";

const a = (fileName: string, mimeType: string, disposition: string | null = "attachment") => ({
  fileName,
  mimeType,
  disposition,
});

describe("classifyAttachment", () => {
  it("application/pdf はPDFとして扱う", () => {
    expect(classifyAttachment(a("seikyu.pdf", "application/pdf")).kind).toBe("pdf");
  });

  it("charset 付きのMIMEタイプでもPDFとして扱う", () => {
    expect(classifyAttachment(a("x.pdf", "application/pdf; charset=binary")).kind).toBe("pdf");
  });

  it("application/octet-stream でも拡張子が .pdf ならPDFとして扱う", () => {
    // 送信側がMIMEを正しく付けてこないのは日常的にある。
    // 実体の先頭バイトで最終判定するので、ここで拾いすぎても事故にはならない
    expect(classifyAttachment(a("invoice.pdf", "application/octet-stream")).kind).toBe("pdf");
  });

  it("拡張子が大文字の .PDF も拾う", () => {
    expect(classifyAttachment(a("INVOICE.PDF", "application/octet-stream")).kind).toBe("pdf");
  });

  it("inline の画像は署名画像として自動除外する", () => {
    const result = classifyAttachment(a("logo.png", "image/png", "inline"));
    expect(result.kind).toBe("auto-skip");
  });

  it("attachment の画像は自動除外しない（請求書の写真かもしれない）", () => {
    expect(classifyAttachment(a("scan.png", "image/png", "attachment")).kind).toBe("not-pdf");
  });

  it("Content-Disposition が無い画像も自動除外しない", () => {
    expect(classifyAttachment(a("photo.jpg", "image/jpeg", null)).kind).toBe("not-pdf");
  });

  it("Excelの請求書はPDF以外として人の確認に回す（静かに捨てない）", () => {
    const result = classifyAttachment(
      a("seikyu.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    expect(result.kind).toBe("not-pdf");
    if (result.kind === "not-pdf") expect(result.reason).toContain("PDF以外");
  });

  it("inline のPDFはPDFとして扱う（自動除外は画像だけ）", () => {
    expect(classifyAttachment(a("invoice.pdf", "application/pdf", "inline")).kind).toBe("pdf");
  });
});
