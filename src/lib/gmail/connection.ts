import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { openToken, sealToken } from "./crypto";
import { refreshAccessToken, revokeToken } from "./oauth";
import { canSend } from "./scope";
import { GmailNotConnectedError } from "./types";
import type { GmailConnectionState, GmailSendCapability } from "./types";

/**
 * 接続情報の読み書き。
 *
 * このモジュールの外へ refresh_token を出さないこと（暗号文も平文も）。
 * 画面へは connectionState() が返す表示用の型だけを渡す。
 */

const ID = "default";

/**
 * 表示・判定に使う接続の行を読む。1リクエストにつき1回だけDBを叩く。
 *
 * connectionState / sendCapability / connectedAddress は同じ1行を見ているのに、
 * 1画面で別々に引いていた（/upload/requests では3回）。
 * リクエスト単位でまとめるので、返す値も画面の挙動も変わらない。
 * 3つが同じリクエストの中で食い違わなくなるという効きもある。
 *
 * ★refreshTokenCipher は引かない。トークンが要るのは client.ts だけで、
 * そこは loadRefreshToken() を通る。表示のために復号材料を持ち回らない。
 *
 * 更新（markSynced / markRevoked / saveConnection / disconnect）のあとに
 * 同じリクエストでここを読み直す経路は無い。足すときは順序に注意すること。
 */
const readConnection = cache(async () =>
  prisma.gmailConnection.findUnique({
    where: { id: ID },
    select: {
      emailAddress: true,
      scope: true,
      connectedAt: true,
      connectedByEmail: true,
      lastSyncedAt: true,
      lastSyncError: true,
    },
  }),
);

/**
 * 接続を保存する。呼ぶのは callback だけ。
 *
 * 戻り値は「保存した後に新しいトークンが使えることを確かめられたか」。
 * null なら正常、文字列なら人に見せる失敗理由。
 */
export async function saveConnection(params: {
  emailAddress: string;
  scope: string;
  refreshToken: string;
  connectedByEmail: string;
}): Promise<string | null> {
  const previous = await prisma.gmailConnection.findUnique({ where: { id: ID } });

  const data = {
    emailAddress: params.emailAddress,
    scope: params.scope,
    refreshTokenCipher: sealToken(params.refreshToken),
    connectedByEmail: params.connectedByEmail,
    connectedAt: new Date(),
    // 繋ぎ直したら前回の失敗理由は消す
    lastSyncError: null,
  };
  // ★先に保存する。revoke の途中で落ちても、新しいトークンだけは必ず手元に残る
  await prisma.gmailConnection.upsert({
    where: { id: ID },
    create: { id: ID, ...data },
    update: data,
  });

  await revokePrevious(previous?.refreshTokenCipher, params.refreshToken);
  return verifyRefreshToken(params.refreshToken);
}

/**
 * 古いリフレッシュトークンをGoogle側で無効化する。
 *
 * ★必ず新しいトークンを取得し終えた後に呼ぶこと。
 * 放置すると再接続のたびに grant が積み上がり、1ユーザー100本の上限を超えた時点で
 * 古いものから無言で失効する（＝ある日突然、取り込みだけが動かなくなる）。
 */
async function revokePrevious(cipher: string | undefined, newToken: string): Promise<void> {
  if (!cipher) return;
  try {
    const old = openToken(cipher);
    // 同じトークンが返ってきた場合に revoke すると、今保存したものを自分で壊す
    if (old === newToken) return;
    await revokeToken(old);
  } catch {
    // 鍵が変わっていて復号できない場合もここに来る。新しい接続の保存は済んでいる
  }
}

/**
 * 保存した直後に、そのトークンで実際にアクセストークンを取れるか試す。
 *
 * 古い grant の revoke が新しい方まで巻き込む可能性がゼロとは言い切れないため、
 * 「繋がったように見えて次の取り込みで初めて壊れているのが分かる」経路を潰しておく。
 * 失敗したら行に理由を書き、設定画面が「連携が切れています」を出す状態にする。
 */
async function verifyRefreshToken(refreshToken: string): Promise<string | null> {
  try {
    await refreshAccessToken(refreshToken);
    return null;
  } catch (error) {
    const message =
      error instanceof Error
        ? `接続を保存しましたが、その権限で認証できませんでした: ${error.message}`
        : "接続を保存しましたが、その権限で認証できませんでした";
    await markRevoked(message);
    return message;
  }
}

/** 内部専用。トークンが要る箇所（client.ts）からだけ呼ぶ */
export async function loadRefreshToken(): Promise<{ refreshToken: string; emailAddress: string }> {
  const row = await prisma.gmailConnection.findUnique({ where: { id: ID } });
  if (!row) throw new GmailNotConnectedError();
  return { refreshToken: openToken(row.refreshTokenCipher), emailAddress: row.emailAddress };
}

export async function markSynced(at: Date = new Date()): Promise<void> {
  await prisma.gmailConnection
    .update({ where: { id: ID }, data: { lastSyncedAt: at, lastSyncError: null } })
    .catch(() => undefined);
}

/**
 * 認可が切れたことを記録する。行は消さない。
 * どのアドレスの連携が切れたのかを画面に出す必要があるため。
 */
export async function markRevoked(message: string): Promise<void> {
  await prisma.gmailConnection
    .update({ where: { id: ID }, data: { lastSyncError: message } })
    .catch(() => undefined);
}

export async function disconnect(): Promise<void> {
  const row = await prisma.gmailConnection.findUnique({ where: { id: ID } });
  if (!row) return;
  // Google側でも無効化する。失敗しても手元の行は消す（画面上の「接続中」を残さない）
  try {
    await revokeToken(openToken(row.refreshTokenCipher));
  } catch {
    // 鍵が変わっていて復号できない場合もここに来る。行の削除は続ける
  }
  await prisma.gmailConnection.delete({ where: { id: ID } }).catch(() => undefined);
}

/** 画面に渡す表示用の状態。トークンは含めない */
export async function connectionState(): Promise<GmailConnectionState> {
  const row = await readConnection();
  if (!row) return { status: "disconnected" };
  if (row.lastSyncError) {
    return { status: "revoked", emailAddress: row.emailAddress, message: row.lastSyncError };
  }
  return {
    status: "connected",
    emailAddress: row.emailAddress,
    scope: row.scope,
    connectedAt: row.connectedAt,
    connectedByEmail: row.connectedByEmail,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/**
 * 依頼メールを送れる状態か。
 *
 * ★Gmail APIを叩かずDBの scope だけで判定する。
 * gmail.send を足した後も既存の接続は readonly のまま有効なので、
 * 何もしなければ「送信ボタンを押して初めて403で分かる」ことになる。
 * 押す前に「設定画面の『接続し直す』を1回押してください」と出すためのもの。
 */
export async function sendCapability(): Promise<GmailSendCapability> {
  const row = await readConnection();
  if (!row) {
    return { canSend: false, reason: "disconnected", message: new GmailNotConnectedError().message };
  }
  if (row.lastSyncError) {
    return { canSend: false, reason: "revoked", message: row.lastSyncError };
  }
  if (!canSend(row.scope)) {
    return {
      canSend: false,
      reason: "scope",
      message:
        "メールを送る権限がまだありません。設定画面の「接続し直す」を1回押してください（取り込みはそのまま使えます）",
    };
  }
  return { canSend: true, reason: null, message: null, fromAddress: row.emailAddress };
}

/** 走査の記録に残す接続先アドレス */
export async function connectedAddress(): Promise<string> {
  const row = await readConnection();
  if (!row) throw new GmailNotConnectedError();
  return row.emailAddress;
}
