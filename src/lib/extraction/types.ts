import { z } from "zod";

/**
 * 請求書PDFから抽出する項目。
 *
 * 読み取れなかった項目は null にする。推測で埋めるより、画面で人に入力させるほうが安全。
 */
export const ExtractedInvoiceSchema = z.object({
  /** 請求元の会社名・屋号（表記どおり） */
  vendorName: z.string().nullable(),
  /** 金融機関コード（4桁）。記載がなければ null */
  bankCode: z.string().nullable(),
  /** 金融機関名 */
  bankName: z.string().nullable(),
  /** 支店番号（3桁）。記載がなければ null */
  branchCode: z.string().nullable(),
  /** 支店名 */
  branchName: z.string().nullable(),
  /** 全銀の預金種目コード 1=普通 2=当座 4=貯蓄 9=その他 */
  accountType: z.enum(["1", "2", "4", "9"]).nullable(),
  /** 口座番号（数字のみ） */
  accountNumber: z.string().nullable(),
  /** 口座名義。カナ表記が併記されていればカナを優先する */
  recipientName: z.string().nullable(),
  /** 請求書番号 */
  invoiceNumber: z.string().nullable(),
  /** 発行日 YYYY-MM-DD */
  issueDate: z.string().nullable(),
  /** 支払期日 YYYY-MM-DD */
  dueDate: z.string().nullable(),
  /** 請求合計（税込・円・整数） */
  billedAmount: z.number().int().nullable(),
  /** 項目ごとの確信度 0.0〜1.0 */
  confidence: z.object({
    vendorName: z.number(),
    bankCode: z.number(),
    branchCode: z.number(),
    accountType: z.number(),
    accountNumber: z.number(),
    recipientName: z.number(),
    billedAmount: z.number(),
    dueDate: z.number(),
  }),
  /**
   * 人が確認すべき事項。
   * 複数口座の記載、ゆうちょの記号-番号表記、金額の不整合などをここに書く。
   */
  notes: z.string().nullable(),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

export interface ExtractionMeta {
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export type ExtractionResult =
  | { ok: true; data: ExtractedInvoice; meta: ExtractionMeta; raw: unknown }
  | { ok: false; error: string; meta: ExtractionMeta; raw?: unknown };

/**
 * 抽出の実装を差し替えられるようにするためのインターフェース。
 * LLMを使わない方式（テキスト抽出＋ルール）へ移行する場合もここを実装する。
 */
export interface InvoiceExtractor {
  extract(pdf: Buffer, fileName: string): Promise<ExtractionResult>;
}

/** 確信度がこれを下回る項目は画面で警告する */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;
