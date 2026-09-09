import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "請求書一括振込",
  description: "請求書PDFから振込データを作成し、総合振込CSVを出力する",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
