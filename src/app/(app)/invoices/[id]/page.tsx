import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { matchVendor, VENDOR_FIELDS, VENDOR_FIELD_LABELS, type VendorField } from "@/lib/vendors";
import { StatusBadge } from "@/components/ui";
import { InvoiceForm } from "./InvoiceForm";
import type { VendorMatchInfo } from "./VendorMatchPanel";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [invoice, vendors] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      // どの実装で読み取ったかを出すため、直近の抽出実行を1件だけ添える
      include: { extractionRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    prisma.vendor.findMany(),
  ]);
  if (!invoice) notFound();

  // ここは口座番号を目視確認して承認する画面。ダミーの読み取り結果を
  // 本物と取り違えないよう、判断の直前で明示する。
  const isStub = invoice.extractionRuns[0]?.model === "stub";

  // 取引先マスタとの照合は保存せずここで取り直す。一覧・承認ガードと必ず同じ判定になる
  const match = matchVendor(invoice, vendors);
  const matchInfo: VendorMatchInfo = {
    state: match.state,
    vendorId: match.vendor?.id ?? null,
    vendorName: match.vendor?.name ?? null,
    mismatches: match.mismatched.map((f) => ({
      label: VENDOR_FIELD_LABELS[f],
      master: match.vendor![f],
      invoice: invoice[f] ?? "",
    })),
    fillableLabels: match.fillable.map((f) => VENDOR_FIELD_LABELS[f]),
    filledLabels: invoice.vendorFilledFields.map(
      (f) => VENDOR_FIELD_LABELS[f as VendorField] ?? f,
    ),
    mismatchAcked: invoice.accountMismatchAckedAt !== null,
    canRegister:
      Boolean(invoice.vendorName?.trim()) &&
      VENDOR_FIELDS.every((f) => Boolean(invoice[f]?.trim())),
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/invoices" className="text-sm text-slate-500 hover:underline">
          ← 一覧へ戻る
        </Link>
        <StatusBadge status={invoice.status} />
        {isStub && (
          <span className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700">
            スタブ読み取り（PDF未読）
          </span>
        )}
        <h1 className="truncate text-sm font-medium">{invoice.fileName}</h1>
      </div>

      {/* 左にPDF、右に抽出値。目を大きく動かさずに突き合わせられるように並置する */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[calc(100vh-12rem)] overflow-hidden rounded border border-slate-200 bg-slate-100">
          <iframe
            src={`/api/invoices/${invoice.id}/file`}
            title={invoice.fileName}
            className="h-full w-full"
          />
        </div>
        <div className="rounded border border-slate-200 bg-white p-5">
          <InvoiceForm invoice={invoice} matchInfo={matchInfo} />
        </div>
      </div>
    </div>
  );
}
