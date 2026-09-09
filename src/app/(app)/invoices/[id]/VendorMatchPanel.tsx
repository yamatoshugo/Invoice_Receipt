"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  acknowledgeAccountMismatch,
  applyVendorToInvoice,
  registerVendorFromInvoice,
  updateVendorFromInvoice,
} from "@/app/actions";
import type { VendorMatchState } from "@/lib/vendors";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

export interface VendorMatchInfo {
  state: VendorMatchState;
  vendorId: string | null;
  vendorName: string | null;
  /** 食い違っている項目。マスタと請求書の値を並べて見せる */
  mismatches: Array<{ label: string; master: string; invoice: string }>;
  /** マスタから埋められる項目名（まだ埋めていないもの） */
  fillableLabels: string[];
  /** 取り込み時にマスタから補完した項目名 */
  filledLabels: string[];
  mismatchAcked: boolean;
  /** 口座項目が揃っていて、マスタに登録できる状態か */
  canRegister: boolean;
}

/**
 * 取引先マスタとの照合結果を、承認の判断の直前に見せる。
 *
 * 口座相違は「振込先が変わっている」ということなので、
 * 人がどちらかを選ぶまで承認できない状態にしてある（承認の拒否は Server Action 側）。
 */
export function VendorMatchPanel({
  invoiceId,
  info,
  locked,
}: {
  invoiceId: string;
  info: VendorMatchInfo;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message ?? "" });
      if (result.ok) router.refresh();
    });
  }

  const result = message && (
    <p className={message.ok ? "mt-2 text-xs text-emerald-700" : "mt-2 text-xs text-red-700"}>
      {message.text}
    </p>
  );

  if (info.state === "account_mismatch") {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-medium">
          取引先マスタ「{info.vendorName}」と口座情報が異なります。
        </p>
        <p className="mt-1 text-xs">
          振込先の変更を装った詐欺の可能性があります。取引先へ電話などで確認してから進めてください。
        </p>
        <table className="mt-2 text-xs">
          <tbody>
            {info.mismatches.map((m) => (
              <tr key={m.label}>
                <td className="py-0.5 pr-3 text-red-700">{m.label}</td>
                <td className="tabular py-0.5 pr-3">マスタ: {m.master}</td>
                <td className="tabular py-0.5">請求書: {m.invoice || "（空欄）"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {info.mismatchAcked ? (
          <p className="mt-2 text-xs">この口座で振り込むと確認済みです。承認できます。</p>
        ) : (
          !locked && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={pending}
                onClick={() =>
                  run(
                    () => updateVendorFromInvoice(invoiceId),
                    "取引先マスタの口座情報を、この請求書の内容に更新します。正当な口座変更であることを確認しましたか？",
                  )
                }
              >
                マスタを更新する
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={pending}
                onClick={() =>
                  run(
                    () => acknowledgeAccountMismatch(invoiceId),
                    "マスタは変えずに、今回だけこの口座へ振り込みます。よろしいですか？",
                  )
                }
              >
                今回はこの口座で振り込む
              </button>
              <Link
                href={info.vendorId ? `/vendors/${info.vendorId}` : "/vendors"}
                className="text-xs text-red-700 underline"
              >
                マスタを見る
              </Link>
            </div>
          )
        )}
        {result}
      </div>
    );
  }

  if (info.state === "none") {
    return (
      <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
        <p>この取引先はまだ登録されていません。</p>
        {!locked &&
          (info.canRegister ? (
            <>
              <p className="mt-1 text-xs">
                登録しておくと、次回から金融機関コードや支店番号が自動で埋まります。
              </p>
              <button
                type="button"
                className={`${buttonClass} mt-2`}
                disabled={pending}
                onClick={() => run(() => registerVendorFromInvoice(invoiceId))}
              >
                この内容で取引先を登録
              </button>
            </>
          ) : (
            <p className="mt-1 text-xs">
              金融機関コード・支店番号などを埋めて保存すると、ここから取引先マスタに登録できます。
            </p>
          ))}
        {result}
      </div>
    );
  }

  // matched / name_mismatch
  const isNameMismatch = info.state === "name_mismatch";
  return (
    <div
      className={
        isNameMismatch
          ? "rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          : "rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
      }
    >
      <p>
        {isNameMismatch ? (
          <>
            口座は取引先マスタ「{info.vendorName}」と一致しますが、
            <span className="font-medium">取引先名の表記が異なります。</span>
            改称や表記変更でなければ確認してください。
          </>
        ) : (
          <>
            取引先マスタ「{info.vendorName}」と一致しています。
          </>
        )}
      </p>
      {info.filledLabels.length > 0 && (
        <p className="mt-1 text-xs">
          取り込み時に {info.filledLabels.join("・")} をマスタから補完しました。
        </p>
      )}
      {!locked && info.fillableLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">
            未入力の {info.fillableLabels.join("・")} をマスタから埋められます。
          </span>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={pending}
            onClick={() => run(() => applyVendorToInvoice(invoiceId))}
          >
            マスタから補完する
          </button>
        </div>
      )}
      <Link
        href={info.vendorId ? `/vendors/${info.vendorId}` : "/vendors"}
        className="mt-2 inline-block text-xs underline"
      >
        マスタを見る
      </Link>
      {result}
    </div>
  );
}
