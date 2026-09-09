import { storageMode } from "@/lib/storage";
import { UploadDropzone } from "./UploadDropzone";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">請求書の取り込み</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        受信メールの添付PDFをまとめてダウンロードし、ここに投入してください。
        読み取りは1件あたり10〜40秒かかります。同じPDFを再度入れても二重には登録されません。
      </p>

      <UploadDropzone mode={storageMode()} />

      <div className="mt-8 rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <h2 className="mb-2 font-medium text-slate-900">請求書がURLで届いた場合</h2>
        <p>
          請求書サービスのURLはログインが必要なため自動では取得できません。
          ブラウザでPDFをダウンロードしてから、他の請求書と同じようにここへ投入してください。
        </p>
      </div>
    </div>
  );
}
