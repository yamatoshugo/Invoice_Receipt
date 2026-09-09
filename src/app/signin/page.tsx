import { signIn } from "@/auth";

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
      </div>
    </main>
  );
}
