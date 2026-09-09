export { auth as middleware } from "@/auth";

export const config = {
  // 認証関連と静的ファイル以外はすべて保護する（未ログインは /signin へ飛ぶ）
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
