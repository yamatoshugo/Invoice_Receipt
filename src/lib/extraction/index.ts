import { ClaudeInvoiceExtractor } from "./claude";
import type { InvoiceExtractor } from "./types";

export * from "./types";
export { PROMPT_VERSION } from "./claude";

let cached: InvoiceExtractor | null = null;

/**
 * 抽出の実装を1箇所で選ぶ。
 * ルールベース等へ差し替える場合はここだけを変える。
 */
export function getInvoiceExtractor(): InvoiceExtractor {
  cached ??= new ClaudeInvoiceExtractor();
  return cached;
}
