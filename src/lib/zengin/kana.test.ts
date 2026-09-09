import { describe, expect, it } from "vitest";
import { toZenginKana } from "./kana";

describe("toZenginKana", () => {
  describe("銀行公式サンプルの再現", () => {
    it("後株の依頼人名が公式サンプルどおりに変換される", () => {
      // 仕様書の例: ｽﾐｴｽｼﾖｳｼﾞ(ｶ
      const r = toZenginKana("スミエスショウジ株式会社");
      expect(r.value).toBe("ｽﾐｴｽｼﾖｳｼﾞ(ｶ");
      expect(r.ok).toBe(true);
    });

    it("スペース入りの個人名が公式サンプルどおりに変換される", () => {
      // 仕様書の例: ｽﾐｼﾝ ﾀﾛｳ
      const r = toZenginKana("スミシン タロウ");
      expect(r.value).toBe("ｽﾐｼﾝ ﾀﾛｳ");
      expect(r.ok).toBe(true);
    });
  });

  describe("法人格の略号と位置", () => {
    it("前株は ｶ) になる", () => {
      expect(toZenginKana("株式会社サンプル").value).toBe("ｶ)ｻﾝﾌﾟﾙ");
    });

    it("後株は (ｶ になる", () => {
      expect(toZenginKana("サンプル株式会社").value).toBe("ｻﾝﾌﾟﾙ(ｶ");
    });

    it("中間の法人格は (ｶ) になる", () => {
      expect(toZenginKana("トウキョウ株式会社シブヤ").value).toBe("ﾄｳｷﾖｳ(ｶ)ｼﾌﾞﾔ");
    });

    it("法人格の直近の空白は詰められる", () => {
      expect(toZenginKana("株式会社 サンプル").value).toBe("ｶ)ｻﾝﾌﾟﾙ");
      expect(toZenginKana("サンプル 株式会社").value).toBe("ｻﾝﾌﾟﾙ(ｶ");
    });

    it("有限会社・合同会社・一般社団法人がそれぞれの略号になる", () => {
      expect(toZenginKana("有限会社サンプル").value).toBe("ﾕ)ｻﾝﾌﾟﾙ");
      expect(toZenginKana("合同会社サンプル").value).toBe("ﾄﾞ)ｻﾝﾌﾟﾙ");
      expect(toZenginKana("一般社団法人サンプル").value).toBe("ｼﾔ)ｻﾝﾌﾟﾙ");
    });

    it("「社団法人」より「一般社団法人」が優先して一致する", () => {
      // 長い表記を先に当てないと「一般」が漢字のまま残ってしまう
      const r = toZenginKana("一般社団法人サンプル");
      expect(r.ok).toBe(true);
      expect(r.value).not.toContain("一");
    });

    it("カナ表記の法人格も略号になる", () => {
      expect(toZenginKana("カブシキガイシャサンプル").value).toBe("ｶ)ｻﾝﾌﾟﾙ");
      expect(toZenginKana("サンプルカブシキカイシャ").value).toBe("ｻﾝﾌﾟﾙ(ｶ");
    });
  });

  describe("カナの変換規則", () => {
    it("濁点・半濁点は分離され2文字を消費する", () => {
      const r = toZenginKana("ガパ");
      expect(r.value).toBe("ｶﾞﾊﾟ");
      expect(r.length).toBe(4);
    });

    it("小書き文字は大書きになる", () => {
      expect(toZenginKana("キャノン").value).toBe("ｷﾔﾉﾝ");
      expect(toZenginKana("ジャパン").value).toBe("ｼﾞﾔﾊﾟﾝ");
      expect(toZenginKana("サッポロ").value).toBe("ｻﾂﾎﾟﾛ");
    });

    it("半角の小書きカナで入力された場合も大書きになる", () => {
      expect(toZenginKana("ｷｬﾉﾝ").value).toBe("ｷﾔﾉﾝ");
    });

    it("長音はｰになる", () => {
      expect(toZenginKana("コーヒー").value).toBe("ｺｰﾋｰ");
    });

    it("ヴはｳﾞになる", () => {
      expect(toZenginKana("ヴァイオリン").value).toBe("ｳﾞｱｲｵﾘﾝ");
    });

    it("ひらがなはカタカナ経由で変換される", () => {
      expect(toZenginKana("さんぷる").value).toBe("ｻﾝﾌﾟﾙ");
    });

    it("NFDで分解された濁点も正しく扱える", () => {
      const decomposed = "ガ".normalize("NFD");
      expect(decomposed.length).toBe(2); // 前提の確認
      expect(toZenginKana(decomposed).value).toBe("ｶﾞ");
    });
  });

  describe("英数字と空白", () => {
    it("全角英数は半角になり英字は大文字になる", () => {
      expect(toZenginKana("ＡＢＣ１２３").value).toBe("ABC123");
      expect(toZenginKana("abc123").value).toBe("ABC123");
    });

    it("全角スペースは半角になり、連続空白は1つにまとめられる", () => {
      expect(toZenginKana("ヤマダ　　タロウ").value).toBe("ﾔﾏﾀﾞ ﾀﾛｳ");
    });

    it("前後の空白は除去される", () => {
      expect(toZenginKana("  ﾔﾏﾀﾞ  ").value).toBe("ﾔﾏﾀﾞ");
    });

    it("中黒はピリオドになる", () => {
      expect(toZenginKana("エー・ビー").value).toBe("ｴｰ.ﾋﾞｰ");
    });
  });

  describe("使用不可文字の検出", () => {
    it("漢字が残ると ok=false になり警告が出る", () => {
      const r = toZenginKana("山田太郎");
      expect(r.ok).toBe(false);
      expect(r.invalidChars).toEqual(["山", "田", "太", "郎"]);
      expect(r.warnings.join()).toContain("漢字");
    });

    it("アンパサンドは使用不可として検出される", () => {
      const r = toZenginKana("A&B");
      expect(r.ok).toBe(false);
      expect(r.invalidChars).toEqual(["&"]);
    });

    it("カンマはCSV区切りと衝突するため使用不可として検出される", () => {
      const r = toZenginKana("ヤマダ、タロウ");
      expect(r.ok).toBe(false);
      expect(r.invalidChars).toEqual([","]);
    });

    it("円記号はShift_JISで曖昧なため使用不可として検出される", () => {
      const r = toZenginKana("¥100");
      expect(r.ok).toBe(false);
      expect(r.invalidChars).toEqual(["¥"]);
    });

    it("使用不可文字は重複排除され出現順に並ぶ", () => {
      const r = toZenginKana("山山川");
      expect(r.invalidChars).toEqual(["山", "川"]);
    });

    it("使用不可文字があっても変換結果は捨てずに返す（画面で該当箇所を示せるように）", () => {
      const r = toZenginKana("株式会社山田");
      expect(r.value).toBe("ｶ)山田");
      expect(r.ok).toBe(false);
    });

    it("許可された記号は通る", () => {
      const r = toZenginKana("A-B.C/D(E)");
      expect(r.ok).toBe(true);
      expect(r.value).toBe("A-B.C/D(E)");
    });
  });

  describe("境界値", () => {
    it("空文字は ok かつ空を返す", () => {
      const r = toZenginKana("");
      expect(r.value).toBe("");
      expect(r.ok).toBe(true);
      expect(r.length).toBe(0);
    });

    it("空白のみは空になる", () => {
      expect(toZenginKana("　 ").value).toBe("");
    });

    it("lengthは濁点を含めた変換後の文字数を返す", () => {
      // ﾔﾏﾀﾞ = 4文字（ﾔ ﾏ ﾀ ﾞ）
      expect(toZenginKana("ヤマダ").length).toBe(4);
    });
  });
});
