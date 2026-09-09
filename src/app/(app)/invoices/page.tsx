import Link from "next/link";
import type { InvoiceStatus } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { effectiveAmount, formatDate, formatYen, STATUS_LABELS } from "@/lib/invoices";
import { matchVendor } from "@/lib/vendors";
import { toZenginKana } from "@/lib/zengin/kana";
import { InvoiceTable, type InvoiceRow } from "./InvoiceTable";

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

  // 取引先マスタとの照合状態は保存せず毎回突き合わせる。
  // 保存すると、請求書を直したときやマスタを更新したときに実態とずれる。
  const [invoices, vendors] = await Promise.all([
    prisma.invoice.findMany({
      where: active.statuses ? { status: { in: active.statuses } } : undefined,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    }),
    prisma.vendor.findMany(),
  ]);

  const total = invoices.reduce((sum, i) => sum + (effectiveAmount(i) ?? 0), 0);

  // 表示に必要な値はここで組み立てる。半角カナ変換や金額整形はサーバー側に残し、
  // クライアントには選択と一括操作だけを持たせる。
  const rows: InvoiceRow[] = invoices.map((invoice) => {
    const kana = invoice.recipientName ? toZenginKana(invoice.recipientName) : null;
    const match = matchVendor(invoice, vendors);
    return {
      id: invoice.id,
      status: invoice.status,
      vendorLabel: invoice.vendorName ?? invoice.fileName,
      fileName: invoice.fileName,
      bankLine: invoice.bankCode
        ? `${invoice.bankName ?? invoice.bankCode} ${invoice.branchName ?? invoice.branchCode ?? ""}`.trim()
        : null,
      accountNumber: invoice.accountNumber,
      kanaValue: kana?.value ?? null,
      kanaOk: kana?.ok ?? true,
      amountLabel: formatYen(effectiveAmount(invoice)),
      amountChanged: invoice.transferAmount !== null,
      dueDateLabel: formatDate(invoice.dueDate),
      missing:
        !invoice.bankCode ||
        !invoice.branchCode ||
        !invoice.accountNumber ||
        !invoice.accountType ||
        effectiveAmount(invoice) === null,
      hasNote: Boolean(invoice.note),
      vendorState: match.state,
      vendorName: match.vendor?.name ?? null,
      vendorFilledCount: invoice.vendorFilledFields.length,
      mismatchAcked: invoice.accountMismatchAckedAt !== null,
      // bulkSetStatus が対象にするのは NEEDS_REVIEW / APPROVED / EXCLUDED のみ
      selectable: ["NEEDS_REVIEW", "APPROVED", "EXCLUDED"].includes(invoice.status),
    };
  });

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
        <InvoiceTable rows={rows} />
      )}

      <p className="mt-4 text-xs text-slate-500">
        {STATUS_LABELS.NEEDS_REVIEW}の請求書は、内容を確認して承認するまでCSVに出力されません。
        {STATUS_LABELS.NEEDS_REVIEW}・{STATUS_LABELS.APPROVED}・{STATUS_LABELS.EXCLUDED}
        は、チェックを入れて操作すれば行き来できます（承認や除外の取り消し）。
        {STATUS_LABELS.EXPORTED}以降は、銀行へ送ったデータと帳簿がずれるため変更できません。
      </p>
    </div>
  );
}
