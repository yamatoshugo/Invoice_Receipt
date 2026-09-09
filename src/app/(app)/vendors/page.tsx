import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_TYPE_LABELS } from "@/lib/invoices";
import { toZenginKana } from "@/lib/zengin/kana";
import { VendorTable, type VendorRow } from "./VendorTable";

export default async function VendorsPage() {
  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  const rows: VendorRow[] = vendors.map((v) => {
    const kana = toZenginKana(v.recipientName);
    return {
      id: v.id,
      name: v.name,
      bankLine: `${v.bankName}（${v.bankCode}） ${v.branchName}（${v.branchCode}）`,
      accountLine: `${ACCOUNT_TYPE_LABELS[v.accountType as keyof typeof ACCOUNT_TYPE_LABELS] ?? v.accountType} ${v.accountNumber}`,
      recipientName: v.recipientName,
      kanaValue: kana.value,
      kanaOk: kana.ok,
      invoiceCount: v._count.invoices,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">取引先</h1>
          <p className="mt-1 text-sm text-slate-600">
            一度確認した振込先をここに登録しておくと、次回以降の請求書で
            金融機関コードや支店番号が自動で埋まります。{vendors.length}件
          </p>
        </div>
        <Link
          href="/vendors/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium whitespace-nowrap text-white hover:bg-slate-700"
        >
          取引先を登録
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          まだ登録がありません。請求書の明細画面で口座を確認したあと、
          「この内容で取引先を登録」から追加するのが簡単です。
        </p>
      ) : (
        <VendorTable rows={rows} />
      )}

      <p className="mt-4 text-xs text-slate-500">
        登録した口座と請求書の口座が食い違うと、請求書一覧に「口座相違」と表示され承認できなくなります。
        振込先の変更を装った詐欺を防ぐためです。
      </p>
    </div>
  );
}
