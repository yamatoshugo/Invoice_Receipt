/**
 * 全銀フォーマット（総合振込）CSVの生成
 *
 * ドコモSMTBネット銀行「振込ファイル（CSV形式）」に準拠する。
 *   - 文字コード: Shift_JIS のみ
 *   - 区切り: カンマ / 改行: CRLF
 *   - すべて半角
 *   - 構成: ヘッダー(1) → データ(2)×n → トレーラ(8) → エンド(9)
 *
 * 金銭事故に直結するため、1件でも検証エラーがあれば CSV を生成しない。
 *
 * 仕様: https://www.netbk.co.jp/contents/resources/pdf/doc_soufuri_furikomicsv.pdf
 */

import iconv from "iconv-lite";
import {
  RECIPIENT_NAME_MAX_LENGTH,
  REQUESTER_NAME_MAX_LENGTH,
  toZenginKana,
} from "./kana";
import { isBankBusinessDay, toMMDD } from "./businessDay";

/** ドコモSMTBネット銀行の金融機関番号（仕様書の固定値） */
export const SENDER_BANK_CODE = "0038";

/** 総合振込の種別コード（仕様書の固定値） */
const RECORD_TYPE_SOUGOU = "21";

export const ACCOUNT_TYPES = {
  "1": "普通",
  "2": "当座",
  "4": "貯蓄",
  "9": "その他",
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

/** 振込金額の上限（仕様上の桁数 10 桁） */
const MAX_AMOUNT = 9_999_999_999;

export interface RequesterSettings {
  /** 振込依頼人コード（委託者コード）。銀行採番の「20」ではじまる10桁 */
  requesterCode: string;
  /** 振込依頼人名。全角で渡してよい（内部で半角カナへ変換する） */
  requesterName: string;
  /** 仕向銀行番号。既定は 0038 */
  senderBankCode?: string;
  /** 仕向支店番号（3桁以内） */
  senderBranchCode: string;
  /** 依頼人口座番号（7桁以内） */
  senderAccountNumber: string;
}

export interface TransferRecord {
  /** 画面で該当行を特定するための識別子（CSVには出力しない） */
  id: string;
  /** 被仕向銀行番号（4桁以内） */
  bankCode: string;
  /** 被仕向支店番号（3桁以内） */
  branchCode: string;
  accountType: AccountType;
  /** 口座番号（7桁以内） */
  accountNumber: string;
  /** 受取人名。全角で渡してよい（内部で半角カナへ変換する） */
  recipientName: string;
  /** 振込金額（円・整数） */
  amount: number;
  /** 新規コード 1=第1回振込分 2=変更分 0=その他。未指定なら項目ごと省略する */
  newCode?: "0" | "1" | "2";
}

export interface ValidationError {
  /** 該当する TransferRecord の id。ヘッダーや全体の問題なら undefined */
  recordId?: string;
  field: string;
  message: string;
}

export interface BuildZenginCsvInput {
  requester: RequesterSettings;
  /** 取組日（銀行営業日である必要がある） */
  transferDate: Date;
  records: TransferRecord[];
}

export type BuildZenginCsvResult =
  | {
      ok: true;
      /** Shift_JIS でエンコード済みのCSV本体 */
      buffer: Buffer;
      /** 検証・デバッグ用のUTF-16文字列表現（バイト列は buffer が正） */
      text: string;
      recordCount: number;
      totalAmount: number;
      errors: [];
      warnings: string[];
    }
  | {
      ok: false;
      errors: ValidationError[];
      warnings: string[];
    };

const DIGITS = /^\d+$/;

function validateDigits(
  value: string,
  maxLength: number,
  field: string,
  label: string,
  recordId?: string,
): ValidationError | null {
  if (!value) return { recordId, field, message: `${label}が未入力です` };
  if (!DIGITS.test(value)) return { recordId, field, message: `${label}は数字のみです: ${value}` };
  if (value.length > maxLength) {
    return { recordId, field, message: `${label}は${maxLength}桁以内です: ${value}` };
  }
  return null;
}

/**
 * 名義を半角カナへ変換し、変換不能文字・桁あふれを検証する。
 * 変換できなかった場合は CSV を生成させないため、必ずエラーを返す。
 */
function convertName(
  raw: string,
  maxLength: number,
  field: string,
  label: string,
  errors: ValidationError[],
  warnings: string[],
  recordId?: string,
): string {
  const result = toZenginKana(raw);

  if (!result.ok) {
    errors.push({
      recordId,
      field,
      message: `${label}に全銀フォーマットで使用できない文字があります: ${result.invalidChars.join(" ")}`,
    });
  }
  if (result.length === 0) {
    errors.push({ recordId, field, message: `${label}が未入力です` });
  }
  if (result.length > maxLength) {
    errors.push({
      recordId,
      field,
      message: `${label}が${maxLength}文字を超えています（${result.length}文字）: ${result.value}`,
    });
  }
  for (const w of result.warnings) {
    warnings.push(recordId ? `[${recordId}] ${label}: ${w}` : `${label}: ${w}`);
  }

  return result.value;
}

/** CSVの1行を組み立てる。全銀の項目に引用符の規定がないため、値にカンマを含めてはならない。 */
function toLine(fields: string[]): string {
  for (const f of fields) {
    if (f.includes(",")) {
      throw new Error(`CSVの項目にカンマを含めることはできません: ${f}`);
    }
  }
  return fields.join(",");
}

export function buildZenginCsv(input: BuildZenginCsvInput): BuildZenginCsvResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const { requester, transferDate, records } = input;

  // --- ヘッダーの検証 ---
  const requesterCodeError = validateDigits(
    requester.requesterCode,
    10,
    "requesterCode",
    "振込依頼人コード",
  );
  if (requesterCodeError) {
    errors.push(requesterCodeError);
  } else if (requester.requesterCode.length !== 10) {
    errors.push({
      field: "requesterCode",
      message: `振込依頼人コードは10桁です: ${requester.requesterCode}`,
    });
  } else if (!requester.requesterCode.startsWith("20")) {
    warnings.push(
      `振込依頼人コードが「20」ではじまっていません: ${requester.requesterCode}。銀行の画面で再確認してください`,
    );
  }

  const senderBankCode = requester.senderBankCode ?? SENDER_BANK_CODE;
  const senderBankError = validateDigits(senderBankCode, 4, "senderBankCode", "仕向銀行番号");
  if (senderBankError) errors.push(senderBankError);

  const senderBranchError = validateDigits(
    requester.senderBranchCode,
    3,
    "senderBranchCode",
    "仕向支店番号",
  );
  if (senderBranchError) errors.push(senderBranchError);

  const senderAccountError = validateDigits(
    requester.senderAccountNumber,
    7,
    "senderAccountNumber",
    "依頼人口座番号",
  );
  if (senderAccountError) errors.push(senderAccountError);

  const requesterName = convertName(
    requester.requesterName,
    REQUESTER_NAME_MAX_LENGTH,
    "requesterName",
    "振込依頼人名",
    errors,
    warnings,
  );

  // --- 取組日の検証 ---
  if (Number.isNaN(transferDate.getTime())) {
    errors.push({ field: "transferDate", message: "取組日が不正です" });
  } else if (!isBankBusinessDay(transferDate)) {
    errors.push({
      field: "transferDate",
      message: `取組日が銀行営業日ではありません: ${transferDate.toLocaleDateString("ja-JP")}`,
    });
  }

  // --- データレコードの検証 ---
  if (records.length === 0) {
    errors.push({ field: "records", message: "振込対象が1件もありません" });
  }

  // 行の組み立ては全検証を通過してから行う。カンマ混入は convertName が
  // 使用不可文字として弾くため、toLine の例外は到達しない不変条件チェックになる。
  const dataFieldRows: string[][] = [];
  let totalAmount = 0;

  for (const r of records) {
    const bankError = validateDigits(r.bankCode, 4, "bankCode", "被仕向銀行番号", r.id);
    if (bankError) errors.push(bankError);

    const branchError = validateDigits(r.branchCode, 3, "branchCode", "被仕向支店番号", r.id);
    if (branchError) errors.push(branchError);

    const accountError = validateDigits(r.accountNumber, 7, "accountNumber", "口座番号", r.id);
    if (accountError) errors.push(accountError);

    if (!(r.accountType in ACCOUNT_TYPES)) {
      errors.push({
        recordId: r.id,
        field: "accountType",
        message: `預金種目が不正です: ${r.accountType}`,
      });
    }

    const recipientName = convertName(
      r.recipientName,
      RECIPIENT_NAME_MAX_LENGTH,
      "recipientName",
      "受取人名",
      errors,
      warnings,
      r.id,
    );

    if (!Number.isInteger(r.amount)) {
      errors.push({ recordId: r.id, field: "amount", message: `振込金額は整数です: ${r.amount}` });
    } else if (r.amount <= 0) {
      errors.push({ recordId: r.id, field: "amount", message: `振込金額が0円以下です: ${r.amount}` });
    } else if (r.amount > MAX_AMOUNT) {
      errors.push({
        recordId: r.id,
        field: "amount",
        message: `振込金額が上限（${MAX_AMOUNT.toLocaleString()}円）を超えています: ${r.amount}`,
      });
    } else {
      totalAmount += r.amount;
    }

    const fields = [
      "2",
      r.bankCode,
      "", // *被仕向銀行名（省略）
      r.branchCode,
      "", // *被仕向支店名（省略）
      "", // *統一手形交換所番号（省略）
      r.accountType,
      r.accountNumber,
      recipientName,
      String(r.amount),
    ];
    if (r.newCode !== undefined) fields.push(r.newCode);

    dataFieldRows.push(fields);
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const dataLines = dataFieldRows.map(toLine);

  // --- 組み立て ---
  const headerLine = toLine([
    "1",
    RECORD_TYPE_SOUGOU,
    "0",
    requester.requesterCode,
    requesterName,
    toMMDD(transferDate),
    senderBankCode,
    "", // *仕向銀行名（省略）
    requester.senderBranchCode,
    "", // *仕向支店名（省略）
    "1", // 預金種目（依頼人）固定値
    requester.senderAccountNumber,
  ]);

  const trailerLine = toLine(["8", String(records.length), String(totalAmount)]);
  const endLine = "9";

  const text = [headerLine, ...dataLines, trailerLine, endLine].join("\r\n") + "\r\n";

  return {
    ok: true,
    buffer: iconv.encode(text, "Shift_JIS"),
    text,
    recordCount: records.length,
    totalAmount,
    errors: [],
    warnings,
  };
}
