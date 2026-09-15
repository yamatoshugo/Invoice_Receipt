import { MAX_LINKS } from "./types";
import type { LinkPick, LinkPickCandidate, LinkPickInput } from "./types";

/**
 * LLMに渡す材料の整形と、返ってきた答えの検証。
 *
 * ここを純関数にしておくと、プロンプトの組み立てと、番号→URLの対応が
 * 壊れていないことをモック無しで固定できる。
 */

/** 上限を超えるリンクは切る。先頭側（本文の前のほう）を残す */
export function limitLinks(links: LinkPickCandidate[]): LinkPickCandidate[] {
  return links.slice(0, MAX_LINKS);
}

/** LLMに見せる番号付きの一覧 */
export function formatLinkList(links: LinkPickCandidate[]): string {
  return links
    .map((l, i) => `${i + 1}. [${l.anchorText ?? "(テキストなし)"}] ${l.url}`)
    .join("\n");
}

export function buildUserText(input: LinkPickInput): string {
  return [
    `差出人: ${input.fromRaw || "(不明)"}`,
    `件名: ${input.subject ?? "(件名なし)"}`,
    "",
    "--- 本文 ---",
    input.bodyText || "(本文なし)",
    "",
    "--- 本文中のリンク ---",
    formatLinkList(input.links),
  ].join("\n");
}

export type PickedLink =
  | { kind: "download"; url: string; fallbackUrl: string | null; confidence: number; reason: string }
  | { kind: "login-required"; url: string; confidence: number; reason: string }
  | { kind: "none"; confidence: number; reason: string };

/**
 * LLMの答えを、実際に使える形へ落とす。
 *
 * 番号が範囲外なら採用しない。範囲外の番号を無視して decision だけ採ると、
 * 「請求書リンクがある」と言われたのにURLが無い、という壊れた状態になる。
 */
export function resolvePick(
  pick: LinkPick,
  links: LinkPickCandidate[],
): PickedLink | { kind: "invalid"; reason: string } {
  const confidence = clamp01(pick.confidence);
  const at = (index: number | null): string | null => {
    if (index === null) return null;
    if (!Number.isInteger(index) || index < 1 || index > links.length) return null;
    return links[index - 1]!.url;
  };

  if (pick.decision === "none") {
    return { kind: "none", confidence, reason: pick.reason };
  }

  const primary = at(pick.primaryIndex);
  if (!primary) {
    return {
      kind: "invalid",
      reason: `リンクの番号が範囲外です（${pick.primaryIndex} / 全${links.length}件）`,
    };
  }

  if (pick.decision === "login_required") {
    return { kind: "login-required", url: primary, confidence, reason: pick.reason };
  }

  const secondary = at(pick.secondaryIndex);
  return {
    kind: "download",
    url: primary,
    // 第1候補と同じものを2度叩かない
    fallbackUrl: secondary && secondary !== primary ? secondary : null,
    confidence,
    reason: pick.reason,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
