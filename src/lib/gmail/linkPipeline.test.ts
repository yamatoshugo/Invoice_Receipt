import { beforeAll, describe, expect, it } from "vitest";
import { extractBody } from "./body";
import { decodeText } from "./charset";
import { getLinkPicker, resolvePick } from "@/lib/linkpick";
import { classifyFetched, fileNameFromDownload } from "@/lib/safefetch";
import type { GmailPart } from "./types";

/**
 * 本文 → リンク判定 → 取得結果の分類 までの通し。
 *
 * 実際のネットワーク取得はここでは行わない。
 * safefetch は内部アドレスを遮断するので、テスト用のローカルサーバーには
 * （正しく）到達できない。遮断そのものは fetch.test.ts が実サーバーで確認している。
 * 本物のURLでの取得は、実際の請求書メールで確認する。
 */
beforeAll(() => {
  process.env.LINK_PICKER = "stub";
});

const mail = (html: string, plain = "ご請求のお知らせ"): GmailPart => ({
  mimeType: "multipart/alternative",
  filename: "",
  parts: [
    { mimeType: "text/plain", filename: "", body: { data: Buffer.from(plain).toString("base64url") } },
    { mimeType: "text/html", filename: "", body: { data: Buffer.from(html).toString("base64url") } },
  ],
});

async function pickFrom(html: string) {
  const body = extractBody(mail(html));
  const picked = await getLinkPicker().pick({
    subject: "8月分ご請求",
    fromRaw: "経理 <billing@ex.jp>",
    bodyText: body.text,
    links: body.links,
  });
  if (!picked.ok) throw new Error(picked.error);
  return { body, resolved: resolvePick(picked.data, body.links) };
}

describe("本文からリンクを選ぶまで", () => {
  it("請求書リンクを選び、配信停止リンクは選ばない", async () => {
    // これがこの機能の安全性そのもの。押したら取り消せないリンクを選ばせない
    const { body, resolved } = await pickFrom(`
      <p>ご請求書を発行しました</p>
      <a href="https://ex.jp/invoice/8f3a">請求書をダウンロード</a>
      <a href="https://ex.jp/unsubscribe?u=1">配信停止はこちら</a>`);

    expect(body.links).toHaveLength(2);
    expect(resolved.kind).toBe("download");
    if (resolved.kind !== "download") return;
    expect(resolved.url).toBe("https://ex.jp/invoice/8f3a");
    expect(resolved.url).not.toContain("unsubscribe");
  });

  it("ログインが要るリンクは取得せず、依頼待ちとして返す", async () => {
    const { resolved } = await pickFrom(
      '<a href="https://portal.ex.jp/login?next=/invoice">請求書はログインしてご確認ください</a>',
    );
    expect(resolved.kind).toBe("login-required");
  });

  it("請求書リンクが無ければ none（取得を試みない）", async () => {
    const { resolved } = await pickFrom(
      '<a href="https://ex.jp/">会社サイト</a><a href="https://ex.jp/unsubscribe">配信停止</a>',
    );
    expect(resolved.kind).toBe("none");
  });

  it("本文にリンクが無ければ候補も空", async () => {
    const body = extractBody(mail("<p>添付をご確認ください</p>"));
    expect(body.links).toEqual([]);
  });

  it("ISO-2022-JP の本文でもURLが壊れない", () => {
    // 日本語メールの定番。iconv-lite が非対応なので自前で変換している
    const raw = Buffer.from(
      "\u001b$B@AEA=q\u001b(B https://ex.jp/invoice/8f3a \u001b$B$r$4Mw2<$5$$\u001b(B",
      "latin1",
    );
    const text = decodeText(raw, "ISO-2022-JP");
    expect(text).toContain("https://ex.jp/invoice/8f3a");
  });
});

describe("取得結果の分類", () => {
  const pdf = Buffer.from("%PDF-1.7\ntrailer<</Root 1 0 R>>\n%%EOF", "latin1");

  it("PDFが返れば取り込みへ進む", () => {
    const klass = classifyFetched({
      status: 200,
      contentType: "application/octet-stream",
      hops: ["https://ex.jp/invoice/8f3a"],
      body: pdf,
      bodyText: null,
    });
    expect(klass.kind).toBe("pdf");
  });

  it("ログイン画面が返れば依頼待ちにする", () => {
    const html = '<!doctype html><html><body><form><input type="password"></form></body></html>';
    const klass = classifyFetched({
      status: 200,
      contentType: "text/html",
      hops: ["https://portal.ex.jp/login"],
      body: Buffer.from(html),
      bodyText: html,
    });
    expect(klass.kind).toBe("login-required");
  });

  it("Content-Disposition から日本語のファイル名を取り出す", () => {
    const name = fileNameFromDownload({
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent("請求書2608.pdf")}`,
      finalUrl: "https://ex.jp/invoice/8f3a",
      fallback: "invoice.pdf",
    });
    expect(name).toBe("請求書2608.pdf");
  });

  it("ファイル名が無ければURLから作り、.pdf を付ける", () => {
    const name = fileNameFromDownload({
      contentDisposition: null,
      finalUrl: "https://ex.jp/invoice/8f3a",
      fallback: "invoice.pdf",
    });
    expect(name).toBe("8f3a.pdf");
  });
});
