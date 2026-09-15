import { createHash, randomBytes } from "node:crypto";
import { missingRequiredScopes } from "./scope";
import { GmailAuthRevokedError } from "./types";

/**
 * Gmail読み取り用のOAuth。
 *
 * アプリのログイン（next-auth の Google プロバイダ）とは完全に別建てにしてある。
 * 理由は2つ:
 *   1. 「Internal」は OAuth クライアント単位ではなくGCPプロジェクト単位の設定なので、
 *      ログイン用と同じプロジェクトを使うと、ALLOWED_EMAILS に組織外のアドレスを
 *      入れた瞬間にログインが壊れる（または gmail.readonly が審査対象になる）
 *   2. Gmail用のsecretが漏れても、全員をログアウトさせずにローテーションできる
 */

/**
 * 要求するスコープ。読み取りと送信だけで、ラベル付与も既読化もしない。
 *
 * gmail.send は「取引先にPDF送付をお願いするメール」用。Googleの分類では Sensitive で、
 * 既に使っている gmail.readonly（Restricted）より一段低いため審査区分は上がらない。
 *
 * ★ここに足しても、既存の接続は readonly のまま動き続ける。
 * リフレッシュはスコープを引数に取らないので、利用者が設定画面の「接続し直す」を
 * 1回押すまで送信だけができない。その状態は scope.ts の canSend() で検知する。
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export interface GmailOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * redirect_uri は APP_BASE_URL から必ず導出する。
 *
 * 認可時とトークン交換時で値が一致することを構造的に保証するため
 * （不一致は redirect_uri_mismatch の最頻出原因）。
 * request.url から作らないのは、Vercelのプロキシ配下でホストやプロトコルが
 * 期待どおりにならないことと、Hostヘッダ経由で外部に影響される余地を作らないため。
 */
export function gmailOauthConfig(): GmailOauthConfig {
  const clientId = process.env.GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? "";
  const baseUrl = process.env.APP_BASE_URL ?? "";
  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error(
      "Gmail連携の設定が足りません（GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / APP_BASE_URL）",
    );
  }
  return { clientId, clientSecret, redirectUri: new URL("/api/gmail/callback", baseUrl).toString() };
}

export function gmailOauthConfigured(): boolean {
  try {
    gmailOauthConfig();
    return true;
  } catch {
    return false;
  }
}

/** CSRF対策の state と、PKCE の verifier を作る */
export function createAuthSession(): { state: string; codeVerifier: string } {
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(32).toString("base64url"),
  };
}

export function codeChallengeOf(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function buildAuthorizeUrl(params: {
  state: string;
  codeVerifier: string;
  /** 間違ったアカウントで認可する事故を減らす */
  loginHint?: string;
}): string {
  const { clientId, redirectUri } = gmailOauthConfig();
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  // これが無いと refresh_token が返らず、「1回繋いだら以後ログイン不要」が成立しない
  url.searchParams.set("access_type", "offline");
  // Googleは2回目以降の認可で refresh_token を省略する。
  // 再接続が無言で壊れるのを防ぐため、常に同意を求める
  url.searchParams.set("prompt", "consent");
  // include_granted_scopes は付けない。付けると過去に許可した他スコープが
  // 混ざり込み、専用クライアントにして最小権限にした意味が消える
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", codeChallengeOf(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

export interface TokenExchangeResult {
  refreshToken: string;
  accessToken: string;
  expiresInSec: number;
  scope: string;
}

export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<TokenExchangeResult> {
  const { clientId, clientSecret, redirectUri } = gmailOauthConfig();
  const body = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(`トークンの取得に失敗しました: ${String(json.error ?? res.status)}`);
  }
  if (typeof json.refresh_token !== "string" || !json.refresh_token) {
    // access_type=offline と prompt=consent を付けていれば起きないはずだが、
    // ここを黙って通すと「繋がったように見えて翌日には動かない」状態になる
    throw new Error(
      "リフレッシュトークンが返りませんでした。Google側の認可設定（access_type=offline）を確認してください",
    );
  }

  return {
    refreshToken: json.refresh_token,
    accessToken: String(json.access_token ?? ""),
    expiresInSec: Number(json.expires_in ?? 3600),
    scope: String(json.scope ?? ""),
  };
}

/**
 * 許可されたスコープで接続してよいかを確かめる。
 *
 * Googleは利用者が一部のチェックを外すと、要求より狭いスコープを返すことがある。
 * 読み取りが無いまま繋がると、走査の途中で意味の分からない403になる。繋いだ時点で止める。
 *
 * ★必須は読み取りだけ（REQUIRED_SCOPES）。要求した GMAIL_SCOPES と一致させないのは、
 * 同意画面で送信のチェックを外した人が取り込みすらできなくなるのを避けるため。
 * 送信できない接続は canSend() で検知し、画面で「接続し直す」を案内する。
 */
export function validateGrantedScope(granted: string): { ok: true } | { ok: false; message: string } {
  if (missingRequiredScopes(granted).length > 0) {
    return {
      ok: false,
      message:
        "Gmailの読み取り権限が許可されませんでした。同意画面で「メールの閲覧」を許可してください",
    };
  }
  return { ok: true };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const { clientId, clientSecret } = gmailOauthConfig();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    // invalid_grant = 認可の取り消し・パスワード変更・6か月未使用。人が繋ぎ直すしかない
    if (json.error === "invalid_grant") throw new GmailAuthRevokedError();
    throw new Error(`アクセストークンの更新に失敗しました: ${String(json.error ?? res.status)}`);
  }

  return {
    accessToken: String(json.access_token ?? ""),
    expiresInSec: Number(json.expires_in ?? 3600),
  };
}

/** 連携解除のときにGoogle側でも無効化する。失敗しても手元の行は消す */
export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}
