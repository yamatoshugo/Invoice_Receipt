import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, extractLinks, extractPlainUrls, htmlToText } from "./html";

describe("decodeHtmlEntities", () => {
  it("&amp; を戻す（戻さないとURLのクエリが壊れる）", () => {
    expect(decodeHtmlEntities("a=1&amp;b=2")).toBe("a=1&b=2");
  });

  it("数値文字参照を戻す", () => {
    expect(decodeHtmlEntities("&#x3042;&#12356;")).toBe("あい");
  });

  it("名前付き実体を戻す", () => {
    expect(decodeHtmlEntities("&lt;tag&gt; &quot;q&quot; &nbsp;")).toBe('<tag> "q"  ');
  });

  it("&amp;lt; を二重に戻さない", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("壊れた数値参照でも落ちない", () => {
    expect(() => decodeHtmlEntities("&#99999999999;")).not.toThrow();
  });
});

describe("extractLinks", () => {
  it("href とアンカーテキストを取り出す", () => {
    const links = extractLinks('<a href="https://example.jp/a">請求書はこちら</a>');
    expect(links).toEqual([
      { url: "https://example.jp/a", anchorText: "請求書はこちら", source: "html" },
    ]);
  });

  it("引用符なし・シングルクォートの href も拾う", () => {
    expect(extractLinks("<a href=https://a.jp/x>a</a>")[0]!.url).toBe("https://a.jp/x");
    expect(extractLinks("<a href='https://b.jp/y'>b</a>")[0]!.url).toBe("https://b.jp/y");
  });

  it("href の中の &amp; を戻す（署名付きURLを壊さない）", () => {
    const links = extractLinks('<a href="https://a.jp/d?id=1&amp;sig=xyz">DL</a>');
    expect(links[0]!.url).toBe("https://a.jp/d?id=1&sig=xyz");
  });

  it("script の中のURLは拾わない", () => {
    // 人に見えないURLを判定の候補にしない
    expect(extractLinks('<script>var u="https://evil.jp/x";</script>')).toEqual([]);
  });

  it("style の中のURLは拾わない", () => {
    expect(extractLinks('<style>a{background:url(https://evil.jp/x)}</style>')).toEqual([]);
  });

  it("HTMLコメントの中のURLは拾わない", () => {
    expect(extractLinks('<!-- <a href="https://old.jp/x">古い</a> -->')).toEqual([]);
  });

  it("mailto: や tel: は拾わない", () => {
    expect(extractLinks('<a href="mailto:a@b.jp">メール</a><a href="tel:0312345678">電話</a>')).toEqual(
      [],
    );
  });

  it("cid: の埋め込み画像は拾わない", () => {
    expect(extractLinks('<a href="cid:logo@1">logo</a>')).toEqual([]);
  });

  it("アンカーテキストが空なら null", () => {
    expect(extractLinks('<a href="https://a.jp/x"><img src="y"></a>')[0]!.anchorText).toBeNull();
  });

  it("複数のリンクを順に返す", () => {
    const html = '<a href="https://a.jp/1">請求書</a><a href="https://a.jp/2">配信停止</a>';
    expect(extractLinks(html).map((l) => l.anchorText)).toEqual(["請求書", "配信停止"]);
  });
});

describe("htmlToText", () => {
  it("タグを落として読めるテキストにする", () => {
    expect(htmlToText("<p>ご請求</p><p>金額は10,000円です</p>")).toBe("ご請求\n金額は10,000円です");
  });

  it("<br> は改行になる", () => {
    expect(htmlToText("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("リストの各項目が改行で分かれる", () => {
    expect(htmlToText("<ul><li>一</li><li>二</li></ul>")).toBe("一\n二");
  });

  it("実体参照を戻す", () => {
    expect(htmlToText("<p>A&amp;B</p>")).toBe("A&B");
  });

  it("script と style の中身は出さない", () => {
    expect(htmlToText("<style>p{color:red}</style><p>本文</p>")).toBe("本文");
  });
});

describe("extractPlainUrls", () => {
  it("平文中の生URLを拾う", () => {
    expect(extractPlainUrls("詳細は https://example.jp/a をご覧ください")).toEqual([
      "https://example.jp/a",
    ]);
  });

  it("全角の句点を終端として扱う", () => {
    expect(extractPlainUrls("こちら https://example.jp/a。")).toEqual(["https://example.jp/a"]);
  });

  it("全角括弧で囲まれていても拾う", () => {
    expect(extractPlainUrls("（https://example.jp/a）")).toEqual(["https://example.jp/a"]);
  });

  it("末尾の半角句読点を落とす", () => {
    expect(extractPlainUrls("see https://example.jp/a.")).toEqual(["https://example.jp/a"]);
    expect(extractPlainUrls("see https://example.jp/a, and")).toEqual(["https://example.jp/a"]);
  });

  it("URL内に対応する開き括弧があれば閉じ括弧を残す", () => {
    expect(extractPlainUrls("https://ja.wikipedia.org/wiki/A_(B)")).toEqual([
      "https://ja.wikipedia.org/wiki/A_(B)",
    ]);
  });

  it("http と https の両方を拾う", () => {
    expect(extractPlainUrls("http://a.jp/1 https://b.jp/2")).toHaveLength(2);
  });

  it("URLが無ければ空", () => {
    expect(extractPlainUrls("本文にリンクはありません")).toEqual([]);
  });

  it("スキームだけの文字列は拾わない", () => {
    expect(extractPlainUrls("https://")).toEqual([]);
  });
});
