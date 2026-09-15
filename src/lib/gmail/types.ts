import { z } from "zod";

/**
 * Gmail API のレスポンスのうち、この機能が使う部分だけを写した型。
 *
 * googleapis パッケージは入れていない（必要なのは4エンドポイントだけで、
 * 巨大な依存とNext.jsのバンドル問題に見合わないため）。代わりに素のJSONを
 * zod で検証してここへ落とす。
 *
 * 判断を行う純関数は、この自前の型にだけ依存させること。
 * そうすれば手書きのJSONリテラルだけでテストが書ける。
 */

export interface GmailHeader {
  name: string;
  value: string;
}

/** MIMEツリーの1ノード */
export interface GmailPart {
  mimeType?: string;
  /** 添付なら元のファイル名。本文パートでは空文字 */
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    /** これがあれば実体を attachments.get で取得できる */
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailPart[];
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  /** Gmailが記録した受信時刻（epochミリ秒）。Date: ヘッダより信頼できる */
  internalDate: number;
  labelIds: string[];
  payload: GmailPart | null;
}

export interface GmailListPage {
  messages: { id: string; threadId: string }[];
  nextPageToken: string | null;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
}

/** 送信が成功したときにGmailが返すもの */
export interface GmailSentMessage {
  /** Gmailが採番したメールID。送信控えの識別に使う */
  id: string;
  /** 実際に入ったスレッド。要求した threadId と違えば新規スレッドになった証拠 */
  threadId: string;
  labelIds: string[];
}

/**
 * Gmail の読み書き口。
 *
 * 実装は fetch 直叩き1つだけだが、インターフェースを切っておくことで
 * 呼び出し側が生のHTTPを意識せずに済む（storage/ extraction/ と同じ形）。
 */
export interface GmailClient {
  /** 接続中のアドレスの確認用。接続直後の検証と設定画面の疎通確認に使う */
  getProfile(): Promise<GmailProfile>;

  listMessages(opts: {
    q: string;
    pageToken?: string | null;
    maxResults?: number;
    /** 請求書が迷惑メールに落ちることは実際に起きるので、既定で含める */
    includeSpamTrash?: boolean;
  }): Promise<GmailListPage>;

  getMessage(id: string): Promise<GmailMessageDetail>;

  /** 添付の実体。base64url を Buffer に戻して返す */
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;

  /**
   * PDF送付の依頼メールを送る。raw は RFC 2822 の生メール。
   * threadId を渡すと、件名が一致する場合にかぎり元のスレッドに入る。
   */
  sendMessage(params: { raw: string; threadId?: string | null }): Promise<GmailSentMessage>;
}

/** 画面に出してよい情報だけ。トークンは決してこの型に載せない */
export type GmailConnectionState =
  | { status: "disconnected" }
  | {
      status: "connected";
      emailAddress: string;
      scope: string;
      connectedAt: Date;
      connectedByEmail: string;
      lastSyncedAt: Date | null;
    }
  | { status: "revoked"; emailAddress: string; message: string };

/**
 * 依頼メールを送れるか。送れないときは、そのまま画面に出せる理由を必ず持つ。
 * fromAddress は送れるときだけ（差出人＝接続中のアドレス）。
 */
export type GmailSendCapability =
  | { canSend: true; reason: null; message: null; fromAddress: string }
  | { canSend: false; reason: "disconnected" | "revoked" | "scope"; message: string };

/** まだ receiving アドレスを繋いでいない */
export class GmailNotConnectedError extends Error {
  constructor(message = "Gmailに接続されていません。設定画面から接続してください") {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

/** refresh_token が失効した。人が繋ぎ直すしかない */
export class GmailAuthRevokedError extends Error {
  constructor(message = "Gmailの認可が取り消されています。設定画面から再接続してください") {
    super(message);
    this.name = "GmailAuthRevokedError";
  }
}

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

// --- レスポンス検証 -------------------------------------------------------
// Gmail のレスポンスは素のJSONなので、境界で検証してから自前の型へ落とす。

const PartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z
      .object({
        attachmentId: z.string().optional(),
        size: z.number().optional(),
        data: z.string().optional(),
      })
      .optional(),
    parts: z.array(PartSchema).optional(),
  }),
);

export const MessageResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  /** APIは文字列で返す */
  internalDate: z.string(),
  labelIds: z.array(z.string()).optional(),
  payload: PartSchema.nullish(),
});

export const ListResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional(),
  nextPageToken: z.string().optional(),
});

export const AttachmentResponseSchema = z.object({
  size: z.number().optional(),
  data: z.string(),
});

export const SendResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

export const ProfileResponseSchema = z.object({
  emailAddress: z.string(),
  messagesTotal: z.number().optional(),
});
