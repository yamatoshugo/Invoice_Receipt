import type { DefaultUser } from "next-auth";

/**
 * authorize() の戻り値に足したフィールドを型に認識させる。
 *
 * JWT の側は Record<string, unknown> を継承しているので拡張は要らない。
 */
declare module "next-auth" {
  interface User extends DefaultUser {
    /**
     * パスワードを最後に設定した時刻(ミリ秒)。
     * 発行済みCookieを失効させるために JWT へ焼き込む（src/auth.ts の jwt コールバック）
     */
    passwordUpdatedAt?: number;
  }
}

export {};
