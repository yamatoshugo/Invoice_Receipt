import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui";
import { InvoiceForm } from "./InvoiceForm";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) notFound();

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/invoices" className="text-sm text-slate-500 hover:underline">
          ← 一覧へ戻る
        </Link>
        <StatusBadge status={invoice.status} />
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
          <InvoiceForm invoice={invoice} />
        </div>
      </div>
    </div>
  );
}
