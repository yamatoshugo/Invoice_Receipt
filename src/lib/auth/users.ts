import { prisma } from "@/lib/prisma";
import { isSerializationFailure, isUniqueConflictOn } from "@/lib/prismaErrors";
import { hashPassword, passwordProblem } from "@/lib/auth/password";

/**
 * ログインできる人の管理。
 *
 * ★権限の区別は設けない。ログインできる人は全員、人を追加・削除できる。
 * 5人規模の社内ツールで管理者権限を作ると、その人が休んだ日に誰も操作できなくなる。
 * 代わりに「絶対に起きてはいけないこと」＝全員締め出しだけを機械的に防ぐ。
 */

export type UserRow = {
  id: string;
  email: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  createdByEmail: string | null;
};

export type UserActionResult = { ok: boolean; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 200;

/** 保存・照合の前に必ず通す。大小の揺れで同じ人が2行になるのを防ぐ */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 追加・再設定の入力を確かめる。問題があれば画面に出す日本語、無ければ null。
 *
 * DBを触らないので、そのままテストできる。
 */
export function newUserProblem(email: string, password: string, confirm: string): string | null {
  if (email === "") return "メールアドレスを入力してください。";
  if (email.length > EMAIL_MAX_LENGTH) return "メールアドレスが長すぎます。";
  if (!EMAIL_PATTERN.test(email)) return "メールアドレスの形式が正しくありません。";
  if (password !== confirm) return "確認用のパスワードが一致しません。";
  // ★パスワードとメールアドレスが同じだと、アドレスを知っている人は誰でも入れてしまう
  if (normalizeEmail(password) === email) {
    return "パスワードにメールアドレスと同じ値は使えません。";
  }
  return passwordProblem(password);
}

/** パスワード再設定の入力（メールアドレスは変えない） */
export function newPasswordProblem(
  password: string,
  confirm: string,
  email: string,
): string | null {
  if (password !== confirm) return "確認用のパスワードが一致しません。";
  if (normalizeEmail(password) === email) {
    return "パスワードにメールアドレスと同じ値は使えません。";
  }
  return passwordProblem(password);
}

/**
 * 一覧を取る。
 *
 * ★画面から prisma.user.findMany() を直接呼ばないこと。
 * 既定では passwordHash まで返り、それを Server Component の props に載せると
 * RSCのペイロードとしてブラウザへ送られる（画面に表示しなくても中身は読める）。
 * select を1か所に閉じるためにこの関数を通す。
 * lib/gmail/connection.ts の connectionState() が refreshTokenCipher を
 * 外に出さないのと同じ理由。
 */
export async function listUsers(): Promise<UserRow[]> {
  return prisma.user.findMany({
    select: { id: true, email: true, createdAt: true, lastLoginAt: true, createdByEmail: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function addUser(input: {
  email: string;
  password: string;
  confirm: string;
  actorEmail: string;
}): Promise<UserActionResult> {
  const email = normalizeEmail(input.email);
  const problem = newUserProblem(email, input.password, input.confirm);
  if (problem) return { ok: false, message: problem };

  try {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(input.password),
        createdByEmail: input.actorEmail,
      },
    });
  } catch (e) {
    // ログイン済みの人にしか見えない画面なので、ここは「登録済み」と明かしてよい
    // （ログイン画面で明かすとアドレスの総当たりの的を絞らせてしまうが、ここは別）
    if (isUniqueConflictOn(e, "email")) {
      return { ok: false, message: "そのメールアドレスはすでに登録されています。" };
    }
    throw e;
  }
  return { ok: true, message: `${email} を追加しました。` };
}

export async function resetPassword(input: {
  userId: string;
  password: string;
  confirm: string;
  actorEmail: string;
}): Promise<UserActionResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  if (!user) return { ok: false, message: "その利用者は見つかりませんでした。" };

  const problem = newPasswordProblem(input.password, input.confirm, user.email);
  if (problem) return { ok: false, message: problem };

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      passwordHash: await hashPassword(input.password),
      // ★この更新が、その人の発行済みCookieをすべて無効にする（src/auth.ts の jwt）
      passwordUpdatedAt: new Date(),
      updatedByEmail: input.actorEmail,
    },
  });
  return {
    ok: true,
    message: `${user.email} のパスワードを再設定しました。この人は全ての端末でログアウトされます。`,
  };
}

/** 最後の1人を消そうとしたときに内部で使う目印 */
class LastUserError extends Error {}

export async function deleteUser(input: {
  userId: string;
  actorEmail: string;
}): Promise<UserActionResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  if (!user) return { ok: false, message: "その利用者は見つかりませんでした。" };

  // ガード1: 自分を消すと、その場で全画面から締め出される
  if (user.email === normalizeEmail(input.actorEmail)) {
    return {
      ok: false,
      message: "自分自身は削除できません。別の利用者にログインして削除してもらってください。",
    };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // ガード2: 0人になるとこのシステムには二度と入れない。
        // 利用者を追加する画面はログインの先にあるので、
        // 環境変数を入れ直して再デプロイするまで全員締め出しになる
        if ((await tx.user.count()) <= 1) throw new LastUserError();
        await tx.user.delete({ where: { id: input.userId } });
      },
      // ★件数を数えてから消すまでの間に、別の人が別の利用者を消す可能性がある。
      // 既定の Read Committed だと両方が「まだ2人いる」と読んで両方成功し、0人になる。
      // このシステムで唯一、取り返しがつかない競合なので Serializable にする
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e instanceof LastUserError) {
      return { ok: false, message: "最後の1人は削除できません（誰もログインできなくなります）。" };
    }
    // ★黙ってやり直さない。取り返しがつかない操作なので、
    // 人がもう一度状況を見てから押し直すほうが安全
    if (isSerializationFailure(e)) {
      return { ok: false, message: "他の操作と競合しました。画面を更新してやり直してください。" };
    }
    throw e;
  }

  return {
    ok: true,
    message: `${user.email} を削除しました。この人が行った操作の記録は残ります。`,
  };
}
