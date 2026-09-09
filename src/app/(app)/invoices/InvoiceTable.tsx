"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/generated/prisma";
import { bulkSetStatus, deleteInvoices } from "@/app/actions";
import { formatYen } from "@/lib/invoices";
import type { VendorMatchState } from "@/lib/vendors";
import {
  StatusBadge,
  buttonClass,
  dangerButtonClass,
  secondaryButtonClass,
} from "@/components/ui";

/** 一覧の1行。表示に必要な値はサーバー側で組み立て済みのものを受け取る */
export interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
  vendorLabel: string;
  fileName: string;
  bankLine: string | null;
  accountNumber: string | null;
  kanaValue: string | null;
  kanaOk: boolean;
  amountLabel: string;
  amountChanged: boolean;
  dueDateLabel: string;
  missing: boolean;
  hasNote: boolean;
  /** 取引先マスタとの照合結果 */
  vendorState: VendorMatchState;
  vendorName: string | null;
  vendorFilledCount: number;
  /** 口座相違を「この口座で振り込む」と確認済みか */
  mismatchAcked: boolean;
  /** 削除の確認に出す金額 */
  amount: number | null;
  /** 状態を動かせるか（未処理・承認済み・除外のみ）。削除は状態によらずできる */
  changeable: boolean;
}

