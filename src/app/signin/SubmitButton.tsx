"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

/**
 * 送信中は押せなくする。
 *
 * パスワードの照合(scrypt)とDBの往復で200ms前後かかるため、
 * 素早く2回押すとログインのPOSTが2本飛ぶ。押した手応えを返す意味もある。
 */
export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
      {pending ? "ログイン中…" : "ログイン"}
    </button>
  );
}
