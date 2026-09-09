"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteVendor } from "@/app/actions";

/** 一覧の1行。表示に必要な値はサーバー側で組み立て済みのものを受け取る */
export interface VendorRow {
  id: string;
  name: string;
  bankLine: string;
  accountLine: string;
  recipientName: string;
  kanaValue: string;
  kanaOk: boolean;
  invoiceCount: number;
}

export function VendorTable({ rows }: { rows: VendorRow[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(row: VendorRow) {
    const warning =
      row.invoiceCount > 0
        ? `「${row.name}」を削除します。この取引先で照合済みの請求書${row.invoiceCount}件は消えませんが、次回以降の自動補完はされなくなります。`
        : `「${row.name}」を削除します。`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteVendor(row.id);
      setMessage({ ok: result.ok, text: result.message ?? "" });
      router.refresh();
    });
  }

  return (
    <div>
      {message && (
        <p className={message.ok ? "mb-3 text-sm text-emerald-700" : "mb-3 text-sm text-red-700"}>
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">取引先名</th>
              <th className="px-3 py-2 font-medium">金融機関・支店</th>
              <th className="px-3 py-2 font-medium">口座</th>
              <th className="px-3 py-2 font-medium">受取人名（変換後）</th>
              <th className="px-3 py-2 text-right font-medium">請求書</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/vendors/${row.id}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{row.bankLine}</td>
                <td className="tabular px-3 py-2 text-xs whitespace-nowrap">{row.accountLine}</td>
                <td className="tabular px-3 py-2 text-xs">
                  <span className={row.kanaOk ? "" : "text-red-600"}>{row.kanaValue}</span>
                  <div className="text-slate-500">{row.recipientName}</div>
                </td>
                <td className="tabular px-3 py-2 text-right text-xs whitespace-nowrap">
                  {row.invoiceCount}件
                </td>
                <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                  <Link href={`/vendors/${row.id}`} className="text-slate-500 underline hover:text-slate-900">
                    編集
                  </Link>
                  <button
                    type="button"
                    className="ml-3 text-slate-500 underline hover:text-red-700 disabled:opacity-40"
                    disabled={pending}
                    onClick={() => remove(row)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
