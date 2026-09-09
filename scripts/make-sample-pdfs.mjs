// 動作確認用のサンプルPDFを samples/ に作る。
//
//   node scripts/make-sample-pdfs.mjs
//
// 実際の請求書が手元に無くても、取り込み → 重複検知 → 承認 → CSV出力 の
// 動線を試せるようにするためのもの。中身は EXTRACTOR=stub でしか意味を持たない
// （スタブはPDFの中身を読まない）。実際の読み取り精度の確認には本物の請求書を使うこと。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** 依存ライブラリ無しで作る最小構成のPDF。ASCIIのみ */
function minimalPdf(lines) {
  const content =
    "BT /F1 14 Tf 60 760 Td 18 TL\n" +
    lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join("\n") +
    "\nET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

const SAMPLES = [
  { file: "sample-invoice-1.pdf", vendor: "Sample Trading Co., Ltd.", amount: "132,000" },
  { file: "sample-invoice-2.pdf", vendor: "Aoyama Design Office", amount: "88,000" },
  { file: "sample-invoice-3.pdf", vendor: "Yamada Manufacturing Inc.", amount: "451,000" },
];

const dir = path.join(process.cwd(), "samples");
await mkdir(dir, { recursive: true });

for (const [i, s] of SAMPLES.entries()) {
  const pdf = minimalPdf([
    "INVOICE (sample for local testing)",
    "",
    `From: ${s.vendor}`,
    `Invoice No: SAMPLE-${String(i + 1).padStart(4, "0")}`,
    `Total: JPY ${s.amount}`,
    "",
    "This file contains no real bank account.",
  ]);
  await writeFile(path.join(dir, s.file), pdf);
  console.log(`created samples/${s.file}`);
}
