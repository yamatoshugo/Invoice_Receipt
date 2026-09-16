import { describe, expect, it } from "vitest";
import { MAX_RETRY_WAIT_MS, retryWaitMs } from "./retry";

describe("retryWaitMs", () => {
  describe("Retry-After が返ってきたとき", () => {
    it("秒をミリ秒にして従う", () => {
      expect(retryWaitMs("3", 1)).toBe(3000);
    });

    it("★上限で頭打ちにする。相手の言い値をそのまま待たない", () => {
      // これが無いと、1回の呼び出しが60秒止まる。走査は実行時間の上限(300秒)の
      // 中で何度もAPIを叩くので、待ちだけで予算が尽きて打ち切られる。
      // 打ち切られるとカーソルが進まず、やり直しても同じところで止まり続ける
      expect(retryWaitMs("60", 1)).toBe(MAX_RETRY_WAIT_MS);
      expect(retryWaitMs("3600", 1)).toBe(MAX_RETRY_WAIT_MS);
    });

    it("上限ちょうどは切り捨てない", () => {
      expect(retryWaitMs(String(MAX_RETRY_WAIT_MS / 1000), 1)).toBe(MAX_RETRY_WAIT_MS);
    });

    it("上限は実行時間の上限(300秒)より十分に短い", () => {
      // 1回の待ちで予算の大半を使ってしまわないこと
      expect(MAX_RETRY_WAIT_MS).toBeLessThan(30 * 1000);
    });
  });

  describe("Retry-After が無い・使えないとき", () => {
    it("ヘッダが無ければ指数バックオフに落ちる", () => {
      const wait = retryWaitMs(null, 1);
      expect(wait).toBeGreaterThanOrEqual(500);
      expect(wait).toBeLessThan(750);
    });

    it("数値でない値は無視して指数バックオフに落ちる", () => {
      // HTTP日付形式で返してくる実装もある。解釈できないものを 0 と読んで
      // 即座に再試行すると、混んでいる相手をさらに叩くことになる
      const wait = retryWaitMs("Wed, 16 Sep 2026 12:00:00 GMT", 1);
      expect(wait).toBeGreaterThanOrEqual(500);
      expect(wait).toBeLessThan(750);
    });

    it("0 や負の値は無視する", () => {
      expect(retryWaitMs("0", 1)).toBeGreaterThanOrEqual(500);
      expect(retryWaitMs("-5", 1)).toBeGreaterThanOrEqual(500);
    });

    it("試行を重ねるほど長く待つ", () => {
      // 上限(5回)まで重ねても、合計が実行時間の上限を脅かさない範囲に収まること
      const worstTotal = [1, 2, 3, 4].reduce((sum, a) => sum + 2 ** a * 250 + 250, 0);
      expect(worstTotal).toBeLessThan(30 * 1000);
    });
  });
});
