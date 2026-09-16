import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { DevModeBanner } from "@/components/DevModeBanner";

// 全ページがログイン中のユーザーとDBの現在値に依存するため、事前生成もキャッシュもしない
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/invoices", label: "請求書一覧" },
  { href: "/upload", label: "取り込み" },
  { href: "/export", label: "CSV出力" },
  { href: "/settings", label: "設定" },
  { href: "/vendors", label: "取引先" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // proxy はCookieが復号できるかしか見ない（src/auth.config.ts 参照）。
  // 削除された人・パスワードを再設定された人のCookieはそこを通過してくるので、
  // 実際の締め出しはここで効かせる
  if (!session?.user?.email) redirect("/signin");

  return (
    <div className="min-h-screen">
      <DevModeBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3 lg:px-10">
          <Link href="/invoices" className="text-sm font-semibold whitespace-nowrap">
            請求書一括振込
          </Link>
          <nav className="flex gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-500">{session?.user?.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-900">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* ヘッダーと同じ幅・同じ余白にする（ずれるとナビと本文の左端が合わない） */}
      <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">{children}</main>
    </div>
  );
}
