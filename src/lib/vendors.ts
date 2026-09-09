import { digitsOnly } from "@/lib/invoices";
import { ENTITY_ABBREVIATIONS, toZenginKana } from "@/lib/zengin/kana";

/**
 * 取引先マスタとの照合。
 *
 * DBに触らない純関数だけを置く。一覧・明細画面・承認ガードがすべてここを呼ぶことで、
 * 「一覧では一致と出ているのに承認できない」といった食い違いが起きないようにする。
 */

/** 補完と照合の対象になる口座項目 */
export const VENDOR_FIELDS = [
  "bankCode",
  "bankName",
  "branchCode",
  "branchName",
  "accountType",
  "accountNumber",
  "recipientName",
] as const;

export type VendorField = (typeof VENDOR_FIELDS)[number];

export const VENDOR_FIELD_LABELS: Record<VendorField, string> = {
  bankCode: "金融機関コード",
  bankName: "金融機関名",
  branchCode: "支店番号",
  branchName: "支店名",
  accountType: "預金種目",
  accountNumber: "口座番号",
  recipientName: "受取人名",
};

export type VendorMatchState =
  /** 取引先名でも口座でも見つからない＝新規の取引先 */
  | "none"
  /** 取引先名・口座ともマスタと一致 */
  | "matched"
  /** 取引先名は一致するが口座が違う。口座変更詐欺の形なので承認を止める */
  | "account_mismatch"
  /** 口座は一致するが取引先名が違う。改称・表記変更が主因なので止めない */
  | "name_mismatch";

/** 照合に必要な項目だけを持つ形。Invoice でも抽出結果でも渡せる */
export type VendorMatchable = { vendorName: string | null } & {
  [K in VendorField]: string | null;
};

/** 照合対象のマスタ。Prisma の Vendor をそのまま渡せる */
export type VendorLike = { id: string; name: string; matchKey: string } & {
  [K in VendorField]: string;
};

export interface VendorMatch {
  vendor: VendorLike | null;
  state: VendorMatchState;
  /** 請求書が空欄で、マスタから埋められる項目 */
  fillable: VendorField[];
  /** 両方に値があって食い違う項目 */
  mismatched: VendorField[];
}

const ENTITY_NAMES = ENTITY_ABBREVIATIONS.map(([name]) => name).sort((a, b) => b.length - a.length);

/**
 * 括弧書きの法人格。「サンプル(株)」の形で届く。
 * ㈱ ㈲ などの合成文字は NFKC で (株) (有) に開かれるので、この1本で拾える。
 */
const BRACKETED_ENTITY = /[(（]\s*(特非|農協|生協|株|有|合|資|名|医|財|社|学|宗|福|税|弁|監)\s*[)）]/g;

/**
 * 取引先名から照合キーを作る。
 * 「株式会社サンプル」「サンプル(株)」「ｻﾝﾌﾟﾙ　株式会社」がすべて同じキーになる。
 */
export function normalizeVendorKey(name: string | null | undefined): string {
  if (!name) return "";
  // NFKC で全角英数・半角カナ・㈱ などの合成文字を一度そろえる
  let s = name.normalize("NFKC").toUpperCase();
  // 法人格は表記も位置も揺れるので、キーからは落とす。括弧書きを先に処理する
  s = s.replace(BRACKETED_ENTITY, "");
  for (const entity of ENTITY_NAMES) {
    s = s.split(entity.normalize("NFKC").toUpperCase()).join("");
  }
  // 残った括弧と区切り記号を落とす
  s = s.replace(/[（）()［］\[\]「」【】・,.\-‐－—_/／\s]/g, "");
  return s;
}

/** 口座番号は表記揺れ（ハイフン・全角）を吸収して比べる */
function sameAccountNumber(a: string | null, b: string | null): boolean {
  return digitsOnly(a?.normalize("NFKC")) === digitsOnly(b?.normalize("NFKC"));
}

/** 受取人名は半角カナへ寄せてから比べる。「ヤマトシュウゴ」と「ヤマトシユウゴ」は同じ口座 */
function sameRecipientName(a: string | null, b: string | null): boolean {
  return toZenginKana(a ?? "").value === toZenginKana(b ?? "").value;
}

