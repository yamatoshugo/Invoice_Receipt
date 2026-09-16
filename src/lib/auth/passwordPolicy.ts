/**
 * パスワードの最低条件。
 *
 * ★このファイルは画面（クライアントコンポーネント）からも読む。
 * だから node: の組み込みモジュールを import してはいけない。
 *
 * ハッシュ化本体（password.ts）から切り出してあるのはそのため。
 * 定数1つを import しただけでもモジュール全体がブラウザ用のバンドルに入り、
 * その中の promisify(scrypt) がブラウザで評価された瞬間に例外になって
 * 「ページを読み込めません」だけが出る（原因が画面からは全く分からない）。
 */

/** 短すぎるパスワードを防ぐ最低ライン */
export const PASSWORD_MIN_LENGTH = 12;

/** 長すぎる入力でCPUを浪費させないための上限 */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * パスワードの最低条件を確かめる。問題があれば画面に出す日本語、無ければ null。
 *
 * ★「記号を1文字以上」のような構成規則は課さない。規則を増やすほど
 * 人は Password1! のような推測しやすい形に寄せるため（NIST SP 800-63B）。
 * 長さだけを見る。
 */
export function passwordProblem(plain: string): string | null {
  if (plain.trim() === "") return "パスワードを入力してください。";
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください。`;
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    return `パスワードは${PASSWORD_MAX_LENGTH}文字以内にしてください。`;
  }
  return null;
}
