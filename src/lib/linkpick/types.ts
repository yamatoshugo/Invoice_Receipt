import { z } from "zod";

/**
 * メール本文から「請求書のダウンロードリンクはどれか」を判定する。
 *
 * 本文中の全URLを叩くわけにはいかない。配信停止・退会・承認のリンクを
 * サーバーが勝手に押すことになり、取り消せない結果が出る。
 * そこで、先にLLMに候補を絞らせてから、選ばれたものだけを取得する。
 *
 * extraction/ とは別のモジュールにしてある。同居させると PROMPT_VERSION を
 * 共有してしまい、請求書抽出のプロンプトを直すとリンク判定のバージョンまで上がる。
 */

export const LinkPickSchema = z.object({
  decision: z.enum([
    /** 直接PDFにつながるリンクがある */
    "download",
    /** 請求書のリンクはあるが、見るにはログインが必要 */
    "login_required",
    /** 請求書のリンクは無い */
    "none",
  ]),
  /**
   * 一覧の番号（1始まり）。decision が none なら null。
   *
   * URLを文字列で返させない。署名付きURLを1文字書き換えられただけで取得が壊れるうえ、
   * 存在しないホストを作られるとそのまま外部への接続要求になる。
   */
  primaryIndex: z.number().int().nullable(),
  /** 第1候補が外れたときに試す2番目。無ければ null */
  secondaryIndex: z.number().int().nullable(),
  /** 0.0〜1.0。記録と表示に使い、取得の可否は判定しない */
  confidence: z.number(),
  /** なぜそう判断したか。日本語。GmailItem.message_ にそのまま入り画面に出る */
  reason: z.string(),
});

export type LinkPick = z.infer<typeof LinkPickSchema>;

export interface LinkPickCandidate {
  url: string;
  anchorText: string | null;
}

export interface LinkPickInput {
  subject: string | null;
  fromRaw: string;
  /** 本文テキスト（切り詰め済み） */
  bodyText: string;
  /** 番号付きで提示するリンク。配列の順序がそのまま index になる */
  links: LinkPickCandidate[];
}

export interface LinkPickMeta {
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export type LinkPickResult =
  | { ok: true; data: LinkPick; meta: LinkPickMeta; raw: unknown }
  | { ok: false; error: string; meta: LinkPickMeta; raw?: unknown };

export interface LinkPicker {
  pick(input: LinkPickInput): Promise<LinkPickResult>;
}

/** LLMへ渡すリンクの上限。販促メールは平気で100本入っている */
export const MAX_LINKS = 60;
