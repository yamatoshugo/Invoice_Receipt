import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LinkPickSchema } from "./types";
import { buildUserText, limitLinks } from "./validate";
import type { LinkPickInput, LinkPickResult, LinkPicker } from "./types";

const MODEL = "claude-opus-5";
export const LINK_PROMPT_VERSION = "v1";

/**
 * 禁止事項がこの機能の安全性そのもの。
 *
 * 取り込みは「取り逃がしたら人が拾える」が、誤って押したリンクは取り消せない。
 * 迷ったら none を選ばせる。
 */
const SYSTEM_PROMPT = `あなたは経理担当者の補助として、請求書メールの本文から「請求書を取得できるリンク」を1つ選びます。

## 絶対に選んではいけないリンク

押した時点で取り消せない結果が出るもの、または請求書と無関係なもの:

- 配信停止 / 購読解除 / 配信設定の変更 / unsubscribe / opt-out
- 退会 / アカウント削除 / パスワード変更 / メールアドレス変更 / ログアウト
- 「心当たりがない場合はこちら」「本人でない場合はこちら」
- 同意する / 承認する / 支払いを実行する / 口座を登録する / 申し込む
- SNS・会社ホームページ・採用情報・プライバシーポリシー・利用規約・お問い合わせ
- 署名欄に並んでいる会社サイトのURL
- 画像やトラッキング用のURL

## 選ぶべきリンク

- 「請求書」「ご請求」「請求内容」「ご利用明細」「Web明細」「invoice」「PDF」
  「ダウンロード」「明細を見る」などが近くにあるもの
- パスやファイル名が .pdf で終わるもの

## decision の決め方

- download: そのリンクを開けば請求書のPDFが直接手に入ると考えられる
- login_required: 請求書のリンクはあるが、見るにはログインや会員登録が必要
  （楽々明細・BtoBプラットフォーム・各社のWeb明細サービスなど）。
  この場合も primaryIndex にはそのリンクの番号を入れる
- none: 請求書を取得できるリンクが見当たらない。
  広告メール・通知メール・添付だけのメールはこれ

## 守ること

- リンクは必ず一覧の「番号」で指すこと。URLの文字列を書き換えたり、
  一覧に無いURLを作ったりしてはいけない
- 迷ったら none を選ぶこと。取りこぼしは人がGmailを見て拾えるが、
  誤って押したリンクは取り消せない
- confidence は自信の度合い（0.0〜1.0）。確証が無いときは低くする
- reason は、その判断の根拠を日本語1〜2文で書く。画面にそのまま表示される`;

export class ClaudeLinkPicker implements LinkPicker {
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async pick(input: LinkPickInput): Promise<LinkPickResult> {
    const startedAt = Date.now();
    const meta = { model: MODEL, promptVersion: LINK_PROMPT_VERSION, latencyMs: 0 };
    const links = limitLinks(input.links);

    if (links.length === 0) {
      return {
        ok: true,
        data: {
          decision: "none",
          primaryIndex: null,
          secondaryIndex: null,
          confidence: 1,
          reason: "本文にリンクがありません",
        },
        meta: { ...meta, latencyMs: 0 },
        raw: null,
      };
    }

    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        // これは推論ではなく分類。effort を下げないと思考トークンが費用を支配する
        output_config: { format: zodOutputFormat(LinkPickSchema), effort: "low" },
        messages: [{ role: "user", content: buildUserText({ ...input, links }) }],
      });

      const fullMeta = {
        ...meta,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };

      if (response.stop_reason === "refusal") {
        return { ok: false, error: "リンクの判定が拒否されました", meta: fullMeta, raw: response };
      }
      if (!response.parsed_output) {
        return { ok: false, error: "リンクの判定結果を取得できませんでした", meta: fullMeta, raw: response };
      }

      return { ok: true, data: response.parsed_output, meta: fullMeta, raw: response };
    } catch (error) {
      const message = error instanceof Error ? error.message : "リンクの判定に失敗しました";
      return { ok: false, error: message, meta: { ...meta, latencyMs: Date.now() - startedAt } };
    }
  }
}
