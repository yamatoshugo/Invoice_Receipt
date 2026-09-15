/**
 * 外部URLを安全に取得する層。
 *
 * 判断（純関数）と接続（I/O）を分けてある。
 *   ip / url / classify / filename … 純関数。テストで固める
 *   fetch                          … ネットワークに触る唯一の場所
 */
export { blockedHostReason, blockedIpReason } from "./ip";
export { dedupKey, parseHttpUrl } from "./url";
export { classifyFetched } from "./classify";
export type { FetchClass, FetchedForClassify } from "./classify";
export { fileNameFromDownload } from "./filename";
export { DEFAULT_FETCH_OPTIONS, fetchDocument } from "./fetch";
export type { FetchOptions, FetchOutcome } from "./fetch";
