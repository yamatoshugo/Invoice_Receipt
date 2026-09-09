import { createHash } from "node:crypto";
import type { ExtractionResult, InvoiceExtractor } from "./types";

/**
 * PDFを読まずにダミーの読み取り結果を返す実装。
 *
 * Anthropic のAPIキーが無くても「取り込み → 確認 → 承認 → CSV出力」を
 * 通しで操作できるようにするためのもの。EXTRACTOR=stub のときだけ使う。
 */

const VENDORS = [
  { vendorName: "株式会社サンプル商事", recipientName: "カ）サンプルショウジ" },
  { vendorName: "デザインオフィス青山", recipientName: "デザインオフィスアオヤマ" },
  { vendorName: "有限会社山田製作所", recipientName: "ヤマダセイサクショ（ユ" },
  { vendorName: "ミーティングテクノロジー株式会社", recipientName: "ミーテイングテクノロジー（カ" },
];

const BANKS = [
  { bankCode: "0038", bankName: "住信SBIネット銀行", branchCode: "106", branchName: "イチゴ支店" },
  { bankCode: "0001", bankName: "みずほ銀行", branchCode: "001", branchName: "東京営業部" },
  { bankCode: "0009", bankName: "三井住友銀行", branchCode: "213", branchName: "渋谷支店" },
];

/** 同じPDFなら毎回同じ結果になるよう、内容のハッシュから決定的に値を作る */
function seedOf(pdf: Buffer, fileName: string): number {
  const hex = createHash("sha256").update(pdf).update(fileName).digest("hex");
  return parseInt(hex.slice(0, 8), 16);
}

function isoDate(base: Date, addDays: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class StubInvoiceExtractor implements InvoiceExtractor {
  async extract(pdf: Buffer, fileName: string): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const seed = seedOf(pdf, fileName);
    const vendor = VENDORS[seed % VENDORS.length];
    const bank = BANKS[(seed >> 3) % BANKS.length];
    const today = new Date();

    return {
      ok: true,
      data: {
        vendorName: vendor.vendorName,
        bankCode: bank.bankCode,
        bankName: bank.bankName,
        branchCode: bank.branchCode,
        branchName: bank.branchName,
        accountType: "1",
        accountNumber: String(1000000 + (seed % 9000000)),
        recipientName: vendor.recipientName,
        invoiceNumber: `INV-${String(seed % 100000).padStart(5, "0")}`,
        issueDate: isoDate(today, -7),
        dueDate: isoDate(today, 23),
        billedAmount: 10000 + (seed % 500) * 1000,
        confidence: {
          vendorName: 0.95,
          bankCode: 0.95,
          branchCode: 0.9,
          accountType: 0.9,
          accountNumber: 0.75, // 画面で低確信度の警告が出ることを確認できるよう、1項目だけ下げてある
          recipientName: 0.9,
          billedAmount: 0.95,
          dueDate: 0.85,
        },
        notes: "スタブ抽出です。PDFの中身は読んでいません。この値で振り込まないでください。",
      },
      meta: {
        model: "stub",
        promptVersion: "stub",
        latencyMs: Date.now() - startedAt,
      },
      raw: { stub: true, fileName },
    };
  }
}
