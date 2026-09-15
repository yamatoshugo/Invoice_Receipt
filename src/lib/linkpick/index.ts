import { ClaudeLinkPicker } from "./claude";
import { StubLinkPicker } from "./stub";
import type { LinkPicker } from "./types";

export * from "./types";
export { buildUserText, formatLinkList, limitLinks, resolvePick } from "./validate";
export type { PickedLink } from "./validate";
export { LINK_PROMPT_VERSION } from "./claude";

let cached: LinkPicker | null = null;

/**
 * 本文のリンク判定器を返す。
 *
 * 抽出（extraction/）と同じく、環境変数でスタブに差し替えられる。
 * EXTRACTOR=stub のときも合わせてスタブにする（APIキー無しで通しで触れるようにするため）。
 */
export function getLinkPicker(): LinkPicker {
  if (process.env.LINK_PICKER === "stub" || process.env.EXTRACTOR === "stub") {
    // スタブは請求書リンクをまともに判定しない。本番で有効になると
    // URL請求書が「リンク無し」として静かに片付き、請求書が届いていないことに
    // 誰も気付かなくなる。黙って通さず起動を止める
    if (process.env.NODE_ENV === "production") {
      throw new Error("LINK_PICKER=stub は本番環境では使用できません");
    }
    cached ??= new StubLinkPicker();
    return cached;
  }

  cached ??= new ClaudeLinkPicker();
  return cached;
}
