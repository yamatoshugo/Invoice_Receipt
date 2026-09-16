import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { isUniqueConflictOn } from "./prismaErrors";

const uniqueConflict = (target: unknown): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });

describe("isUniqueConflictOn", () => {
  it("その列の一意制約に当たっていれば true", () => {
    expect(isUniqueConflictOn(uniqueConflict(["sha256"]), "sha256")).toBe(true);
  });

  it("target が文字列で返ってきても拾う", () => {
    // Prismaのバージョンやドライバによって形が変わる
    expect(isUniqueConflictOn(uniqueConflict("Invoice_sha256_key"), "sha256")).toBe(true);
  });

  it("複合の一意制約に含まれていれば拾う", () => {
    expect(isUniqueConflictOn(uniqueConflict(["messageId", "kind", "ref"]), "kind")).toBe(true);
  });

  it("★別の列の一意制約は false。想定外の制約違反を飲み込まない", () => {
    // ここが緩いと、取り込みで別の不具合が起きても「同じ請求書が届きました」と
    // 表示されて静かに終わる。二重振込を防ぐ砦の手前で事実がすり替わる
    expect(isUniqueConflictOn(uniqueConflict(["blobPathname"]), "sha256")).toBe(false);
  });

  it("★target が分からないときは false に倒す", () => {
    expect(isUniqueConflictOn(uniqueConflict(undefined), "sha256")).toBe(false);
    expect(isUniqueConflictOn(uniqueConflict({ unexpected: true }), "sha256")).toBe(false);
  });

  it("一意制約以外のPrismaエラーは false", () => {
    const notFound = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "test",
    });
    expect(isUniqueConflictOn(notFound, "sha256")).toBe(false);
  });

  it("Prisma以外の例外は false（握り潰さずに投げ直させる）", () => {
    expect(isUniqueConflictOn(new Error("network down"), "sha256")).toBe(false);
    expect(isUniqueConflictOn("P2002", "sha256")).toBe(false);
    expect(isUniqueConflictOn(null, "sha256")).toBe(false);
  });
});
