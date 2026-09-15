import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveConnection } from "@/lib/gmail/connection";
import { exchangeCode, revokeToken, validateGrantedScope } from "@/lib/gmail/oauth";
import { OAUTH_COOKIE, settingsUrl } from "../connect/route";

/**
 * Googleからの認可コードを受け取り、リフレッシュトークンを保存する。
 *
 * 保存する前に2つ確かめる:
 *   A. 許可されたスコープが要求どおりか（狭いまま繋ぐと走査中に謎の403になる）
 *   B. 実際に繋がったアドレスは何か（別アカウントで認可する事故の検知）
 * どちらかが駄目なら、その場でトークンを無効化して保存しない。
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.redirect(new URL("/signin", request.url));

  const params = new URL(request.url).searchParams;

  const denied = params.get("error");
  if (denied) {
    return clearCookie(
      NextResponse.redirect(
        settingsUrl(request, "error", denied === "access_denied" ? "連携をキャンセルしました" : denied),
      ),
    );
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return clearCookie(NextResponse.redirect(settingsUrl(request, "error", "認可の応答が不正です")));
  }

  const stored = readCookie(request);
  if (!stored) {
    return clearCookie(
      NextResponse.redirect(settingsUrl(request, "error", "連携の手続きが期限切れです。やり直してください")),
    );
  }
  if (!safeEqual(stored.state, state)) {
    return clearCookie(NextResponse.redirect(settingsUrl(request, "error", "認可の検証に失敗しました")));
  }

  try {
    const token = await exchangeCode({ code, codeVerifier: stored.codeVerifier });

    // --- A. スコープの検証 ---
    const scopeCheck = validateGrantedScope(token.scope);
    if (!scopeCheck.ok) {
      await revokeToken(token.refreshToken);
      return clearCookie(NextResponse.redirect(settingsUrl(request, "error", scopeCheck.message)));
    }

    // --- B. 実際に繋がったアドレスの確認 ---
    const profile = await fetchProfile(token.accessToken);
    if (!profile) {
      await revokeToken(token.refreshToken);
      return clearCookie(
        NextResponse.redirect(settingsUrl(request, "error", "接続先アドレスを確認できませんでした")),
      );
    }

    const saveError = await saveConnection({
      emailAddress: profile,
      scope: token.scope,
      refreshToken: token.refreshToken,
      connectedByEmail: email,
    });
    // 保存はされているが使えない状態。黙って「接続しました」と出さない
    if (saveError) {
      return clearCookie(NextResponse.redirect(settingsUrl(request, "error", saveError)));
    }

    return clearCookie(NextResponse.redirect(settingsUrl(request, "connected", profile)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "連携に失敗しました";
    return clearCookie(NextResponse.redirect(settingsUrl(request, "error", message)));
  }
}

async function fetchProfile(accessToken: string): Promise<string | null> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { emailAddress?: unknown };
  return typeof json.emailAddress === "string" ? json.emailAddress : null;
}

function readCookie(request: Request): { state: string; codeVerifier: string } | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_COOKIE}=`))
    ?.slice(OAUTH_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { state?: unknown; codeVerifier?: unknown };
    if (typeof parsed.state !== "string" || typeof parsed.codeVerifier !== "string") return null;
    return { state: parsed.state, codeVerifier: parsed.codeVerifier };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** state と verifier はワンタイム。使い終わったら必ず消す */
function clearCookie(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/gmail", maxAge: 0 });
  return response;
}
