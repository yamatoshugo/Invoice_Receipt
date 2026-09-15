import { describe, expect, it } from "vitest";
import { collectAttachmentParts, decodeMimeFilename, findPartById, parseFromHeader } from "./parts";
import type { GmailPart } from "./types";

/** 添付パートを1つ作る */
const attach = (fileName: string, mimeType = "application/pdf", attachmentId = "att-1"): GmailPart => ({
  mimeType,
  filename: fileName,
  body: { attachmentId, size: 1234 },
});

/** 本文パート（filename を持たない） */
const text = (mimeType = "text/plain"): GmailPart => ({
  mimeType,
  filename: "",
  body: { size: 10, data: "aGVsbG8" },
});

describe("collectAttachmentParts", () => {
  it("添付が無いメールでは空配列を返す", () => {
    const payload: GmailPart = { mimeType: "text/plain", filename: "", body: { size: 5 } };
    expect(collectAttachmentParts(payload)).toEqual([]);
  });

  it("payload が無くても落ちない", () => {
    expect(collectAttachmentParts(null)).toEqual([]);
    expect(collectAttachmentParts(undefined)).toEqual([]);
  });

  it("multipart/mixed の直下のPDFを拾う", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [text(), attach("seikyu.pdf")],
    };
    const found = collectAttachmentParts(payload);
    expect(found).toHaveLength(1);
    expect(found[0]!.fileName).toBe("seikyu.pdf");
    expect(found[0]!.ref).toBe("2"); // 2番目の子
  });

  it("multipart/alternative の入れ子の中のPDFも拾う", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [
        { mimeType: "multipart/alternative", filename: "", parts: [text(), text("text/html")] },
        attach("invoice.pdf"),
      ],
    };
    const found = collectAttachmentParts(payload);
    expect(found.map((f) => f.fileName)).toEqual(["invoice.pdf"]);
  });

  it("転送メール（message/rfc822）に入れ子になった添付を拾う", () => {
    // 社内で転送された請求書は実運用で必ず出る。再帰が浅いとここで静かに落ちる
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [
        text(),
        {
          mimeType: "message/rfc822",
          filename: "転送メール.eml",
          parts: [
            {
              mimeType: "multipart/mixed",
              filename: "",
              parts: [text(), attach("nested-invoice.pdf", "application/pdf", "att-nested")],
            },
          ],
        },
      ],
    };
    const found = collectAttachmentParts(payload);
    expect(found.map((f) => f.fileName)).toEqual(["転送メール.eml", "nested-invoice.pdf"]);
    expect(found[1]!.ref).toBe("2.1.2");
    expect(found[1]!.attachmentId).toBe("att-nested");
  });

  it("ref は親から連結した位置になる", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [
        { mimeType: "multipart/related", filename: "", parts: [text(), attach("a.pdf")] },
        attach("b.pdf"),
      ],
    };
    expect(collectAttachmentParts(payload).map((f) => f.ref)).toEqual(["1.2", "2"]);
  });

  it("filename が空のパートは添付として数えない", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [text(), text("text/html"), { mimeType: "image/png", filename: "", body: { size: 1 } }],
    };
    expect(collectAttachmentParts(payload)).toEqual([]);
  });

  it("同じファイル名の添付2件を別々に返す", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [attach("invoice.pdf", "application/pdf", "att-1"), attach("invoice.pdf", "application/pdf", "att-2")],
    };
    const found = collectAttachmentParts(payload);
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.ref)).toEqual(["1", "2"]);
    expect(found.map((f) => f.attachmentId)).toEqual(["att-1", "att-2"]);
  });

  it("Content-Disposition を取り出す", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [
        {
          mimeType: "image/png",
          filename: "logo.png",
          headers: [{ name: "Content-Disposition", value: 'inline; filename="logo.png"' }],
          body: { attachmentId: "att-logo", size: 100 },
        },
      ],
    };
    expect(collectAttachmentParts(payload)[0]!.disposition).toBe("inline");
  });

  it("attachmentId が無い添付でも列挙する（取り込み時に取り直すため）", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [{ mimeType: "application/pdf", filename: "x.pdf", body: { size: 9 } }],
    };
    expect(collectAttachmentParts(payload)[0]!.attachmentId).toBeNull();
  });
});

