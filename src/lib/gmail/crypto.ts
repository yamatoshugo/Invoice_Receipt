import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * refresh_token の暗号化。
 *
 * このトークンは「請求書メールボックス全体を読める鍵」なので、他のどの列よりも
 * 漏れたときの影響範囲が広い。DBは第三者のマネージドPostgres(Neon)で、
 * バックアップ・ダンプ・prisma studio・読み取り専用の資格情報すべてに載る。
 *
 * 鍵は環境変数（Vercel）、暗号文はDB（Neon）に置くことで信頼境界を分ける。
 * 片方だけが漏れても復号できない。
 */

const VERSION = "v1";

/** 用途を暗号文に焼き込み、他用途の暗号文と取り違えて復号できないようにする */
const AAD = Buffer.from("gmail-refresh-token");

/**
 * AUTH_SECRET から導出せず、専用の鍵を使う。
 *
 * AUTH_SECRET のローテーションは「全員ログアウトするだけ」の安全な日常操作で、
 * そこに「Gmail連携が無言で壊れる」副作用を隠すのは危険なため。
 */
function tokenKey(): Buffer {
  const raw = process.env.GMAIL_TOKEN_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "GMAIL_TOKEN_KEY は base64 エンコードした32バイトで設定してください（openssl rand -base64 32）",
    );
  }
  return key;
}

/** 平文のトークンを "v1.<iv>.<tag>.<ciphertext>" 形式へ封じる */
export function sealToken(plain: string): string {
  // GCMのIVは96bit固定。同じ鍵でIVを再利用するとGCMは致命的に壊れるので、毎回新規生成する
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/**
 * 封じたトークンを開く。改ざん・鍵違いは例外になる。
 *
 * 戻り値はログ・API応答・Server Componentのpropsに絶対に載せないこと。
 * 使うのは refreshAccessToken() の引数としてだけ。
 */
export function openToken(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4) throw new Error("暗号文の形式が不正です");
  const [version, iv, tag, ct] = parts as [string, string, string, string];
  if (version !== VERSION) throw new Error(`対応していない暗号形式です: ${version}`);

  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(AAD);
  // 改ざんや鍵違いは final() で必ず例外になる
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** 設定漏れを接続前に気づけるようにする。画面の表示判定に使う */
export function tokenKeyConfigured(): boolean {
  try {
    tokenKey();
    return true;
  } catch {
    return false;
  }
}
