import type { GmailItemStatus } from "@/generated/prisma";

/**
 * 「決着したか」の判定と集計。
 *
 * 決着をDBのフラグにしない。保存すると請求書を消したときやマスタを更新したときに
 * 実態とずれ、更新経路すべてで再計算が要る（必ずどこかで漏れる）。
 * 既存の取引先マスタ照合と同じく、画面を出すたびに導出する。
 */

export interface ItemLike {
  status: GmailItemStatus;
  invoiceId: string | null;
  acknowledgedAt: Date | null;
  autoSkipped: boolean;
  /**
   * 送付依頼メールに返信（添付付き）が届いた時刻。届いていなければ null。
   *
   * ★DBの列ではなく、呼び出し側が reply.ts で計算して渡す。
   * 決着をDBに保存しない方針はそのまま（保存すると必ずどこかでずれる）。
   * 必須フィールドにしてあるので、渡し忘れた画面は型エラーで止まる。
   */
  repliedAt: Date | null;
}

export type Settlement = "settled" | "unsettled";

/** 決着していない理由。画面のバナーで内訳を出すために使う */
export type UnsettledReason =
  | "pending"
  | "importing"
  | "failed"
  | "needs-check"
  | "invoice-deleted"
  /** ログインが要るURLだった。取引先にPDF送付を依頼する段 */
  | "request-needed"
  /** 依頼メールを送信中のまま止まっている。送れたか分からないので必ず人の目に触れさせる */
  | "request-sending"
  /** 依頼メールは送った。請求書が返ってくるのを待っている */
  | "request-waiting"
  /** 依頼メールの送信に失敗した。自動では再送しない */
  | "request-failed";

/**
 * 状態ごとの分類表。
 *
 * switch のフォールスルー（default で needs-check に落とす形）で書くと、
 * 状態を足したときに黙って未決着へ落ちるだけで誰も気付かない。
 * 表にしておけば、メンバーを足した瞬間に Record の型エラーで必ず止まる。
 *
 * settled=true でも、下の settlementOf が請求書の有無などで覆すことがある。
 * ここは「その状態そのものが決着を意味するか」だけを表す。
 */
export const STATUS_CLASSIFICATION: Record<
  GmailItemStatus,
  { settled: boolean; reason: UnsettledReason | null }
> = {
  PENDING: { settled: false, reason: "pending" },
  IMPORTING: { settled: false, reason: "importing" },
  IMPORTED: { settled: true, reason: null },
  DUPLICATE: { settled: true, reason: null },
  // PDF以外・破損・パスワード付きを自動で「済」にしないのが要点。
  // パスワード付きPDFの請求書が黙って消えるのが、この機能で最も起きやすい抜け洩れ
  NOT_PDF: { settled: false, reason: "needs-check" },
  UNREADABLE: { settled: false, reason: "needs-check" },
  TOO_LARGE: { settled: false, reason: "needs-check" },
  FAILED: { settled: false, reason: "failed" },
  // 請求書はまだ手元に無い。決着にすると
  // 「ログインが必要だったので終わり」で請求書が静かに消える
  LOGIN_REQUIRED: { settled: false, reason: "request-needed" },
  // 送信APIの応答を受け取る前に落ちるとここで止まる。送れたか分からない
  REQUEST_SENDING: { settled: false, reason: "request-sending" },
  // ★依頼を送っただけでは決着しない。返信が来て初めて決着する（下の settlementOf）。
  // 単体で決着にすると、依頼を無視された請求書が「済」の札を付けて画面から消える。
  // それは月末の支払漏れを防ぐというこのシステムの目的そのものを裏切る
  REQUEST_SENT: { settled: false, reason: "request-waiting" },
  REQUEST_FAILED: { settled: false, reason: "request-failed" },
};

/**
 * 決着する経路は4つだけ。
 *   ① 請求書になった（IMPORTED / DUPLICATE で、その請求書が生きている）
 *   ② 人が「取り込まない」と確認した
 *   ③ 署名画像・請求書リンクなしとして自動で脇に寄せた
 *   ④ 送付依頼への返信（添付付き）が届いた
 */
