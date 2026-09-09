import Link from "next/link";
import type { InvoiceStatus } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui";
import { effectiveAmount, formatDate, formatYen, STATUS_LABELS } from "@/lib/invoices";
import { toZenginKana } from "@/lib/zengin/kana";

const FILTERS: Array<{ key: string; label: string; statuses?: InvoiceStatus[] }> = [
  { key: "open", label: "未処理", statuses: ["NEEDS_REVIEW", "EXTRACTION_FAILED"] },
  { key: "approved", label: "承認済み", statuses: ["APPROVED"] },
  { key: "excluded", label: "除外", statuses: ["EXCLUDED"] },
  { key: "done", label: "出力・振込済み", statuses: ["EXPORTED", "PAID"] },
  { key: "all", label: "すべて" },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "open" } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const invoices = await prisma.invoice.findMany({
    where: active.statuses ? { status: { in: active.statuses } } : undefined,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  const total = invoices.reduce((sum, i) => sum + (effectiveAmount(i) ?? 0), 0);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">請求書一覧</h1>
          <p className="mt-1 text-sm text-slate-600">
            {invoices.length}件 / 合計 {formatYen(total)}
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          請求書を取り込む
        </Link>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/invoices?filter=${f.key}`}
            className={
              f.key === active.key
                ? "-mb-px border-b-2 border-slate-900 px-3 py-2 text-sm font-medium"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          {active.label}の請求書はありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <tr>
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
              {invoices.map((invoice) => {
                const kana = invoice.recipientName ? toZenginKana(invoice.recipientName) : null;
                const missing =
                  !invoice.bankCode ||
                  !invoice.branchCode ||
                  !invoice.accountNumber ||
                  !invoice.accountType ||
                  effectiveAmount(invoice) === null;

                return (
                  <tr key={invoice.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                        {invoice.vendorName ?? invoice.fileName}
                      </Link>
                      <div className="text-xs text-slate-500">{invoice.fileName}</div>
                    </td>
                    <td className="tabular px-3 py-2 text-xs whitespace-nowrap">
                      {invoice.bankCode ? (
                        <>
                          {invoice.bankName ?? invoice.bankCode} {invoice.branchName ?? invoice.branchCode}
                          <div>{invoice.accountNumber}</div>
                        </>
                      ) : (
                        <span className="text-red-600">未取得</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-xs">
                      {kana ? (
                        <span className={kana.ok ? "" : "text-red-600"}>{kana.value}</span>
                      ) : (
                        <span className="text-red-600">未取得</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                      {formatYen(effectiveAmount(invoice))}
                      {invoice.transferAmount !== null && (
                        <div className="text-xs text-amber-700">請求額から変更</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(invoice.dueDate)}</td>
                    <td className="px-3 py-2 text-xs">
                      {invoice.status === "EXTRACTION_FAILED" && (
                        <span className="text-red-600">読み取り失敗</span>
                      )}
                      {invoice.status !== "EXTRACTION_FAILED" && missing && (
                        <span className="text-red-600">項目不足</span>
                      )}
                      {kana && !kana.ok && <span className="text-red-600">カナ変換不可</span>}
                      {invoice.note && <span className="text-amber-700">要確認メモあり</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        {STATUS_LABELS.NEEDS_REVIEW}の請求書は、内容を確認して承認するまでCSVに出力されません。
      </p>
    </div>
  );
}
