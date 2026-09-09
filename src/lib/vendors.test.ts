import { describe, expect, it } from "vitest";
import {
  describeMatch,
  fillFromVendor,
  matchVendor,
  normalizeVendorKey,
  type VendorLike,
  type VendorMatchable,
} from "./vendors";

const VENDOR: VendorLike = {
  id: "v1",
  name: "株式会社サンプル商事",
  matchKey: normalizeVendorKey("株式会社サンプル商事"),
  bankCode: "0009",
  bankName: "三井住友銀行",
  branchCode: "213",
  branchName: "渋谷支店",
  accountType: "1",
  accountNumber: "1234567",
  recipientName: "カ）サンプルショウジ",
};

/** 請求書から読み取れた項目だけを渡し、残りは空にする */
function invoice(overrides: Partial<VendorMatchable> = {}): VendorMatchable {
  return {
    vendorName: null,
    bankCode: null,
    bankName: null,
    branchCode: null,
    branchName: null,
    accountType: null,
    accountNumber: null,
    recipientName: null,
    ...overrides,
  };
}

describe("normalizeVendorKey", () => {
  it("法人格の位置と表記が違っても同じキーになる", () => {
    const expected = normalizeVendorKey("株式会社サンプル");
    expect(normalizeVendorKey("サンプル株式会社")).toBe(expected);
    expect(normalizeVendorKey("サンプル(株)")).toBe(expected);
    expect(normalizeVendorKey("サンプル（株）")).toBe(expected);
    expect(normalizeVendorKey("株式会社 サンプル")).toBe(expected);
    expect(normalizeVendorKey("株式会社　サンプル")).toBe(expected);
  });

  it("全角英数と半角英数を同一視する", () => {
    expect(normalizeVendorKey("ＡＢＣ商店")).toBe(normalizeVendorKey("abc商店"));
  });

  it("半角カナと全角カナを同一視する", () => {
    expect(normalizeVendorKey("ｻﾝﾌﾟﾙ")).toBe(normalizeVendorKey("サンプル"));
  });

  it("中黒・ハイフンなどの区切り記号を無視する", () => {
    expect(normalizeVendorKey("サンプル・デザイン")).toBe(normalizeVendorKey("サンプルデザイン"));
    expect(normalizeVendorKey("サンプル-商事")).toBe(normalizeVendorKey("サンプル商事"));
  });

  it("別の取引先は別のキーになる", () => {
    expect(normalizeVendorKey("株式会社サンプル")).not.toBe(normalizeVendorKey("株式会社サンプル商会"));
  });

  it("空や未設定は空文字を返す", () => {
    expect(normalizeVendorKey(null)).toBe("");
    expect(normalizeVendorKey("")).toBe("");
  });
});

describe("matchVendor", () => {
  it("マスタが空なら none", () => {
    const m = matchVendor(invoice({ vendorName: "株式会社サンプル商事" }), []);
    expect(m.state).toBe("none");
    expect(m.vendor).toBeNull();
  });

  it("取引先名も口座も一致しなければ none", () => {
    const m = matchVendor(
      invoice({ vendorName: "別会社", bankName: "みずほ銀行", accountNumber: "9999999" }),
      [VENDOR],
    );
    expect(m.state).toBe("none");
  });

  it("取引先名が一致し、読み取れた口座もマスタと同じなら matched", () => {
    const m = matchVendor(
      invoice({
        vendorName: "サンプル商事（株）",
        bankName: "三井住友銀行",
        accountNumber: "1234567",
      }),
      [VENDOR],
    );
    expect(m.state).toBe("matched");
    expect(m.vendor?.id).toBe("v1");
  });

  it("取引先名が一致するのに口座番号が違えば account_mismatch", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", accountNumber: "7654321" }),
      [VENDOR],
    );
    expect(m.state).toBe("account_mismatch");
    expect(m.mismatched).toContain("accountNumber");
  });

  it("支店番号が違うだけでも account_mismatch（振込先が変わるため）", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", branchCode: "999" }),
      [VENDOR],
    );
    expect(m.state).toBe("account_mismatch");
  });

  it("支店名の表記違いだけなら口座は変わらないので matched のまま", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", branchName: "渋谷支店（旧）" }),
      [VENDOR],
    );
    expect(m.state).toBe("matched");
    expect(m.mismatched).toContain("branchName");
  });

  it("取引先名が違っても銀行名＋口座番号が一致すれば name_mismatch", () => {
    const m = matchVendor(
      invoice({
        vendorName: "サンプル商事ホールディングス",
        bankName: "三井住友銀行",
        accountNumber: "1234567",
      }),
      [VENDOR],
    );
    expect(m.state).toBe("name_mismatch");
    expect(m.vendor?.id).toBe("v1");
  });

  it("口座番号の表記揺れ（ハイフン・全角）を吸収する", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", accountNumber: "123-4567" }),
      [VENDOR],
    );
    expect(m.state).toBe("matched");
  });

  it("受取人名は半角カナに寄せて比較する", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", recipientName: "カ)サンプルシヨウジ" }),
      [VENDOR],
    );
    expect(m.state).toBe("matched");
    expect(m.mismatched).not.toContain("recipientName");
  });

  it("空欄の項目だけが fillable に入る", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", bankName: "三井住友銀行" }),
      [VENDOR],
    );
    expect(m.fillable).toContain("bankCode");
    expect(m.fillable).toContain("branchCode");
    expect(m.fillable).not.toContain("bankName");
  });
});

describe("fillFromVendor", () => {
  it("空欄の項目だけを埋める", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", bankName: "三井住友銀行" }),
      [VENDOR],
    );
    const filled = fillFromVendor(m);
    expect(filled.bankCode).toBe("0009");
    expect(filled.branchCode).toBe("213");
    expect(filled.bankName).toBeUndefined();
  });

  it("請求書から読み取れた値は上書きしない", () => {
    const m = matchVendor(
      invoice({ vendorName: "株式会社サンプル商事", accountNumber: "7654321" }),
      [VENDOR],
    );
    // 口座が食い違う場合、その項目は補完対象にならない（塗り潰すと変更に気づけない）
    expect(fillFromVendor(m).accountNumber).toBeUndefined();
  });

  it("マスタに当たらなければ何も埋めない", () => {
    expect(fillFromVendor(matchVendor(invoice(), []))).toEqual({});
  });
});

describe("describeMatch", () => {
  it("口座相違はマスタと請求書の値を並べて知らせる", () => {
    const inv = invoice({ vendorName: "株式会社サンプル商事", accountNumber: "7654321" });
    const text = describeMatch(matchVendor(inv, [VENDOR]), inv);
    expect(text).toContain("口座情報が異なります");
    expect(text).toContain("1234567");
    expect(text).toContain("7654321");
  });

  it("補完したときは補完した項目名を並べる", () => {
    const inv = invoice({ vendorName: "株式会社サンプル商事" });
    const text = describeMatch(matchVendor(inv, [VENDOR]), inv);
    expect(text).toContain("支店番号");
    expect(text).toContain("補完しました");
  });

  it("マスタに当たらなければ何も書かない", () => {
    const inv = invoice({ vendorName: "別会社" });
    expect(describeMatch(matchVendor(inv, [VENDOR]), inv)).toBeNull();
  });
});
