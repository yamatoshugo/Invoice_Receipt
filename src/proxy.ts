// Next.js 16 で middleware は proxy に改名された（機能は同じ）。
// 各 Server Action は使用先ページへのPOSTとして扱われ、matcher の除外がそのまま効くため、
// ここだけに頼らず actions.ts 側でも毎回セッションを検証している。
export { auth as proxy } from "@/auth";

export const config = {
  // 認証関連と静的ファイル以外はすべて保護する（未ログインは /signin へ飛ぶ）
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
