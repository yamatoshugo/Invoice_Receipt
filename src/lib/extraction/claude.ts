import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ExtractedInvoiceSchema,
  type ExtractionResult,
  type InvoiceExtractor,
} from "./types";

const MODEL = "claude-opus-5";
export const PROMPT_VERSION = "v2";

const SYSTEM_PROMPT = `あなたは日本の経理担当者を補助し、請求書PDFから振込に必要な情報を読み取ります。
読み取った内容はそのまま銀行の総合振込データになるため、正確さが最優先です。

必ず守ること:
- 読み取れない項目、確信が持てない項目は必ず null にする。推測で埋めてはいけない。
- 「振込先」「お振込先」「送金先」などの見出しの近くにある口座情報を採用する。
  請求元の住所や電話番号に含まれる数字を口座番号と取り違えないこと。
- 金融機関コード(4桁)と支店番号(3桁)は、請求書に数字として印字されている場合のみ採用する。
  銀行名や支店名から一般に知られているコードを補完してはいけない。
  印字がなければ bankCode / branchCode は null にし、名称だけを bankName / branchName に残す。
  請求書で確認できない値を埋めると、人が突き合わせて検算できなくなるため。
- 受取人名（口座名義）は請求元の会社名と一致しないことがある。必ず口座名義として
  記載されているものを採用する。カナ表記が併記されていればカナを優先する。
- 金額は「合計」「ご請求金額」など税込の請求総額を採用する。小計や税額ではない。
  カンマや「円」「¥」を除いた整数にする。
- 日付は YYYY-MM-DD 形式にする。和暦は西暦に直す。年の記載がない場合は null にする。
- 預金種目は 1=普通 2=当座 4=貯蓄 9=その他 に対応させる。

notes に必ず書くこと（該当する場合）:
- 振込先口座が複数記載されている場合、どれを採用したか
- ゆうちょ銀行の「記号-番号」表記の場合（この表記は振込用の店番・口座番号へ変換が
  必要なため、accountNumber と branchCode は null にして、記号と番号を notes に書く）
- 小計・税額・合計が計算上合わない場合
- 振込手数料の負担に関する記載
- そもそも請求書ではないと思われる場合

confidence は各項目について、PDF上の記載を明確に読み取れたなら 1.0 に近く、
推測や解釈が入るなら低くする。null にした項目は 0 にする。
請求書に印字されていない値を入れた場合は必ず 0.5 以下にする（画面で警告を出すため）。`;

export class ClaudeInvoiceExtractor implements InvoiceExtractor {
  private client: Anthropic;

  constructor(client?: Anthropic) {
    // 引数なしなら ANTHROPIC_API_KEY など環境の資格情報を使う
    this.client = client ?? new Anthropic();
  }

  async extract(pdf: Buffer, fileName: string): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const meta = { model: MODEL, promptVersion: PROMPT_VERSION, latencyMs: 0 };

    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(ExtractedInvoiceSchema) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdf.toString("base64"),
                },
              },
              {
                type: "text",
                text: `この請求書（ファイル名: ${fileName}）から振込に必要な情報を読み取ってください。`,
              },
            ],
          },
        ],
      });

      const latencyMs = Date.now() - startedAt;
      const fullMeta = {
        ...meta,
        latencyMs,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };

      if (response.stop_reason === "refusal") {
        return {
          ok: false,
          error: "読み取りが拒否されました。請求書以外のPDFの可能性があります。",
          meta: fullMeta,
          raw: response,
        };
      }

      if (!response.parsed_output) {
        return {
          ok: false,
          error: "構造化された読み取り結果を得られませんでした。",
          meta: fullMeta,
          raw: response,
        };
      }

      return { ok: true, data: response.parsed_output, meta: fullMeta, raw: response };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const fullMeta = { ...meta, latencyMs };

      if (error instanceof Anthropic.RateLimitError) {
        return { ok: false, error: "APIの利用制限に達しました。時間をおいて再実行してください。", meta: fullMeta };
      }
      if (error instanceof Anthropic.AuthenticationError) {
        return { ok: false, error: "ANTHROPIC_API_KEY が正しく設定されていません。", meta: fullMeta };
      }
      if (error instanceof Anthropic.APIError) {
        return { ok: false, error: `読み取りAPIでエラーが発生しました (${error.status}): ${error.message}`, meta: fullMeta };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : "読み取り中に不明なエラーが発生しました。",
        meta: fullMeta,
      };
    }
  }
}
