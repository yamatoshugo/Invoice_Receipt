/**
 * PDFの実体に対する判定。
 *
 * MIMEタイプや拡張子は送信側の申告にすぎないので、LLMへ投げる前に実体で確かめる。
 * パスワード付きPDFをLLMに渡しても中身は読めず、費用だけがかかったうえに
 * 「読み取り失敗」に紛れて本当の原因が見えなくなる。
 */

/** PDFのファイル先頭は必ず "%PDF-" で始まる */
export function looksLikePdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * 暗号化（パスワード保護）されたPDFか。
 *
 * PDFの暗号化は trailer 辞書の /Encrypt で示される。厳密に構文解析はせず、
 * ファイル末尾側を走査して /Encrypt への参照があるかを見る。
 * 誤検知しても「開けません」と表示して人に回るだけで、黙って捨てはしない。
 */
export function isEncryptedPdf(data: Buffer): boolean {
  // trailer はファイル末尾にある。本文中の文字列と衝突しないよう末尾側だけを見る
  const tailSize = Math.min(data.length, 64 * 1024);
  const tail = data.subarray(data.length - tailSize).toString("latin1");
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s*<</.test(tail);
}
