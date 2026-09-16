/**
 * 再試行までの待ち時間の決め方。
 *
 * 判断だけをここに置き、実際に待つのは client.ts に任せる
 * （DBやfetchに触るものを import しないので、そのままテストできる）。
 */

/**
 * 再試行までに待つ時間の上限。
 *
 * Gmail が返す Retry-After には上限が無い。言われたまま待つと1回の呼び出しが
 * 数十秒止まり、走査のように実行時間の上限(300秒)の中で何度もAPIを叩く処理では
 * 待ちだけで予算が尽きる。しかも打ち切られるとカーソルが進まないので、
 * 同じところを何度やり直しても終わらなくなる。
 *
 * 頭打ちにしておけば、本当に混んでいるときは試行を使い切って呼び出し側に戻り、
 * 走査ならカーソルを残したまま終われる（次のチャンクで続きから再開できる）。
 */
export const MAX_RETRY_WAIT_MS = 10_000;

/**
 * 次の試行までに待つミリ秒。
 *
 * Retry-After があればそれに従う（ただし上限まで）。
 * 無ければ指数バックオフ＋ジッタ。ジッタは、同時に走っている呼び出しが
 * 揃って再試行して二度目の混雑を作らないため。
 */
export function retryWaitMs(retryAfterHeader: string | null, attempt: number): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
  }
  return 2 ** attempt * 250 + Math.random() * 250;
}
