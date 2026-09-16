import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bootstrapConfigured } from "@/lib/auth/bootstrap";
import { Field, inputClass } from "@/components/ui";
import { SubmitButton } from "./SubmitButton";

// 利用者が登録済みかどうかを毎回見るため、事前生成もキャッシュもしない
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, userCount] = await Promise.all([searchParams, prisma.user.count()]);

  // まだ誰も登録されていない状態は、案内を出さないと
  // 環境変数の設定漏れやタイプミスが「パスワードが違う」と区別できず、
  // 正しいはずの値を延々と試すことになる
  const noUsers = userCount === 0;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold">請求書一括振込</h1>
        <p className="mt-2 text-sm text-slate-600">
          メールアドレスとパスワードでログインしてください。
        </p>

        {noUsers && (
          <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-medium">まだ利用者が1人も登録されていません。</p>
            {bootstrapConfigured() ? (
              <p className="mt-1">
                環境変数 <code>INITIAL_ADMIN_EMAIL</code> のアドレスと{" "}
                <code>INITIAL_ADMIN_PASSWORD</code> のパスワードでログインすると、
                最初の1人として登録されます。
              </p>
            ) : (
              <p className="mt-1">
                環境変数 <code>INITIAL_ADMIN_EMAIL</code> と{" "}
                <code>INITIAL_ADMIN_PASSWORD</code> を設定してから、
                そのアドレスとパスワードでログインしてください。
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {/* ★どちらが違うかは出さない。アドレスの存在が分かると総当たりの的が絞られる */}
            メールアドレスまたはパスワードが違います。
          </p>
        )}

        <form
          className="mt-6 space-y-4"
          action={async (formData: FormData) => {
            "use server";
            try {
              await signIn("password", {
                email: String(formData.get("email") ?? ""),
                password: String(formData.get("password") ?? ""),
                redirectTo: "/invoices",
              });
            } catch (e) {
              // signIn の redirectTo は例外として送出されるため、認証エラーだけを拾う
              if (e instanceof AuthError) redirect("/signin?error=credentials");
              throw e;
            }
          }}
        >
          <Field label="メールアドレス">
            <input
              type="email"
              name="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              className={inputClass}
            />
          </Field>

          <Field label="パスワード">
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>

          <SubmitButton />
        </form>
      </div>
    </main>
  );
}
