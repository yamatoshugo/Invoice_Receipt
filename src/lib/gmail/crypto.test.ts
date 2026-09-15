import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openToken, sealToken, tokenKeyConfigured } from "./crypto";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.GMAIL_TOKEN_KEY;
  process.env.GMAIL_TOKEN_KEY = KEY_A;
});

afterEach(() => {
  if (saved === undefined) delete process.env.GMAIL_TOKEN_KEY;
  else process.env.GMAIL_TOKEN_KEY = saved;
});

describe("sealToken / openToken", () => {
  it("封じて開くと元に戻る", () => {
    const plain = "1//0eXaMpLe-refresh-token_value";
    expect(openToken(sealToken(plain))).toBe(plain);
  });

  it("暗号文に平文が現れない", () => {
    const plain = "1//0eXaMpLe-refresh-token_value";
    expect(sealToken(plain)).not.toContain(plain);
  });

  it("バージョン接頭辞が付く（将来の鍵ローテーションのため）", () => {
    expect(sealToken("x").startsWith("v1.")).toBe(true);
  });

  it("同じ平文でも毎回違う暗号文になる（IVを使い回さない）", () => {
    // 同じ鍵でIVを再利用するとGCMは致命的に壊れる
    expect(sealToken("same")).not.toBe(sealToken("same"));
  });

  it("鍵が違えば復号できない", () => {
    const sealed = sealToken("secret");
    process.env.GMAIL_TOKEN_KEY = KEY_B;
    expect(() => openToken(sealed)).toThrow();
  });

  it("暗号文を改ざんすると復号できない", () => {
    const sealed = sealToken("secret");
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join(".");
    expect(() => openToken(tampered)).toThrow();
  });

  it("認証タグを改ざんすると復号できない", () => {
    const parts = sealToken("secret").split(".");
    const tag = Buffer.from(parts[2]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    expect(() => openToken([parts[0], parts[1], tag.toString("base64url"), parts[3]].join("."))).toThrow();
  });

  it("形式が壊れていれば例外を投げる", () => {
    expect(() => openToken("not-a-cipher")).toThrow("暗号文の形式が不正です");
  });

  it("知らないバージョンは例外を投げる", () => {
    const parts = sealToken("secret").split(".");
    expect(() => openToken(["v9", parts[1], parts[2], parts[3]].join("."))).toThrow("対応していない");
  });

  it("日本語を含むトークンでも往復できる", () => {
    expect(openToken(sealToken("トークン値"))).toBe("トークン値");
  });
});

describe("tokenKey の検証", () => {
  it("未設定なら封じる時点で分かりやすく落ちる", () => {
    delete process.env.GMAIL_TOKEN_KEY;
    expect(() => sealToken("x")).toThrow("GMAIL_TOKEN_KEY");
    expect(tokenKeyConfigured()).toBe(false);
  });

  it("32バイトでない鍵は拒否する", () => {
    process.env.GMAIL_TOKEN_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => sealToken("x")).toThrow("32バイト");
    expect(tokenKeyConfigured()).toBe(false);
  });

  it("正しい鍵なら設定済みと判定する", () => {
    expect(tokenKeyConfigured()).toBe(true);
  });
});
