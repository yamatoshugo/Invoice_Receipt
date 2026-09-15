/**
 * 依頼メールを「元のメールへの返信」として送るための判定（純関数）。
 *
 * 返信にする理由は3つあり、3つ目が設計上いちばん効く。
 *   1. 取引先が文脈で読める
 *   2. 迷惑メール判定に有利（既存の会話への返信は強いham信号）
 *   3. ★取引先がPDFを添付して返信すると同じスレッドに入る。
 *      次の走査でそれが記録され、「返信が来たか」を曖昧照合ではなく
 *      スレッドIDの等値比較で判定できる（reply.ts）
 */

/** "Re:" "RE:" "Ｒｅ：" "Re[2]:" などの接頭辞。先頭に何個並んでいても落とす */
const RE_PREFIX = /^(?:\s*(?:re|ｒｅ)(?:\[\d+\])?\s*[:：])+\s*/i;

/** 比較用に件名を均す。接頭辞と前後・連続の空白を無視する */
export function normalizeSubject(subject: string): string {
  return subject.replace(RE_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 返信の件名にする。既に Re: が付いていれば重ねない */
export function withRePrefix(subject: string): string {
  const base = subject.replace(RE_PREFIX, "").trim();
  return base === "" ? "Re:" : `Re: ${base}`;
}

/**
 * この件名で送ったとき、Gmailが元のスレッドに入れてくれるか。
 *
 * ★Gmail は threadId を渡しても、件名が一致しないとスレッドに入れない
 * （リクエストが失敗するのではなく、黙って新規メールになる）。
 * 人が件名を書き換えたときはエラーにせず、新規メールとして送る。
 * どちらになるかは承認画面にバッジで出して、送る前に分かるようにする。
 */
export function canThread(subject: string, originalSubject: string | null): boolean {
  if (originalSubject === null) return false;
  const original = normalizeSubject(originalSubject);
  if (original === "") return false;
  return normalizeSubject(subject) === original;
}
