import type { NextAuthConfig } from "next-auth";

/**
 * proxy（旧middleware）と本体 src/auth.ts で共有する土台。
 *
 * ★ここには DB を触るものを書かない（プロバイダの authorize / jwt コールバック）。
 * proxy は画面遷移・<Link>のホバープリフェッチ・API・Server Action の POST と、
 * ほぼ全リクエストで走る。ここに1本でもクエリを足すと、
 * リンクにマウスを乗せただけでDBを叩くようになる。
 * proxy の役目は「Cookieが復号できるか」の判定だけでよい。
 * 削除・パスワード再設定の反映（失効判定）は src/auth.ts 側で行う。
 *
 * ★Cookie名やセッションの設定がこの2つのインスタンスでずれると、
 * 片方が発行したCookieをもう片方が読めなくなる。
 * 同じオブジェクトを共有することでずれようがなくしている。
 */
export const authConfig = {
  // 実際のプロバイダは src/auth.ts で足す。proxy 側は検証だけなので空でよい
  providers: [],
  session: {
    strategy: "jwt",
    /** 7日。放置された端末が居座り続けないようにする */
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
  },
} satisfies NextAuthConfig;
