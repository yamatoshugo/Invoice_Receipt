/**
 * 全銀フォーマット用 半角カナ変換
 *
 * 総合振込の受取人名・振込依頼人名は、半角カタカナ・半角英大文字・数字・
 * 一部記号しか使用できない。使用不可文字が混ざったまま銀行へ送ると
 * 受付エラーまたは振込不着になるため、変換できない文字は必ず検出して
 * 呼び出し側でCSV出力をブロックする。
 *
 * 参考: ドコモSMTBネット銀行「振込ファイル（CSV形式）」
 * https://www.netbk.co.jp/contents/resources/pdf/doc_soufuri_furikomicsv.pdf
 */

/** 全銀で使用できる記号（カンマと円記号は意図的に除外。理由は ALLOWED_SYMBOLS 下部を参照） */
const ALLOWED_SYMBOLS = " ().-/";
// カンマ ... CSVの項目区切りと衝突するため使用不可とする（銀行仕様上は許容だが引用符の規定がない）
// 円記号 ... Shift_JIS では 0x5C がバックスラッシュと同一コードで曖昧なため使用不可とする

/** 半角カタカナの許可コードポイント: ｦ / ｰ / ｱ〜ﾟ（小書きカナ ｧ〜ｯ は除外） */
function isAllowedHalfKana(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 0xff66 || c === 0xff70 || (c >= 0xff71 && c <= 0xff9f);
}

function isAllowedChar(ch: string): boolean {
  if (isAllowedHalfKana(ch)) return true;
  if (ch >= "A" && ch <= "Z") return true;
  if (ch >= "0" && ch <= "9") return true;
  return ALLOWED_SYMBOLS.includes(ch);
}

/**
 * 法人格の略号（全銀協ルール）。
 * 先頭にあれば `ｶ)`、末尾にあれば `(ｶ`、中間にあれば `(ｶ)` に変換する。
 * 長い表記から先に判定する必要があるため、登録順ではなく文字数降順で使用する。
 */
export const ENTITY_ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  ["株式会社", "ｶ"],
  ["有限会社", "ﾕ"],
  ["合資会社", "ｼ"],
  ["合名会社", "ﾒ"],
  ["合同会社", "ﾄﾞ"],
  ["相互会社", "ｿ"],
  ["特定非営利活動法人", "ﾄｸﾋ"],
  ["独立行政法人", "ﾄﾞｸ"],
  ["一般社団法人", "ｼﾔ"],
  ["公益社団法人", "ｼﾔ"],
  ["社団法人", "ｼﾔ"],
  ["一般財団法人", "ｻﾞｲ"],
  ["公益財団法人", "ｻﾞｲ"],
  ["財団法人", "ｻﾞｲ"],
  ["医療法人社団", "ｲ"],
  ["医療法人財団", "ｲ"],
  ["医療法人", "ｲ"],
  ["学校法人", "ｶﾞｸ"],
  ["宗教法人", "ｼﾕｳ"],
  ["社会福祉法人", "ﾌｸ"],
  ["弁護士法人", "ﾍﾞﾝ"],
  ["税理士法人", "ｾﾞｲ"],
  ["司法書士法人", "ｼﾎｳ"],
  ["行政書士法人", "ｷﾞﾖ"],
  ["監査法人", "ｶﾝｻ"],
  ["農業協同組合", "ﾉｳｷﾖｳ"],
  ["生活協同組合", "ｾｲｷﾖｳ"],
  ["企業組合", "ｷｷﾞﾖｳ"],
  ["協同組合", "ｷﾖｳﾄﾞｳ"],
  // カナ表記で届くケース
  ["カブシキガイシャ", "ｶ"],
  ["カブシキカイシャ", "ｶ"],
  ["ユウゲンガイシャ", "ﾕ"],
  ["ユウゲンカイシャ", "ﾕ"],
  ["ゴウドウガイシャ", "ﾄﾞ"],
  ["ゴウドウカイシャ", "ﾄﾞ"],
];

