import { describe, expect, it } from "vitest";
import { classifyFetched } from "./classify";
import type { FetchedForClassify } from "./classify";

const pdf = Buffer.from("%PDF-1.7\ntrailer<</Root 1 0 R>>\n%%EOF", "latin1");
const html = (inner: string) => Buffer.from(`<!doctype html><html><body>${inner}</body></html>`, "utf8");

const input = (over: Partial<FetchedForClassify> = {}): FetchedForClassify => ({
  status: 200,
  contentType: "application/pdf",
  hops: ["https://example.jp/invoice/1"],
  body: pdf,
  bodyText: null,
  ...over,
});

describe("classifyFetched", () => {
  it("実体がPDFなら、Content-Type が何であれPDFとして扱う", () => {
    // 配信サーバーが octet-stream や text/plain で返すのは日常茶飯事
    expect(classifyFetched(input({ contentType: "application/octet-stream" })).kind).toBe("pdf");
    expect(classifyFetched(input({ contentType: "text/plain" })).kind).toBe("pdf");
    expect(classifyFetched(input({ contentType: null })).kind).toBe("pdf");
  });

  it("Content-Type がPDFでも中身がHTMLならPDFとして扱わない", () => {
    const body = html("<p>メンテナンス中です</p>");
    const result = classifyFetched(
      input({ body, bodyText: body.toString("utf8"), contentType: "application/pdf" }),
    );
    expect(result.kind).toBe("not-pdf");
  });

  it("401 はログインが必要", () => {
    const body = html("unauthorized");
    expect(classifyFetched(input({ status: 401, body, bodyText: "unauthorized" })).kind).toBe(
      "login-required",
    );
  });

  it("403 はログインが必要", () => {
    const body = html("forbidden");
    expect(classifyFetched(input({ status: 403, body, bodyText: "forbidden" })).kind).toBe(
      "login-required",
    );
  });

  it("パスワード入力欄があればログインが必要", () => {
    const body = html('<form><input type="password" name="p"></form>');
    expect(classifyFetched(input({ body, bodyText: body.toString("utf8") })).kind).toBe(
      "login-required",
    );
  });

  it("日本語の「ログイン」があればログインが必要", () => {
    const body = html("<h1>ログインしてください</h1>");
    expect(classifyFetched(input({ body, bodyText: body.toString("utf8") })).kind).toBe(
      "login-required",
    );
  });

  it("転送の経路にログイン画面があればログインが必要", () => {
    const body = html("<p>Redirecting</p>");
    const result = classifyFetched(
      input({
        body,
        bodyText: body.toString("utf8"),
        hops: ["https://a.jp/invoice/1", "https://a.jp/login?returnUrl=%2Finvoice%2F1"],
      }),
    );
    expect(result.kind).toBe("login-required");
  });

  it("証拠が無いHTMLは not-pdf に倒す（取引先にメールを出さない側）", () => {
    // login-required は依頼メールを送る状態で、送ったメールは取り消せない。
    // 誤検知の代償が非対称なので、証拠が無いときは人が見るだけの側にする
    const body = html("<p>お探しのページは移動しました</p>");
    expect(classifyFetched(input({ body, bodyText: body.toString("utf8") })).kind).toBe("not-pdf");
  });

  it("PDFでもHTMLでもない 200 は not-pdf", () => {
    const body = Buffer.from("PKzip", "latin1");
    const result = classifyFetched(input({ body, bodyText: null, contentType: "application/zip" }));
    expect(result.kind).toBe("not-pdf");
    if (result.kind === "not-pdf") expect(result.reason).toContain("application/zip");
  });

  it("404 は失敗（期限切れの可能性）", () => {
    const result = classifyFetched(input({ status: 404, body: Buffer.alloc(0), bodyText: null }));
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.reason).toContain("有効期限");
  });

  it("410 も失敗として扱う", () => {
    expect(classifyFetched(input({ status: 410, body: Buffer.alloc(0), bodyText: null })).kind).toBe(
      "failed",
    );
  });

  it("5xx は失敗（再試行の価値がある）", () => {
    expect(classifyFetched(input({ status: 503, body: Buffer.alloc(0), bodyText: null })).kind).toBe(
      "failed",
    );
  });

  it("空の本文でも落ちない", () => {
    expect(() =>
      classifyFetched(input({ status: 200, body: Buffer.alloc(0), bodyText: null })),
    ).not.toThrow();
  });
});
