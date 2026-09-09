import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * 請求書と口座情報を扱うため、許可リストに載っているGoogleアカウント以外は
 * ログインさせない。Google Workspace のドメインだけで絞ると退職者や
 * 無関係な社員も入れてしまうので、メールアドレスの完全一致で判定する。
 */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ profile }) {
      const list = allowedEmails();
      // 許可リストが未設定のまま公開すると誰でも入れてしまうため、その場合は全員拒否する
      if (list.length === 0) return false;
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      if (profile?.email_verified === false) return false;
      return list.includes(email);
    },
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
  },
});
