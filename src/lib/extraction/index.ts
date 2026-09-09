import { ClaudeInvoiceExtractor } from "./claude";
import { StubInvoiceExtractor } from "./stub";
import type { InvoiceExtractor } from "./types";

export * from "./types";
export { PROMPT_VERSION } from "./claude";

let cached: InvoiceExtractor | null = null;

/**
 * 抽出の実装を1箇所で選ぶ。
 * ルールベース等へ差し替える場合はここだけを変える。
 */
export function getInvoiceExtractor(): InvoiceExtractor {
  if (process.env.EXTRACTOR === "stub") {
    // スタブが返すのは実在しない口座番号なので、本番で有効になると
    // そのまま振込CSVに載って金銭事故になる。黙って通さず起動を止める。
    if (process.env.NODE_ENV === "production") {
      throw new Error("EXTRACTOR=stub は本番環境では使用できません");
    }
    cached ??= new StubInvoiceExtractor();
    return cached;
  }

  cached ??= new ClaudeInvoiceExtractor();
  return cached;
}
