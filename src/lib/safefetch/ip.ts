/**
 * 到達させてはいけないIPアドレスの判定。
 *
 * 「外に出るつもりで内側を叩かされる」のがSSRF。メールの本文に書かれたURLを
 * サーバーが取得しに行く以上、行き先は攻撃者が決められる。
 * クラウドのメタデータ（169.254.169.254）に届くと、サーバーの認証情報が
 * そのまま抜ける。
 *
 * ここは文字列を受けて文字列|null を返す純関数にしてあり、テストで全範囲を固定できる。
 */

/** IPv4 を 32bit 整数にする。IPv4 でなければ null */
function toV4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inV4Range(value: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const baseValue = toV4(base!)!;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

/** 遮断するIPv4の範囲と、その理由 */
const V4_BLOCKS: [string, string][] = [
  ["0.0.0.0/8", "this-network"],
  ["10.0.0.0/8", "プライベートアドレス"],
  ["100.64.0.0/10", "CGNAT"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link-local（クラウドのメタデータを含む）"],
  ["172.16.0.0/12", "プライベートアドレス"],
  ["192.0.0.0/24", "IETF特殊用途"],
  ["192.0.2.0/24", "文書用"],
  ["192.88.99.0/24", "6to4リレー"],
  ["192.168.0.0/16", "プライベートアドレス"],
  ["198.18.0.0/15", "ベンチマーク用"],
  ["198.51.100.0/24", "文書用"],
  ["203.0.113.0/24", "文書用"],
  ["224.0.0.0/4", "マルチキャスト"],
  ["240.0.0.0/4", "予約済み"],
];

/** IPv6 を16バイトにする。IPv6 でなければ null */
function toV6Bytes(ip: string): Uint8Array | null {
  let text = ip.trim().toLowerCase();
  // ゾーンID（fe80::1%eth0）は落とす
  const percent = text.indexOf("%");
  if (percent >= 0) text = text.slice(0, percent);
  if (!text.includes(":")) return null;

  // 末尾がIPv4表記（::ffff:127.0.0.1）なら16進に直す
  const v4tail = /^(.*:)((\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (v4tail) {
    const v4 = toV4(v4tail[2]!);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    text = `${v4tail[1]}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":").filter(Boolean) : []) : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i]!;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

function bytesToV4String(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

/**
 * 到達させてはいけないIPなら理由を返す。問題なければ null。
 *
 * IPv4射影（::ffff:x）と NAT64（64:ff9b::x）は、内側のIPv4を取り出して
 * 再検査する。ここを剥がさないと ::ffff:127.0.0.1 で loopback に届く。
 */
export function blockedIpReason(ip: string): string | null {
  const v4 = toV4(ip);
  if (v4 !== null) {
    for (const [cidr, reason] of V4_BLOCKS) {
      if (inV4Range(v4, cidr)) return `内部アドレス（${reason}）です: ${ip}`;
    }
    return null;
  }

  const bytes = toV6Bytes(ip);
  if (!bytes) return `IPアドレスとして解釈できません: ${ip}`;

  // IPv4射影 ::ffff:0:0/96
  if (hasPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])) {
    return blockedIpReason(bytesToV4String(bytes, 12));
  }
  // NAT64 64:ff9b::/96
  if (hasPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) {
    return blockedIpReason(bytesToV4String(bytes, 12));
  }

  const allZero = bytes.every((b) => b === 0);
  if (allZero) return `内部アドレス（unspecified）です: ${ip}`;
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) {
    return `内部アドレス（loopback）です: ${ip}`;
  }
  // fc00::/7 ユニークローカル
  if ((bytes[0]! & 0xfe) === 0xfc) return `内部アドレス（ユニークローカル）です: ${ip}`;
  // fe80::/10 リンクローカル
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) {
    return `内部アドレス（link-local）です: ${ip}`;
  }
  // ff00::/8 マルチキャスト
  if (bytes[0] === 0xff) return `内部アドレス（マルチキャスト）です: ${ip}`;
  // 100::/64 discard-only
  if (hasPrefix(bytes, [0x01, 0x00, 0, 0, 0, 0, 0, 0])) return `内部アドレス（discard）です: ${ip}`;
  // 2001:db8::/32 文書用
  if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8])) return `内部アドレス（文書用）です: ${ip}`;
  // 2002::/16 6to4（内側にIPv4を包める）
  if (hasPrefix(bytes, [0x20, 0x02])) {
    return blockedIpReason(bytesToV4String(bytes, 2)) ?? null;
  }

  return null;
}

/**
 * ホスト名の段階での遮断。
 *
 * ★ ここでIPリテラルを必ず検査すること。
 *   URLのホストが既にIPアドレス（http://127.0.0.1/ や http://[::1]/）の場合、
 *   Node は名前解決を行わないので lookup の差し込みが一切呼ばれない。
 *   実測でここから内部アドレスへ到達できることを確認済み。
 */
export function blockedHostReason(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") return "ホスト名が空です";

  // URL の hostname は IPv6 を角括弧付きで返す
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (looksLikeIpLiteral(literal)) return blockedIpReason(literal);

  const internal = ["localhost", "metadata.google.internal"];
  if (internal.includes(host)) return `内部ホストです: ${hostname}`;
  if (/\.(localhost|local|internal|intranet|home\.arpa)$/.test(host)) {
    return `内部ホストです: ${hostname}`;
  }
  return null;
}

/** 名前ではなくIPアドレスが直接書かれているか */
function looksLikeIpLiteral(host: string): boolean {
  if (host.includes(":")) return true; // IPv6
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}
