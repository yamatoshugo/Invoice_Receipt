/**
 * Gmail取込のまとめ口。
 *
 * storage/ extraction/ と同じく「types + 実装 + index」の形にしてある。
 * 実装を差し替えるならここだけを見ればよい。
 */
export * from "./types";
export { getGmailClient } from "./client";
export { connectionState, connectedAddress, disconnect, markRevoked, markSynced, saveConnection, sendCapability } from "./connection";
export { gmailOauthConfigured, GMAIL_SCOPES } from "./oauth";
export { canSend, describeScopes, GMAIL_SCOPE_READONLY, GMAIL_SCOPE_SEND, hasScope } from "./scope";
export { tokenKeyConfigured } from "./crypto";
export { buildGmailQuery, inWindow, jstDayRangeToInstants, toJstDay } from "./query";
export { collectAttachmentParts, findPartById, headerValue, parseFromHeader } from "./parts";
export { classifyAttachment } from "./classify";
export { isEncryptedPdf, looksLikePdf } from "./pdf";
export { findGaps, INDEX_LAG_MARGIN_MS, mergeCoveredRanges, nextScanWindow } from "./coverage";
export { messageScanComplete, settlementOf, summarizeItems, unsettledReasonOf } from "./status";
// --- PDF送付の依頼メール ---
export { replyArrivedAt, replyWithoutAttachmentAt } from "./reply";
export { daysElapsed, describeWait, replyWaitLevel } from "./replyWait";
export {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  hasUnresolvedPlaceholders,
  looksUnreplyable,
  renderTemplate,
  REQUEST_VARS,
} from "./requestTemplate";
export { buildRfc2822, encodeHeaderWord, isSendableAddress, sanitizeHeaderValue } from "./rfc2822";
export { canThread, normalizeSubject, withRePrefix } from "./threading";
export {
  itemsForSummary,
  loadRequestContext,
  loadRequestQueue,
  requestBadgeCounts,
  sendRequestMail,
  skipRequest,
} from "./requests";

/** Gmail連携がそもそも設定されているか（環境変数の有無）。画面の案内に使う */
export function gmailConfigured(): boolean {
  // 循環importを避けるため、ここで直接読む
  return Boolean(
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.APP_BASE_URL,
  );
}
