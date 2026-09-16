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
  "ANTHROPIC_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_TOKEN_KEY",
  "APP_BASE_URL",
] as const;

/** 本番に入っていてはいけないもの（入っていたら赤信号） */
const FORBIDDEN_IN_PRODUCTION = ["STORAGE", "EXTRACTOR"] as const;

/**
 * 最初の1人を作るための設定。
 *
 * ★REQUIRED には入れない。初回ログインが済めば無いのが正常な状態で、
 * 必須にすると ok:false が常態化し、本当に困ったときに誰も見なくなる。
 * 代わりに「残っている」ことだけを警告として出す（ok は落とさない）。
 */
const BOOTSTRAP = ["INITIAL_ADMIN_EMAIL", "INITIAL_ADMIN_PASSWORD"] as const;

/**
 * 接続先DBのリージョンだけを取り出す（例: "ap-southeast-1"）。
 *
 * 関数のリージョンとDBのリージョンが離れていると、DBを1回叩くたびに
 * その距離を往復する。1画面で10回引けば10往復ぶん遅くなるが、
 * 症状としては「なんとなく重い」としか出ないので原因に辿り着きにくい。
 * deployment.region と並べて見られるようにしておく。
 *
 * ★ホスト名も認証情報も返さない。地域名だけを取り出す。
 * ローカル（localhost）のように地域名を含まない接続先では null になる。
 */
function databaseRegion(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    // AWSの地域名の形（ap-southeast-1 / us-east-2 など）だけを拾う
    return new URL(url).hostname.match(/\b[a-z]{2}-[a-z]+-\d+\b/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const present = (name: string): boolean => (process.env[name] ?? "").trim() !== "";

  const missing = REQUIRED.filter((name) => !present(name));
  const unexpected = FORBIDDEN_IN_PRODUCTION.filter((name) => present(name));

  // ok は落とさない。「消し忘れ」であって「壊れている」ではないため
  const warnings = present("INITIAL_ADMIN_PASSWORD")
    ? [
        "INITIAL_ADMIN_PASSWORD が残っています。最初のログインが済んだら削除して再デプロイしてください。",
      ]
    : [];

  return Response.json({
    // どのデプロイを見ているかの確認用。URLを取り違えているとここで分かる
    deployment: {
      env: process.env.VERCEL_ENV ?? "local",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    // 上の deployment.region と見比べる。離れているとDBを叩くたびに往復する
    database: { region: databaseRegion() },
    storage: storageMode(),
    appBaseUrl: process.env.APP_BASE_URL ?? null,
    // 値は出さない。設定の有無だけ
    env: Object.fromEntries([
      ...REQUIRED.map((name) => [name, present(name)]),
      ...FORBIDDEN_IN_PRODUCTION.map((name) => [name, present(name)]),
      ...BOOTSTRAP.map((name) => [name, present(name)]),
    ]),
    missing,
    // 本番でこれが空でなければ、設定を消すまで使ってはいけない
    unexpected,
    // 動作は止まらないが、放置してはいけないもの
    warnings,
    ok: missing.length === 0 && unexpected.length === 0,
  });
}