function sameField(field: VendorField, a: string | null, b: string | null): boolean {
  if (field === "accountNumber") return sameAccountNumber(a, b);
  if (field === "recipientName") return sameRecipientName(a, b);
  return (a ?? "").normalize("NFKC").trim() === (b ?? "").normalize("NFKC").trim();
}

/** 口座を特定する3項目。ここが食い違えば振込先が変わっている */
const ACCOUNT_KEY_FIELDS: VendorField[] = ["branchCode", "accountNumber", "accountType"];

function compare(invoice: VendorMatchable, vendor: VendorLike) {
  const fillable: VendorField[] = [];
  const mismatched: VendorField[] = [];

  for (const field of VENDOR_FIELDS) {
    const own = invoice[field]?.trim() || null;
    if (own === null) {
      fillable.push(field);
    } else if (!sameField(field, own, vendor[field])) {
      mismatched.push(field);
    }
  }
  return { fillable, mismatched };
}

/**
 * 取引先マスタと突き合わせる。
 *
 * 取引先名 → 銀行名＋口座番号 の順で探す。名前を先に見るのは、
 * 「同じ取引先なのに口座が違う」を検知したいため。口座で先に引くと、
 * 口座が変わった請求書は単に「マスタに無い」となって警告を出せない。
 */
export function matchVendor(invoice: VendorMatchable, vendors: VendorLike[]): VendorMatch {
  const key = normalizeVendorKey(invoice.vendorName);

  const byName = key ? (vendors.find((v) => v.matchKey === key) ?? null) : null;
  if (byName) {
    const { fillable, mismatched } = compare(invoice, byName);
    // 口座を特定する項目が食い違っていれば、振込先が変わっている
    const accountChanged = mismatched.some((f) => ACCOUNT_KEY_FIELDS.includes(f));
    return {
      vendor: byName,
      state: accountChanged ? "account_mismatch" : "matched",
      fillable,
      mismatched,
    };
  }

  const byAccount =
    invoice.accountNumber && invoice.bankName
      ? (vendors.find(
          (v) =>
            sameAccountNumber(v.accountNumber, invoice.accountNumber) &&
            sameField("bankName", invoice.bankName, v.bankName),
        ) ?? null)
      : null;
  if (byAccount) {
    const { fillable, mismatched } = compare(invoice, byAccount);
    return { vendor: byAccount, state: "name_mismatch", fillable, mismatched };
  }

  return { vendor: null, state: "none", fillable: [], mismatched: [] };
}

/**
 * 補完する値を組み立てる。
 *
 * 埋めるのは請求書が空欄の項目だけ。LLMが請求書から読み取った値は絶対に上書きしない。
 * 上書きすると、検知したい「口座が変わっている」という事実がマスタの値で塗り潰される。
 */
export function fillFromVendor(match: VendorMatch): Partial<Record<VendorField, string>> {
  if (!match.vendor) return {};
  const filled: Partial<Record<VendorField, string>> = {};
  for (const field of match.fillable) filled[field] = match.vendor[field];
  return filled;
}

/** 取り込み時に note へ追記する説明。人が明細画面で気づけるようにする */
export function describeMatch(match: VendorMatch, invoice: VendorMatchable): string | null {
  if (!match.vendor) return null;

  if (match.state === "account_mismatch") {
    const details = match.mismatched
      .map(
        (f) =>
          `${VENDOR_FIELD_LABELS[f]}: マスタ「${match.vendor![f]}」/ 請求書「${invoice[f] ?? ""}」`,
      )
      .join(" / ");
    return `取引先マスタ「${match.vendor.name}」と口座情報が異なります。振込先の変更でないか確認してください。${details}`;
  }

  const parts: string[] = [];
  if (match.state === "name_mismatch") {
    parts.push(
      `口座は取引先マスタ「${match.vendor.name}」と一致しますが、取引先名の表記が異なります。`,
    );
  }
  if (match.fillable.length > 0) {
    const labels = match.fillable.map((f) => VENDOR_FIELD_LABELS[f]).join("・");
    parts.push(`${labels}を取引先マスタ「${match.vendor.name}」から補完しました。`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
