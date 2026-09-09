"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { InvoiceStatus } from "@/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { digitsOnly, parseIsoDate } from "@/lib/invoices";

async function requireEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("ログインが必要です");
  return email;
}

export type ActionState = { ok: boolean; message?: string };

const InvoiceFormSchema = z.object({
  vendorName: z.string().trim().max(200),
  bankCode: z.string().trim().max(20),
  bankName: z.string().trim().max(100),
  branchCode: z.string().trim().max(20),
  branchName: z.string().trim().max(100),
  accountType: z.enum(["1", "2", "4", "9", ""]),
  accountNumber: z.string().trim().max(20),
  recipientName: z.string().trim().max(200),
  invoiceNumber: z.string().trim().max(100),
  issueDate: z.string().trim().max(10),
  dueDate: z.string().trim().max(10),
  billedAmount: z.string().trim().max(20),
  transferAmount: z.string().trim().max(20),
  note: z.string().trim().max(2000),
});

function toAmount(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** 明細画面での内容修正 */
export async function updateInvoice(
  invoiceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireEmail();

  const parsed = InvoiceFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください" };
  const f = parsed.data;

  const current = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  if (!current) return { ok: false, message: "請求書が見つかりません" };
  // 出力済み・振込済みの内容を書き換えると、銀行に送ったデータと帳簿が食い違う
  if (current.status === "EXPORTED" || current.status === "PAID") {
    return { ok: false, message: "CSV出力済みの請求書は編集できません" };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      vendorName: f.vendorName || null,
      bankCode: digitsOnly(f.bankCode),
      bankName: f.bankName || null,
      branchCode: digitsOnly(f.branchCode),
      branchName: f.branchName || null,
      accountType: f.accountType || null,
      accountNumber: digitsOnly(f.accountNumber),
      recipientName: f.recipientName || null,
      invoiceNumber: f.invoiceNumber || null,
      issueDate: parseIsoDate(f.issueDate),
      dueDate: parseIsoDate(f.dueDate),
      billedAmount: toAmount(f.billedAmount),
      transferAmount: toAmount(f.transferAmount),
      note: f.note || null,
      updatedByEmail: email,
    },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "保存しました" };
}

/** 承認 / 除外 / 要確認へ戻す */
export async function setInvoiceStatus(
  invoiceId: string,
  status: Extract<InvoiceStatus, "APPROVED" | "EXCLUDED" | "NEEDS_REVIEW">,
  excludeReason?: string,
): Promise<ActionState> {
  const email = await requireEmail();

  const current = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  if (!current) return { ok: false, message: "請求書が見つかりません" };
  if (current.status === "EXPORTED" || current.status === "PAID") {
    return { ok: false, message: "CSV出力済みの請求書は変更できません" };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status,
      excludeReason: status === "EXCLUDED" ? (excludeReason ?? null) : null,
      updatedByEmail: email,
    },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/export");
  return { ok: true };
}

/** 一覧からのまとめて承認・除外 */
export async function bulkSetStatus(
  invoiceIds: string[],
  status: Extract<InvoiceStatus, "APPROVED" | "EXCLUDED">,
): Promise<ActionState> {
  const email = await requireEmail();
  if (invoiceIds.length === 0) return { ok: false, message: "対象が選択されていません" };

  const { count } = await prisma.invoice.updateMany({
    where: { id: { in: invoiceIds }, status: { in: ["NEEDS_REVIEW", "APPROVED", "EXCLUDED"] } },
    data: { status, updatedByEmail: email },
  });

  revalidatePath("/invoices");
  revalidatePath("/export");
  return { ok: true, message: `${count}件を更新しました` };
}

/** 一覧のフォームから呼ぶための薄いラッパー */
export async function markBatchPaidForm(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batchId") ?? "");
  if (batchId) await markBatchPaid(batchId);
}

/** ネットバンキングでの振込完了を記録する */
export async function markBatchPaid(batchId: string): Promise<ActionState> {
  await requireEmail();

  await prisma.$transaction([
    prisma.exportBatch.update({
      where: { id: batchId },
      data: { isPaid: true, paidAt: new Date() },
    }),
    prisma.invoice.updateMany({
      where: { exportBatchId: batchId },
      data: { status: "PAID" },
    }),
  ]);

  revalidatePath("/export");
  revalidatePath("/invoices");
  return { ok: true, message: "振込済みにしました" };
}

const SettingsSchema = z.object({
  requesterCode: z.string().trim().regex(/^\d{10}$/, "振込依頼人コードは数字10桁です"),
  requesterName: z.string().trim().min(1, "振込依頼人名を入力してください").max(100),
  senderBankCode: z.string().trim().regex(/^\d{1,4}$/, "仕向銀行番号は数字4桁以内です"),
  senderBranchCode: z.string().trim().regex(/^\d{1,3}$/, "仕向支店番号は数字3桁以内です"),
  senderAccountNumber: z.string().trim().regex(/^\d{1,7}$/, "口座番号は数字7桁以内です"),
});

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = await requireEmail();

  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(" / ") };
  }

  await prisma.setting.upsert({
    where: { id: "default" },
    create: { id: "default", ...parsed.data, updatedByEmail: email },
    update: { ...parsed.data, updatedByEmail: email },
  });

  revalidatePath("/settings");
  revalidatePath("/export");
  return { ok: true, message: "保存しました" };
}
