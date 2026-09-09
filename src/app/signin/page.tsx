import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { devLoginEnabled, signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold">請求書一括振込</h1>
        <p className="mt-2 text-sm text-slate-600">
          許可されたGoogleアカウントでログインしてください。
        </p>

        {error && (
          <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            ログインできませんでした。このアカウントは利用を許可されていません。
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/invoices" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Googleでログイン
          </button>
        </form>

        {devLoginEnabled && (
          <div className="mt-8 border-t border-dashed border-slate-300 pt-6">
            <p className="text-xs font-medium text-amber-700">
              開発用ログイン（本番では無効）
            </p>
            <p className="mt-1 text-xs text-slate-500">
              デプロイ前の動作確認用です。パスワードの確認は行いません。
            </p>
            <form
              className="mt-3 space-y-2"
              action={async (formData: FormData) => {
                "use server";
                try {
                  await signIn("dev-login", {
                    email: String(formData.get("email") ?? ""),
                    redirectTo: "/invoices",
                  });
                } catch (e) {
                  // signIn の redirectTo は例外として送出されるため、認証エラーだけを拾う
                  if (e instanceof AuthError) redirect("/signin?error=dev-login");
                  throw e;
                }
              }}
            >
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-900 focus:outline-none"
              />
              <button
                type="submit"
                className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                このメールアドレスでログイン
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
