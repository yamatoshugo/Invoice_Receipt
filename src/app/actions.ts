"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Invoice, InvoiceStatus, Vendor } from "@/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFileStore } from "@/lib/storage";
import { digitsOnly, parseIsoDate } from "@/lib/invoices";
import {
  describeMatch,
  fillFromVendor,
  matchVendor,
  normalizeVendorKey,
  VENDOR_FIELDS,
} from "@/lib/vendors";

async function requireEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("ログインが必要です");
  return email;
}

export type ActionState = { ok: boolean; message?: string };

const ACCOUNT_MISMATCH_MESSAGE =
  "取引先マスタと口座情報が異なります。振込先の変更でないか確認してください";

/**
 * 口座がマスタと食い違ったままかを判定する。
 *
 * 状態を保存せず毎回照合し直すので、人が請求書側を直せば自動で承認できるようになる。
 * 「今回はこの口座で振り込む」と確認済みなら通す。
 */
function isAccountMismatch(invoice: Invoice, vendors: Vendor[]): boolean {
  if (invoice.accountMismatchAckedAt) return false;
  return matchVendor(invoice, vendors).state === "account_mismatch";
}

async function accountMismatchBlocked(invoice: Invoice): Promise<boolean> {
  if (invoice.accountMismatchAckedAt) return false;
  return isAccountMismatch(invoice, await prisma.vendor.findMany());
}

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

  const current = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!current) return { ok: false, message: "請求書が見つかりません" };
  if (current.status === "EXPORTED" || current.status === "PAID") {
    return { ok: false, message: "CSV出力済みの請求書は変更できません" };
  }

  if (status === "APPROVED" && (await accountMismatchBlocked(current))) {
    return { ok: false, message: ACCOUNT_MISMATCH_MESSAGE };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status,
      excludeReason: status === "EXCLUDED" ? (excludeReason ?? null) : null,
      updatedByEmail: email,
      // 未処理に戻すのは「もう一度見直す」ということなので、
      // 口座相違の確認済み記録も外して、承認時にもう一度確認させる
      ...(status === "NEEDS_REVIEW"
        ? { accountMismatchAckedAt: null, accountMismatchAckedEmail: null }
        : {}),
    },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/export");
  return { ok: true };
}

/**
 * 一覧からのまとめて承認・除外・未処理へ戻す。
 *
 * 未処理・承認済み・除外の3つは行き来できる（誤って承認や除外をしても取り消せる）。
 * CSV出力済み・振込済みは対象外。銀行へ送ったデータと帳簿がずれるため。
 */
export async function bulkSetStatus(
  invoiceIds: string[],
  status: Extract<InvoiceStatus, "APPROVED" | "EXCLUDED" | "NEEDS_REVIEW">,
): Promise<ActionState> {
  const email = await requireEmail();
  if (invoiceIds.length === 0) return { ok: false, message: "対象が選択されていません" };

  const targets = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, status: { in: ["NEEDS_REVIEW", "APPROVED", "EXCLUDED"] } },
  });

  // 承認だけは口座相違をここで弾く。まとめて処理するときこそ見落とされやすい
  const blocked: string[] = [];
  const allowed: string[] = [];
  if (status === "APPROVED") {
    const vendors = await prisma.vendor.findMany();
    for (const invoice of targets) {
      if (isAccountMismatch(invoice, vendors)) blocked.push(invoice.id);
      else allowed.push(invoice.id);
    }
  } else {
    allowed.push(...targets.map((i) => i.id));
  }

  const { count } = await prisma.invoice.updateMany({
    where: { id: { in: allowed } },
    data: {
      status,
      updatedByEmail: email,
      // 除外から出るなら理由は残さない
      excludeReason: status === "EXCLUDED" ? undefined : null,
      // 未処理に戻すのは「もう一度見直す」ということなので、
      // 口座相違の確認済み記録も外して、承認時にもう一度確認させる
      ...(status === "NEEDS_REVIEW"
        ? { accountMismatchAckedAt: null, accountMismatchAckedEmail: null }
        : {}),
    },
  });

  revalidatePath("/invoices");
  revalidatePath("/export");
  if (blocked.length > 0) {
    return {
      ok: false,
      message: `${count}件を更新しました。${blocked.length}件は口座が取引先マスタと異なるため承認できませんでした`,
    };
  }
  return { ok: true, message: `${count}件を更新しました` };
}