export function settlementOf(item: ItemLike): Settlement {
  // 取り込んだ請求書が後から削除された ＝ 決着が解けた。
  // 見逃すと「取り込んだつもりで手元に無い」請求書ができる
  if (isImported(item.status) && item.invoiceId === null) return "unsettled";
  // 依頼への返信が届いていれば決着。逆に言えば、返信が無い限り決着しない
  if (item.status === "REQUEST_SENT" && item.repliedAt !== null) return "settled";
  if (STATUS_CLASSIFICATION[item.status].settled) return "settled";
  if (item.autoSkipped) return "settled";
  if (item.acknowledgedAt !== null) return "settled";
  return "unsettled";
}

function isImported(status: GmailItemStatus): boolean {
  return status === "IMPORTED" || status === "DUPLICATE";
}

export function unsettledReasonOf(item: ItemLike): UnsettledReason | null {
  if (settlementOf(item) === "settled") return null;
  if (isImported(item.status)) return "invoice-deleted";
  // 決着していない以上、表の reason は必ず埋まっている
  return STATUS_CLASSIFICATION[item.status].reason ?? "needs-check";
}

export interface ItemSummary {
  total: number;
  settled: number;
  unsettled: number;
  /** 未決着の内訳。合計は unsettled と必ず一致する */
  pending: number;
  importing: number;
  failed: number;
  needsCheck: number;
  invoiceDeleted: number;
  /** ログインが要るURL。取引先へのPDF送付依頼待ち（＝まだ送っていない） */
  requestNeeded: number;
  /** 依頼メールを送信中のまま止まっている */
  requestSending: number;
  /** 依頼メールを送って、返信を待っている */
  requestWaiting: number;
  /** 依頼メールの送信に失敗した */
  requestFailed: number;
  /** 参考表示用。決着済みのうちの内訳 */
  imported: number;
  duplicate: number;
  autoSkipped: number;
  acknowledged: number;
  /** 依頼への返信が届いて決着したもの */
  replied: number;
}

export function summarizeItems(items: ItemLike[]): ItemSummary {
  const s: ItemSummary = {
    total: items.length,
    settled: 0,
    unsettled: 0,
    pending: 0,
    importing: 0,
    failed: 0,
    needsCheck: 0,
    invoiceDeleted: 0,
    requestNeeded: 0,
    requestSending: 0,
    requestWaiting: 0,
    requestFailed: 0,
    imported: 0,
    duplicate: 0,
    autoSkipped: 0,
    acknowledged: 0,
    replied: 0,
  };

  for (const item of items) {
    const reason = unsettledReasonOf(item);
    if (reason === null) {
      s.settled += 1;
      if (item.status === "IMPORTED") s.imported += 1;
      else if (item.status === "DUPLICATE") s.duplicate += 1;
      // 返信が来た依頼。人の確認より先に見る（acknowledged に混ぜると経緯が消える）
      else if (item.status === "REQUEST_SENT" && item.repliedAt !== null) s.replied += 1;
      else if (item.autoSkipped) s.autoSkipped += 1;
      else s.acknowledged += 1;
      continue;
    }
    s.unsettled += 1;
    if (reason === "pending") s.pending += 1;
    else if (reason === "importing") s.importing += 1;
    else if (reason === "failed") s.failed += 1;
    else if (reason === "invoice-deleted") s.invoiceDeleted += 1;
    else if (reason === "request-needed") s.requestNeeded += 1;
    else if (reason === "request-sending") s.requestSending += 1;
    else if (reason === "request-waiting") s.requestWaiting += 1;
    else if (reason === "request-failed") s.requestFailed += 1;
    else s.needsCheck += 1;
  }

  return s;
}

export interface MessageLike {
  attachmentsScannedAt: Date | null;
  /**
   * 本文のリンクを調べ終えた時刻。
   *
   * この列を足した時点で既存の全メールが null ＝ 未走査になり、
   * 同じ期間をもう一度走査するだけで対象になる（遡って書き換える作業は要らない）。
   */
  linksScannedAt: Date | null;
}

/**
 * メールを調べ終えたか ＝ 有効な調べ方をすべて終えたか。
 *
 * 添付とリンクの両方を見て初めて完了。片方だけで完了にすると、
 * URLの向こうにある請求書が「調べ終えた」扱いで画面から消える。
 */
export function messageScanComplete(message: MessageLike): boolean {
  return message.attachmentsScannedAt !== null && message.linksScannedAt !== null;
}
