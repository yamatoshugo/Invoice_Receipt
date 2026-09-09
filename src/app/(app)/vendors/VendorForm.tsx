"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { Vendor } from "@/generated/prisma";
import { saveVendor, type ActionState } from "@/app/actions";
import { Field, inputClass, buttonClass, secondaryButtonClass } from "@/components/ui";
import { toZenginKana, RECIPIENT_NAME_MAX_LENGTH } from "@/lib/zengin/kana";

/** 新規登録と編集で共用する。vendor が null なら新規 */
export function VendorForm({ vendor }: { vendor: Vendor | null }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveVendor.bind(null, vendor?.id ?? null),
    { ok: true },
  );
  const [recipientName, setRecipientName] = useState(vendor?.recipientName ?? "");

  const kana = toZenginKana(recipientName);
  const tooLong = kana.length > RECIPIENT_NAME_MAX_LENGTH;

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field
        label="取引先名"
        hint="請求書に書かれている発行者名。「株式会社」の位置や(株)などの表記が違っても同じ取引先として照合します"
      >
        <input
          name="name"
          defaultValue={vendor?.name ?? ""}
          className={inputClass}
          placeholder="株式会社サンプル商事"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="金融機関コード（4桁）">
          <input
            name="bankCode"
            defaultValue={vendor?.bankCode ?? ""}
            className={`${inputClass} tabular`}
            inputMode="numeric"
            placeholder="0009"
          />
        </Field>
        <Field label="金融機関名">
          <input
            name="bankName"
            defaultValue={vendor?.bankName ?? ""}
            className={inputClass}
            placeholder="三井住友銀行"
          />
        </Field>
        <Field label="支店番号（3桁）">
          <input
            name="branchCode"
            defaultValue={vendor?.branchCode ?? ""}
            className={`${inputClass} tabular`}
            inputMode="numeric"
            placeholder="213"
          />
        </Field>
        <Field label="支店名">
          <input
            name="branchName"
            defaultValue={vendor?.branchName ?? ""}
            className={inputClass}
            placeholder="渋谷支店"
          />
        </Field>
        <Field label="預金種目">
          <select name="accountType" defaultValue={vendor?.accountType ?? "1"} className={inputClass}>
            <option value="1">普通</option>
            <option value="2">当座</option>
            <option value="4">貯蓄</option>
            <option value="9">その他</option>
          </select>
        </Field>
        <Field label="口座番号（7桁）">
          <input
            name="accountNumber"
            defaultValue={vendor?.accountNumber ?? ""}
            className={`${inputClass} tabular`}
            inputMode="numeric"
            placeholder="1234567"
          />
        </Field>
      </div>

      <Field
        label="受取人名（口座名義）"
        hint={
          <>
            CSVには{" "}
            <span
              className={
                kana.ok && !tooLong
                  ? "tabular font-medium text-slate-900"
                  : "tabular font-medium text-red-600"
              }
            >
              {kana.value || "（未入力）"}
            </span>{" "}
            として出力されます（{kana.length}/{RECIPIENT_NAME_MAX_LENGTH}文字）。
            {!kana.ok && (
              <span className="mt-1 block text-red-600">
                使用できない文字があります: {kana.invalidChars.join(" ")}
              </span>
            )}
            {tooLong && <span className="mt-1 block text-red-600">文字数が上限を超えています</span>}
          </>
        }
      >
        <input
          name="recipientName"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          className={inputClass}
          placeholder="カ）サンプルショウジ"
        />
      </Field>

      <Field label="メモ" hint="振込手数料の負担など、担当者への申し送り">
        <textarea name="note" defaultValue={vendor?.note ?? ""} rows={2} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3">
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </button>
        <Link href="/vendors" className={secondaryButtonClass}>
          一覧へ戻る
        </Link>
        {state.message && (
          <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
