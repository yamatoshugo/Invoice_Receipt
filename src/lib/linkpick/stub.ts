import type { LinkPickInput, LinkPickResult, LinkPicker } from "./types";

/**
 * APIキー無しで画面を通しで触るためのダミー判定。
 *
 * アンカーテキストとURLの見た目だけで決める。精度は期待しない。
 * 本番で有効になると、URL請求書が全部「リンク無し」として静かに片付き、
 * 請求書が届いていないことに誰も気付かなくなる（index.ts で止めている）。
 */
export class StubLinkPicker implements LinkPicker {
  async pick(input: LinkPickInput): Promise<LinkPickResult> {
    const meta = { model: "stub", promptVersion: "stub", latencyMs: 0 };
    const text = (i: number) => `${input.links[i]!.anchorText ?? ""} ${input.links[i]!.url}`.toLowerCase();

    const loginAt = input.links.findIndex((_, i) => /ログイン|login|signin|会員/.test(text(i)));
    if (loginAt >= 0) {
      return {
        ok: true,
        data: {
          decision: "login_required",
          primaryIndex: loginAt + 1,
          secondaryIndex: null,
          confidence: 0.5,
          reason: "スタブ判定: ログインが要りそうなリンクです",
        },
        meta,
        raw: null,
      };
    }

    const pdfAt = input.links.findIndex((_, i) => /請求|invoice|seikyu|\.pdf/.test(text(i)));
    if (pdfAt >= 0) {
      return {
        ok: true,
        data: {
          decision: "download",
          primaryIndex: pdfAt + 1,
          secondaryIndex: null,
          confidence: 0.5,
          reason: "スタブ判定: 請求書のリンクらしきものです",
        },
        meta,
        raw: null,
      };
    }

    return {
      ok: true,
      data: {
        decision: "none",
        primaryIndex: null,
        secondaryIndex: null,
        confidence: 0.5,
        reason: "スタブ判定: 請求書のリンクは見つかりませんでした",
      },
      meta,
      raw: null,
    };
  }
}
