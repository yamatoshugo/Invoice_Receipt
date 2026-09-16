import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { staleImportingBefore } from "@/lib/gmail/status";

/** 自動で再試行する上限。これを超えた失敗は、人が見るまで再試行しない */
const MAX_AUTO_ATTEMPTS = 5;

/**
 * 走査した期間のうち、まだ取り込んでいない候補を返す。
 *
 * ブラウザはこの一覧を1件ずつ /api/gmail/items/[id]/import に投げる。
 * 走査IDではなく期間で引くのは、再走査では既存の行に走査IDを付け替えないため
 * （走査IDで引くと、前回の走査で見つかった未処理を取りこぼす）。
 *
 * 前回失敗した分(FAILED)も対象にする。一時的な通信エラーで落ちたものを、
 * もう一度ボタンを押すだけで拾い直せるようにするため
 * （個別に再試行する画面は持たない方針）。
 * PDF以外・開けない・サイズ超過は、何度試しても結果が変わらないので対象にしない。
 *
 * 取り残された IMPORTING も対象にする。実行時間の上限で打ち切られると
 * IMPORTING のまま残り、放っておくと二度と拾い直されないため。
 * ★占有側(items/[id]/import)と同じ基準を使うこと。片方だけだと
 * 「一覧には出るのに押しても何も起きない」になる。
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const scanId = new URL(request.url).searchParams.get("scan");
  if (!scanId) return Response.json({ error: "走査が指定されていません" }, { status: 400 });

  const scan = await prisma.gmailScan.findUnique({ where: { id: scanId } });
  if (!scan) return Response.json({ error: "走査が見つかりません" }, { status: 404 });

  const items = await prisma.gmailItem.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        // 何度叩いても結果が変わらない相手（消えたURL等）を毎回試し直さない。
        // 上限に達した行は再試行されなくなるだけで、FAILED のまま未決着として画面に残る
        { status: "FAILED", attemptCount: { lt: MAX_AUTO_ATTEMPTS } },
        // 取り残された取り込み。いま走っている最中のものを横取りしないよう、
        // 占有した時刻が十分に古いものだけを対象にする
        {
          status: "IMPORTING",
          attemptCount: { lt: MAX_AUTO_ATTEMPTS },
          lastAttemptAt: { lt: staleImportingBefore() },
        },
      ],
      message: { internalDate: { gte: scan.windowFrom, lt: scan.windowTo } },
    },
    include: { message: { select: { fromAddress: true, internalDate: true, subject: true } } },
    // 添付を先に処理する。リンクはLLMの判定と外部への取得が挟まって時間がかかる
    orderBy: [{ kind: "asc" }, { message: { internalDate: "asc" } }, { ref: "asc" }],
  });

  return Response.json({
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      // 進捗表示に出す名前。リンクにはファイル名が無いので件名を使う
      label:
        i.kind === "LINK"
          ? `本文のリンク（${i.message.subject ?? "件名なし"}）`
          : (i.fileName ?? "(名前なし)"),
      from: i.message.fromAddress ?? "",
    })),
  });
}
