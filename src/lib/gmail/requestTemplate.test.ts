import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  REQUEST_VARS,
  hasUnresolvedPlaceholders,
  looksUnreplyable,
  renderTemplate,
  todayLabel,
} from "./requestTemplate";
import type { RequestVars } from "./requestTemplate";

const vars = (over: Partial<RequestVars> = {}): RequestVars => ({
  取引先名: "楽々商事株式会社",
  元の件名: "8月分ご請求のお知らせ",
  受取アドレス: "seikyusho@example.co.jp",
  自社名: "株式会社テスト",
  今日: "2026年9月15日",
  ...over,
});

describe("renderTemplate", () => {
  it("すべての変数を差し込む", () => {
    const template = REQUEST_VARS.map((v) => `{{${v}}}`).join("/");
    const { text, unknownVars, emptyVars } = renderTemplate(template, vars());
    expect(text).toBe("楽々商事株式会社/8月分ご請求のお知らせ/seikyusho@example.co.jp/株式会社テスト/2026年9月15日");
    expect(unknownVars).toEqual([]);
    expect(emptyVars).toEqual([]);
  });

  it("同じ変数が何度出てきても差し込む", () => {
    expect(renderTemplate("{{自社名}}と{{自社名}}", vars()).text).toBe("株式会社テストと株式会社テスト");
  });

  it("空白が入った書き方も拾う", () => {
    expect(renderTemplate("{{ 取引先名 }}", vars()).text).toBe("楽々商事株式会社");
  });

  it("★未知の変数はそのまま残す（黙って消さない）", () => {
    // 消すと文が不自然になるだけで、書き間違いに誰も気付かない
    const { text, unknownVars } = renderTemplate("{{取引先名}} と {{担当者名}}", vars());
    expect(text).toBe("楽々商事株式会社 と {{担当者名}}");
    expect(unknownVars).toEqual(["担当者名"]);
  });

  it("★差し込んだ値の中の {{...}} は再展開されない", () => {
    // replace が1パスしか回らない性質に依存している。ループにしてはいけない
    const { text } = renderTemplate("{{取引先名}} 御中", vars({ 取引先名: "{{自社名}}" }));
    expect(text).toBe("{{自社名}} 御中");
  });

  it("★値に $& が含まれても壊れない", () => {
    // 置換を文字列で渡していると、ここで本文が壊れる
    expect(renderTemplate("[{{取引先名}}]", vars({ 取引先名: "$&商事" })).text).toBe("[$&商事]");
    expect(renderTemplate("[{{取引先名}}]", vars({ 取引先名: "$1$`$'" })).text).toBe("[$1$`$']");
  });

  it("値が空の変数を報告する（差し込み自体は空文字で行う）", () => {
    const { text, emptyVars } = renderTemplate("{{取引先名}} 御中", vars({ 取引先名: "" }));
    expect(text).toBe(" 御中");
    expect(emptyVars).toEqual(["取引先名"]);
  });

  it("変数が無いひな型はそのまま返る", () => {
    expect(renderTemplate("お世話になっております。", vars()).text).toBe("お世話になっております。");
  });

  it("例外を投げない（編集途中の保存を邪魔しない）", () => {
    expect(() => renderTemplate("{{ 壊れた", vars())).not.toThrow();
    expect(() => renderTemplate("}}{{}}{{", vars())).not.toThrow();
  });
});

describe("既定文面", () => {
  it("既定の件名を展開すると、元の件名と一致する（＝返信として送れる）", () => {
    const { text } = renderTemplate(DEFAULT_SUBJECT, vars());
    expect(text).toBe("Re: 8月分ご請求のお知らせ");
  });

  it("既定の本文に未知の変数が無い", () => {
    expect(renderTemplate(DEFAULT_BODY, vars()).unknownVars).toEqual([]);
  });

  it("展開すると差し込みが残らない", () => {
    expect(hasUnresolvedPlaceholders(renderTemplate(DEFAULT_BODY, vars()).text)).toBe(false);
  });

  it("★金額・口座・URLを書かない（誤送信時に漏れる情報を最小にする）", () => {
    expect(DEFAULT_BODY).not.toMatch(/http|振込|口座|金額|円/);
  });

  it("期限や「至急」を書かない", () => {
    expect(DEFAULT_BODY).not.toMatch(/至急|期限|までに/);
  });
});

describe("hasUnresolvedPlaceholders", () => {
  it("残っていれば true（送信ボタンを無効にする）", () => {
    expect(hasUnresolvedPlaceholders("{{取引先名}} 御中")).toBe(true);
  });

  it("残っていなければ false", () => {
    expect(hasUnresolvedPlaceholders("楽々商事株式会社 御中")).toBe(false);
  });

  it("連続で呼んでも結果が変わらない（正規表現の状態を持ち越さない）", () => {
    // gフラグ付きの正規表現は lastIndex を持つ。放置すると2回目が false になる
    expect(hasUnresolvedPlaceholders("{{a}}{{b}}")).toBe(true);
    expect(hasUnresolvedPlaceholders("{{a}}{{b}}")).toBe(true);
  });
});

describe("todayLabel", () => {
  it("JSTで日付を出す", () => {
    // UTC 2026-09-14 16:00 は JST では 9月15日
    expect(todayLabel(new Date("2026-09-14T16:00:00Z"))).toBe("2026年9月15日");
    expect(todayLabel(new Date("2026-09-14T14:59:00Z"))).toBe("2026年9月14日");
  });
});

describe("looksUnreplyable", () => {
  it("返信を受け付けない定番のアドレスを検出する", () => {
    expect(looksUnreplyable("noreply@rakuraku.jp")).toBe(true);
    expect(looksUnreplyable("no-reply@example.com")).toBe(true);
    expect(looksUnreplyable("donotreply@example.com")).toBe(true);
    expect(looksUnreplyable("NoReply@Example.com")).toBe(true);
    expect(looksUnreplyable("noreply-invoice@example.com")).toBe(true);
  });

  it("普通の窓口は誤検出しない", () => {
    expect(looksUnreplyable("keiri@example.com")).toBe(false);
    expect(looksUnreplyable("support@example.com")).toBe(false);
    expect(looksUnreplyable("reply@example.com")).toBe(false);
  });
});