describe("findPartById", () => {
  const payload: GmailPart = {
    mimeType: "multipart/mixed",
    filename: "",
    parts: [
      { mimeType: "multipart/alternative", filename: "", parts: [text(), attach("deep.pdf")] },
      attach("top.pdf"),
    ],
  };

  it("入れ子の ref で目的のパートを取り出す", () => {
    expect(findPartById(payload, "1.2")!.filename).toBe("deep.pdf");
    expect(findPartById(payload, "2")!.filename).toBe("top.pdf");
  });

  it("collectAttachmentParts が返した ref で必ず引き直せる", () => {
    for (const found of collectAttachmentParts(payload)) {
      expect(findPartById(payload, found.ref)!.filename).toBe(found.fileName);
    }
  });

  it("存在しない ref では null", () => {
    expect(findPartById(payload, "9")).toBeNull();
    expect(findPartById(payload, "1.9")).toBeNull();
  });

  it("空の ref はルートを返す", () => {
    expect(findPartById(payload, "")).toBe(payload);
  });
});

describe("decodeMimeFilename", () => {
  it("素のASCIIはそのまま返す", () => {
    expect(decodeMimeFilename("invoice.pdf")).toBe("invoice.pdf");
  });

  it("Gmailが既にデコード済みで返す日本語名もそのまま返す", () => {
    expect(decodeMimeFilename("請求書_2026年8月.pdf")).toBe("請求書_2026年8月.pdf");
  });

  it("RFC2047 の B エンコード（UTF-8）を復号する", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("請求書.pdf", "utf8").toString("base64")}?=`;
    expect(decodeMimeFilename(encoded)).toBe("請求書.pdf");
  });

  it("RFC2047 の Q エンコードを復号する（_ は空白）", () => {
    expect(decodeMimeFilename("=?UTF-8?Q?invoice=5Faug.pdf?=")).toBe("invoice_aug.pdf");
    expect(decodeMimeFilename("=?UTF-8?Q?my_file.pdf?=")).toBe("my file.pdf");
  });

  it("隣接するエンコード語の間の空白は無視する", () => {
    const a = `=?UTF-8?B?${Buffer.from("請求", "utf8").toString("base64")}?=`;
    const b = `=?UTF-8?B?${Buffer.from("書.pdf", "utf8").toString("base64")}?=`;
    expect(decodeMimeFilename(`${a} ${b}`)).toBe("請求書.pdf");
  });

  it("未知の文字セットや壊れたエンコードは、消さず生のまま残す", () => {
    // 名前が消えると人が判断できなくなる。読めないより、生で見えたほうがよい
    expect(decodeMimeFilename("=?NOSUCHSET?B?xxxx?=")).toBe("=?NOSUCHSET?B?xxxx?=");
  });
});

describe("parseFromHeader", () => {
  it("表示名とアドレスを分ける", () => {
    expect(parseFromHeader('"山田 太郎" <taro@example.co.jp>')).toEqual({
      name: "山田 太郎",
      address: "taro@example.co.jp",
    });
  });

  it("アドレスだけの形式も扱う", () => {
    expect(parseFromHeader("billing@example.co.jp")).toEqual({
      name: null,
      address: "billing@example.co.jp",
    });
  });

  it("アドレスは小文字に揃える（照合と宛先の取り違えを防ぐ）", () => {
    expect(parseFromHeader("<Billing@Example.CO.JP>").address).toBe("billing@example.co.jp");
  });

  it("RFC2047 の表示名を復号する", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("株式会社サンプル", "utf8").toString("base64")}?=`;
    expect(parseFromHeader(`${encoded} <a@b.jp>`)).toEqual({
      name: "株式会社サンプル",
      address: "a@b.jp",
    });
  });
});
