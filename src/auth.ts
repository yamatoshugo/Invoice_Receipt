import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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

/**
 * デプロイ前にローカルで操作確認するための簡易ログイン。
 *
 * Google Cloud の OAuth 設定なしで画面を触れるようにするためのものなので、
 * 環境変数と NODE_ENV の二重で条件を付ける。
 * 本番ビルドでは AUTH_DEV_LOGIN を立てても有効にならない。
 */
export const devLoginEnabled =
  process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "1";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const devLoginProvider = Credentials({
  id: "dev-login",
  name: "開発用ログイン",
  credentials: { email: { label: "メールアドレス", type: "email" } },
  authorize(credentials) {
    if (!devLoginEnabled) return null;
    const email = String(credentials?.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return null;

    // 許可リストがあれば本番と同じ基準で絞る。
    // 空のときだけ、動作確認を始められるように任意のアドレスを通す。
    const list = allowedEmails();
    if (list.length > 0 && !list.includes(email)) return null;

    return { id: email, email, name: email };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: devLoginEnabled ? [Google, devLoginProvider] : [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ account, profile }) {
      // 簡易ログインは authorize 側で判定済み。
      // devLoginEnabled が false ならプロバイダ自体が存在しないため、ここには到達しない。
      if (account?.provider === "dev-login") return devLoginEnabled;

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