/**
 * 一覧からのまとめて削除。
 *
 * 二重取込を防いでいるのは sha256 の一意制約なので、行を消せば同じPDFを取り込み直せる。
 * 取り込み直したときは取引先マスタから補完されるため、消したデータを参照する必要はない。
 *
 * CSVの出力履歴（件数・合計・生成したCSVの実体）は ExportBatch に残るので、
 * 銀行へ何を送ったかの記録は請求書を消しても失われない。
 */
export async function deleteInvoices(invoiceIds: string[]): Promise<ActionState> {
  await requireEmail();
  if (invoiceIds.length === 0) return { ok: false, message: "対象が選択されていません" };

  const targets = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, blobPathname: true },
  });
  if (targets.length === 0) return { ok: false, message: "対象が見つかりません" };

  const { count } = await prisma.invoice.deleteMany({
    where: { id: { in: targets.map((t) => t.id) } },
  });

  // PDFの実体も片付ける。DBから消した後なので、失敗しても不整合にはならない
  const store = getFileStore();
  await Promise.all(targets.map((t) => store.delete(t.blobPathname).catch(() => {})));

  revalidatePath("/invoices");
  revalidatePath("/export");
  return { ok: true, message: `${count}件を削除しました。同じPDFを取り込み直せます` };
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

// ===== 取引先マスタ =====

const VendorSchema = z.object({
  name: z.string().trim().min(1, "取引先名を入力してください").max(200),
  bankCode: z.string().trim().regex(/^\d{1,4}$/, "金融機関コードは数字4桁以内です"),
  bankName: z.string().trim().min(1, "金融機関名を入力してください").max(100),
  branchCode: z.string().trim().regex(/^\d{1,3}$/, "支店番号は数字3桁以内です"),
  branchName: z.string().trim().min(1, "支店名を入力してください").max(100),
  accountType: z.enum(["1", "2", "4", "9"], { message: "預金種目を選んでください" }),
  accountNumber: z.string().trim().regex(/^\d{1,7}$/, "口座番号は数字7桁以内です"),
  recipientName: z.string().trim().min(1, "受取人名を入力してください").max(200),
  note: z.string().trim().max(2000),
});

/** 取引先の新規作成・編集。vendorId が null なら新規 */
export async function saveVendor(
  vendorId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = await requireEmail();

  const parsed = VendorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(" / ") };
  }
  const data = { ...parsed.data, note: parsed.data.note || null, updatedByEmail: email };
  const matchKey = normalizeVendorKey(data.name);
  if (!matchKey) return { ok: false, message: "取引先名から照合キーを作れませんでした" };

  // 表記違いで同じ取引先を二重登録されると、どちらに照合されるか決まらなくなる
  const duplicate = await prisma.vendor.findUnique({ where: { matchKey } });
  if (duplicate && duplicate.id !== vendorId) {
    return { ok: false, message: `同じ取引先が既に登録されています（${duplicate.name}）` };
  }

  const vendor = vendorId
    ? await prisma.vendor.update({ where: { id: vendorId }, data: { ...data, matchKey } })
    : await prisma.vendor.create({ data: { ...data, matchKey } });

  revalidatePath("/vendors");
  revalidatePath("/invoices");
  return { ok: true, message: `「${vendor.name}」を保存しました` };
}

/** 取引先を削除する。請求書は自身に口座情報のコピーを持つので消えない（vendorId が外れるだけ） */
export async function deleteVendor(vendorId: string): Promise<ActionState> {
  await requireEmail();

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return { ok: false, message: "取引先が見つかりません" };

  await prisma.vendor.delete({ where: { id: vendorId } });

  revalidatePath("/vendors");
  revalidatePath("/invoices");
  return { ok: true, message: `「${vendor.name}」を削除しました` };
}

