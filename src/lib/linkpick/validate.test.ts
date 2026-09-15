import { describe, expect, it } from "vitest";
import { MAX_LINKS } from "./types";
import { buildUserText, formatLinkList, limitLinks, resolvePick } from "./validate";
import type { LinkPick, LinkPickCandidate } from "./types";

const links: LinkPickCandidate[] = [
  { url: "https://ex.jp/invoice/8f3a", anchorText: "請求書をダウンロード" },
  { url: "https://ex.jp/", anchorText: "example.co.jp" },
  { url: "https://ex.jp/unsubscribe?u=1", anchorText: "配信停止" },
];

const pick = (over: Partial<LinkPick> = {}): LinkPick => ({
  decision: "download",
  primaryIndex: 1,
  secondaryIndex: null,
  confidence: 0.9,
  reason: "アンカーテキストが「請求書をダウンロード」でした",
  ...over,
});

describe("limitLinks", () => {
  it("上限までは全部渡す", () => {
    expect(limitLinks(links)).toHaveLength(3);
  });

  it("上限を超えたら切る", () => {
    const many = Array.from({ length: MAX_LINKS + 20 }, (_, i) => ({
      url: `https://ex.jp/${i}`,
      anchorText: null,
    }));
    expect(limitLinks(many)).toHaveLength(MAX_LINKS);
  });

  it("切るのは後ろ側（本文の前のほうを残す）", () => {
    const many = Array.from({ length: MAX_LINKS + 5 }, (_, i) => ({
      url: `https://ex.jp/${i}`,
      anchorText: null,
    }));
    expect(limitLinks(many)[0]!.url).toBe("https://ex.jp/0");
  });
});

describe("formatLinkList", () => {
  it("1始まりの番号を振る", () => {
    const text = formatLinkList(links);
    expect(text).toContain("1. [請求書をダウンロード] https://ex.jp/invoice/8f3a");
    expect(text).toContain("3. [配信停止] https://ex.jp/unsubscribe?u=1");
  });

  it("アンカーテキストが無い場合も番号がずれない", () => {
    const text = formatLinkList([{ url: "https://ex.jp/a", anchorText: null }]);
    expect(text).toContain("1. [(テキストなし)] https://ex.jp/a");
  });
});

describe("buildUserText", () => {
  it("差出人・件名・本文・リンク一覧を含む", () => {
    const text = buildUserText({
      subject: "8月分ご請求",
      fromRaw: "経理 <billing@ex.jp>",
      bodyText: "請求書を発行しました",
      links,
    });
    expect(text).toContain("8月分ご請求");
    expect(text).toContain("billing@ex.jp");
    expect(text).toContain("請求書を発行しました");
    expect(text).toContain("1. [請求書をダウンロード]");
  });

  it("件名や本文が無くても壊れない", () => {
    const text = buildUserText({ subject: null, fromRaw: "", bodyText: "", links });
    expect(text).toContain("(件名なし)");
    expect(text).toContain("(本文なし)");
  });
});

describe("resolvePick", () => {
  it("番号を原文のURLに戻す", () => {
    const r = resolvePick(pick(), links);
    expect(r.kind).toBe("download");
    if (r.kind === "download") expect(r.url).toBe("https://ex.jp/invoice/8f3a");
  });

  it("第2候補も戻す", () => {
    const r = resolvePick(pick({ secondaryIndex: 2 }), links);
    if (r.kind === "download") expect(r.fallbackUrl).toBe("https://ex.jp/");
  });

  it("第1候補と同じ第2候補は捨てる（同じURLを2度叩かない）", () => {
    const r = resolvePick(pick({ secondaryIndex: 1 }), links);
    if (r.kind === "download") expect(r.fallbackUrl).toBeNull();
  });

  it("ログインが要る場合もURLを返す（あとで送付依頼に使う）", () => {
    const r = resolvePick(pick({ decision: "login_required", primaryIndex: 1 }), links);
    expect(r.kind).toBe("login-required");
    if (r.kind === "login-required") expect(r.url).toBe("https://ex.jp/invoice/8f3a");
  });

  it("none なら番号を見ない", () => {
    const r = resolvePick(pick({ decision: "none", primaryIndex: null }), links);
    expect(r.kind).toBe("none");
  });

  it("番号が範囲外なら採用しない", () => {
    // decision だけ採ると「リンクがあると言われたのにURLが無い」壊れた状態になる
    expect(resolvePick(pick({ primaryIndex: 99 }), links).kind).toBe("invalid");
    expect(resolvePick(pick({ primaryIndex: 0 }), links).kind).toBe("invalid");
    expect(resolvePick(pick({ primaryIndex: -1 }), links).kind).toBe("invalid");
  });

  it("download なのに番号が無ければ採用しない", () => {
    expect(resolvePick(pick({ primaryIndex: null }), links).kind).toBe("invalid");
  });

  it("整数でない番号は採用しない", () => {
    expect(resolvePick(pick({ primaryIndex: 1.5 }), links).kind).toBe("invalid");
  });

  it("範囲外の第2候補は黙って捨てる（第1候補は活かす）", () => {
    const r = resolvePick(pick({ secondaryIndex: 99 }), links);
    expect(r.kind).toBe("download");
    if (r.kind === "download") expect(r.fallbackUrl).toBeNull();
  });

  it("確信度を0〜1に収める", () => {
    const over = resolvePick(pick({ confidence: 5 }), links);
    const under = resolvePick(pick({ confidence: -1 }), links);
    const nan = resolvePick(pick({ confidence: Number.NaN }), links);
    if (over.kind === "download") expect(over.confidence).toBe(1);
    if (under.kind === "download") expect(under.confidence).toBe(0);
    if (nan.kind === "download") expect(nan.confidence).toBe(0);
  });

  it("リンクが1件も無ければ採用しない", () => {
    expect(resolvePick(pick(), []).kind).toBe("invalid");
  });

  it("判断の理由をそのまま持ち回る（画面に出す）", () => {
    const r = resolvePick(pick({ reason: "「ご請求書はこちら」とありました" }), links);
    if (r.kind === "download") expect(r.reason).toBe("「ご請求書はこちら」とありました");
  });
});
