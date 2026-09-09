"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { buttonClass } from "@/components/ui";
import type { StorageMode } from "@/lib/storage/types";

type ItemState = "waiting" | "uploading" | "extracting" | "done" | "duplicate" | "error";

interface Item {
  file: File;
  state: ItemState;
  message?: string;
  invoiceId?: string;
}

const STATE_LABEL: Record<ItemState, string> = {
  waiting: "待機中",
  uploading: "アップロード中…",
  extracting: "読み取り中…",
  done: "完了",
  duplicate: "取込済み",
  error: "エラー",
};

const STATE_CLASS: Record<ItemState, string> = {
  waiting: "text-slate-500",
  uploading: "text-slate-700",
  extracting: "text-blue-700",
  done: "text-emerald-700",
  duplicate: "text-amber-700",
  error: "text-red-700",
};

/**
 * 1通のPDFを保管先へ送り、取り込みAPIに渡す識別子を得る。
 *
 * 本番(Vercel Blob)はVercelのリクエストボディ上限(4.5MB)を避けるためブラウザから直接送るが、
 * ローカル動作確認ではBlobストアが無いのでサーバー経由で置く。
 * どちらも同じ { pathname, url } を返すので、この先の取り込み経路は共通になる。
 */
async function storeFile(file: File, mode: StorageMode): Promise<{ pathname: string; url: string }> {
  if (mode === "local") {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "アップロードに失敗しました");
    }
    return res.json();
  }

  const blob = await upload(file.name, file, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    contentType: "application/pdf",
  });
  return { pathname: blob.pathname, url: blob.url };
}

export function UploadDropzone({ mode }: { mode: StorageMode }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const update = useCallback((index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }, []);

  const process = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      const rejected = files.length - pdfs.length;
      if (pdfs.length === 0) {
        if (rejected > 0) window.alert("PDFファイルを選択してください。");
        return;
      }

      const startIndex = items.length;
      setItems((prev) => [...prev, ...pdfs.map((file) => ({ file, state: "waiting" as ItemState }))]);
      setRunning(true);

      // 1件ずつ順に処理する。読み取りは1件あたり数十秒かかるため、
      // まとめて投げるとサーバー側で詰まり、進捗も分からなくなる。
      for (let i = 0; i < pdfs.length; i += 1) {
        const index = startIndex + i;
        const file = pdfs[i];

        try {
          update(index, { state: "uploading" });
          const stored = await storeFile(file, mode);

          update(index, { state: "extracting" });
          const res = await fetch("/api/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pathname: stored.pathname,
              url: stored.url,
              fileName: file.name,
              size: file.size,
            }),
          });
          const data = await res.json();

          if (res.status === 409) {
            update(index, { state: "duplicate", message: data.message, invoiceId: data.existingId });
          } else if (!res.ok) {
            update(index, { state: "error", message: data.error ?? "取り込みに失敗しました" });
          } else if (data.extracted === false) {
            update(index, {
              state: "error",
              message: `取り込みましたが読み取りに失敗しました: ${data.error}`,
              invoiceId: data.invoice.id,
            });
          } else {
            update(index, { state: "done", invoiceId: data.invoice.id });
          }
        } catch (error) {
          update(index, {
            state: "error",
            message: error instanceof Error ? error.message : "不明なエラー",
          });
        }
      }

      setRunning(false);
      router.refresh();
    },
    [items.length, mode, router, update],
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!running) void process(Array.from(e.dataTransfer.files));
        }}
        className={
          dragging
            ? "rounded-lg border-2 border-dashed border-slate-900 bg-slate-100 p-12 text-center"
            : "rounded-lg border-2 border-dashed border-slate-300 bg-white p-12 text-center"
        }
      >
        <p className="text-sm text-slate-700">請求書のPDFをここにドラッグ&ドロップ</p>
        <p className="mt-1 text-xs text-slate-500">複数まとめて指定できます</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            void process(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={`${buttonClass} mt-4`}
          disabled={running}
          onClick={() => inputRef.current?.click()}
        >
          {running ? "処理中…" : "ファイルを選ぶ"}
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {items.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1 truncate">{item.file.name}</span>
              <span className={`text-xs whitespace-nowrap ${STATE_CLASS[item.state]}`}>
                {STATE_LABEL[item.state]}
              </span>
              {item.invoiceId && (
                <Link
                  href={`/invoices/${item.invoiceId}`}
                  className="text-xs whitespace-nowrap text-slate-500 underline hover:text-slate-900"
                >
                  開く
                </Link>
              )}
              {item.message && (
                <span className="max-w-md truncate text-xs text-slate-500" title={item.message}>
                  {item.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
