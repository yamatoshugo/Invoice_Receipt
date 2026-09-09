import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { buildZenginCsv, type BuildZenginCsvInput, type TransferRecord } from "./csv";

/** 2025-12-25(木) は銀行営業日。仕様書サンプルの取組日 1225 に対応する。 */
const TRANSFER_DATE = new Date(2025, 11, 25);

const REQUESTER = {
  requesterCode: "2012345678",
  requesterName: "スミエスショウジ株式会社",
  senderBankCode: "38",
  senderBranchCode: "106",
  senderAccountNumber: "1234567",
};

function record(overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id: "inv-1",
    bankCode: "38",
    branchCode: "101",
    accountType: "1",
    accountNumber: "1234567",
    recipientName: "スミシン タロウ",
    amount: 1_000_000,
    ...overrides,
  };
}

function build(overrides: Partial<BuildZenginCsvInput> = {}) {
  return buildZenginCsv({
    requester: REQUESTER,
    transferDate: TRANSFER_DATE,
    records: [record()],
    ...overrides,
  });
}

describe("buildZenginCsv", () => {
  describe("公式サンプルとのゴールデンテスト", () => {
    // 仕様書「振込ファイルの作成（ＣＳＶ形式）」の例と完全に一致させる
    const EXPECTED = [
      "1,21,0,2012345678,ｽﾐｴｽｼﾖｳｼﾞ(ｶ,1225,38,,106,,1,1234567",
      "2,38,,101,,,1,1234567,ｽﾐｼﾝ ﾀﾛｳ,1000000,1",
      "2,38,,102,,,1,1234567,ｽﾐｼﾝ ﾀﾛｳ,100000",
      "2,38,,103,,,1,1234567,ｽﾐｼﾝ ﾀﾛｳ,10000",
      "8,3,1110000",
      "9",
    ].join("\r\n");

    const result = build({
      records: [
        record({ id: "a", branchCode: "101", amount: 1_000_000, newCode: "1" }),
        record({ id: "b", branchCode: "102", amount: 100_000 }),
        record({ id: "c", branchCode: "103", amount: 10_000 }),
      ],
    });

    it("生成に成功する", () => {
      expect(result.ok).toBe(true);
    });

    it("公式サンプルと1文字違わず一致する（末尾の改行のみ付与）", () => {
      if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
      expect(result.text).toBe(`${EXPECTED}\r\n`);
    });

    it("トレーラの件数と合計金額がデータレコードと整合する", () => {
      if (!result.ok) throw new Error("build failed");
      expect(result.recordCount).toBe(3);
      expect(result.totalAmount).toBe(1_110_000);
    });

    it("Shift_JISでエンコードされている", () => {
      if (!result.ok) throw new Error("build failed");
      // ｽ (U+FF7D) は Shift_JIS では 1バイトの 0xBD
      const headerStart = result.buffer.indexOf(0xbd);
      expect(headerStart).toBeGreaterThan(0);
      expect(result.buffer[0]).toBe(0x31); // '1' ヘッダーレコードのデータ区分
      // Shift_JIS へ戻すと元のテキストに一致する
      expect(iconv.decode(result.buffer, "Shift_JIS")).toBe(result.text);
    });

    it("全項目が半角のためバイト数と文字数が一致する", () => {
      if (!result.ok) throw new Error("build failed");
      expect(result.buffer.length).toBe(result.text.length);
    });
  });

  describe("レコード構成", () => {
    it("新規コードを指定しない場合はその項目ごと省略される", () => {
      const r = build({ records: [record()] });
      if (!r.ok) throw new Error("build failed");
      const dataLine = r.text.split("\r\n")[1];
      expect(dataLine.split(",")).toHaveLength(10);
    });

    it("新規コードを指定すると11項目になる", () => {
      const r = build({ records: [record({ newCode: "1" })] });
      if (!r.ok) throw new Error("build failed");
      expect(r.text.split("\r\n")[1].split(",")).toHaveLength(11);
    });

    it("エンドレコードは 9 のみ", () => {
      const r = build();
      if (!r.ok) throw new Error("build failed");
      const lines = r.text.trimEnd().split("\r\n");
      expect(lines.at(-1)).toBe("9");
      expect(lines.at(-2)).toBe("8,1,1000000");
    });

    it("預金種目は当座・貯蓄・その他も出力できる", () => {
      for (const t of ["2", "4", "9"] as const) {
        const r = build({ records: [record({ accountType: t })] });
        if (!r.ok) throw new Error("build failed");
        expect(r.text.split("\r\n")[1].split(",")[6]).toBe(t);
      }
    });
  });

  describe("受取人名の検証", () => {
    it("漢字が残る受取人名は生成をブロックする", () => {
      const r = build({ records: [record({ recipientName: "山田太郎" })] });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const e = r.errors.find((x) => x.field === "recipientName");
      expect(e?.recordId).toBe("inv-1");
      expect(e?.message).toContain("使用できない文字");
    });

    it("受取人名が30文字を超えると生成をブロックする", () => {
      // 濁点は独立した1文字を消費するため、見た目より早く上限に達する
      const r = build({ records: [record({ recipientName: "ガガガガガガガガガガガガガガガガ" })] });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.message.includes("30文字を超えて"))).toBe(true);
    });

    it("受取人名が空だと生成をブロックする", () => {
      const r = build({ records: [record({ recipientName: "  " })] });
      expect(r.ok).toBe(false);
    });

    it("法人格は略号に変換されて出力される", () => {
      const r = build({ records: [record({ recipientName: "株式会社サンプル" })] });
      if (!r.ok) throw new Error("build failed");
      expect(r.text.split("\r\n")[1].split(",")[8]).toBe("ｶ)ｻﾝﾌﾟﾙ");
    });
  });

  describe("桁数・金額の検証", () => {
    it("口座番号が8桁だと生成をブロックする", () => {
      const r = build({ records: [record({ accountNumber: "12345678" })] });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.field === "accountNumber")).toBe(true);
    });

    it("口座番号に数字以外が含まれると生成をブロックする", () => {
      const r = build({ records: [record({ accountNumber: "123-456" })] });
      expect(r.ok).toBe(false);
    });

    it("被仕向支店番号が4桁だと生成をブロックする", () => {
      const r = build({ records: [record({ branchCode: "1234" })] });
      expect(r.ok).toBe(false);
    });

    it("振込金額が0円以下だと生成をブロックする", () => {
      expect(build({ records: [record({ amount: 0 })] }).ok).toBe(false);
      expect(build({ records: [record({ amount: -1 })] }).ok).toBe(false);
    });

    it("振込金額が小数だと生成をブロックする", () => {
      expect(build({ records: [record({ amount: 100.5 })] }).ok).toBe(false);
    });

    it("振込金額が11桁だと生成をブロックする", () => {
      expect(build({ records: [record({ amount: 10_000_000_000 })] }).ok).toBe(false);
    });
  });

  describe("ヘッダーと取組日の検証", () => {
    it("振込依頼人コードが10桁でないと生成をブロックする", () => {
      const r = build({ requester: { ...REQUESTER, requesterCode: "201234567" } });
      expect(r.ok).toBe(false);
    });

    it("振込依頼人コードが20ではじまらない場合は警告する（生成は通す）", () => {
      const r = build({ requester: { ...REQUESTER, requesterCode: "1012345678" } });
      expect(r.ok).toBe(true);
      expect(r.warnings.some((w) => w.includes("20"))).toBe(true);
    });

    it("取組日が土曜だと生成をブロックする", () => {
      const r = build({ transferDate: new Date(2025, 11, 27) }); // 土
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.field === "transferDate")).toBe(true);
    });

    it("取組日が祝日だと生成をブロックする", () => {
      const r = build({ transferDate: new Date(2026, 0, 1) }); // 元日
      expect(r.ok).toBe(false);
    });

    it("振込対象が0件だと生成をブロックする", () => {
      const r = build({ records: [] });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.field === "records")).toBe(true);
    });
  });

  describe("エラーの集約", () => {
    it("複数件のエラーをまとめて返し、どの請求書かを特定できる", () => {
      const r = build({
        records: [
          record({ id: "ng-1", recipientName: "山田" }),
          record({ id: "ok-1" }),
          record({ id: "ng-2", accountNumber: "12345678" }),
        ],
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const ids = r.errors.map((e) => e.recordId);
      expect(ids).toContain("ng-1");
      expect(ids).toContain("ng-2");
      expect(ids).not.toContain("ok-1");
    });
  });
});
