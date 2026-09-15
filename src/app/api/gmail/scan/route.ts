import { z } from "zod";
import { auth } from "@/auth";
import { clampScanWindow, jstDayRangeToInstants } from "@/lib/gmail/query";
import { runScanChunk, startScan } from "@/lib/gmail/scan";
import { GmailNotConnectedError } from "@/lib/gmail/types";

// 走査はページングを繰り返すので時間がかかる。1チャンクは55秒で切り上げる
export const maxDuration = 300;

const BodySchema = z.union([
  // 新しい走査を始める（JSTの日付）
  z.object({
    fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  // 途中の走査を続ける
  z.object({ scanId: z.string().min(1) }),
]);

/**
 * 走査を1チャンク進める。
 *
 * ブラウザは done:true が返るまでこのエンドポイントを呼び続ける。
 * 途中で閉じてもカーソルはDBに残るので、あとから続きを再開できる。
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  try {
    let scanId: string;
    if ("scanId" in parsed.data) {
      scanId = parsed.data.scanId;
    } else {
      const { from, to } = jstDayRangeToInstants(parsed.data.fromDay, parsed.data.toDay);

      // 上限を「今」より手前に切り詰める。切り詰めないと、走査したあとに届いたメールが
      // 「走査済みの期間」に入ったまま読まれず、次回の走査が飛ばしてしまう
      const window = clampScanWindow(from, to, new Date());
      if (!window) {
        return Response.json(
          {
            error:
              "指定された期間には、まだ走査できるメールがありません。直近10分以内に届いたメールは、Gmailの検索に反映されてから取り込みます",
          },
          { status: 400 },
        );
      }

      const scan = await startScan({ ...window, startedByEmail: email });
      scanId = scan.id;
    }

    return Response.json(await runScanChunk(scanId));
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RangeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "走査に失敗しました";
    return Response.json({ error: message }, { status: 500 });
  }
}
