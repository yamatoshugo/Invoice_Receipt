import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { User } from "@/generated/prisma";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { bootstrapFirstUser } from "@/lib/auth/bootstrap";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";

/**
 * ログインできるのは User テーブルに行がある人だけ。
 *
 * 以前は Google OAuth + 許可リスト(ALLOWED_EMAILS)だった。安全ではあったが、
 * 「誰が使えるか」が環境変数にあるため、人が入れ替わるたびに再デプロイが要り、
 * 画面からは誰が使えるのか確認できなかった。
 * DBの行にして、設定画面から追加・削除できるようにしてある。
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.email,
    // 下の jwt コールバックで「発行後にパスワードが変わっていないか」を見るために持たせる
    passwordUpdatedAt: user.passwordUpdatedAt.getTime(),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "password",
      name: "メールアドレスとパスワード",
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      /**
       * ★ここがログインできるかどうかの唯一の関門。
       * signIn コールバックは置かない（判定が2か所に散ると、片方だけ直して穴が空く）。
       */
      async authorize(raw) {
        const email = String(raw?.email ?? "")
          .trim()
          .toLowerCase();
        // ★パスワードは trim しない。設定時と照合時で1バイトでも違えば通らなくなる
        const password = String(raw?.password ?? "");
        if (!EMAIL_PATTERN.test(email) || password === "") return null;

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          // まだ誰も登録されていないときだけ、環境変数の初期ユーザーを作る
          const created = await bootstrapFirstUser(email, password);
          if (created) return toAuthUser(created);

          // ★登録が無いアドレスでも、照合したのと同じだけ時間を使ってから落とす。
          // すぐ返すと応答の速さだけで「このアドレスは登録済み」が外から分かる
          await verifyAgainstDummy(password);
          return null;
        }

        if (!(await verifyPassword(password, user.passwordHash))) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        return toAuthUser(user);
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    /**
     * 削除・パスワード再設定を、発行済みのCookieへその場で反映させる。
     *
     * ★session.user.email を保つための処理ではない。
     * authorize() が返した email は既定で token.email → session.user.email に入る
     * （@auth/core/lib/actions/callback/index.js の defaultToken と
     * 　lib/actions/session.js の user: { email: token.email }）。
     *
     * これを置いている理由は失効だけ。JWTセッションはDBを見ないので、
     * 何もしないと「設定画面から削除したのに、その人は最大7日間ログインしたまま」になる。
     * その場で効かない削除ボタンは、機能ではなく不具合。
     *
     * null を返すとセッションが作られずCookieも削除される
     * （lib/actions/session.js の if (token !== null) ... else sessionStore.clean()）。
     *
     * 代償: auth() 1回につき主キー引きが1本増える。
     * proxy には効かせていないので（src/auth.config.ts 参照）、増えるのは
     * 実際にページやAPIを処理するときだけ。
     */
    async jwt({ token, user }) {
      // ログインした直後。authorize() の戻り値がそのまま渡ってくる
      if (user) {
        token.passwordUpdatedAt = user.passwordUpdatedAt;
        return token;
      }

      if (!token.sub) return null;

      const current = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { email: true, passwordUpdatedAt: true },
      });
      // 削除済み
      if (!current) return null;
      // このCookieが発行された後にパスワードが再設定されている
      if (current.passwordUpdatedAt.getTime() !== token.passwordUpdatedAt) return null;

      // アドレスを変えたときに追随させる
      token.email = current.email;
      token.name = current.email;
      return token;
    },
  },
});
