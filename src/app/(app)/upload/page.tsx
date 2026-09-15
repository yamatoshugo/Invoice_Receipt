import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { connectionState } from "@/lib/gmail/connection";
import { findGaps, mergeCoveredRanges, nextScanWindow } from "@/lib/gmail/coverage";
import { toJstDay } from "@/lib/gmail/query";
import { itemsForSummary } from "@/lib/gmail/requests";
import { summarizeItems } from "@/lib/gmail/status";
import { buttonClass, Warning } from "@/components/ui";
import { GmailPanel } from "./GmailPanel";
import { CoverageBar } from "./CoverageBar";
import { ScanSummary } from "./ScanSummary";

export default async function UploadMailPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>;
}) {
  const [connection, params] = await Promise.all([connectionState(), searchParams]);

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

  const scans = await prisma.gmailScan.findMany({ orderBy: { startedAt: "desc" }, take: 200 });

  // 走査した期間は、完了した走査の記録から毎回導出する。
  // 「前回どこまで見たか」をポインタで持つと必ずどこかでずれ、ずれた分が抜け洩れになる。
  const covered = mergeCoveredRanges(scans);
  const now = new Date();

  const selected = params.scan
    ? (scans.find((s) => s.id === params.scan) ?? null)
    : (scans.find((s) => s.state === "COMPLETED") ?? scans[0] ?? null);

  // 集計は、選んだ走査の「期間」で引く。
  // 再走査では既存の行に走査IDを付け替えないので、走査IDで引くと取りこぼす。
  const inWindow = selected
    ? { internalDate: { gte: selected.windowFrom, lt: selected.windowTo } }
    : null;

  const [summaryInput, messagesInWindow, messagesWithAttachments, linksUnscanned] = inWindow
    ? await Promise.all([
        // 依頼メールの返信が来たかを含めて集計する。
        // 接続中のアドレスを渡すのは、自分の送信控えを「返信」と数えないため
        itemsForSummary(inWindow, connection.emailAddress, now),
        prisma.gmailMessage.count({ where: inWindow }),
        prisma.gmailMessage.count({ where: { ...inWindow, attachmentCount: { gt: 0 } } }),
        // 本文のリンクをまだ調べていないメール。
        // この機能を足した直後は、過去に走査したメールが全部ここに出る。
        // 同じ期間をもう一度走査すれば埋まる（遡って書き換える作業は要らない）
        prisma.gmailMessage.count({ where: { ...inWindow, linksScannedAt: null } }),
      ])
    : [{ items: [], requestOverdue: 0 }, 0, 0, 0];

  // 走査が途中で止まっているもの。完了と混同させない
  const interrupted = scans.filter((s) => s.state === "RUNNING" || s.state === "FAILED");

  const suggested = nextScanWindow(covered, now);
  const defaults = suggested
    ? { fromDay: toJstDay(suggested.from), toDay: toJstDay(suggested.to) }
    : defaultLastMonth(now);

  // 帯の右端は「走査済みの右端」にする。
  // 「今」にすると、走査上限を常に10分手前で止めている分が永久に隙間として残り、
  // 走ったのに「未走査の期間があります」と出てしまう。
  // ここを走査済みの右端にすると、残る隙間は「走査済み期間の内側の本物の穴」だけになる。
  const overall =
    covered.length > 0 ? { from: covered[0]!.from, to: covered[covered.length - 1]!.to } : null;
  const gaps = overall ? findGaps(covered, overall) : [];

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-slate-600">
        請求書受け取り専用のGmail（
        <span className="font-medium">{connection.emailAddress}</span>）に届いた、
        <strong className="text-slate-900">PDFが直接添付されたメール</strong>
        と、<strong className="text-slate-900">本文のリンクで届いた請求書</strong>
        を、期間を指定してまとめて取り込みます。
        リンクは中身を見てPDFなら取り込み、ログインが必要なものは取引先への依頼待ちとして残します。
      </p>

      {connection.status === "revoked" && (
        <Warning>
          <p className="font-medium">Gmail連携が切れています（{connection.emailAddress}）</p>
          <p className="mt-1">{connection.message}</p>
          <Link href="/settings#gmail" className="mt-2 inline-block underline">
            設定画面から再接続する
          </Link>
        </Warning>
      )}

      {overall && <CoverageBar covered={covered} gaps={gaps} overall={overall} />}

      {/* 広い画面では、取り込みの操作と結果の件数を横に並べる
          （縦積みだと、押した結果を見るのに毎回スクロールが要る） */}
      <div className="grid items-start gap-8 xl:grid-cols-2">
        <GmailPanel
          defaults={defaults}
          suggestedFromPrevious={suggested !== null}
          interrupted={interrupted.map((s) => ({
            id: s.id,
            state: s.state,
            fromDay: toJstDay(s.windowFrom),
            toDay: toJstDay(s.windowTo),
            pageCount: s.pageCount,
            error: s.error,
          }))}
        />

        {selected && (
          <ScanSummary
            scan={{
              state: selected.state,
              query: selected.query,
              fromLabel: selected.windowFrom.toLocaleString("ja-JP"),
              toLabel: selected.windowTo.toLocaleString("ja-JP"),
              listedMessageCount: selected.listedMessageCount,
              inWindowThreadCount: selected.inWindowThreadCount,
            }}
            messagesInWindow={messagesInWindow}
            messagesWithAttachments={messagesWithAttachments}
            linksUnscanned={linksUnscanned}
            summary={summarizeItems(summaryInput.items)}
            requestOverdue={summaryInput.requestOverdue}
          />
        )}
      </div>
    </div>
  );
}

/** 走査がまだ1件も無いときの既定値。先月1か月分 */
function defaultLastMonth(now: Date): { fromDay: string; toDay: string } {
  const start = new Date(now.getTime());
  start.setMonth(start.getMonth() - 1);
  return { fromDay: toJstDay(start), toDay: toJstDay(now) };
}