/** 文字数降順（同長なら登録順）。「社団法人」より「一般社団法人」を先に当てるため。 */
const ENTITY_PATTERNS = [...ENTITY_ABBREVIATIONS].sort((a, b) => b[0].length - a[0].length);

/** 全角カタカナ・記号 → 半角。濁点/半濁点は分離され2文字になる。小書きカナは大書きに寄せる。 */
const KANA_MAP: Readonly<Record<string, string>> = {
  ァ: "ｱ", ア: "ｱ", ィ: "ｲ", イ: "ｲ", ゥ: "ｳ", ウ: "ｳ", ェ: "ｴ", エ: "ｴ", ォ: "ｵ", オ: "ｵ",
  カ: "ｶ", ガ: "ｶﾞ", キ: "ｷ", ギ: "ｷﾞ", ク: "ｸ", グ: "ｸﾞ", ケ: "ｹ", ゲ: "ｹﾞ", コ: "ｺ", ゴ: "ｺﾞ",
  サ: "ｻ", ザ: "ｻﾞ", シ: "ｼ", ジ: "ｼﾞ", ス: "ｽ", ズ: "ｽﾞ", セ: "ｾ", ゼ: "ｾﾞ", ソ: "ｿ", ゾ: "ｿﾞ",
  タ: "ﾀ", ダ: "ﾀﾞ", チ: "ﾁ", ヂ: "ﾁﾞ", ッ: "ﾂ", ツ: "ﾂ", ヅ: "ﾂﾞ", テ: "ﾃ", デ: "ﾃﾞ", ト: "ﾄ", ド: "ﾄﾞ",
  ナ: "ﾅ", ニ: "ﾆ", ヌ: "ﾇ", ネ: "ﾈ", ノ: "ﾉ",
  ハ: "ﾊ", バ: "ﾊﾞ", パ: "ﾊﾟ", ヒ: "ﾋ", ビ: "ﾋﾞ", ピ: "ﾋﾟ", フ: "ﾌ", ブ: "ﾌﾞ", プ: "ﾌﾟ",
  ヘ: "ﾍ", ベ: "ﾍﾞ", ペ: "ﾍﾟ", ホ: "ﾎ", ボ: "ﾎﾞ", ポ: "ﾎﾟ",
  マ: "ﾏ", ミ: "ﾐ", ム: "ﾑ", メ: "ﾒ", モ: "ﾓ",
  ャ: "ﾔ", ヤ: "ﾔ", ュ: "ﾕ", ユ: "ﾕ", ョ: "ﾖ", ヨ: "ﾖ",
  ラ: "ﾗ", リ: "ﾘ", ル: "ﾙ", レ: "ﾚ", ロ: "ﾛ",
  ヮ: "ﾜ", ワ: "ﾜ", ヰ: "ｲ", ヱ: "ｴ", ヲ: "ｦ", ン: "ﾝ",
  ヴ: "ｳﾞ", ヵ: "ｶ", ヶ: "ｹ",
  ー: "ｰ", "・": ".", "。": ".", "、": ",", "　": " ",
  "「": "(", "」": ")", "（": "(", "）": ")",
};

/** 半角小書きカナ → 大書き（全銀では小書きカナを使用できない） */
const SMALL_HALF_KANA: Readonly<Record<string, string>> = {
  "ｧ": "ｱ", "ｨ": "ｲ", "ｩ": "ｳ", "ｪ": "ｴ", "ｫ": "ｵ",
  "ｬ": "ﾔ", "ｭ": "ﾕ", "ｮ": "ﾖ", "ｯ": "ﾂ",
};

export interface KanaResult {
  /** 変換後の文字列。使用不可文字は取り除かず残すので、画面でそのまま強調表示できる。 */
  value: string;
  /** 使用不可文字が1つも無ければ true */
  ok: boolean;
  /** 検出した使用不可文字（重複排除・出現順） */
  invalidChars: string[];
  /** 変換はできたが人の確認が望ましいもの */
  warnings: string[];
  /** 変換後の文字数（＝Shift_JISでのバイト数。全て半角のため一致する） */
  length: number;
}

