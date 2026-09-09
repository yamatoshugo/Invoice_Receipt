import type { Invoice } from "@/generated/prisma";

/** 実際に振り込む金額。画面で上書きされていればそちらを使う */
export function effectiveAmount(invoice: Pick<Invoice, "transferAmount" | "billedAmount">): number | null {
  return invoice.transferAmount ?? invoice.billedAmount;
}

/** "YYYY-MM-DD" を Date にする。解釈できなければ null */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

/** 数字以外を取り除く。抽出値の「1234-567」「口座番号: 1234567」などを吸収する */
export function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export const STATUS_LABELS = {
  NEEDS_REVIEW: "要確認",
  EXTRACTION_FAILED: "読み取り失敗",
  APPROVED: "承認済み",
  EXCLUDED: "除外",
  EXPORTED: "CSV出力済み",
  PAID: "振込済み",
} as const;

export const ACCOUNT_TYPE_LABELS = {
  "1": "普通",
  "2": "当座",
  "4": "貯蓄",
  "9": "その他",
} as const;

export function formatYen(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}
