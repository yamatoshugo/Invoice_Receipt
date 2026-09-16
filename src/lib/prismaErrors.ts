import { Prisma } from "@/generated/prisma";

/**
 * Prismaのエラーの判定。
 *
 * DBへ繋ぐもの（@/lib/prisma）を import しないこと。判定だけを切り出してあるので
 * そのままテストできる。
 */

/**
 * 指定した列の一意制約に当たったか（P2002）。
 *
 * ★必ず列名まで見ること。「一意制約に当たった」だけで分岐すると、
 * 想定していない別の制約違反まで同じ扱いに飲み込まれる。
 * 例えば取り込みでは、sha256 の競合は「同じ請求書が2回届いた」という
 * 想定内の事象だが、他の制約違反は想定外の不具合であって、
 * それを「重複です」と表示して静かに終わらせてはいけない。
 *
 * meta.target は Prisma のバージョンやDBによって配列にも文字列にもなるため、
 * どちらの形でも拾えるようにしてある。
 */
export function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target.includes(field);
  // 対象が分からないときは「当たっていない」に倒す。
  // 分からないものを想定内として飲み込むより、例外として表に出すほうが安全
  return false;
}

/**
 * 直列化の失敗（P2034）か。
 *
 * isolationLevel: "Serializable" のトランザクションは、他の処理と競合すると
 * 「両方を直列に並べても同じ結果にならない」と判断して片方を落とす。
 * ★これは不具合ではなく想定内の結果であり、正しい対処は「やり直す」こと。
 *
 * ただし黙ってリトライしないこと。ユーザーの削除のように取り返しがつかない操作では、
 * 人がもう一度状況を見てから押し直すほうが安全なので、画面に出して止める。
 */
export function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034";
}
