import { devLoginEnabled } from "@/auth";
import { storageMode } from "@/lib/storage";

/**
 * ローカル動作確認用の設定が有効なことを画面上で知らせる。
 *
 * 特にスタブ抽出は、実在しない口座番号が本物の読み取り結果に見えてしまう。
 * それを承認してCSVに載せるのがこのシステムで最も避けたい事故なので、
 * メモ欄の注記だけに頼らず、全画面の最上部で目に入るようにする。
 *
 * 本番ではこれらの環境変数を設定しないため、何も描画されない。
 */
export function DevModeBanner() {
  const stubExtraction = process.env.EXTRACTOR === "stub";
  const devModes = [
    devLoginEnabled ? "簡易ログイン" : null,
    storageMode() === "local" ? "PDFをローカル保存" : null,
  ].filter(Boolean);

  if (!stubExtraction && devModes.length === 0) return null;

  return (
    <div>
      {stubExtraction && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2.5 text-center text-sm font-medium text-red-800">
          読み取り結果はダミーです。PDFの中身は読んでいません。
          <span className="font-semibold">この口座情報で振り込まないでください。</span>
          <span className="ml-2 font-normal text-red-600">
            実際に読み取るには .env の EXTRACTOR=&quot;stub&quot; を外してください
          </span>
        </div>
      )}
      {devModes.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-center text-xs text-amber-800">
          開発モード（{devModes.join(" / ")}）— 本番環境では無効になります
        </div>
      )}
    </div>
  );
}
