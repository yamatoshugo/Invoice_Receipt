/**
 * 「請求書をPDFで送ってください」の文面ひな型（純関数）。
 *
 * ★既定文面はここに置く。Prismaの @default に長い日本語を書くと、
 * 文面を直すたびにマイグレーションが要るうえ、直す前に作られた行が
 * 古い文面を持ち続ける。DBの列が null なら「既定のまま」を意味する。
 */

/** 差し込める変数。画面の挿入ボタンもこの配列から作る */
export const REQUEST_VARS = ["取引先名", "元の件名", "受取アドレス", "自社名", "今日"] as const;

export type RequestVarName = (typeof REQUEST_VARS)[number];
export type RequestVars = Record<RequestVarName, string>;

export const DEFAULT_SUBJECT = "Re: {{元の件名}}";

/**
 * 方針:
 *   - 期限や「至急」を書かない。相手は既に有効な請求書を送っており、
 *     こちらの都合でお願いする側
 *   - URLも添付も入れない（迷惑メール判定とフィッシング疑いを避ける）
 *   - ★金額・口座を一切書かない。誤送信しても漏れるのは取引先名と自社名だけ
 */
export const DEFAULT_BODY = `{{取引先名}} ご担当者様

いつもお世話になっております。
{{自社名}} 経理担当でございます。

お送りいただきました「{{元の件名}}」につきまして、
請求書がWeb明細サイトでのご提供となっており、
恐れ入りますが弊社にて内容を確認できておりません。

つきましては、お手数をおかけし大変恐縮ですが、
請求書をPDFファイルにてご添付のうえ、本メールへご返信いただけますでしょうか。

ご返信は下記のアドレスにて承っております。
{{受取アドレス}}

お忙しいところ恐れ入りますが、何卒よろしくお願い申し上げます。

{{自社名}}
`;

export interface RenderResult {
  text: string;
  /** ひな型に書かれていたが、差し込める変数ではなかったもの。そのまま本文に残る */
  unknownVars: string[];
  /** 変数はあるが値が空だったもの。画面で注意を出す */
  emptyVars: string[];
}

/** `{{ 取引先名 }}` のように空白が入っていても拾う。閉じ括弧をまたがない */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * ひな型に値を差し込む。
 *
 * 危ない箇所が3つあり、どれも実際に壊れる:
 *
 * 1. ★置換は文字列ではなく関数で行う。文字列を渡すと、取引先名に含まれる
 *    `$&` や `$1` が置換パターンとして解釈されて本文が壊れる
 *    （取引先名は請求書から来る外部の値なので、実際に起こりうる）
 * 2. ★replace は1パスしか回らない。差し込んだ値の中の `{{...}}` が
 *    再展開されないのはこの性質に依存している。ループにしないこと
 * 3. ★書き間違えた変数はそのまま残す。黙って消すと文が不自然になるだけで
 *    誰も気付かない。例外も投げない（設定画面で編集途中の保存を邪魔しないため）
 */
export function renderTemplate(template: string, vars: RequestVars): RenderResult {
  const unknown = new Set<string>();
  const empty = new Set<string>();

  const text = template.replace(PLACEHOLDER, (whole, rawName: string) => {
    const name = rawName.trim();
    if (!isRequestVar(name)) {
      unknown.add(name);
      return whole;
    }
    const value = vars[name] ?? "";
    if (value === "") empty.add(name);
    return value;
  });

  return { text, unknownVars: [...unknown], emptyVars: [...empty] };
}

function isRequestVar(name: string): name is RequestVarName {
  return (REQUEST_VARS as readonly string[]).includes(name);
}

/**
 * 展開しきれていない差し込みが残っているか。
 * 残っていたら承認画面の送信ボタンを無効にする（`{{取引先名}}` 様、で送らない）。
 */
export function hasUnresolvedPlaceholders(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/** 本文の「{{今日}}」に入れる日付。JSTで数える */
export function todayLabel(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

/**
 * 返信を受け付けない可能性が高い宛先か。
 *
 * 楽々明細のような明細サイトの通知は noreply@ から来ることが多く、
 * そのまま送っても届かない。実務でいちばん起きる失敗なので必ず警告する。
 * ★ブロックはしない。正しい窓口を人が入れれば送れるようにしておく。
 */
export function looksUnreplyable(address: string): boolean {
  const local = address.split("@")[0]?.toLowerCase() ?? "";
  return /^(no-?reply|donotreply|do-not-reply|postmaster|mailer-daemon|noreply)/.test(local);
}
