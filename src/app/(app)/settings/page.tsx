import { prisma } from "@/lib/prisma";
import { connectionState } from "@/lib/gmail/connection";
import { tokenKeyConfigured } from "@/lib/gmail/crypto";
import { gmailOauthConfigured } from "@/lib/gmail/oauth";
import { SettingsForm } from "./SettingsForm";
import { GmailConnectionPanel } from "./GmailConnectionPanel";
import { RequestMailForm } from "./RequestMailForm";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string; gmailMessage?: string }>;
}) {
  const [setting, gmail, params] = await Promise.all([
    prisma.setting.findUnique({ where: { id: "default" } }),
    connectionState(),
    searchParams,
  ]);

  const notice =
    params.gmail === "connected"
      ? { kind: "connected" as const, message: params.gmailMessage ?? "" }
      : params.gmail === "error"
        ? { kind: "error" as const, message: params.gmailMessage ?? "原因不明のエラー" }
        : null;

  return (
    <div>
      <h1 className="text-xl font-semibold">設定</h1>

      {/* 画面が広いときは2カラム。文面はプレビューが縦に長いので、独立した右カラムに置く */}
      <div className="mt-6 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
        <div className="space-y-8">
          <section className="rounded border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">振込依頼人</h2>
            <p className="mt-1 mb-4 text-sm text-slate-600">
              CSVのヘッダーレコードに出力される、自社（振込元）の情報です。
              値はすべてネットバンキングの画面から取得してください。
              ここが誤っていると銀行で受付エラーになります。
            </p>
            <SettingsForm setting={setting} />
          </section>

          <GmailConnectionPanel
            state={gmail}
            configured={gmailOauthConfigured() && tokenKeyConfigured()}
            notice={notice}
          />
        </div>

        <RequestMailForm
          subject={setting?.requestMailSubject ?? null}
          body={setting?.requestMailBody ?? null}
          fromName={setting?.requestMailFromName ?? null}
          mailboxAddress={gmail.status === "disconnected" ? null : gmail.emailAddress}
          companyName={setting?.requesterName ?? ""}
        />
      </div>
    </div>
  );
}
