import { describe, expect, it } from "vitest";
import { validateGrantedScope } from "./oauth";
import {
  canSend,
  describeScopes,
  GMAIL_SCOPE_READONLY,
  GMAIL_SCOPE_SEND,
  hasScope,
  missingRequiredScopes,
  parseScopes,
  shortScopeName,
} from "./scope";

const READONLY = GMAIL_SCOPE_READONLY;
const SEND = GMAIL_SCOPE_SEND;
/** Googleは openid/email/profile を勝手に混ぜてくることがある */
const EXTRA = "https://www.googleapis.com/auth/userinfo.email";

describe("parseScopes", () => {
  it("空白区切りを集合にする", () => {
    expect(parseScopes(`${READONLY} ${SEND}`)).toEqual(new Set([READONLY, SEND]));
  });

  it("空文字・余分な空白・改行で壊れない", () => {
    expect(parseScopes("")).toEqual(new Set());
    expect(parseScopes("   ")).toEqual(new Set());
    expect(parseScopes(`  ${READONLY}\n ${SEND}  `)).toEqual(new Set([READONLY, SEND]));
  });

  it("前方一致では判定しない", () => {
    // gmail.readonly を含む別のスコープ名を、読み取り権限と誤認しない
    expect(hasScope(`${READONLY}.extra`, READONLY)).toBe(false);
  });
});

describe("canSend", () => {
  it("読み取りだけなら送れない", () => {
    // 既存の接続はここに該当する。送信ボタンを押す前に検知するのがこの関数の役目
    expect(canSend(READONLY)).toBe(false);
  });

  it("送信が含まれていれば送れる", () => {
    expect(canSend(`${READONLY} ${SEND}`)).toBe(true);
  });

  it("順序が違っても、余分なスコープが混ざっても変わらない", () => {
    expect(canSend(`${SEND} ${READONLY}`)).toBe(true);
    expect(canSend(`${EXTRA} ${SEND} ${READONLY}`)).toBe(true);
    expect(canSend(`${EXTRA} ${READONLY}`)).toBe(false);
  });

  it("空文字なら送れない", () => {
    expect(canSend("")).toBe(false);
  });
});

describe("missingRequiredScopes / validateGrantedScope", () => {
  it("必須は読み取りだけ。送信が無くても接続してよい", () => {
    // 送信まで必須にすると、同意画面で送信を外した人が取り込みすらできなくなる
    expect(missingRequiredScopes(READONLY)).toEqual([]);
    expect(validateGrantedScope(READONLY).ok).toBe(true);
  });

  it("読み取りが無ければ接続を止める", () => {
    expect(missingRequiredScopes(SEND)).toEqual([READONLY]);
    const result = validateGrantedScope(SEND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("読み取り");
  });

  it("両方あれば当然よい", () => {
    expect(validateGrantedScope(`${READONLY} ${SEND}`).ok).toBe(true);
  });

  it("空のスコープは拒否する", () => {
    expect(validateGrantedScope("").ok).toBe(false);
  });
});

describe("describeScopes", () => {
  it("読み取りだけのときの文言", () => {
    expect(describeScopes(READONLY)).toBe("読み取りのみ（gmail.readonly）");
  });

  it("読み取りと送信のときの文言", () => {
    expect(describeScopes(`${READONLY} ${SEND}`)).toBe("読み取り・送信（gmail.readonly / gmail.send）");
  });

  it("Googleが返す順序に文言が左右されない", () => {
    expect(describeScopes(`${SEND} ${READONLY}`)).toBe(describeScopes(`${READONLY} ${SEND}`));
  });

  it("知らないスコープが混ざっても落とさずに出す", () => {
    // 権限の表示で嘘をつかないことが目的なので、知らないものこそ隠さない
    const text = describeScopes(`${READONLY} ${EXTRA}`);
    expect(text).toContain("gmail.readonly");
    expect(text).toContain("userinfo.email");
    expect(text).not.toContain("のみ");
  });

  it("記録が空でも表示できる", () => {
    expect(describeScopes("")).toBe("（権限の記録がありません）");
  });
});

describe("shortScopeName", () => {
  it("Googleの接頭辞を落とす", () => {
    expect(shortScopeName(SEND)).toBe("gmail.send");
  });

  it("知らない形はそのまま返す", () => {
    expect(shortScopeName("openid")).toBe("openid");
  });
});
