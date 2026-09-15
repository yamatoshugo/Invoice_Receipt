import { describe, expect, it } from "vitest";
import { canThread, normalizeSubject, withRePrefix } from "./threading";

describe("normalizeSubject", () => {
  it("Re: を落とす", () => {
    expect(normalizeSubject("Re: 8月分ご請求")).toBe("8月分ご請求");
    expect(normalizeSubject("RE:8月分ご請求")).toBe("8月分ご請求");
    expect(normalizeSubject("re : 8月分ご請求")).toBe("8月分ご請求");
  });

  it("全角の Ｒｅ： も落とす（日本語のメールソフトで実際に付く）", () => {
    expect(normalizeSubject("Ｒｅ：8月分ご請求")).toBe("8月分ご請求");
  });

  it("重ねて付いた Re: をすべて落とす", () => {
    expect(normalizeSubject("Re: Re: RE: 8月分ご請求")).toBe("8月分ご請求");
    expect(normalizeSubject("Re[2]: 8月分ご請求")).toBe("8月分ご請求");
  });

  it("前後・連続の空白を無視する", () => {
    expect(normalizeSubject("  8月分  ご請求 ")).toBe("8月分 ご請求");
  });

  it("本文中の Re: は落とさない", () => {
    expect(normalizeSubject("8月分ご請求 Re: 追加分")).toBe("8月分ご請求 re: 追加分");
  });
});

describe("withRePrefix", () => {
  it("Re: を付ける", () => {
    expect(withRePrefix("8月分ご請求")).toBe("Re: 8月分ご請求");
  });

  it("既に付いていれば重ねない", () => {
    expect(withRePrefix("Re: 8月分ご請求")).toBe("Re: 8月分ご請求");
    expect(withRePrefix("Ｒｅ：8月分ご請求")).toBe("Re: 8月分ご請求");
  });

  it("件名が空でも壊れない", () => {
    expect(withRePrefix("")).toBe("Re:");
  });
});

describe("canThread", () => {
  it("既定の件名（Re: 元の件名）なら元のスレッドに入る", () => {
    expect(canThread("Re: 8月分ご請求", "8月分ご請求")).toBe(true);
  });

  it("元の件名に既に Re: が付いていても一致する", () => {
    expect(canThread("Re: 8月分ご請求", "Re: 8月分ご請求")).toBe(true);
  });

  it("★件名を書き換えたらスレッドに入らない（Gmailは黙って新規メールにする）", () => {
    expect(canThread("請求書のご送付のお願い", "8月分ご請求")).toBe(false);
  });

  it("元の件名が無いメールには返信できない", () => {
    expect(canThread("Re: 8月分ご請求", null)).toBe(false);
    expect(canThread("Re: ", "")).toBe(false);
  });

  it("空白の違いだけなら一致とみなす", () => {
    expect(canThread("Re:  8月分  ご請求", "8月分 ご請求")).toBe(true);
  });
});
