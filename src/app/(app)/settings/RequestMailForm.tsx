"use client";

import { useActionState, useRef, useState } from "react";
import { saveRequestMailTemplate, type ActionState } from "@/app/actions";
import { Field, inputClass, buttonClass, Warning } from "@/components/ui";
import {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  REQUEST_VARS,
  renderTemplate,
  todayLabel,
} from "@/lib/gmail/requestTemplate";
import type { RequestVars } from "@/lib/gmail/requestTemplate";

/** プレビュー用のサンプル値。実際の送信では元メールと設定から埋まる */
const SAMPLE: RequestVars = {
  取引先名: "楽々商事株式会社",
  元の件名: "8月分ご請求のお知らせ",
  受取アドレス: "seikyusho@example.co.jp",
  自社名: "株式会社サンプル",
  今日: todayLabel(new Date()),
};

export function RequestMailForm({
  subject,
  body,
  fromName,
  mailboxAddress,
  companyName,
}: {
  subject: string | null;
  body: string | null;
  fromName: string | null;
  /** 接続中のアドレス。プレビューを実際の値で出す */
  mailboxAddress: string | null;
  companyName: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveRequestMailTemplate,
    { ok: true },
  );

  // null は「既定のまま」。既定文面はコード側にあるので、ここで初めて文字列になる
  const [subjectText, setSubjectText] = useState(subject ?? DEFAULT_SUBJECT);
  const [bodyText, setBodyText] = useState(body ?? DEFAULT_BODY);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const vars: RequestVars = {
    ...SAMPLE,
    受取アドレス: mailboxAddress ?? SAMPLE.受取アドレス,
    自社名: companyName || SAMPLE.自社名,
  };
  const subjectPreview = renderTemplate(subjectText, vars);
  const bodyPreview = renderTemplate(bodyText, vars);
  const unknown = [...new Set([...subjectPreview.unknownVars, ...bodyPreview.unknownVars])];

  /** カーソル位置に変数を挿入する。手で打つと全角波括弧などで書き間違えるため */
  function insertVar(name: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${bodyText.slice(0, start)}{{${name}}}${bodyText.slice(end)}`;
    setBodyText(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + name.length + 4;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <section id="request-mail" className="rounded border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">請求書の送付依頼メールの文面</h2>
      <p className="mt-1 mb-4 text-sm text-slate-600">
        ログインが必要なWeb明細サイトのURLだけが届いた場合に、取引先へ送る依頼メールのひな型です。
        送信前に「取り込み ≫ 送付依頼」の画面で1件ずつ内容を確認・編集できます。
      </p>

      <form action={formAction} className="space-y-4">
        <Field
          label="差出人の表示名"
          hint={`空欄なら表示名を付けず、${mailboxAddress ?? "接続中のアドレス"} だけで送ります`}
        >
          <input
            name="requestMailFromName"
            defaultValue={fromName ?? ""}
            className={inputClass}
            placeholder="株式会社サンプル 経理部"
          />
        </Field>

        <Field
          label="件名のひな型"
          hint="既定の「Re: {{元の件名}}」は、元のメールへの返信としてスレッドに入ります。件名を変えると新規メールとして送られます"
        >
          <input
            name="requestMailSubject"
            value={subjectText}
            onChange={(e) => setSubjectText(e.target.value)}
            className={inputClass}
          />
        </Field>

        {/* 広い画面では、編集欄とプレビューを横に並べる。
            文面を直しながら結果が見えることが、この画面の本来の狙い */}
        <div className="grid items-start gap-4 2xl:grid-cols-2">
          <div className="space-y-2">
            <Field label="本文のひな型">
              <textarea
                ref={bodyRef}
                name="requestMailBody"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={18}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">本文に差し込む:</span>
              {REQUEST_VARS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertVar(name)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                >
                  {`{{${name}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">プレビュー（サンプルの値で表示）</p>
            <p className="text-sm">
              <span className="text-slate-500">件名: </span>
              {subjectPreview.text}
            </p>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-white p-3 text-xs whitespace-pre-wrap">
              {bodyPreview.text}
            </pre>
          </div>
        </div>

        {unknown.length > 0 && (
          <Warning>
            <p className="font-medium">差し込めない変数があります: {unknown.join(" / ")}</p>
            <p className="mt-1">
              この部分は <code>{"{{…}}"}</code> のまま本文に残り、
              <strong>送信ボタンが押せなくなります</strong>。書き間違いを直してください。
            </p>
          </Warning>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass} disabled={pending}>
            {pending ? "保存中…" : "文面を保存"}
          </button>
          <button
            type="button"
            className="text-sm text-slate-600 underline"
            onClick={() => {
              setSubjectText(DEFAULT_SUBJECT);
              setBodyText(DEFAULT_BODY);
            }}
          >
            既定の文面に戻す
          </button>
          {state.message && (
            <span className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
              {state.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
