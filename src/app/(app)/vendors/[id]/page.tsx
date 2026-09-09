import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { VendorForm } from "../VendorForm";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { _count: { select: { invoices: true } } },
  });
  if (!vendor) notFound();

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/vendors" className="text-sm text-slate-500 hover:underline">
          ← 取引先一覧へ戻る
        </Link>
      </div>
      <h1 className="text-xl font-semibold">{vendor.name}</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        この取引先で照合済みの請求書 {vendor._count.invoices}件。
        口座を変更すると、以後の請求書はこの内容と突き合わせて確認されます。
      </p>
      <VendorForm vendor={vendor} />
    </div>
  );
}
