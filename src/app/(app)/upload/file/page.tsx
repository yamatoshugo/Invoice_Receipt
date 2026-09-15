import { storageMode } from "@/lib/storage";
import { UploadDropzone } from "../UploadDropzone";

export default function UploadFilePage() {
  return (
    <div>
      {/* 説明文だけは読みやすい幅に留める（全幅にすると1行が長くなりすぎる） */}
      <p className="mb-6 max-w-3xl text-sm text-slate-600">
        手元にあるPDFをここに投入します。Gmail以外の経路で届いたものや、急ぎで1件だけ入れたいときに使います。
        読み取りは1件あたり10〜40秒かかります。同じPDFを再度入れても二重には登録されません。
      </p>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <UploadDropzone mode={storageMode()} />

        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <h2 className="mb-2 font-medium text-slate-900">請求書がURLで届いた場合</h2>
          <p>
            請求書サービスのURLはログインが必要なため自動では取得できません。
            ブラウザでPDFをダウンロードしてから、他の請求書と同じようにここへ投入してください。
          </p>
        </div>
      </div>
    </div>
  );
}
