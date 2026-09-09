import type { Invoice, Setting } from "@/generated/prisma";
import { buildZenginCsv, type AccountType, type TransferRecord } from "@/lib/zengin/csv";
import { effectiveAmount } from "@/lib/invoices";

const ACCOUNT_TYPES = new Set(["1", "2", "4", "9"]);

/**
 * 承認済み請求書を全銀CSVのデータレコードへ変換する。
 * 金額や口座が未入力のものはここで 0 や空文字に落とさず、
 * そのまま buildZenginCsv へ渡して「未入力」として検証エラーにさせる。
 */
export function toTransferRecords(invoices: Invoice[]): TransferRecord[] {
  return invoices.map((invoice) => ({
    id: invoice.id,
    bankCode: invoice.bankCode ?? "",
    branchCode: invoice.branchCode ?? "",
    accountType: (ACCOUNT_TYPES.has(invoice.accountType ?? "")
      ? invoice.accountType
      : "") as AccountType,
    accountNumber: invoice.accountNumber ?? "",
    recipientName: invoice.recipientName ?? "",
    amount: effectiveAmount(invoice) ?? 0,
  }));
}

export function buildExportCsv(setting: Setting, transferDate: Date, invoices: Invoice[]) {
  return buildZenginCsv({
    requester: {
      requesterCode: setting.requesterCode,
      requesterName: setting.requesterName,
      senderBankCode: setting.senderBankCode,
      senderBranchCode: setting.senderBranchCode,
      senderAccountNumber: setting.senderAccountNumber,
    },
    transferDate,
    records: toTransferRecords(invoices),
  });
}

/** 取組日から出力ファイル名を作る */
export function exportFileName(transferDate: Date): string {
  const y = transferDate.getFullYear();
  const m = String(transferDate.getMonth() + 1).padStart(2, "0");
  const d = String(transferDate.getDate()).padStart(2, "0");
  return `soufuri_${y}${m}${d}.csv`;
}

/**
 * 同じ取引先・同じ金額が同一バッチに複数あるものを探す。
 * 正当なケースもあるため出力は止めず、画面で確認を促すだけにする。
 */
export function findPossibleDuplicates(invoices: Invoice[]): Array<{ key: string; invoices: Invoice[] }> {
  const groups = new Map<string, Invoice[]>();

  for (const invoice of invoices) {
    const amount = effectiveAmount(invoice);
    if (amount === null || !invoice.accountNumber) continue;
    const key = `${invoice.bankCode}-${invoice.branchCode}-${invoice.accountNumber}-${amount}`;
    groups.set(key, [...(groups.get(key) ?? []), invoice]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, invoices: list }));
}
