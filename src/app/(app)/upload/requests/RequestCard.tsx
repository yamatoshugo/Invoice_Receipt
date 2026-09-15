"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { sendGmailRequest, skipGmailRequest, type ActionState } from "@/app/actions";
import { ErrorBox, Warning, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { hasUnresolvedPlaceholders, looksUnreplyable } from "@/lib/gmail/requestTemplate";
import { isSendableAddress } from "@/lib/gmail/rfc2822";
import { canThread } from "@/lib/gmail/threading";
import type { RequestRow } from "@/lib/gmail/requests";

/**
 * 依頼1件。アコーディオンで開いて、その場で宛先・件名・本文を直して送る。
 *
 * ★本文をその場で直せることが、この機能が使われ続ける条件。
 * 直せないと担当者は「少しズレた文面をそのまま送る」か「Gmailで直接送る」になる。
 * 後者だと送信の記録が残らず、返信待ちの可視化が丸ごと死ぬ。
 */
export function RequestCard({ row, canSend }: { row: RequestRow; canSend: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(row.toAddress ?? "");
  const [editingTo, setEditingTo] = useState(row.toAddress === null);
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [skipping, startSkip] = useTransition();
  const [skipMessage, setSkipMessage] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    sendGmailRequest.bind(null, row.id),
    { ok: true },
  );

  // 展開後に {{ が残ったままでは送らせない（「{{取引先名}} ご担当者様」を送らないため）
  const unresolved = hasUnresolvedPlaceholders(subject) || hasUnresolvedPlaceholders(body);
  const addressOk = isSendableAddress(to.trim());
  const threads = canThread(subject, row.originalSubject);
  const blocked = !canSend || unresolved || !addressOk || subject.trim() === "" || body.trim() === "";

  function handleSkip() {
    if (!confirm("この請求書について依頼しないものとして記録します。よろしいですか？")) return;
    startSkip(async () => {
      const result = await skipGmailRequest(row.id, "画面から「依頼しない」を選択");
      setSkipMessage(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="text-xs text-slate-400">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{row.vendorName}</span>
        <span className="text-xs text-slate-500">{row.toAddress ?? "差出人アドレス不明"}</span>
        <span className="flex-1 truncate text-sm text-slate-600">{row.originalSubject ?? "(件名なし)"}</span>
        {row.status === "REQUEST_FAILED" && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">送信に失敗</span>
        )}
        {row.status === "REQUEST_SENDING" && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">送信中のまま</span>
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-4">
          {row.status === "REQUEST_FAILED" && (
            <ErrorBox>
              <p className="font-medium">前回の送信でエラーになりました</p>
              <p className="mt-1">{row.requestError}</p>
              <p className="mt-2 text-xs">
                ★エラーでも、Gmailが受理した後で失敗した可能性があります。
                <strong>Gmailの「送信済み」を確認してから</strong>再送してください。
              </p>
            </ErrorBox>
          )}

          {row.status === "REQUEST_SENDING" && (
            <Warning>
              送信処理の途中で中断しています。Gmailの「送信済み」を確認し、
              送られていなければ下のボタンで送り直してください。
            </Warning>
          )}

          {row.url && (
            <p className="text-xs break-all text-slate-500">
              判定されたURL: {row.url}
              {row.reason && <span className="ml-2">（{row.reason}）</span>}
            </p>
          )}

          {row.unreplyable && (
            <Warning>
              このアドレスは返信を受け付けない可能性があります（noreply宛）。
              取引先の担当窓口のアドレスに変更してください。
            </Warning>
          )}

          {row.recentlySentAt && (
            <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              この宛先には {row.recentlySentAt.toLocaleDateString("ja-JP")} にも依頼を送っています。
              別の請求であれば、そのまま送って問題ありません。
            </p>
          )}

          {/* 広い画面では「宛先・件名」と「本文」を横に並べる。
              本文は必ず人が読んで直す前提なので、広いほうが実用的 */}
          <form action={formAction} className="space-y-3">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">宛先</span>
                  {editingTo ? (
                    <input
                      name="to"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className={inputClass}
                      placeholder="keiri@example.co.jp"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      {/* 最終的に届く先を大きく出す。誤送信はここを読み飛ばしたときに起きる */}
                      <span className="text-base font-medium">{to}</span>
                      <input type="hidden" name="to" value={to} />
                      <button
                        type="button"
                        onClick={() => setEditingTo(true)}
                        className="text-xs text-slate-600 underline"
                      >
                        宛先を変更
                      </button>
                    </div>
                  )}
                  {!addressOk && to.trim() !== "" && (
                    <span className="mt-1 block text-xs text-red-600">
                      メールアドレスの形式が正しくありません
                    </span>
                  )}
                  {editingTo && looksUnreplyable(to) && (
                    <span className="mt-1 block text-xs text-amber-700">
                      noreply宛の可能性があります
                    </span>
                  )}
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">件名</span>
                  <input
                    name="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className={inputClass}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    {threads
                      ? "🔗 元のスレッドへの返信として送られます（返信が同じスレッドに戻るので、届いたことを自動で確認できます）"
                      : "件名が元のメールと異なるため、新規メールとして送られます"}
                  </span>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">本文</span>
                <textarea
                  name="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={18}
                  className={`${inputClass} font-mono text-xs leading-relaxed`}
                />
              </div>
            </div>

            {unresolved && (
              <ErrorBox>
                本文または件名に未展開の差し込み（<code>{"{{…}}"}</code>）が残っています。
                設定画面の文面を直すか、ここで直接書き換えてください。
              </ErrorBox>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonClass} disabled={pending || blocked}>
                {pending ? "送信中…" : "この内容で送信"}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={skipping}
                className={secondaryButtonClass}
              >
                {skipping ? "記録中…" : "依頼しない"}
              </button>
              {state.message && (
                <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
                  {state.message}
                </span>
              )}
              {skipMessage && <span className="text-sm text-slate-600">{skipMessage}</span>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
