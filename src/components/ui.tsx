import { clsx } from "clsx";
import type { InvoiceStatus } from "@/generated/prisma";
import { STATUS_LABELS } from "@/lib/invoices";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  NEEDS_REVIEW: "bg-amber-100 text-amber-800",
  EXTRACTION_FAILED: "bg-red-100 text-red-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  EXCLUDED: "bg-slate-200 text-slate-600",
  EXPORTED: "bg-blue-100 text-blue-800",
  PAID: "bg-slate-900 text-white",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={clsx(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {children}
    </div>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{children}</div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-900 focus:outline-none";

export const buttonClass =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40";

export const secondaryButtonClass =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";

/** 取り消せない操作（削除）用。押す前に色で気づけるようにする */
export const dangerButtonClass =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40";
