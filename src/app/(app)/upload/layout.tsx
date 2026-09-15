import { requestBadgeCounts } from "@/lib/gmail/requests";
import { SubTabs } from "./SubTabs";

/**
 * 請求書の取り込み。入口は3つある。
 *
 * - メール経由（/upload）          : 専用Gmailに届いた添付PDFとリンクを期間指定でまとめて取り込む。月末の主作業
 * - アップロード経由（/upload/file）: 手元のPDFをドラッグ&ドロップ。Gmail以外で届いたものや急ぎの1件
 * - 送付依頼（/upload/requests）    : ログインが要るWeb明細サイトだった場合に、取引先へPDFの送付を依頼する
 */
export default async function UploadLayout({ children }: { children: React.ReactNode }) {
  const counts = await requestBadgeCounts();

  return (
    <div>
      <h1 className="text-xl font-semibold">請求書の取り込み</h1>
      <SubTabs requestCount={counts.unsent + counts.waiting} />
      {children}
    </div>
  );
}
