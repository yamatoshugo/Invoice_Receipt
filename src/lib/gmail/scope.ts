/**
 * Gmailの権限（スコープ）の判定。
 *
 * env に触らない純関数だけを置く。oauth.ts は gmailOauthConfig() が env を読んで
 * throw するので、そちらに混ぜるとスコープ判定のテストに環境変数が要るようになる。
 */

export const GMAIL_SCOPE_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";

/**
 * 接続の必須スコープ。読み取りだけ。
 *
 * 送信を必須にすると、同意画面で送信のチェックを外した利用者が
 * 「取り込みすらできない」状態になる。取り込みが本体で、依頼メールは付随機能。
 * 本体を付随機能の都合で止めない。
 */
export const REQUIRED_SCOPES = [GMAIL_SCOPE_READONLY] as const;

/** 表示順を固定する。Googleが返す順序に画面の文言を左右されないため */
const SCOPE_ORDER = [GMAIL_SCOPE_READONLY, GMAIL_SCOPE_SEND] as const;

const LABELS: Record<string, string> = {
  [GMAIL_SCOPE_READONLY]: "読み取り",
  [GMAIL_SCOPE_SEND]: "送信",
};

/** Googleはスペース区切りで返す。順序も個数も保証が無いので集合にして扱う */
export function parseScopes(granted: string): Set<string> {
  return new Set(granted.split(/\s+/).filter(Boolean));
}

export function hasScope(granted: string, scope: string): boolean {
  return parseScopes(granted).has(scope);
}

/**
 * 依頼メールを送れるか。
 *
 * リフレッシュはスコープを引数に取らないので、gmail.send を足した後も
 * 既存の接続は readonly のまま有効に動き続ける（＝読めるが送れない）。
 * 送信時の403で初めて気付くことになるので、DBに記録した scope で事前に判定する。
 */
export function canSend(granted: string): boolean {
  return hasScope(granted, GMAIL_SCOPE_SEND);
}

/** 接続に足りないスコープ。空なら接続してよい */
export function missingRequiredScopes(granted: string): string[] {
  const set = parseScopes(granted);
  return REQUIRED_SCOPES.filter((s) => !set.has(s));
}

/** "https://www.googleapis.com/auth/gmail.send" → "gmail.send" */
export function shortScopeName(scope: string): string {
  return scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "");
}

/**
 * 画面に出す権限の説明。
 *
 * 決め打ちの文字列にすると、スコープを足したときにここが嘘になる
 * （実際、第1段では「読み取りのみ」と決め打ちしていた）。
 */
export function describeScopes(granted: string): string {
  const set = parseScopes(granted);
  const known = SCOPE_ORDER.filter((s) => set.has(s));
  const unknown = [...set].filter((s) => !SCOPE_ORDER.includes(s as never)).sort();

  const names = [...known, ...unknown].map(shortScopeName).join(" / ");
  if (known.length === 0) return names === "" ? "（権限の記録がありません）" : names;

  const labels = known.map((s) => LABELS[s]).join("・");
  const only = known.length === 1 && unknown.length === 0 ? "のみ" : "";
  return `${labels}${only}（${names}）`;
}
