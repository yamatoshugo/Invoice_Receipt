import { prisma } from "@/lib/prisma";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });

  return (
    <div>
      <h1 className="text-xl font-semibold">振込依頼人の設定</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        CSVのヘッダーレコードに出力される、自社（振込元）の情報です。
        値はすべてネットバンキングの画面から取得してください。ここが誤っていると銀行で受付エラーになります。
      </p>
      <SettingsForm setting={setting} />
    </div>
  );
}
