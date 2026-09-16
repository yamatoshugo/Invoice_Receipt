import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * ログインパスワードのハッシュ化と照合。
 *
 * ★このファイルをクライアントコンポーネントから import しないこと。
 * node:crypto を読むので、定数1つを取るだけでもモジュール全体が
 * ブラウザ用バンドルに入り、promisify(scrypt) の評価で落ちて
 * 画面には「ページを読み込めません」しか出なくなる。
 * 画面から使えるのは passwordPolicy.ts のほうだけ。
 *
 * ★依存を足さずに node:crypto の scrypt を使う。lib/gmail/crypto.ts と同じ判断で、
 * 「何をどう保存しているか」を1ファイル読めば確かめられる状態を優先している。
 * bcrypt系は、ネイティブ版だとWindowsとVercelの両方でビルドの面倒を抱え、
 * 純JS版(bcryptjs)は同じ強度を出すのに数倍の時間がかかる。
 *
 * ★同期版(scryptSync)は使わない。1回あたり100ms前後CPUを占有するので、
 * 1つの関数インスタンスでイベントループを止め、同時に来た他のリクエストまで待たせる。
 * 非同期版は libuv のスレッドプールで動くのでイベントループを塞がない。
 */

const ALGORITHM = "scrypt";

/**
 * scrypt のパラメータ。必要メモリは 128 * N * r で、この値では 16MiB。
 *
 * ★N を上げるときは必ず MAXMEM も確認すること（下の MAXMEM のコメント参照）。
 * 既存のハッシュは文字列の中にパラメータを持っているので、値を変えても
 * 古いパスワードはそのまま照合できる。
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * ★node の既定 maxmem は 32MiB。N を 32768 にすると必要量がちょうど 32MiB に達し、
 * 「強度を上げただけ」のつもりが ERR_CRYPTO_INVALID_SCRYPT_PARAMS になって
 * 全員ログインできなくなる。明示して余裕を持たせておく。
 */
const MAXMEM = 64 * 1024 * 1024;

/**
 * 保存されている N の上限。
 *
 * ★DBの値が壊れた・書き換えられた場合の防御。N に巨大な数が入っていると
 * 128 * N * r バイトを確保しようとして関数ごと落ちる。
 * 上限を超えた行は「照合できない」＝ false として扱う。
 */
const MAX_N = 1 << 20;

// promisify は scrypt の「options 無し」のオーバーロードを拾うため、型を明示する
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

async function derive(plain: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return scryptAsync(plain, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAXMEM });
}

/**
 * 平文を "scrypt$N$r$p$<salt>$<hash>" 形式へ変換する。
 *
 * ★平文はここから先へ持ち出さない。戻り値だけをDBに入れること。
 * ソルトは毎回新規生成する。同じパスワードの人が2人いても別のハッシュになり、
 * 「この2人は同じパスワード」という事実すらDBから読み取れなくなる。
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(plain, salt, N, R, P);
  return [ALGORITHM, N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/** 10進の正の整数として読めるものだけを通す（"1e9" や "0x10" を弾く） */
function parsePositiveInt(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * 平文と保存済みハッシュを照合する。
 *
 * ★合わないときに例外を投げない。形式違い・base64の破損・別アルゴリズムも false を返す。
 * 「読めなかった」を例外にすると、DBの1行が壊れただけでログイン画面全体が500になり、
 * 原因が「パスワードが違う」と区別できなくなる。
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;

  const [algorithm, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) return false;

  const n = parsePositiveInt(rawN);
  const r = parsePositiveInt(rawR);
  const p = parsePositiveInt(rawP);
  if (n === null || r === null || p === null) return false;
  // ★壊れた行で巨大なメモリ確保を起こさない
  if (n > MAX_N) return false;

  const salt = Buffer.from(rawSalt, "base64");
  const expected = Buffer.from(rawHash, "base64");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await derive(plain, salt, n, r, p);
    // timingSafeEqual は長さが違うと例外になる。鍵長は秘密ではないので先に確認してよい
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    // パラメータの組み合わせが scrypt に拒否された場合など
    return false;
  }
}

/**
 * 登録されていないメールアドレスだったときに呼ぶ。必ず false を返す。
 *
 * ★存在しないアドレスだけ即座に返すと、応答時間の差だけで
 * 「このアドレスは登録済み」が外から分かってしまう（ユーザー列挙）。
 * 本物と同じだけ scrypt を回してから落とす。
 *
 * ★ダミーのハッシュ文字列をベタ書きしないこと。hashPassword() で作ることで、
 * 上のパラメータを変えたときに自動で同じ重さに追随する。
 */
let dummyHash: Promise<string> | null = null;

export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  await verifyPassword(plain, await dummyHash);
  return false;
}

/**
 * 秘密の値どうしを定数時間で比較する（環境変数の初期パスワードの照合に使う）。
 *
 * ★=== で比べない。当たれば全権限が取れる値なので、
 * 「何文字目まで一致したか」が時間に出ると1文字ずつ特定できてしまう。
 * 先に SHA-256 にすることで、長さが違っても timingSafeEqual が例外にならない
 * （長さの違い自体は漏れるが、ここで守りたいのは中身）。
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// 長さの規則は画面からも使うので passwordPolicy.ts に置いてある（理由はそちらのコメント）。
// サーバー側は password.ts だけ見れば済むように、ここから通しで再エクスポートする。
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from "@/lib/auth/passwordPolicy";
