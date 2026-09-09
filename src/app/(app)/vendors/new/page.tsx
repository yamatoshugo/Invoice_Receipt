import { VendorForm } from "../VendorForm";

export default function NewVendorPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">取引先を登録</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        銀行の窓口や取引先からの通知で確認した、正しい振込先を登録してください。
        ここに登録した内容が、以後の請求書の照合基準になります。
      </p>
      <VendorForm vendor={null} />
    </div>
  );
}
