"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { abandonGmailScan } from "@/app/actions";
import { buttonClass, ErrorBox, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import { IMPORT_CONCURRENCY } from "@/lib/importConcurrency";
import { mapWithConcurrency } from "@/lib/concurrency";

interface InterruptedScan {
  id: string;
  state: string;
  fromDay: string;
  toDay: string;
  pageCount: number;
  error: string | null;
}

type Phase = "idle" | "scanning" | "importing" | "done" | "error";

interface Pending {
  id: string;
  kind: string;
  /** 進捗に出す名前。添付ならファイル名、リンクなら件名 */
  label: string;
  from: string;
}

/**
 * 走査と取り込みを続けて実行する。
 *
 * 内部では2段階（メールを数え上げる走査 → 候補の取り込み）だが、画面上はボタン1つ。
 *
 * ★取り込みは「1リクエストにつき候補1件」を必ず守る。読み取りに数十秒かかるので、
 * 1リクエストに複数件を詰め込むと実行時間の上限を超え、進捗も分からなくなる。
 * これは守ったうえで、独立したリクエストを数本だけ同時に走らせる。
 * サーバー側から見れば1件ずつの取り込みが数本来ているだけで、
 * 1回の関数実行の長さは変わらない（＝実行時間の上限には影響しない）。
 */
export function GmailPanel({
  defaults,
  suggestedFromPrevious,
  interrupted,
}: {
  defaults: { fromDay: string; toDay: string };
  suggestedFromPrevious: boolean;
  interrupted: InterruptedScan[];
}) {
  const router = useRouter();
  const [fromDay, setFromDay] = useState(defaults.fromDay);
  const [toDay, setToDay] = useState(defaults.toDay);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingTransition, startTransition] = useTransition();

  const running = phase === "scanning" || phase === "importing";

  /** 走査を最後まで回す。done が返るまでカーソルを渡し続ける */
  const runScan = useCallback(
    async (body: Record<string, string>): Promise<string | null> => {
      let scanId: string | null = null;
      let guard = 0;

      for (;;) {
        guard += 1;
        // 万一サーバー側が終わらない状態になっても、ブラウザを固めない
        if (guard > 500) throw new Error("走査が終わりません。時間をおいて再開してください");

        const res = await fetch("/api/gmail/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scanId ? { scanId } : body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "走査に失敗しました");

        scanId = data.scanId as string;
        setProgress(
          `走査中… ${data.pageCount}ページ / ${data.listedMessageCount}通を確認（期間内 ${data.inWindowMessageCount}通）`,
        );

        if (data.state === "FAILED") throw new Error(data.error ?? "走査が中断しました");
        if (data.done) return scanId;
      }
    },
    [],
  );

  /** 未処理の候補を取り込む。1件失敗しても残りは続ける */
  const runImport = useCallback(async (scanId: string) => {
    const res = await fetch(`/api/gmail/pending?scan=${encodeURIComponent(scanId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "取り込み対象を取得できませんでした");

    const pending = (data.items ?? []) as Pending[];
    if (pending.length === 0) {
      setProgress("取り込む候補はありませんでした");
      return;
    }

    let done = 0;
    await mapWithConcurrency(pending, IMPORT_CONCURRENCY, async (item) => {
      try {
        await fetch(`/api/gmail/items/${encodeURIComponent(item.id)}/import`, { method: "POST" });
      } catch {
        // 1件の失敗で残りを止めない。失敗はサーバー側で FAILED として記録され、
        // 未決着のまま画面に残るので取りこぼしにはならない
      }
      // 順不同で終わるので「N件目」ではなく終わった数を出す
      done += 1;
      setProgress(`読み取り中… 完了 ${done} / 全 ${pending.length}件`);
    });

    setProgress(`${pending.length}件の取り込みが終わりました`);
  }, []);

  const start = useCallback(
    async (body: Record<string, string>) => {
      setError(null);
      setPhase("scanning");
      try {
        const scanId = await runScan(body);
        if (!scanId) throw new Error("走査を開始できませんでした");
        setPhase("importing");
        await runImport(scanId);
        setPhase("done");
        router.replace(`/upload?scan=${scanId}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
        setPhase("error");
        router.refresh();
      }
    },
    [router, runImport, runScan],
  );

  function handleAbandon(scanId: string) {
    if (!confirm("この走査を破棄します。破棄してもその期間は未走査のまま残ります。")) return;
    startTransition(async () => {
      await abandonGmailScan(scanId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {interrupted.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">走査が途中で止まっています。</p>
          <ul className="mt-2 space-y-2">
            {interrupted.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {s.fromDay} 〜 {s.toDay}（{s.pageCount}ページまで）
                  {s.error && <span className="ml-1 text-xs">— {s.error}</span>}
                </span>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={running || pendingTransition}
                  onClick={() => void start({ scanId: s.id })}
                >
                  続きから再開
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={running || pendingTransition}
                  onClick={() => handleAbandon(s.id)}
                >
                  破棄
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            この期間はまだ走査済みになっていません。再開するまで走査済み期間の帯に隙間として残ります。
          </p>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">期間を指定して取り込む</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label="開始日（JST）">
              <input
                type="date"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
                disabled={running}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="終了日（この日を含む）">
              <input
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
                disabled={running}
                className={inputClass}
              />
            </Field>
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={running}
            onClick={() => void start({ fromDay, toDay })}
          >
            {running ? "処理中…" : "取り込む"}
          </button>
        </div>

        {suggestedFromPrevious && (
          <p className="mt-2 text-xs text-slate-500">
            前回の走査の続きから、隙間ができないように既定値を入れています。
          </p>
        )}

        {progress && <p className="mt-3 text-sm text-slate-700">{progress}</p>}
        {phase === "done" && !error && (
          <p className="mt-1 text-sm text-emerald-700">
            走査と取り込みが終わりました。下の内訳を確認してください。
          </p>
        )}
        {error && (
          <div className="mt-3">
            <ErrorBox>
              <p>{error}</p>
              <p className="mt-1 text-xs">
                途中までの結果は保存されています。もう一度実行すると続きから再開できます。
              </p>
            </ErrorBox>
          </div>
        )}
      </div>
    </div>
  );
}
