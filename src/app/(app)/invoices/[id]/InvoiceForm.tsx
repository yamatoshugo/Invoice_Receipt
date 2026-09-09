"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Invoice } from "@/generated/prisma";
import { setInvoiceStatus, updateInvoice, type ActionState } from "@/app/actions";
import { toZenginKana, RECIPIENT_NAME_MAX_LENGTH } from "@/lib/zengin/kana";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/extraction/types";
import { Field, inputClass, buttonClass, secondaryButtonClass, ErrorBox } from "@/components/ui";

function toDateInput(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 抽出の確信度が低い項目に印を付ける */
function ConfidenceMark({ score }: { score: number | undefined }) {
  if (score === undefined || score >= LOW_CONFIDENCE_THRESHOLD) return null;
  return (
    <span className="ml-1 text-amber-600" title={`読み取りの確信度が低い項目です (${score.toFixed(2)})`}>
      ●
    </span>
  );
}

export function InvoiceForm({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateInvoice.bind(null, invoice.id),
    { ok: true },
  );
  const [statusPending, startStatusTransition] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState(invoice.recipientName ?? "");

  const confidence = (invoice.confidence ?? {}) as Record<string, number>;
  const kana = toZenginKana(recipientName);
  const locked = invoice.status === "EXPORTED" || invoice.status === "PAID";

  function changeStatus(status: "APPROVED" | "EXCLUDED" | "NEEDS_REVIEW") {
    setStatusError(null);
    startStatusTransition(async () => {
      const result = await setInvoiceStatus(invoice.id, status);
      if (!result.ok) setStatusError(result.message ?? "変更できませんでした");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {locked && (
        <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          この請求書はCSVに出力済みのため編集できません。銀行へ送ったデータと内容がずれるのを防ぐためです。
        </div>
      )}

      {invoice.extractionError && (
        <ErrorBox>
          読み取りに失敗しました: {invoice.extractionError}
          <div className="mt-1 text-xs">PDFを見ながら以下の項目を手で入力してください。</div>
        </ErrorBox>
      )}

      {invoice.note && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">読み取り時の申し送り:</span> {invoice.note}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <fieldset disabled={locked} className="space-y-4">
          <Field label="取引先名">
            <input name="vendorName" defaultValue={invoice.vendorName ?? ""} className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                <>
                  金融機関コード（4桁）
                  <ConfidenceMark score={confidence.bankCode} />
                </>
              }
            >
              <input
                name="bankCode"
                defaultValue={invoice.bankCode ?? ""}
                className={inputClass}
                inputMode="numeric"
              />
            </Field>
            <Field label="金融機関名">
              <input name="bankName" defaultValue={invoice.bankName ?? ""} className={inputClass} />
            </Field>
            <Field
              label={
                <>
                  支店番号（3桁）
                  <ConfidenceMark score={confidence.branchCode} />
                </>
              }
            >
              <input
                name="branchCode"
                defaultValue={invoice.branchCode ?? ""}
                className={inputClass}
                inputMode="numeric"
              />
            </Field>
            <Field label="支店名">
              <input name="branchName" defaultValue={invoice.branchName ?? ""} className={inputClass} />
            </Field>
            <Field
              label={
                <>
                  預金種目
                  <ConfidenceMark score={confidence.accountType} />
                </>
              }
            >
              <select name="accountType" defaultValue={invoice.accountType ?? ""} className={inputClass}>
                <option value="">未選択</option>
                <option value="1">普通</option>
                <option value="2">当座</option>
                <option value="4">貯蓄</option>
                <option value="9">その他</option>
              </select>
            </Field>
            <Field
              label={
                <>
                  口座番号（7桁以内）
                  <ConfidenceMark score={confidence.accountNumber} />
                </>
              }
            >
              <input
                name="accountNumber"
                defaultValue={invoice.accountNumber ?? ""}
                className={inputClass}
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field
            label={
              <>
                受取人名（口座名義）
                <ConfidenceMark score={confidence.recipientName} />
              </>
            }
            hint={
              <>
                CSVには{" "}
                <span className={kana.ok ? "tabular font-medium text-slate-900" : "tabular font-medium text-red-600"}>
                  {kana.value || "（未入力）"}
                </span>{" "}
                として出力されます（{kana.length}/{RECIPIENT_NAME_MAX_LENGTH}文字）
                {!kana.ok && (
                  <span className="mt-1 block text-red-600">
                    全銀フォーマットで使えない文字があります: {kana.invalidChars.join(" ")}
                    。カナで入力し直してください。
                  </span>
                )}
                {kana.length > RECIPIENT_NAME_MAX_LENGTH && (
                  <span className="mt-1 block text-red-600">上限を超えています。短縮してください。</span>
                )}
              </>
            }
          >
            <input
              name="recipientName"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                <>
                  請求金額（円）
                  <ConfidenceMark score={confidence.billedAmount} />
                </>
              }
            >
              <input
                name="billedAmount"
                defaultValue={invoice.billedAmount ?? ""}
                className={`${inputClass} tabular`}
                inputMode="numeric"
              />
            </Field>
            <Field label="振込金額（円）" hint="請求額と違う金額を振り込む場合のみ入力">
              <input
                name="transferAmount"
                defaultValue={invoice.transferAmount ?? ""}
                className={`${inputClass} tabular`}
                inputMode="numeric"
              />
            </Field>
            <Field label="請求書番号">
              <input name="invoiceNumber" defaultValue={invoice.invoiceNumber ?? ""} className={inputClass} />
            </Field>
            <Field label="発行日">
              <input
                type="date"
                name="issueDate"
                defaultValue={toDateInput(invoice.issueDate)}
                className={inputClass}
              />
            </Field>
            <Field label="支払期日">
              <input
                type="date"
                name="dueDate"
                defaultValue={toDateInput(invoice.dueDate)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="メモ">
            <textarea name="note" defaultValue={invoice.note ?? ""} rows={2} className={inputClass} />
          </Field>

          <div className="flex items-center gap-3">
            <button type="submit" className={buttonClass} disabled={pending}>
              {pending ? "保存中…" : "保存"}
            </button>
            {state.message && (
              <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
                {state.message}
              </span>
            )}
          </div>
        </fieldset>
      </form>

      {!locked && (
        <div className="border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => changeStatus("APPROVED")}
              disabled={statusPending || invoice.status === "APPROVED"}
              className={buttonClass}
            >
              振込対象として承認
            </button>
            <button
              type="button"
              onClick={() => changeStatus("EXCLUDED")}
              disabled={statusPending || invoice.status === "EXCLUDED"}
              className={secondaryButtonClass}
            >
              今回は振り込まない
            </button>
            {invoice.status !== "NEEDS_REVIEW" && (
              <button
                type="button"
                onClick={() => changeStatus("NEEDS_REVIEW")}
                disabled={statusPending}
                className={secondaryButtonClass}
              >
                要確認に戻す
              </button>
            )}
          </div>
          {statusError && <p className="mt-2 text-sm text-red-700">{statusError}</p>}
          <p className="mt-2 text-xs text-slate-500">
            承認したものだけがCSV出力の対象になります。項目名の横の
            <span className="text-amber-600">●</span> は読み取りの確信度が低い項目です。
          </p>
        </div>
      )}
    </div>
  );
}