/** 全角英数記号 → 半角、全角スペース → 半角スペース */
function toHalfWidthAscii(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xff01 && c <= 0xff5e) {
      out += String.fromCodePoint(c - 0xfee0);
    } else if (c === 0x3000) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** ひらがな → カタカナ（U+3041〜U+3096 を +0x60） */
function hiraganaToKatakana(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    out += c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
  }
  return out;
}

/**
 * 法人格を全銀の略号へ置換する。
 * 位置で表記が変わる（先頭 `ｶ)` / 末尾 `(ｶ` / 中間 `(ｶ)`）ため、
 * 置換のたびに位置を評価し直しながら、見つからなくなるまで繰り返す。
 */
function abbreviateEntities(input: string, warnings: string[]): string {
  let s = input;

  for (let guard = 0; guard < 8; guard += 1) {
    let hit: { index: number; word: string; abbr: string } | null = null;

    for (const [word, abbr] of ENTITY_PATTERNS) {
      const index = s.indexOf(word);
      if (index === -1) continue;
      // より前方の一致を優先。同じ位置なら ENTITY_PATTERNS が長い順なので先勝ちでよい。
      if (!hit || index < hit.index) hit = { index, word, abbr };
    }
    if (!hit) return s;

    const before = s.slice(0, hit.index);
    const after = s.slice(hit.index + hit.word.length);
    const atStart = before.trim() === "";
    const atEnd = after.trim() === "";

    let replacement: string;
    if (atStart && atEnd) {
      // 法人格のみで受取人名が構成されている。まず起こらないが、握りつぶさず警告する。
      warnings.push(`「${hit.word}」以外の名称がありません`);
      replacement = hit.abbr;
    } else if (atStart) {
      replacement = `${hit.abbr})`;
    } else if (atEnd) {
      replacement = `(${hit.abbr}`;
    } else {
      replacement = `(${hit.abbr})`;
    }

    // 法人格の直近の空白は詰める（「株式会社 サンプル」→「ｶ)ｻﾝﾌﾟﾙ」）
    s = `${before.replace(/\s+$/, "")}${replacement}${after.replace(/^\s+/, "")}`;
  }

  warnings.push("法人格の置換が繰り返し上限に達しました");
  return s;
}

/**
 * 受取人名・振込依頼人名を全銀フォーマットの半角文字列へ変換する。
 *
 * 漢字は読み方を機械的に決められないため変換せず、使用不可文字として報告する。
 * 呼び出し側は `ok === false` の場合、CSVを生成せず利用者にカナ入力を求めること。
 */
export function toZenginKana(input: string): KanaResult {
  const warnings: string[] = [];

  let s = (input ?? "").normalize("NFC").trim();
  s = toHalfWidthAscii(s);
  s = abbreviateEntities(s, warnings);
  s = hiraganaToKatakana(s);

  let converted = "";
  for (const ch of s) {
    const mapped = KANA_MAP[ch];
    if (mapped !== undefined) {
      converted += mapped;
      continue;
    }
    const small = SMALL_HALF_KANA[ch];
    if (small !== undefined) {
      converted += small;
      continue;
    }
    converted += ch.toUpperCase();
  }

  // 空白の正規化（連続空白は1つ、前後は除去）
  converted = converted.replace(/\s+/g, " ").trim();

  const invalidChars: string[] = [];
  for (const ch of converted) {
    if (!isAllowedChar(ch) && !invalidChars.includes(ch)) invalidChars.push(ch);
  }

  if (/[一-鿿々〇〻]/.test(converted)) {
    warnings.push("漢字が残っています。カナで入力し直してください");
  }

  return {
    value: converted,
    ok: invalidChars.length === 0,
    invalidChars,
    warnings,
    length: converted.length,
  };
}

/** 全銀の受取人名の上限（半角30文字） */
export const RECIPIENT_NAME_MAX_LENGTH = 30;
/** 全銀の振込依頼人名の上限（半角40文字） */
export const REQUESTER_NAME_MAX_LENGTH = 40;
