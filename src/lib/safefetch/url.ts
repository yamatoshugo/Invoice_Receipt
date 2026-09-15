/**
 * URLの検査と重複判定。
 *
 * 正規化した値で取得してはいけない。署名付きURLやワンタイムトークンは
 * クエリを1文字でも触ると壊れる。正規化は「同じURLを2回LLMに見せない」
 * ためだけに使い、実際に叩くのは必ず原文のURL。
 */

/** http / https だけを通す。それ以外とパース不能は null */
export function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url;
}

/**
 * 既知のトラッキングパラメータ。
 *
 * 消してよいと言い切れるものだけを並べる。
 * `ref` `id` `token` のように「トラッカーにも意味のあるパラメータにもなる名前」は
 * 絶対に触らない。別のURLを同一視すると、そのぶん取りこぼしになる。
 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "vero_conv",
  "igshid",
]);

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/**
 * 重複判定用のキー。表示や取得には使わない。
 *
 * パスの大文字小文字と末尾スラッシュは保つ（/a と /a/ は別リソースでありうる）。
 * 落とすのはフラグメント（サーバーに送られないので取得結果が必ず同じ）と、
 * 既知のトラッキングパラメータだけ。
 */
export function dedupKey(url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([name]) => !isTracking(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  return `${url.protocol}//${url.host}${url.pathname}${query ? `?${query}` : ""}`;
}
