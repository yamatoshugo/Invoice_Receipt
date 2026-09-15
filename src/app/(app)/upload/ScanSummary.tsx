"use client";

import Link from "next/link";
import { useState } from "react";
import type { ItemSummary } from "@/lib/gmail/status";

/**
 * 取り込み結果。
 *
 * 添付を1件ずつ並べる一覧は持たない（月1回の作業に対して管理UIが重すぎたため）。
 * 代わりに件数だけを出し、Gmailの検索欄に同じクエリを貼って突き合わせられるようにする。
 *
 * resultSizeEstimate は「推定値」と明記されているので使わない。
 * ページングで実際に数えたID数だけを出す。
 */
export function ScanSummary({
  scan,
  messagesInWindow,
  messagesWithAttachments,
  linksUnscanned,
  summary,
  requestOverdue,
}: {
  scan: {
    state: string;
    query: string;
    fromLabel: string;
    toLabel: string;
    listedMessageCount: number;
    inWindowThreadCount: number;
  };
  messagesInWindow: number;
  messagesWithAttachments: number;
  /** 本文のリンクをまだ調べていないメール件数 */
  linksUnscanned: number;
  summary: ItemSummary;
  /** 依頼を送って14日以上返信が来ていない件数 */
  requestOverdue: number;
}) {
  const [copied, setCopied] = useState(false);
  const complete = scan.state === "COMPLETED";
  const problems = summary.needsCheck + summary.failed;
  const loginNeeded = summary.requestNeeded;

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {scan.fromLabel} 〜 {scan.toLabel} の取り込み結果
        </h2>
        <span className={complete ? "text-xs text-slate-500" : "text-xs font-medium text-amber-700"}>
          {complete ? "走査済み" : "この走査はまだ完了していません"}
        </span>
      </div>

      <div className="mt-3 rounded bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-white px-2 py-1 text-xs">{scan.query}</code>
          <button
            type="button"
            className="text-xs text-slate-600 underline"
            onClick={() => {
              void navigator.clipboard.writeText(scan.query).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "コピーしました" : "クエリをコピー"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          このクエリをGmailの検索欄に貼ると、下の「クエリが返したメール」と件数を突き合わせられます
          （期間の前後1日はマージンとして広く引いています）。
        </p>
      </div>

      <dl className="mt-4 space-y-1 text-sm">
        <Count label="クエリが返したメール" value={scan.listedMessageCount} unit="通" strong />
        <Count label="うち期間内" value={messagesInWindow} unit="通" indent />
        <Count
          label="うち期間内（スレッド単位）"
          value={scan.inWindowThreadCount}
          unit="件"
          indent
          note="Gmailの画面はスレッドでまとめて数えます"
        />
        <Count label="添付あり" value={messagesWithAttachments} unit="通" indent2 />
        <Count label="添付なし" value={messagesInWindow - messagesWithAttachments} unit="通" indent2 />
      </dl>

      {linksUnscanned > 0 && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          本文のリンクをまだ調べていないメールが {linksUnscanned} 通あります。
          この期間をもう一度取り込むと調べられます（リンクで届く請求書に対応した際、
          それ以前に走査したメールがここに出ます）。
        </p>
      )}

      <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
        <Count label="見つかった添付" value={summary.total} unit="件" strong />
        <Count label="取り込み" value={summary.imported} unit="件" indent />
        <Count
          label="既に取り込み済み"
          value={summary.duplicate}
          unit="件"
          indent
          note={summary.duplicate > 0 ? "請求書一覧に印が出ています" : undefined}
        />
        <Count
          label="ログインが必要（依頼待ち）"
          value={summary.requestNeeded}
          unit="件"
          indent
          note={summary.requestNeeded > 0 ? "「送付依頼」タブから依頼できます" : undefined}
        />
        <Count
          label="送付を依頼して返信待ち"
          value={summary.requestWaiting}
          unit="件"
          indent
          note={requestOverdue > 0 ? `うち14日以上 ${requestOverdue}件` : undefined}
        />
        <Count label="返信が届いて取り込み済み" value={summary.replied} unit="件" indent />
        <Count label="PDF以外" value={summary.needsCheck} unit="件" indent />
        <Count label="失敗" value={summary.failed} unit="件" indent />
        <Count
          label="署名画像・請求書リンク無し（自動で除外）"
          value={summary.autoSkipped}
          unit="件"
          indent
        />
      </dl>

      {summary.pending + summary.importing > 0 && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          まだ取り込んでいない添付が {summary.pending + summary.importing} 件あります。
          もう一度「取り込む」を押すと続きから処理します。
        </p>
      )}

      {loginNeeded > 0 && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ログインが必要なリンクで届いた請求書が {loginNeeded} 件あります。
          <Link href="/upload/requests" className="ml-1 underline">
            送付依頼
          </Link>{" "}
          のタブから、取引先に「請求書をPDFで送ってください」と依頼してください。
        </p>
      )}

      {/* 返信が来ないまま月末を迎えるのが、この機能でいちばん怖い失敗 */}
      {summary.requestWaiting > 0 && (
        <p
          className={
            requestOverdue > 0
              ? "mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
              : "mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
          }
        >
          送付を依頼して返信待ちの請求書が {summary.requestWaiting} 件あります
          {requestOverdue > 0 && <strong>（うち14日以上が {requestOverdue} 件）</strong>}。
          <Link href="/upload/requests" className="ml-1 underline">
            送付依頼
          </Link>{" "}
          のタブで状況を確認できます。
        </p>
      )}

      {problems > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          PDF以外・開けなかった添付は取り込んでいません。
          Excelなどで届いた請求書があれば、Gmailで確認して「アップロード経由」から入れてください。
          失敗した分は、もう一度「取り込む」を押せば自動で再試行します。
        </p>
      )}
    </section>
  );
}

function Count({
  label,
  value,
  unit,
  strong,
  indent,
  indent2,
  note,
}: {
  label: string;
  value: number;
  unit: string;
  strong?: boolean;
  indent?: boolean;
  indent2?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt
        className={[
          indent2 ? "pl-8" : indent ? "pl-4" : "",
          strong ? "font-medium" : "text-slate-600",
          "w-64 shrink-0",
        ].join(" ")}
      >
        {label}
      </dt>
      <dd className="w-20 text-right tabular-nums">
        <span className={strong ? "font-medium" : undefined}>{value.toLocaleString("ja-JP")}</span> {unit}
      </dd>
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}
