"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

/**
 * 取り込みの3つの入口。
 *
 * 請求書一覧のフィルタタブと同じ見た目にして、同じ操作だと分かるようにする。
 */
const TABS = [
  { href: "/upload", label: "メール経由" },
  { href: "/upload/file", label: "アップロード経由" },
  { href: "/upload/requests", label: "送付依頼" },
];

export function SubTabs({ requestCount }: { requestCount: number }) {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex gap-1 border-b border-slate-200">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={clsx(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
            pathname === tab.href
              ? "border-slate-900 font-medium"
              : "border-transparent text-slate-500 hover:text-slate-900",
          )}
        >
          {tab.label}
          {/* 見に行かなくても数字が出続けること自体が、依頼と返信待ちの可視化になる */}
          {tab.href === "/upload/requests" && requestCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 tabular-nums">
              {requestCount}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