/** 請求書の口座項目を取り出す。マスタの必須項目が揃っていなければ null */
function vendorFieldsOf(invoice: Invoice): Record<(typeof VENDOR_FIELDS)[number], string> | null {
  const values = {} as Record<(typeof VENDOR_FIELDS)[number], string>;
  for (const field of VENDOR_FIELDS) {
    const value = invoice[field]?.trim();
    if (!value) return null;
    values[field] = value;
  }
  return values;
}

/**
 * 明細画面から「この内容で取引先を登録」。
 * 人が確認して埋めた口座をマスタに移す、マスタを育てる主動線。
 */
export async function registerVendorFromInvoice(invoiceId: string): Promise<ActionState> {
  const email = await requireEmail();

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, message: "請求書が見つかりません" };
  if (!invoice.vendorName?.trim()) return { ok: false, message: "取引先名を入力してください" };

  const fields = vendorFieldsOf(invoice);
  if (!fields) {
    return { ok: false, message: "金融機関コード・支店番号などを埋めてから登録してください" };
  }

  const matchKey = normalizeVendorKey(invoice.vendorName);
  const duplicate = await prisma.vendor.findUnique({ where: { matchKey } });
  if (duplicate) {
    return { ok: false, message: `同じ取引先が既に登録されています（${duplicate.name}）` };
  }

  const vendor = await prisma.vendor.create({
    data: { name: invoice.vendorName.trim(), matchKey, ...fields, updatedByEmail: email },
  });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { vendorId: vendor.id } });

  revalidatePath("/vendors");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: `「${vendor.name}」を取引先マスタに登録しました` };
}

/** 口座相違のとき、マスタ側を今回の請求書の内容に更新する（正当な口座変更だった場合） */
export async function updateVendorFromInvoice(invoiceId: string): Promise<ActionState> {
  const email = await requireEmail();

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, message: "請求書が見つかりません" };

  const match = matchVendor(invoice, await prisma.vendor.findMany());
  if (!match.vendor) return { ok: false, message: "照合できる取引先がありません" };

  const fields = vendorFieldsOf(invoice);
  if (!fields) {
    return { ok: false, message: "金融機関コード・支店番号などを埋めてから更新してください" };
  }

  await prisma.vendor.update({
    where: { id: match.vendor.id },
    data: { ...fields, updatedByEmail: email },
  });
  // マスタ側が今回の内容と一致したので、確認済みの記録は不要になる
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      vendorId: match.vendor.id,
      accountMismatchAckedAt: null,
      accountMismatchAckedEmail: null,
    },
  });

  revalidatePath("/vendors");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: `「${match.vendor.name}」の口座情報を更新しました` };
}

/** 口座相違のまま「今回はこの口座で振り込む」と確認する。誰がいつ確認したかを残す */
export async function acknowledgeAccountMismatch(invoiceId: string): Promise<ActionState> {
  const email = await requireEmail();

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { accountMismatchAckedAt: new Date(), accountMismatchAckedEmail: email },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "確認済みにしました。承認できます" };
}

/** 取り込み後に登録した取引先を、既存の請求書へ適用する */
export async function applyVendorToInvoice(invoiceId: string): Promise<ActionState> {
  const email = await requireEmail();

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, message: "請求書が見つかりません" };
  if (invoice.status === "EXPORTED" || invoice.status === "PAID") {
    return { ok: false, message: "CSV出力済みの請求書は変更できません" };
  }

  const match = matchVendor(invoice, await prisma.vendor.findMany());
  if (!match.vendor) return { ok: false, message: "照合できる取引先がありません" };

  const filled = fillFromVendor(match);
  const filledFields = match.fillable.filter((f) => f in filled);
  if (filledFields.length === 0) {
    return { ok: false, message: "マスタから補完できる項目がありません" };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      ...filled,
      vendorId: match.vendor.id,
      vendorFilledFields: filledFields,
      note: [invoice.note, describeMatch(match, invoice)].filter(Boolean).join("\n") || null,
      updatedByEmail: email,
    },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: `${filledFields.length}項目を補完しました` };
}
