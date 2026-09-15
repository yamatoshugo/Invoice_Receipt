import Link from "next/link";
import { connectionState, sendCapability } from "@/lib/gmail/connection";
import { loadRequestContext, loadRequestQueue } from "@/lib/gmail/requests";
import { buttonClass, Warning } from "@/components/ui";
import { RequestCard } from "./RequestCard";
import { WaitingList } from "./WaitingList";

/**
 * 請求書の送付依頼。
 *
 * ログインが要るWeb明細サイトのURLだけが届いた請求書は自動取得できないので、
 * 取引先に「PDFで送ってください」と依頼する。
 *
 * ★自動送信はしない。1件ずつ、人が宛先・件名・本文を確認してから送る。
 * ★一括送信も作らない。テンプレートの書き間違いが全社に同時に届く唯一の経路になるため。
 */
export default async function RequestsPage() {
  const connection = await connectionState();

  if (connection.status === "disconnected") {
    return (
      <div className="max-w-3xl">
        <Warning>
          <p className="font-medium">Gmailに接続されていません。</p>
          <p className="mt-1">請求書受け取り専用のアドレスを、設定画面から1回だけ接続してください。</p>
        </Warning>
        <Link href="/settings#gmail" className={`${buttonClass} mt-4 inline-block`}>
          設定画面へ
        </Link>
      </div>
    );
  }

  const [capability, context] = await Promise.all([
    sendCapability(),
    loadRequestContext(new Date(), connection.emailAddress),
  ]);
  const queue = await loadRequestQueue(context);

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-slate-600">
        本文のリンクが<strong className="text-slate-900">ログインの要るWeb明細サイト</strong>
        だった請求書です。取引先に「請求書をPDFで送ってください」と依頼します。
        依頼メールは <span className="font-medium">{connection.emailAddress}</span> から送られ、
        取引先が返信すると次回の取り込みで請求書として拾われます。
      </p>

      {/* 送信できない状態は、送信ボタンを押す前に出す（押して403で気付くのでは遅い） */}
      {!capability.canSend && (
        <div className="max-w-3xl">
          <Warning>
            <p className="font-medium">いまは依頼メールを送れません</p>
            <p className="mt-1">{capability.message}</p>
            {capability.reason === "scope" && (
              <Link href="/settings#gmail" className="mt-2 inline-block underline">
                設定画面へ
              </Link>
            )}
          </Warning>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">未送信（{queue.unsent.length}件）</h2>
        {queue.unsent.length === 0 ? (
          <p className="text-sm text-slate-500">
            依頼待ちのものはありません。ログインが必要なリンクが見つかると、ここに出ます。
          </p>
        ) : (
          <div className="space-y-3">
            {queue.unsent.map((row) => (
              <RequestCard key={row.id} row={row} canSend={capability.canSend} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">返信待ち（{queue.waiting.length}件）</h2>
        {queue.waiting.length === 0 ? (
          <p className="text-sm text-slate-500">返信待ちのものはありません。</p>
        ) : (
          <WaitingList rows={queue.waiting} />
        )}
      </section>

      <p className="max-w-3xl text-xs text-slate-500">
        送った依頼は、返信（請求書の添付）が届くまで「決着していないもの」として残り続けます。
        依頼しないと判断したものは「依頼しない」で記録を残して閉じてください。
      </p>
    </div>
  );
}
