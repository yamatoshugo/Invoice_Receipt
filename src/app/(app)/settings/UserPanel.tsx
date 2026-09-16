"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  addAppUser,
  deleteAppUser,
  resetAppUserPassword,
  type ActionState,
} from "@/app/actions";
import {
  buttonClass,
  dangerButtonClass,
  Field,
  inputClass,
  secondaryButtonClass,
} from "@/components/ui";
import type { UserRow } from "@/lib/auth/users";
// ★@/lib/auth/password からは読まないこと（node:crypto を引きずってブラウザで落ちる）
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordPolicy";

/**
 * ログインできる人の一覧と追加・削除・パスワード再設定。
 *
 * ★ここの制限はすべて見た目だけのもの。本当の判定は lib/auth/users.ts にある。
 * ボタンを disabled にするのは「押す前に理由が分かる」ようにするためで、
 * 締め出しを防いでいるのはサーバー側のガード。
 */
export function UserPanel({ users, currentEmail }: { users: UserRow[]; currentEmail: string }) {
  const lastOne = users.length <= 1;

  return (
    <section id="users" className="rounded border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">利用者</h2>
      <p className="mt-1 mb-4 text-sm text-slate-600">
        このシステムにログインできる人の一覧です。ここに載っている人は全員、
        利用者の追加と削除ができます。
        <strong className="text-slate-900">
          削除とパスワードの再設定は、その人が開いている画面にもすぐ反映されます。
        </strong>
      </p>

      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {users.map((user) => (
          <UserItem
            key={user.id}
            user={user}
            isSelf={user.email === currentEmail}
            lastOne={lastOne}
          />
        ))}
      </ul>

      <AddUserForm />
    </section>
  );
}

function UserItem({
  user,
  isSelf,
  lastOne,
}: {
  user: UserRow;
  isSelf: boolean;
  lastOne: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  // ResetPasswordForm の useEffect が毎レンダーで再実行されないよう、同一性を保つ
  const handleResetDone = useCallback(() => {
    setResetting(false);
    router.refresh();
  }, [router]);

  // 自分は消せない（その場で締め出される）。最後の1人も消せない（誰も入れなくなる）
  const deleteBlocked = isSelf
    ? "自分自身は削除できません"
    : lastOne
      ? "最後の1人は削除できません"
      : null;

  function handleDelete() {
    if (
      !confirm(
        `${user.email} を削除します。\n\n` +
          "以後ログインできなくなり、開いている画面もその場でログアウトされます。\n" +
          "この人が行った操作の記録（更新者・CSV出力者など）は残ります。",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteAppUser(user.id);
      setMessage({ ok: result.ok, text: result.message ?? "" });
      router.refresh();
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{user.email}</span>
        {isSelf && <span className="text-xs text-slate-500">（自分）</span>}

        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setResetting((v) => !v)}
            className={`${secondaryButtonClass} px-3 py-1 text-xs`}
          >
            {resetting ? "やめる" : "パスワード再設定"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || deleteBlocked !== null}
            title={deleteBlocked ?? undefined}
            className={`${dangerButtonClass} px-3 py-1 text-xs`}
          >
            {pending ? "削除中…" : "削除"}
          </button>
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        追加: {user.createdAt.toLocaleDateString("ja-JP")}
        {user.createdByEmail ? `（${user.createdByEmail}）` : "（初期設定）"} ／ 最終ログイン:{" "}
        {user.lastLoginAt ? user.lastLoginAt.toLocaleString("ja-JP") : "まだありません"}
      </p>

      {deleteBlocked && (
        <p className="mt-1 text-xs text-slate-500">{deleteBlocked}。</p>
      )}

      {message && (
        <p className={message.ok ? "mt-1 text-xs text-emerald-700" : "mt-1 text-xs text-red-700"}>
          {message.text}
        </p>
      )}

      {resetting && (
        <ResetPasswordForm userId={user.id} email={user.email} onDone={handleResetDone} />
      )}
    </li>
  );
}

function ResetPasswordForm({
  userId,
  email,
  onDone,
}: {
  userId: string;
  email: string;
  onDone: () => void;
}) {
  const action = resetAppUserPassword.bind(null, userId);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { ok: true });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // 成功したらフォームを閉じる（初期状態は message が無いので発火しない）
  const done = state.ok && Boolean(state.message);
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded bg-slate-50 p-3">
      <p className="text-xs text-slate-600">
        {email} の新しいパスワードを設定します。この人は全ての端末でログアウトされます。
      </p>
      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={`${buttonClass} px-3 py-1 text-xs`}>
          {pending ? "設定中…" : "再設定する"}
        </button>
        {!state.ok && state.message && <span className="text-xs text-red-700">{state.message}</span>}
      </div>
    </form>
  );
}

function AddUserForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addAppUser, {
    ok: true,
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // 追加できたら入力を消す。
  // ★「自動生成」＋「表示する」で作ったパスワードが画面に残り続けないようにする
  const added = state.ok && Boolean(state.message);
  useEffect(() => {
    if (!added) return;
    setPassword("");
    setConfirm("");
    formRef.current?.reset();
  }, [added]);

  return (
    <form ref={formRef} action={formAction} className="mt-5 space-y-4">
      <h3 className="text-sm font-medium">利用者を追加</h3>

      <Field label="メールアドレス">
        <input
          type="email"
          name="email"
          required
          autoComplete="off"
          placeholder="you@example.com"
          className={inputClass}
        />
      </Field>

      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "追加中…" : "追加する"}
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

/**
 * 紛らわしい文字（0/O、1/l/I）を除いた英数字。
 * 口頭やチャットで伝えたときに読み違えられないようにする。
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENERATED_LENGTH = 24;

function generatePassword(): string {
  const bytes = new Uint32Array(GENERATED_LENGTH);
  crypto.getRandomValues(bytes);
  // ALPHABET は56文字で 2^32 を割り切らないため厳密には均等でないが、
  // 偏りは 2^-27 程度で、24文字の強度に影響しない
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * パスワードの入力欄2つと自動生成。
 *
 * 自動生成を置くのは、強いパスワードにするのが一番楽な道になるようにするため。
 * 生成した値は画面に出す（コピーして本人に別途渡してもらう）。
 */
function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  function handleGenerate() {
    const generated = generatePassword();
    onPassword(generated);
    onConfirm(generated);
    // 生成した値は本人に渡す必要があるので、見えるようにする
    setVisible(true);
  }

  return (
    <div className="space-y-3">
      <Field label="パスワード" hint={`${PASSWORD_MIN_LENGTH}文字以上`}>
        <input
          type={visible ? "text" : "password"}
          name="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="パスワード（確認）">
        <input
          type={visible ? "text" : "password"}
          name="confirm"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          className={`${secondaryButtonClass} px-3 py-1 text-xs`}
        >
          自動生成
        </button>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={`${secondaryButtonClass} px-3 py-1 text-xs`}
        >
          {visible ? "隠す" : "表示する"}
        </button>
      </div>
    </div>
  );
}
