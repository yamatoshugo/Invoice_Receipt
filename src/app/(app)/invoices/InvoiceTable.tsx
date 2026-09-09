"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/generated/prisma";
import { bulkSetStatus } from "@/app/actions";
import { StatusBadge, buttonClass, secondaryButtonClass } from "@/components/ui";

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
  /** 一括操作の対象にできるか。出力済み・読み取り失敗は対象外 */
  selectable: boolean;
}

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectableIds = useMemo(() => rows.filter((r) => r.selectable).map((r) => r.id), [rows]);
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected],
  );
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  function apply(status: "APPROVED" | "EXCLUDED") {
    const ids = selectedIds;
    if (ids.length === 0) return;
    if (
      status === "APPROVED" &&
      !window.confirm(`${ids.length}件を承認します。承認した請求書はCSVの出力対象になります。`)
    ) {
      return;
    }

    startTransition(async () => {
      const result = await bulkSetStatus(ids, status);
      setMessage({ ok: result.ok, text: result.message ?? "" });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div>
      {(selectedIds.length > 0 || message) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3">
          {selectedIds.length > 0 ? (
            <>
              <span className="text-sm font-medium">{selectedIds.length}件を選択中</span>
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
              <button
                type="button"
                className="text-sm text-slate-500 underline hover:text-slate-900"
                onClick={() => setSelected(new Set())}
              >
                選択を解除
              </button>
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
                  disabled={selectableIds.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 font-medium">状態</th>
              <th className="px-3 py-2 font-medium">取引先</th>
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
                    // 出力済み・振込済み・読み取り失敗は一括操作の対象外。
                    // 選ばせてから黙って件数が減るより、最初から選べないほうが分かりやすい。
                    disabled={!row.selectable || pending}
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
