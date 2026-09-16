import { describe, expect, it } from "vitest";
import { newPasswordProblem, newUserProblem, normalizeEmail } from "./users";

/**
 * ここで確かめるのはDBを触らない部分だけ。
 *
 * ★以下は意図的に対象外で、README と docs/DEPLOY.md の手順で人が確認する:
 *   - 自分自身は削除できない（ガード1）
 *   - 最後の1人は削除できない（ガード2・Serializable トランザクション）
 *   - パスワード再設定で発行済みCookieが失効すること
 * これらはDBとリクエストが無いと動かせない。Prismaをモックして通すテストは
 * 「モックが期待通りに動いた」ことしか証明しないので書かない。
 */

const PASSWORD = "correct horse battery staple";

describe("normalizeEmail", () => {
  it("前後の空白を落として小文字にする", () => {
    expect(normalizeEmail("  Henry@Example.COM  ")).toBe("henry@example.com");
  });

  it("すでに正規化済みの値は変えない", () => {
    expect(normalizeEmail("henry@example.com")).toBe("henry@example.com");
  });
});

describe("newUserProblem", () => {
  it("正しい入力なら問題なし", () => {
    expect(newUserProblem("henry@example.com", PASSWORD, PASSWORD)).toBeNull();
  });

  it("メールアドレスが空なら弾く", () => {
    expect(newUserProblem("", PASSWORD, PASSWORD)).toContain("メールアドレスを入力");
  });

  it("メールアドレスの形式が違えば弾く", () => {
    expect(newUserProblem("henry", PASSWORD, PASSWORD)).toContain("形式");
    expect(newUserProblem("henry@example", PASSWORD, PASSWORD)).toContain("形式");
    expect(newUserProblem("henry example@a.com", PASSWORD, PASSWORD)).toContain("形式");
  });

  it("長すぎるメールアドレスは弾く", () => {
    expect(newUserProblem(`${"a".repeat(200)}@example.com`, PASSWORD, PASSWORD)).toContain(
      "長すぎます",
    );
  });

  it("確認用と一致しなければ弾く", () => {
    expect(newUserProblem("henry@example.com", PASSWORD, `${PASSWORD}x`)).toContain("一致しません");
  });

  it("★パスワードがメールアドレスと同じなら弾く", () => {
    // アドレスを知っている人が誰でも入れてしまう
    expect(newUserProblem("henry@example.com", "henry@example.com", "henry@example.com")).toContain(
      "メールアドレスと同じ",
    );
    // 大小の違いで抜けないこと
    expect(newUserProblem("henry@example.com", "Henry@Example.com", "Henry@Example.com")).toContain(
      "メールアドレスと同じ",
    );
  });

  it("短いパスワードは弾く（password.ts の規則をそのまま使う）", () => {
    expect(newUserProblem("henry@example.com", "short", "short")).toContain("12文字以上");
  });

  it("★一致の確認は長さの確認より先。不一致を『短い』と誤って伝えない", () => {
    expect(newUserProblem("henry@example.com", "short", "different")).toContain("一致しません");
  });
});

describe("newPasswordProblem", () => {
  it("正しい入力なら問題なし", () => {
    expect(newPasswordProblem(PASSWORD, PASSWORD, "henry@example.com")).toBeNull();
  });

  it("確認用と一致しなければ弾く", () => {
    expect(newPasswordProblem(PASSWORD, "", "henry@example.com")).toContain("一致しません");
  });

  it("メールアドレスと同じ値は弾く", () => {
    expect(
      newPasswordProblem("henry@example.com", "henry@example.com", "henry@example.com"),
    ).toContain("メールアドレスと同じ");
  });

  it("短いパスワードは弾く", () => {
    expect(newPasswordProblem("short", "short", "henry@example.com")).toContain("12文字以上");
  });
});
