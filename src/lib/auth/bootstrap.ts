import type { User } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isUniqueConflictOn } from "@/lib/prismaErrors";
import { hashPassword, safeEqual, verifyPassword } from "@/lib/auth/password";

/**
 * 最初の1人を作る。
 *
 * デプロイ直後は User が0件で、誰もログインできない。
 * ユーザーを追加する画面はログインの先にあるので、放っておくと永久に入れない。
 * その鶏と卵を切るためだけの経路。
 *
 * ★恒久的な裏口にしないため、必ず「0件であること」を先に確かめる。
 * 1人でも登録済みなら、環境変数が残っていても何もしない。
 */

/** 環境変数が両方そろっているか。ログイン画面の案内文の出し分けに使う */
export function bootstrapConfigured(): boolean {
  return (
    (process.env.INITIAL_ADMIN_EMAIL ?? "").trim() !== "" &&
    (process.env.INITIAL_ADMIN_PASSWORD ?? "") !== ""
  );
}

/**
 * 入力が初期ユーザーの設定と一致すれば作成して返す。それ以外は null。
 *
 * 呼び出し側（src/auth.ts の authorize）は、null が返ったら
 * 通常の「認証失敗」として扱えばよい。
 */
export async function bootstrapFirstUser(email: string, password: string): Promise<User | null> {
  // ★ここが最初。0件でなければ環境変数は一切見ない
  if ((await prisma.user.count()) > 0) return null;

  const expectedEmail = (process.env.INITIAL_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const expectedPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  if (!expectedEmail || !expectedPassword) return null;

  // ★=== で比べない。当たればシステム全体の権限が取れる値なので、
  // 「何文字目まで一致したか」が応答時間に出ないようにする
  if (!safeEqual(email, expectedEmail) || !safeEqual(password, expectedPassword)) return null;

  try {
    return await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        // 最初の1人は人が画面から追加したものではないので null（起動時の設定による作成）
        createdByEmail: null,
      },
    });
  } catch (e) {
    // count() と create() の間に、もう1本のログインが同じ行を作った場合。
    // ★件数の確認だけでは競合を防げない。email の一意制約が最後の砦であり、
    // ここに来たということは「正しく1件だけ作られた」ということ。
    // 競合に負けた側も、同じ資格情報なのだから普通に照合し直せば通してよい
    if (isUniqueConflictOn(e, "email")) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && (await verifyPassword(password, existing.passwordHash))) return existing;
      return null;
    }
    throw e;
  }
}
