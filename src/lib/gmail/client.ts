import { loadRefreshToken, markRevoked } from "./connection";
import { refreshAccessToken } from "./oauth";
import { parseFromHeader } from "./parts";
import {
  AttachmentResponseSchema,
  GmailApiError,
  GmailAuthRevokedError,
  ListResponseSchema,
  MessageResponseSchema,
  ProfileResponseSchema,
  SendResponseSchema,
} from "./types";
import type {
  GmailClient,
  GmailListPage,
  GmailMessageDetail,
  GmailProfile,
  GmailSentMessage,
} from "./types";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * アクセストークンのキャッシュ。
 *
 * 寿命は約1時間。DBに置くと守るべき秘密が2つに増えるのに得るものが無いので、
 * プロセス内のメモリだけに持つ。1回の走査で数十〜数百回API呼び出しが走るので、
 * ここが効く場所はまさにそこ。
 * prisma.ts と同じく globalThis に固定し、開発時のホットリロードで飛ばないようにする。
 */
const tokenCache = globalThis as unknown as {
  gmailAccessToken?: { token: string; expiresAt: number };
};

async function getAccessToken(forceRefresh = false): Promise<string> {
  const cached = tokenCache.gmailAccessToken;
  // 時計ずれを見込んで期限の60秒前には取り直す
  if (!forceRefresh && cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const { refreshToken } = await loadRefreshToken();
  try {
    const { accessToken, expiresInSec } = await refreshAccessToken(refreshToken);
    tokenCache.gmailAccessToken = {
      token: accessToken,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
    return accessToken;
  } catch (error) {
    if (error instanceof GmailAuthRevokedError) {
      await markRevoked(error.message);
    }
    throw error;
  }
}

/** 一時的な失敗か。恒久的なエラーを延々と再試行しないよう明示的に絞る */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const MAX_ATTEMPTS = 5;

interface CallOptions {
  search?: URLSearchParams;
  /** 渡すとPOSTになり、JSONとして送る */
  json?: unknown;
  /**
   * この呼び出しを最大何回試すか（既定5）。
   *
   * ★送信では必ず 1 を渡す。詳細は sendMessage のコメント。
   */
  maxRetryAttempts?: number;
}

async function call(path: string, options: CallOptions = {}): Promise<unknown> {
  const maxAttempts = options.maxRetryAttempts ?? MAX_ATTEMPTS;
  const url = `${API_BASE}${path}${options.search ? `?${options.search}` : ""}`;
  const isPost = options.json !== undefined;

  let lastError: Error | null = null;
  let forceFreshToken = false;
  let authRetried = false;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const token = await getAccessToken(forceFreshToken);
    forceFreshToken = false;

    const res = await fetch(url, {
      method: isPost ? "POST" : "GET",
      headers: isPost
        ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
        : { authorization: `Bearer ${token}` },
      body: isPost ? JSON.stringify(options.json) : undefined,
    });

    if (res.ok) return res.json();

    const body = await res.text().catch(() => "");
    lastError = new GmailApiError(gmailErrorMessage(res.status, body), res.status);

    // 401 は「Gmailに届く前の拒否」なので、送信でも安全に1度だけやり直せる。
    // 走査が1時間に及んでトークンが切れた場合の備えでもある。
    // 試行回数には数えない（再試行しない呼び出しでも、この1回は許す）
    if (res.status === 401 && !authRetried) {
      authRetried = true;
      forceFreshToken = true;
      attempt -= 1;
      continue;
    }
    if (!isRetryable(res.status) || attempt >= maxAttempts) throw lastError;

    // Retry-After があれば従い、無ければ指数バックオフ＋ジッタ
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 250 + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw lastError ?? new GmailApiError("Gmail APIの呼び出しに失敗しました", 500);
}

function gmailErrorMessage(status: number, body: string): string {
  if (status === 401) return "Gmailの認証に失敗しました。設定画面から再接続してください";
  if (status === 403) {
    // 送信スコープが無いまま送ろうとした場合。「権限がありません」だけだと
    // 何をすれば直るのか分からないので、直し方まで書く
    if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
      return "メールを送る権限がありません。設定画面の「接続し直す」を1回押してください";
    }
    return "Gmail APIへのアクセスが拒否されました（権限または利用上限を確認してください）";
  }
  if (status === 429) return "Gmail APIの利用上限に達しました。時間をおいて再実行してください";
  const detail = body.slice(0, 200);
  return `Gmail APIエラー (${status})${detail ? `: ${detail}` : ""}`;
}

class FetchGmailClient implements GmailClient {
  async getProfile(): Promise<GmailProfile> {
    const parsed = ProfileResponseSchema.parse(await call("/profile", {}));
    return { emailAddress: parsed.emailAddress, messagesTotal: parsed.messagesTotal ?? 0 };
  }

  async listMessages(opts: {
    q: string;
    pageToken?: string | null;
    maxResults?: number;
    includeSpamTrash?: boolean;
  }): Promise<GmailListPage> {
    const search = new URLSearchParams({
      q: opts.q,
      maxResults: String(opts.maxResults ?? 500),
      // 請求書が迷惑メールに落ちることは実際に起きるので既定で含める
      includeSpamTrash: String(opts.includeSpamTrash ?? true),
    });
    if (opts.pageToken) search.set("pageToken", opts.pageToken);

    const parsed = ListResponseSchema.parse(await call("/messages", { search }));
    return { messages: parsed.messages ?? [], nextPageToken: parsed.nextPageToken ?? null };
  }

  async getMessage(id: string): Promise<GmailMessageDetail> {
    const search = new URLSearchParams({ format: "full" });
    const parsed = MessageResponseSchema.parse(
      await call(`/messages/${encodeURIComponent(id)}`, { search }),
    );
    return {
      id: parsed.id,
      threadId: parsed.threadId,
      internalDate: Number(parsed.internalDate),
      labelIds: parsed.labelIds ?? [],
      payload: parsed.payload ?? null,
    };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const parsed = AttachmentResponseSchema.parse(
      await call(
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      ),
    );
    return Buffer.from(parsed.data, "base64url");
  }

  /**
   * メールを1通送る。
   *
   * ★絶対に自動再試行しない（maxRetryAttempts: 1）。
   * 502やタイムアウトは「Gmailが受理した後」にも起こるので、再試行すると
   * 同じ依頼が取引先に複数回届く。失敗として人に見せ、Gmailの送信済みを
   * 確認してもらうほうが、黙って2通送るよりはるかにましである。
   */
  async sendMessage(params: { raw: string; threadId?: string | null }): Promise<GmailSentMessage> {
    const parsed = SendResponseSchema.parse(
      await call("/messages/send", {
        json: {
          // RFC 2822 の生メールを base64url で渡す（Gmail APIの仕様）
          raw: Buffer.from(params.raw, "utf8").toString("base64url"),
          ...(params.threadId ? { threadId: params.threadId } : {}),
        },
        maxRetryAttempts: 1,
      }),
    );
    return { id: parsed.id, threadId: parsed.threadId, labelIds: parsed.labelIds ?? [] };
  }
}

let cached: GmailClient | null = null;

/**
 * Gmailの読み取り口を返す。
 *
 * 接続情報はDBのシングルトン行にあり、アプリのセッションとは無関係。
 * そのため誰がログインしていても（開発用の簡易ログインでも）同じ受信箱を読める。
 * 未接続なら GmailNotConnectedError が投げられる。
 */
export function getGmailClient(): GmailClient {
  cached ??= new FetchGmailClient();
  return cached;
}

/** 走査時に From ヘッダを取り出す（client の外でも使えるよう再エクスポート） */
export { parseFromHeader };
