import { describe, expect, it } from "vitest";
import { dedupKey, parseHttpUrl } from "./url";

const key = (raw: string) => dedupKey(parseHttpUrl(raw)!);

describe("parseHttpUrl", () => {
  it("http と https を通す", () => {
    expect(parseHttpUrl("https://example.jp/a")).not.toBeNull();
    expect(parseHttpUrl("http://example.jp/a")).not.toBeNull();
  });

  it("http(s) 以外のスキームは通さない", () => {
    // リダイレクト先のスキーム検査を忘れるのが典型的な穴
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("data:text/html,<h1>x</h1>")).toBeNull();
    expect(parseHttpUrl("gopher://a.jp/1")).toBeNull();
    expect(parseHttpUrl("ftp://a.jp/f")).toBeNull();
  });

  it("パースできない文字列は null", () => {
    expect(parseHttpUrl("not a url")).toBeNull();
    expect(parseHttpUrl("")).toBeNull();
  });

  it("前後の空白を無視する", () => {
    expect(parseHttpUrl("  https://example.jp/a  ")?.href).toBe("https://example.jp/a");
  });
});

describe("dedupKey", () => {
  it("ホスト名の大文字小文字を同一視する", () => {
    expect(key("https://EXAMPLE.jp/a")).toBe(key("https://example.jp/a"));
  });

  it("パスの大文字小文字は区別する", () => {
    // /A と /a は別リソースでありうる。同一視すると取りこぼしになる
    expect(key("https://example.jp/A")).not.toBe(key("https://example.jp/a"));
  });

  it("末尾スラッシュの有無は区別する", () => {
    expect(key("https://example.jp/a")).not.toBe(key("https://example.jp/a/"));
  });

  it("フラグメントだけ違うものは同一視する", () => {
    // サーバーに送られないので取得結果は必ず同じ
    expect(key("https://example.jp/a#x")).toBe(key("https://example.jp/a#y"));
  });

  it("クエリの順序が違っても同一視する", () => {
    expect(key("https://example.jp/a?b=2&c=3")).toBe(key("https://example.jp/a?c=3&b=2"));
  });

  it("utm_ パラメータを無視する", () => {
    expect(key("https://example.jp/a?utm_source=mail")).toBe(key("https://example.jp/a"));
  });

  it("既知のクリックIDを無視する", () => {
    expect(key("https://example.jp/a?gclid=x&fbclid=y")).toBe(key("https://example.jp/a"));
  });

  it("ref / id / token は残す（別URLを同一視しない）", () => {
    // トラッカーにも意味のあるパラメータにもなる名前は触らない
    expect(key("https://example.jp/a?id=1")).not.toBe(key("https://example.jp/a?id=2"));
    expect(key("https://example.jp/a?token=abc")).not.toBe(key("https://example.jp/a"));
    expect(key("https://example.jp/a?ref=xyz")).not.toBe(key("https://example.jp/a"));
  });

  it("署名付きURLは値の違いを保つ", () => {
    expect(key("https://a.jp/d?sig=aaa")).not.toBe(key("https://a.jp/d?sig=bbb"));
  });

  it("既定ポートの有無を同一視する", () => {
    expect(key("https://example.jp:443/a")).toBe(key("https://example.jp/a"));
  });

  it("スキームが違えば別物として扱う", () => {
    expect(key("http://example.jp/a")).not.toBe(key("https://example.jp/a"));
  });
});
