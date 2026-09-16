import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { markBatchPaidForm } from "@/app/actions";
import { buttonClass, ErrorBox, inputClass, secondaryButtonClass, Warning } from "@/components/ui";
import { buildExportCsv, findPossibleDuplicates } from "@/lib/export";
import { effectiveAmount, formatDate, formatYen, parseIsoDate } from "@/lib/invoices";
import { nextBankBusinessDay } from "@/lib/zengin/businessDay";

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { date, error } = await searchParams;

  const defaultDate = nextBankBusinessDay(new Date());
  const transferDate = parseIsoDate(date ?? "") ?? defaultDate;

  const [setting, invoices, batches] = await Promise.all([
    prisma.setting.findUnique({ where: { id: "default" } }),
    prisma.invoice.findMany({ where: { status: "APPROVED" }, orderBy: { createdAt: "asc" } }),
    // CSVの実体(csvBase64)は引かない。この画面は一覧を出すだけで、
    // 中身が要るのはダウンロード時（/api/export/[batchId]）だけ
    prisma.exportBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        transferDate: true,
        fileName: true,
        recordCount: true,
        totalAmount: true,
        isPaid: true,
        paidAt: true,
      },
    }),
  ]);

  const result = setting ? buildExportCsv(setting, transferDate, invoices) : null;
  const duplicates = findPossibleDuplicates(invoices);
  const total = invoices.reduce((sum, i) => sum + (effectiveAmount(i) ?? 0), 0);

  // 検証エラーを請求書ごとにまとめて、どの行を直せばよいか分かるようにする
  const errorsByInvoice = new Map<string, string[]>();
  const globalErrors: string[] = [];
  for (const e of result && !result.ok ? result.errors : []) {
    if (e.recordId) {
      errorsByInvoice.set(e.recordId, [...(errorsByInvoice.get(e.recordId) ?? []), e.message]);
    } else {
      globalErrors.push(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">総合振込CSVの出力</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        承認済みの請求書からドコモSMTBネット銀行の総合振込CSV（Shift_JIS）を作成します。
      </p>

      {error === "settings" && <ErrorBox>先に「設定」で振込依頼人の情報を登録してください。</ErrorBox>}
      {error === "validation" && <ErrorBox>検証エラーが残っているため出力できませんでした。</ErrorBox>}
      {error === "date" && <ErrorBox>取組日を指定してください。</ErrorBox>}
      {error === "conflict" && (
        <ErrorBox>
          出力中に対象の請求書が別の操作で変更されたため、中断しました。内容を確認してやり直してください。
        </ErrorBox>
      )}
      {error === "unknown" && <ErrorBox>出力に失敗しました。時間をおいて再実行してください。</ErrorBox>}

      {!setting && (
        <div className="mt-4">
          <Warning>
            振込依頼人の情報が未登録です。
            <Link href="/settings" className="ml-1 underline">
              設定画面
            </Link>
            で銀行から取得した振込依頼人コード・依頼人名・口座情報を登録してください。
          </Warning>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <form method="get" className="rounded border border-slate-200 bg-white p-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">取組日（銀行営業日）</label>
            <input type="date" name="date" defaultValue={toDateInput(transferDate)} className={inputClass} />
            <button type="submit" className={`${secondaryButtonClass} mt-3 w-full`}>
              この日付で検証する
            </button>
            <p className="mt-2 text-xs text-slate-500">
              土日・祝日・年末年始は指定できません。既定は次の営業日（{formatDate(defaultDate)}）です。
            </p>
          </form>

          <div className="rounded border border-slate-200 bg-white p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">対象件数</span>
              <span className="tabular font-medium">{invoices.length}件</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-slate-600">合計金額</span>
              <span className="tabular font-medium">{formatYen(total)}</span>
            </div>
          </div>

          <form method="post" action="/api/export">
            <input type="hidden" name="transferDate" value={toDateInput(transferDate)} />
            <button type="submit" className={`${buttonClass} w-full`} disabled={!result?.ok}>
              CSVをダウンロード
            </button>
          </form>
          {result?.ok ? (
            <p className="text-xs text-slate-500">
              ダウンロードすると対象の請求書は「CSV出力済み」になり、次回のバッチには含まれません。
            </p>
          ) : (
            <p className="text-xs text-red-600">
              検証エラーがあるためダウンロードできません。右の一覧から該当の請求書を修正してください。
            </p>
          )}
        </div>

        <div className="space-y-4">
          {globalErrors.length > 0 && (
            <ErrorBox>
              <ul className="list-inside list-disc">
                {globalErrors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </ErrorBox>
          )}

          {result?.ok && result.warnings.length > 0 && (
            <Warning>
              <ul className="list-inside list-disc">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Warning>
          )}

          {duplicates.length > 0 && (
            <Warning>
              同じ口座・同じ金額の振込が複数含まれています。二重振込でないか確認してください。
              <ul className="mt-1 list-inside list-disc">
                {duplicates.map((g) => (
                  <li key={g.key}>
                    {g.invoices.map((i) => i.vendorName ?? i.fileName).join(" / ")}（
                    {formatYen(effectiveAmount(g.invoices[0]))}）
                  </li>
                ))}
              </ul>
            </Warning>
          )}

          {invoices.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              承認済みの請求書がありません。
              <Link href="/invoices" className="ml-1 underline">
                一覧
              </Link>
              で内容を確認して承認してください。
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">取引先</th>
                    <th className="px-3 py-2 font-medium">振込先</th>
                    <th className="px-3 py-2 text-right font-medium">金額</th>
                    <th className="px-3 py-2 font-medium">検証</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const errs = errorsByInvoice.get(invoice.id) ?? [];
                    return (
                      <tr key={invoice.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2">
                          <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                            {invoice.vendorName ?? invoice.fileName}
                          </Link>
                        </td>
                        <td className="tabular px-3 py-2 text-xs whitespace-nowrap">
                          {invoice.bankCode}-{invoice.branchCode} {invoice.accountNumber}
                        </td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                          {formatYen(effectiveAmount(invoice))}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {errs.length === 0 ? (
                            <span className="text-emerald-700">OK</span>
                          ) : (
                            <ul className="list-inside list-disc text-red-700">
                              {errs.map((m) => (
                                <li key={m}>{m}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {batches.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">出力履歴</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">取組日</th>
                  <th className="px-3 py-2 font-medium">ファイル名</th>
                  <th className="px-3 py-2 text-right font-medium">件数</th>
                  <th className="px-3 py-2 text-right font-medium">合計金額</th>
                  <th className="px-3 py-2 font-medium">状態</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(batch.transferDate)}</td>
                    <td className="tabular px-3 py-2 text-xs">{batch.fileName}</td>
                    <td className="tabular px-3 py-2 text-right">{batch.recordCount}</td>
                    <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                      {formatYen(batch.totalAmount)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {batch.isPaid ? (
                        <span className="text-slate-600">振込済み {formatDate(batch.paidAt)}</span>
                      ) : (
                        <span className="text-amber-700">未振込</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <a
                          href={`/api/export/${batch.id}`}
                          className="text-xs whitespace-nowrap text-slate-500 underline hover:text-slate-900"
                        >
                          再ダウンロード
                        </a>
                        {!batch.isPaid && (
                          <form action={markBatchPaidForm}>
                            <input type="hidden" name="batchId" value={batch.id} />
                            <button
                              type="submit"
                              className="text-xs whitespace-nowrap text-slate-500 underline hover:text-slate-900"
                            >
                              振込済みにする
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
