import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildAuthorizeUrl, createAuthSession } from "@/lib/gmail/oauth";

export const OAUTH_COOKIE = "gmail_oauth";

/**
 * Gmail連携の開始。
 *
 * アプリのログイン（next-auth）には一切触らず、独立したOAuthフローを走らせる。
 * このルートは proxy.ts の matcher で保護されているので、ログイン済みの人しか
 * 連携を開始できない。それでも actions.ts と同じ流儀で、ここでも auth() を呼ぶ。
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  const { state, codeVerifier } = createAuthSession();

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl({
      state,
      codeVerifier,
      // 間違ったアカウントで認可する事故を減らす
      loginHint: new URL(request.url).searchParams.get("hint") ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail連携の設定が不正です";
    return NextResponse.redirect(settingsUrl(request, "error", message));
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    sameSite: "lax", // Googleからのリダイレクトはトップレベルのナビゲーションなので lax で届く
    secure: process.env.NODE_ENV === "production",
    path: "/api/gmail", // 他のルートへこのCookieを漏らさない
    maxAge: 600,
  });
  return response;
}

export function settingsUrl(request: Request, key: string, message?: string): URL {
  const url = new URL("/settings", request.url);
  url.searchParams.set("gmail", key);
  if (message) url.searchParams.set("gmailMessage", message);
  url.hash = "gmail";
  return url;
}