const VENDOR_STATE_STYLES: Record<VendorMatchState, { label: string; className: string }> = {
  matched: { label: "一致", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  account_mismatch: { label: "口座相違", className: "bg-red-50 text-red-700 border-red-300" },
  name_mismatch: { label: "名称相違", className: "bg-amber-50 text-amber-800 border-amber-300" },
  none: { label: "新規", className: "bg-slate-50 text-slate-600 border-slate-200" },
};

/** 取引先マスタと突き合わせた結果。補完されたのか新規なのかを一覧で分かるようにする */
function VendorMatchCell({ row }: { row: InvoiceRow }) {
  const style = VENDOR_STATE_STYLES[row.vendorState];
  return (
    <div className="text-xs">
      <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${style.className}`}>
        {style.label}
      </span>
      {row.vendorName && <div className="mt-0.5 truncate text-slate-500">{row.vendorName}</div>}
      {row.vendorFilledCount > 0 && (
        <div className="text-slate-500">{row.vendorFilledCount}項目を補完</div>
      )}
      {row.vendorState === "account_mismatch" && row.mismatchAcked && (
        <div className="text-slate-500">確認済み</div>
      )}
    </div>
  );
}

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectedIds = useMemo(() => selectedRows.map((r) => r.id), [selectedRows]);
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;
  // 状態変更は未処理・承認済み・除外にしか効かない。選ばせてから黙って
  // 件数が減らないよう、対象がゼロならボタン自体を出さない。
  const changeableIds = useMemo(
    () => selectedRows.filter((r) => r.changeable).map((r) => r.id),
    [selectedRows],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message ?? "" });
      setSelected(new Set());
      router.refresh();
    });
  }

  function apply(status: "APPROVED" | "EXCLUDED" | "NEEDS_REVIEW") {
    const ids = changeableIds;
    if (ids.length === 0) return;
    if (
      status === "APPROVED" &&
      !window.confirm(`${ids.length}件を承認します。承認した請求書はCSVの出力対象になります。`)
    ) {
      return;
    }
    run(() => bulkSetStatus(ids, status));
  }

  function remove() {
    if (selectedRows.length === 0) return;
    const total = selectedRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const exported = selectedRows.filter((r) => !r.changeable).length;

    let text = `${selectedRows.length}件を削除します（合計 ${formatYen(total)}）。\n\n一覧から消え、同じPDFを取り込み直せるようになります。この操作は取り消せません。`;
    if (exported > 0) {
      // 出力済みを消して取り込み直すと二重取込の防止が効かなくなるため、
      // ここだけは何が起きるかを具体的に書く
      text += `\n\nうち${exported}件はCSV出力済みです。銀行での振込が完了しているものを削除して取り込み直すと、二重振込になる恐れがあります。\n（CSVの出力履歴とファイルは残ります）`;
    }
    if (!window.confirm(text)) return;
    run(() => deleteInvoices(selectedIds));
  }

  return (
    <div>
      {(selectedIds.length > 0 || message) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3">
          {selectedIds.length > 0 ? (
            <>
              <span className="text-sm font-medium">{selectedIds.length}件を選択中</span>
              {changeableIds.length > 0 && (
                <>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={pending}
                    onClick={() => apply("APPROVED")}
                  >
                    {pending ? "処理中…" : "選択した請求書を承認"}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={pending}
                    onClick={() => apply("EXCLUDED")}
                  >
                    今回は振り込まない
                  </button>
                  {/* 承認・除外の取り消し。承認済み／除外のタブから未処理へ戻せる */}
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={pending}
                    onClick={() => apply("NEEDS_REVIEW")}
                  >
                    未処理に戻す
                  </button>
                </>
              )}
              <button type="button" className={dangerButtonClass} disabled={pending} onClick={remove}>
                削除
              </button>
              <button
                type="button"
                className="text-sm text-slate-500 underline hover:text-slate-900"
                onClick={() => setSelected(new Set())}
              >
                選択を解除
              </button>
              {changeableIds.length < selectedIds.length && (
                <span className="w-full text-xs text-slate-500">
                  選択のうち{selectedIds.length - changeableIds.length}
                  件はCSV出力済みのため、状態は変更できません（削除はできます）。
                </span>
              )}
            </>
          ) : (
            message && (
              <span className={message.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
                {message.text}
              </span>
            )
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  className="h-4 w-4 align-middle"
                  checked={allSelected}
                  disabled={allIds.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 font-medium">状態</th>
              <th className="px-3 py-2 font-medium">取引先</th>
              <th className="px-3 py-2 font-medium">取引先マスタ</th>
              <th className="px-3 py-2 font-medium">振込先</th>
              <th className="px-3 py-2 font-medium">受取人名（変換後）</th>
              <th className="px-3 py-2 text-right font-medium">振込額</th>
              <th className="px-3 py-2 font-medium">支払期日</th>
              <th className="px-3 py-2 font-medium">確認</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${row.vendorLabel} を選択`}
                    className="h-4 w-4 align-middle"
                    checked={selected.has(row.id)}
                    disabled={pending}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/invoices/${row.id}`} className="font-medium hover:underline">
                    {row.vendorLabel}
                  </Link>
                  <div className="text-xs text-slate-500">{row.fileName}</div>
                </td>
                <td className="max-w-40 px-3 py-2">
                  <VendorMatchCell row={row} />
                </td>
                <td className="tabular px-3 py-2 text-xs whitespace-nowrap">
                  {row.bankLine ? (
                    <>
                      {row.bankLine}
                      <div>{row.accountNumber}</div>
                    </>
                  ) : (
                    <span className="text-red-600">未取得</span>
                  )}
                </td>
                <td className="tabular px-3 py-2 text-xs">
                  {row.kanaValue ? (
                    <span className={row.kanaOk ? "" : "text-red-600"}>{row.kanaValue}</span>
                  ) : (
                    <span className="text-red-600">未取得</span>
                  )}
                </td>
                <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                  {row.amountLabel}
                  {row.amountChanged && <div className="text-xs text-amber-700">請求額から変更</div>}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{row.dueDateLabel}</td>
                <td className="px-3 py-2 text-xs">
                  {row.status === "EXTRACTION_FAILED" && (
                    <span className="text-red-600">読み取り失敗</span>
                  )}
                  {row.status !== "EXTRACTION_FAILED" && row.missing && (
                    <span className="text-red-600">項目不足</span>
                  )}
                  {row.kanaValue && !row.kanaOk && <span className="text-red-600">カナ変換不可</span>}
                  {row.hasNote && <span className="text-amber-700">要確認メモあり</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
