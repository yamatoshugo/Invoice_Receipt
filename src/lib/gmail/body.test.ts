import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { collectBodyParts, decodeBodyPart, extractBody, MAX_BODY_CHARS } from "./body";
import type { GmailPart } from "./types";

/** 本文パートを作る。data は base64url */
const bodyPart = (mimeType: string, text: string, charset = "utf-8"): GmailPart => ({
  mimeType: charset === "utf-8" ? mimeType : `${mimeType}; charset=${charset}`,
  filename: "",
  headers: [{ name: "Content-Type", value: `${mimeType}; charset=${charset}` }],
  body: { data: iconv.encode(text, charset).toString("base64url"), size: text.length },
});

const attachment = (fileName: string): GmailPart => ({
  mimeType: "application/pdf",
  filename: fileName,
  body: { attachmentId: "att-1", size: 100 },
});

describe("collectBodyParts", () => {
  it("text/plain と text/html を両方集める", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      filename: "",
      parts: [bodyPart("text/plain", "平文"), bodyPart("text/html", "<p>HTML</p>")],
    };
    expect(collectBodyParts(payload).map((p) => p.mimeType)).toEqual(["text/plain", "text/html"]);
  });

  it("添付されたHTMLは本文として拾わない", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [{ mimeType: "text/html", filename: "report.html", body: { attachmentId: "a" } }],
    };
    expect(collectBodyParts(payload)).toEqual([]);
  });

  it("転送メール（message/rfc822）の中の本文も拾う", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [
        bodyPart("text/plain", "転送します"),
        {
          mimeType: "message/rfc822",
          filename: "fwd.eml",
          parts: [
            {
              mimeType: "multipart/alternative",
              filename: "",
              parts: [bodyPart("text/plain", "元の請求書メール")],
            },
          ],
        },
      ],
    };
    const texts = collectBodyParts(payload).map(decodeBodyPart);
    expect(texts).toContain("元の請求書メール");
  });

  it("PDFの添付は本文に数えない", () => {
    const payload: GmailPart = {
      mimeType: "multipart/mixed",
      filename: "",
      parts: [bodyPart("text/plain", "本文"), attachment("invoice.pdf")],
    };
    expect(collectBodyParts(payload)).toHaveLength(1);
  });

  it("payload が無くても落ちない", () => {
    expect(collectBodyParts(null)).toEqual([]);
    expect(collectBodyParts(undefined)).toEqual([]);
  });

  it("本文が別取得（attachmentId）になっている場合を記録する", () => {
    const payload: GmailPart = {
      mimeType: "text/html",
      filename: "",
      body: { attachmentId: "big-body", size: 900_000 },
    };
    expect(collectBodyParts(payload)[0]!.externalAttachmentId).toBe("big-body");
  });
});

describe("decodeBodyPart", () => {
  it("UTF-8 の本文を復号する", () => {
    const part = bodyPart("text/plain", "ご請求書のお知らせ");
    expect(decodeBodyPart({ charset: "utf-8", data: part.body!.data! })).toBe("ご請求書のお知らせ");
  });

  it("Shift_JIS の本文を復号する", () => {
    const part = bodyPart("text/plain", "請求書", "Shift_JIS");
    expect(decodeBodyPart({ charset: "Shift_JIS", data: part.body!.data! })).toBe("請求書");
  });

  it("charset が無ければ utf-8 として読む", () => {
    const data = Buffer.from("本文", "utf8").toString("base64url");
    expect(decodeBodyPart({ charset: null, data })).toBe("本文");
  });

  it("未知の charset でも落ちず、utf-8 として読む", () => {
    const data = Buffer.from("本文", "utf8").toString("base64url");
    expect(decodeBodyPart({ charset: "X-UNKNOWN-CHARSET", data })).toBe("本文");
  });

  it("data が無ければ空文字", () => {
    expect(decodeBodyPart({ charset: "utf-8", data: null })).toBe("");
  });
});

describe("extractBody", () => {
  it("平文を本文として使い、HTMLからリンクを拾う", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      filename: "",
      parts: [
        bodyPart("text/plain", "請求書をご確認ください"),
        bodyPart("text/html", '<a href="https://ex.jp/inv/1">請求書</a>'),
      ],
    };
    const body = extractBody(payload);
    expect(body.text).toBe("請求書をご確認ください");
    expect(body.links).toHaveLength(1);
    expect(body.links[0]!.anchorText).toBe("請求書");
  });

  it("平文が無ければHTMLから本文を起こす", () => {
    const payload = bodyPart("text/html", "<p>ご請求のお知らせ</p>");
    expect(extractBody(payload).text).toBe("ご請求のお知らせ");
  });

  it("平文中の生URLも拾う", () => {
    const payload = bodyPart("text/plain", "こちら https://ex.jp/a です");
    expect(extractBody(payload).links.map((l) => l.url)).toEqual(["https://ex.jp/a"]);
  });

  it("同じURLが平文とHTMLの両方にあっても1本にまとめる", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      filename: "",
      parts: [
        bodyPart("text/plain", "https://ex.jp/a"),
        bodyPart("text/html", '<a href="https://ex.jp/a">請求書</a>'),
      ],
    };
    const links = extractBody(payload).links;
    expect(links).toHaveLength(1);
    // 判定の手掛かりになるアンカーテキストがあるほうを残す
    expect(links[0]!.anchorText).toBe("請求書");
  });

  it("リンクが無ければ空", () => {
    expect(extractBody(bodyPart("text/plain", "添付をご確認ください")).links).toEqual([]);
  });

  it("長すぎる本文は切り詰め、切ったことを記録する", () => {
    const long = "あ".repeat(MAX_BODY_CHARS + 100);
    const body = extractBody(bodyPart("text/plain", long));
    expect(body.text).toHaveLength(MAX_BODY_CHARS);
    expect(body.truncated).toBe(true);
  });

  it("収まる本文では truncated が false", () => {
    expect(extractBody(bodyPart("text/plain", "短い本文")).truncated).toBe(false);
  });

  it("本文が別取得になっている場合に hasExternalBody が立つ", () => {
    // リンクの件数を数えられないので「あるかもしれない」側に倒すための印
    const payload: GmailPart = {
      mimeType: "text/html",
      filename: "",
      body: { attachmentId: "big", size: 900_000 },
    };
    expect(extractBody(payload).hasExternalBody).toBe(true);
  });

  it("payload が無くても落ちない", () => {
    const body = extractBody(null);
    expect(body.text).toBe("");
    expect(body.links).toEqual([]);
    expect(body.hasExternalBody).toBe(false);
  });
});
