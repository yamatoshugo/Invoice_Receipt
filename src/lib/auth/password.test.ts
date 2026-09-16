import { randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  passwordProblem,
  safeEqual,
  verifyAgainstDummy,
  verifyPassword,
} from "./password";

const PASSWORD = "correct horse battery staple";

describe("hashPassword / verifyPassword", () => {
  it("同じパスワードなら照合できる", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("違うパスワードは通らない", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword(`${PASSWORD} `, stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("★平文はハッシュ文字列に含まれない", async () => {
    expect(await hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });

  it("★同じパスワードでも毎回違うハッシュになる（ソルト）", async () => {
    // 同じ値になると「この2人は同じパスワード」がDBを見ただけで分かってしまう
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("保存形式は scrypt$N$r$p$salt$hash", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.split("$")).toHaveLength(6);
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
  });

  it("★古いパラメータで作られた行も、その行に書かれた値で照合できる", async () => {
    // 強度を上げたときに、既存の利用者がログインできなくならないことの確認。
    // N=1024 で作った「昔のハッシュ」を手で組み立てて、現在のコードで照合する
    const scryptAsync = promisify(scrypt) as (
      password: string,
      salt: Buffer,
      keylen: number,
      options: ScryptOptions,
    ) => Promise<Buffer>;

    const salt = randomBytes(16);
    const key = await scryptAsync(PASSWORD, salt, 32, { N: 1024, r: 8, p: 1 });
    const old = `scrypt$1024$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

    expect(await verifyPassword(PASSWORD, old)).toBe(true);
    expect(await verifyPassword("違うパスワード", old)).toBe(false);
  });
});

describe("verifyPassword は壊れた値でも例外を投げない", () => {
  // ★ここが例外になると、DBの1行が壊れただけでログイン画面が500になり、
  // 「パスワードが違う」と区別できなくなる。必ず false へ倒すこと
  const broken: Array<[string, string]> = [
    ["空文字", ""],
    ["区切りが無い", "garbage"],
    ["別のアルゴリズム", "bcrypt$16384$8$1$c2FsdA==$aGFzaA=="],
    ["要素が5つしかない", "scrypt$16384$8$1$c2FsdA=="],
    ["要素が7つある", "scrypt$16384$8$1$c2FsdA==$aGFzaA==$extra"],
    ["Nが数字でない", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
    ["Nが0", "scrypt$0$8$1$c2FsdA==$aGFzaA=="],
    ["Nが指数表記", "scrypt$1e9$8$1$c2FsdA==$aGFzaA=="],
    ["ソルトが空", "scrypt$16384$8$1$$aGFzaA=="],
    ["ハッシュの長さが違う", "scrypt$16384$8$1$c2FsdHNhbHQ=$aGFzaA=="],
  ];

  for (const [name, stored] of broken) {
    it(`${name} → false`, async () => {
      await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
    });
  }

  it("★Nが極端に大きい行は、計算せずに false（メモリを食い潰させない）", async () => {
    // 128 * N * r バイトを確保しようとして関数ごと落ちるのを防ぐ上限
    const hash = Buffer.alloc(32).toString("base64");
    const salt = Buffer.alloc(16).toString("base64");
    await expect(
      verifyPassword(PASSWORD, `scrypt$99999999$8$1$${salt}$${hash}`),
    ).resolves.toBe(false);
  });
});

describe("verifyAgainstDummy", () => {
  it("常に false を返す", async () => {
    expect(await verifyAgainstDummy(PASSWORD)).toBe(false);
    expect(await verifyAgainstDummy("")).toBe(false);
  });
});

describe("safeEqual", () => {
  it("一致すれば true", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("違えば false", () => {
    expect(safeEqual("secret", "Secret")).toBe(false);
  });

  it("★長さが違っても例外にならず false（timingSafeEqual をそのまま使うと throw する）", () => {
    expect(safeEqual("short", "much longer value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("12文字以上なら問題なし", () => {
    expect(passwordProblem("123456789012")).toBeNull();
  });

  it("11文字以下は弾く", () => {
    expect(passwordProblem("12345678901")).toContain("12文字以上");
  });

  it("200文字を超えるものは弾く", () => {
    expect(passwordProblem("a".repeat(201))).toContain("200文字以内");
    expect(passwordProblem("a".repeat(200))).toBeNull();
  });

  it("空白だけは弾く", () => {
    expect(passwordProblem("              ")).toContain("入力してください");
    expect(passwordProblem("")).toContain("入力してください");
  });
});
