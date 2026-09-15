"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectGmail } from "@/app/actions";
import { dangerButtonClass, buttonClass, ErrorBox, secondaryButtonClass, Warning } from "@/components/ui";
import { canSend, describeScopes } from "@/lib/gmail/scope";
import type { GmailConnectionState } from "@/lib/gmail/types";

export function GmailConnectionPanel({
  state,
  configured,
  notice,
}: {
  state: GmailConnectionState;
  /** 環境変数（クライアントID・暗号化鍵）が揃っているか */
  configured: boolean;
  notice: { kind: "connected" | "error"; message: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleDisconnect() {
    if (
      !confirm(
        "Gmailの連携を解除します。以後、メール取込は使えなくなります（取り込み済みの請求書は残ります）。",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectGmail();
      setMessage({ ok: result.ok, text: result.message ?? "" });
      router.refresh();
    });
  }

  return (
    <section id="gmail" className="rounded border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">Gmail 連携</h2>
      <p className="mt-1 mb-4 text-sm text-slate-600">
        請求書受け取り専用のGmailアドレスを1回だけ接続します。接続後は、誰がログインしていても
        「取り込み」タブのボタンだけで取り込めます。権限は
        <strong className="text-slate-900">メールの読み取りと、送付依頼メールの送信だけ</strong>で、
        ラベル付与も既読化も削除もしません。
      </p>

      {notice?.kind === "error" && (
        <div className="mb-4">
          <ErrorBox>接続できませんでした: {notice.message}</ErrorBox>
        </div>
      )}
      {notice?.kind === "connected" && (
        <div className="mb-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice.message} を接続しました。
        </div>
      )}
      {message && (
        <div className="mb-4">
          <p className={message.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
            {message.text}
          </p>
        </div>
      )}

      {!configured && (
        <div className="mb-4">
          <Warning>
            Gmail連携の環境変数が設定されていません（<code>GMAIL_CLIENT_ID</code> /{" "}
            <code>GMAIL_CLIENT_SECRET</code> / <code>GMAIL_TOKEN_KEY</code> /{" "}
            <code>APP_BASE_URL</code>）。README の「Gmail連携の設定」を参照してください。
          </Warning>
        </div>
      )}

      {state.status === "disconnected" && (
        <a
          href="/api/gmail/connect"
          className={configured ? buttonClass : `${buttonClass} pointer-events-none opacity-40`}
          aria-disabled={!configured}
        >
          Gmailを接続する
        </a>
      )}

      {state.status === "revoked" && (
        <div className="space-y-3">
          <ErrorBox>
            <p className="font-medium">Gmail連携が切れています（{state.emailAddress}）</p>
            <p className="mt-1">{state.message}</p>
            <p className="mt-2 text-xs">
              対象アカウントのパスワード変更、管理者によるアプリの取り消し、長期間の未使用が原因になります。
            </p>
          </ErrorBox>
          <a href="/api/gmail/connect" className={buttonClass}>
            再接続する
          </a>
        </div>
      )}

      {state.status === "connected" && !canSend(state.scope) && (
        <div className="mb-4">
          <Warning>
            <p className="font-medium">メールを送る権限がまだありません</p>
            <p className="mt-1">
              「請求書をPDFで送ってください」の依頼メールを送るには、下の
              <strong>「接続し直す」</strong>を1回押して、同意画面で送信の項目も許可してください。
            </p>
            <p className="mt-1 text-xs">取り込みはこのままでも動き続けます（送信だけができません）。</p>
          </Warning>
        </div>
      )}

      {state.status === "connected" && (
        <dl className="space-y-2 text-sm">
          <Row label="接続中のアドレス">
            <span className="font-medium">{state.emailAddress}</span>
          </Row>
          <Row label="権限">
            <span className="text-slate-600">{describeScopes(state.scope)}</span>
          </Row>
          <Row label="接続日時">
            <span className="text-slate-600">
              {state.connectedAt.toLocaleString("ja-JP")}（{state.connectedByEmail}）
            </span>
          </Row>
          <Row label="最後の取り込み">
            <span className="text-slate-600">
              {state.lastSyncedAt ? state.lastSyncedAt.toLocaleString("ja-JP") : "まだありません"}
            </span>
          </Row>
          <div className="flex gap-2 pt-3">
            <a href="/api/gmail/connect" className={secondaryButtonClass}>
              接続し直す
            </a>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={pending}
              className={dangerButtonClass}
            >
              {pending ? "解除中…" : "連携を解除"}
            </button>
          </div>
        </dl>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
