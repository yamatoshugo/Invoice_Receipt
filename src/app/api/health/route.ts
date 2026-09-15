import { auth } from "@/auth";
import { storageMode } from "@/lib/storage/types";

/**
 * いま動いているデプロイが「何を見ているか」を返す。
 *
 * 設定の食い違いは、画面上は無関係なエラー（Blobのトークン取得失敗など）として
 * 現れるため、原因の切り分けにとても時間がかかる。
 * ここを開けば、実行中のコードから見えている事実だけが分かる。
 *
 * ★値は返さない。設定されているかどうか（true/false）だけを返す。
 * それでもログインを必須にしてある（構成情報を外に出さないため）。
 */
export const dynamic = "force-dynamic";

/** 本番で1つでも欠けると動かないもの */
const REQUIRED = [
  "DATABASE_URL",
  "DIRECT_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ALLOWED_EMAILS",
  "ANTHROPIC_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_TOKEN_KEY",
  "APP_BASE_URL",
] as const;

/** 本番に入っていてはいけないもの（入っていたら赤信号） */
const FORBIDDEN_IN_PRODUCTION = ["AUTH_DEV_LOGIN", "STORAGE", "EXTRACTOR"] as const;

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const present = (name: string): boolean => (process.env[name] ?? "").trim() !== "";

  const missing = REQUIRED.filter((name) => !present(name));
  const unexpected = FORBIDDEN_IN_PRODUCTION.filter((name) => present(name));

  return Response.json({
    // どのデプロイを見ているかの確認用。URLを取り違えているとここで分かる
    deployment: {
      env: process.env.VERCEL_ENV ?? "local",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    storage: storageMode(),
    appBaseUrl: process.env.APP_BASE_URL ?? null,
    // 値は出さない。設定の有無だけ
    env: Object.fromEntries([
      ...REQUIRED.map((name) => [name, present(name)]),
      ...FORBIDDEN_IN_PRODUCTION.map((name) => [name, present(name)]),
    ]),
    missing,
    // 本番でこれが空でなければ、設定を消すまで使ってはいけない
    unexpected,
    ok: missing.length === 0 && unexpected.length === 0,
  });
}
