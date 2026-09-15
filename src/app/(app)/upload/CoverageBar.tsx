import type { Range } from "@/lib/gmail/coverage";
import { toJstDay } from "@/lib/gmail/query";

/**
 * 走査済み期間の帯。
 *
 * 帯の右端は「走査済みの右端」。ここを「今」にすると、走査上限を常に10分手前で
 * 止めている分が永久に隙間として残り、走ったのに「未走査」と出てしまう。
 *
 * 直近の未走査部分は穴ではなく「まだ走査していない最新部分」なので、
 * 隙間ではなく「〜まで走査済み」という文言で出す。
 * 次回の「前回の続きから」がそこから始まるので、放置しても抜けない。
 */
export function CoverageBar({
  covered,
  gaps,
  overall,
}: {
  covered: Range[];
  gaps: Range[];
  overall: Range;
}) {
  const span = overall.to.getTime() - overall.from.getTime();
  if (span <= 0) return null;

  const percent = (range: Range) => ({
    left: `${((range.from.getTime() - overall.from.getTime()) / span) * 100}%`,
    width: `${((range.to.getTime() - range.from.getTime()) / span) * 100}%`,
  });

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">走査済みの期間</h2>
        <span className="text-xs text-slate-500">
          {overall.to.toLocaleString("ja-JP")} まで走査済み
        </span>
      </div>

      <div className="relative h-6 w-full overflow-hidden rounded bg-red-100">
        {covered.map((range, i) => (
          <div
            key={i}
            className="absolute top-0 h-full bg-emerald-400"
            style={percent(range)}
            title={`走査済み: ${toJstDay(range.from)} 〜 ${toJstDay(new Date(range.to.getTime() - 1))}`}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{toJstDay(overall.from)}</span>
        <span>{toJstDay(new Date(overall.to.getTime() - 1))}</span>
      </div>

      {gaps.length > 0 ? (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium">走査していない期間があります。</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {gaps.map((gap, i) => (
              <li key={i}>
                {toJstDay(gap.from)} 〜 {toJstDay(new Date(gap.to.getTime() - 1))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            下の期間を指定して取り込むと、この隙間が埋まります。
            走査が途中で止まった期間も、完了するまでここに残ります。
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-emerald-700">
          この範囲に抜けはありません。続きは下の期間指定から取り込めます。
        </p>
      )}
    </section>
  );
}
