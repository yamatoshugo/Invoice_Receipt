/**
 * 並列度を決めて順に処理する。
 *
 * 一度に全部投げるのではなく、走らせる本数を固定して端から詰めていく形。
 * 相手（Gmail API・自分のサーバー関数）の受け入れ量には上限があるので、
 * 件数に比例して同時接続が増える書き方は避ける。
 *
 * 結果は入力と同じ並び順で返す。呼び出し側が添字で画面の行と対応づけられるようにするため。
 * 処理そのものは順不同で終わるので、進捗の表示は「N件目」ではなく「完了 N 件」で出すこと。
 *
 * fn が投げると全体が reject する。1件の失敗で残りを止めたくない場合は、
 * 呼び出し側が fn の中で捕まえること。
 *
 * サーバー・ブラウザの両方から使う。環境に依存するものを import しないこと。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
