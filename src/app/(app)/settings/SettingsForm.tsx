"use client";

import { useActionState, useState } from "react";
import type { Setting } from "@/generated/prisma";
import { saveSettings, type ActionState } from "@/app/actions";
import { Field, inputClass, buttonClass } from "@/components/ui";
import { toZenginKana, REQUESTER_NAME_MAX_LENGTH } from "@/lib/zengin/kana";

export function SettingsForm({ setting }: { setting: Setting | null }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveSettings, { ok: true });
  const [requesterName, setRequesterName] = useState(setting?.requesterName ?? "");

  const kana = toZenginKana(requesterName);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field
        label="振込依頼人コード（委託者コード）"
        hint="ネットバンキングの［資金移動 ≫ 振込データの新規作成］画面に表示される「20」ではじまる10桁の番号"
      >
        <input
          name="requesterCode"
          defaultValue={setting?.requesterCode ?? ""}
          className={`${inputClass} tabular`}
          inputMode="numeric"
          placeholder="2012345678"
        />
      </Field>

      <Field
        label="振込依頼人名"
        hint={
          <>
            CSVには{" "}
            <span className={kana.ok ? "tabular font-medium text-slate-900" : "tabular font-medium text-red-600"}>
              {kana.value || "（未入力）"}
            </span>{" "}
            として出力されます（{kana.length}/{REQUESTER_NAME_MAX_LENGTH}文字）。銀行に届け出ている名義と
            一致させてください。
            {!kana.ok && (
              <span className="mt-1 block text-red-600">
                使用できない文字があります: {kana.invalidChars.join(" ")}
              </span>
            )}
          </>
        }
      >
        <input
          name="requesterName"
          value={requesterName}
          onChange={(e) => setRequesterName(e.target.value)}
          className={inputClass}
          placeholder="スミエスショウジ株式会社"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="仕向銀行番号" hint="ドコモSMTBネット銀行は 0038">
          <input
            name="senderBankCode"
            defaultValue={setting?.senderBankCode ?? "0038"}
            className={`${inputClass} tabular`}
            inputMode="numeric"
          />
        </Field>
        <Field label="仕向支店番号">
          <input
            name="senderBranchCode"
            defaultValue={setting?.senderBranchCode ?? ""}
            className={`${inputClass} tabular`}
            inputMode="numeric"
            placeholder="106"
          />
        </Field>
        <Field label="依頼人口座番号">
          <input
            name="senderAccountNumber"
            defaultValue={setting?.senderAccountNumber ?? ""}
            className={`${inputClass} tabular`}
            inputMode="numeric"
            placeholder="1234567"
          />
        </Field>
      </div>

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
    </form>
  );
}
