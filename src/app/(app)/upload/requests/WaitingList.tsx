"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { skipGmailRequest } from "@/app/actions";
import { describeWait } from "@/lib/gmail/replyWait";
import type { RequestRow } from "@/lib/gmail/requests";

/**
 * 送った依頼の返信待ち。
 *
 * ★ここから「もう一度送る」は出さない。同じ依頼が2通届くのを防ぐため、
 * 送信済みの行は占有されたままにしてある（requests.ts の二重送信対策）。
 * 催促が要るときは「Gmailで開く」から人が直接やり取りする。
 */
export function WaitingList({ rows }: { rows: RequestRow[] }) {
  const now = new Date();

  return (
    <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
      {rows.map((row) => (
        <WaitingRow key={row.id} row={row} now={now} />
      ))}
    </ul>
  );
}

function WaitingRow({ row, now }: { row: RequestRow; now: Date }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const replied = row.repliedAt !== null;

  function handleClose() {
    if (!confirm("この依頼を「これ以上待たない」として閉じます。よろしいですか？")) return;
    startTransition(async () => {
      const result = await skipGmailRequest(row.id, "返信を待たないと判断");
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span className="font-medium">{row.vendorName}</span>
      <span className="text-xs text-slate-500">{row.requestToAddress}</span>

      <span className="text-xs text-slate-600">
        {row.requestSentAt?.toLocaleDateString("ja-JP")} 送信
      </span>

      {replied ? (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
          ✅ 返信が届いています（{row.repliedAt?.toLocaleDateString("ja-JP")}）
        </span>
      ) : (
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-xs font-medium",
            row.waitLevel === "critical"
              ? "bg-red-100 text-red-800"
              : row.waitLevel === "overdue"
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-600",
          )}
        >
          {row.requestSentAt ? describeWait(row.requestSentAt, now) : "送信日時不明"}
        </span>
      )}

      {/* 添付なしの返信は決着にしない。請求書がまだ手元に無いことに変わりはない */}
      {!replied && row.repliedWithoutAttachmentAt && (
        <span className="text-xs text-slate-500">
          返信はありますが、請求書が添付されていません（
          {row.repliedWithoutAttachmentAt.toLocaleDateString("ja-JP")}）
        </span>
      )}

      <span className="flex-1" />

      <a
        href={`https://mail.google.com/mail/u/0/#all/${row.gmailThreadId}`}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-slate-600 underline"
      >
        Gmailで開く
      </a>
      <button
        type="button"
        onClick={handleClose}
        disabled={pending}
        className="text-xs text-slate-600 underline disabled:opacity-40"
      >
        {pending ? "記録中…" : "待たない"}
      </button>
      {message && <span className="text-xs text-slate-600">{message}</span>}
    </li>
  );
}
