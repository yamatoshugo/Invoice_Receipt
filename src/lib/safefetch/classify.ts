import { looksLikePdf } from "@/lib/gmail/pdf";

/**
 * 取得した結果を「取り込めるか」に落とす。
 *
 * 判定の順序が仕様。Content-Type は送信側の申告にすぎないので、
 * まず実体（先頭バイト）を見る。既存の添付の分類と同じ思想。
 */

export type FetchClass =
  | { kind: "pdf" }
  /** ログインが要る。取引先にPDF送付を依頼する対象 */
  | { kind: "login-required"; reason: string }
  /** PDFではなかった。人が中身を見る */
  | { kind: "not-pdf"; reason: string }
  /** 取得に失敗した。再試行の価値がある */
  | { kind: "failed"; reason: string };

export interface FetchedForClassify {
  status: number;
  contentType: string | null;
  /** 最終ホップまでに通ったURL。ログイン画面へ飛ばされた形跡を見る */
  hops: string[];
  /** 実体。最終判定はこれで行う */
  body: Buffer;
  /** HTMLだった場合に文字化けせず語を探すための、charset解決済みテキスト */
  bodyText: string | null;
}

const LOGIN_WORDS = [
  "ログイン",
  "ログオン",
  "サインイン",
  "パスワード",
  "会員id",
  "ユーザーid",
  "認証",
  "log in",
  "login",
  "sign in",
  "signin",
  "password",
];

const LOGIN_PATH = /\/(login|signin|sign-in|auth|sso|account\/login)\b|[?&](returnurl|redirect_uri|return_to)=/i;

function looksLikeHtml(body: Buffer, text: string | null): boolean {
  const head = (text ?? body.subarray(0, 512).toString("latin1")).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<body");
}

export function classifyFetched(input: FetchedForClassify): FetchClass {
  // ① 実体がPDFなら無条件でPDF。
  //    配信サーバーが application/octet-stream や text/plain で返すのは日常茶飯事
  if (looksLikePdf(input.body)) return { kind: "pdf" };

  // ② 認証を求められた
  if (input.status === 401) return { kind: "login-required", reason: "認証が必要です（401）" };
  if (input.status === 403) return { kind: "login-required", reason: "アクセスが拒否されました（403）" };

  if (input.status >= 200 && input.status < 300) {
    const text = (input.bodyText ?? "").toLowerCase();
    if (looksLikeHtml(input.body, input.bodyText)) {
      // ③ パスワード入力欄があれば、これが最も確実な証拠
      if (/<input[^>]+type\s*=\s*["']?password/i.test(input.bodyText ?? "")) {
        return { kind: "login-required", reason: "ログイン画面が返りました" };
      }
      if (LOGIN_WORDS.some((w) => text.includes(w))) {
        return { kind: "login-required", reason: "ログインが必要なページのようです" };
      }
      if (input.hops.some((h) => LOGIN_PATH.test(h))) {
        return { kind: "login-required", reason: "ログイン画面へ転送されました" };
      }
      // ④ 証拠が無ければ not-pdf に倒す。
      //    login-required は取引先へメールを出す状態で、送ったメールは取り消せない。
      //    誤検知の代償が非対称なので、証拠が無いときはメールを出さない側にする
      return { kind: "not-pdf", reason: "PDFではなくWebページが返りました" };
    }
    return {
      kind: "not-pdf",
      reason: `PDFではありませんでした（${input.contentType ?? "種別不明"}）`,
    };
  }

  if (input.status === 404 || input.status === 410) {
    return { kind: "failed", reason: "リンクが見つかりません（有効期限切れの可能性があります）" };
  }
  return { kind: "failed", reason: `取得に失敗しました（${input.status}）` };
}
