import { describe, expect, it } from "vitest";
import { blockedHostReason, blockedIpReason } from "./ip";

const blocked = (ip: string) => blockedIpReason(ip) !== null;

describe("blockedIpReason — IPv4", () => {
  it("loopback を遮断する", () => {
    expect(blocked("127.0.0.1")).toBe(true);
    expect(blocked("127.255.255.254")).toBe(true);
  });

  it("プライベートアドレスを遮断する", () => {
    expect(blocked("10.0.0.1")).toBe(true);
    expect(blocked("172.16.0.1")).toBe(true);
    expect(blocked("172.31.255.255")).toBe(true);
    expect(blocked("192.168.1.1")).toBe(true);
  });

  it("クラウドのメタデータを遮断する（最も守りたい相手）", () => {
    // ここに届くとサーバーの認証情報がそのまま抜ける
    expect(blocked("169.254.169.254")).toBe(true);
    expect(blocked("169.254.170.2")).toBe(true);
  });

  it("CGNAT を遮断する", () => {
    expect(blocked("100.64.0.1")).toBe(true);
    expect(blocked("100.100.100.200")).toBe(true);
  });

  it("特殊用途・文書用・マルチキャスト・予約を遮断する", () => {
    expect(blocked("0.0.0.0")).toBe(true);
    expect(blocked("192.0.2.1")).toBe(true);
    expect(blocked("198.18.0.1")).toBe(true);
    expect(blocked("224.0.0.1")).toBe(true);
    expect(blocked("255.255.255.255")).toBe(true);
  });

  it("通常のグローバルアドレスは通す", () => {
    expect(blocked("8.8.8.8")).toBe(false);
    expect(blocked("93.184.216.34")).toBe(false);
    expect(blocked("142.250.196.100")).toBe(false);
  });

  it("境界の外側は通す", () => {
    expect(blocked("172.15.255.255")).toBe(false); // 172.16/12 の直前
    expect(blocked("172.32.0.0")).toBe(false); // 直後
    expect(blocked("100.63.255.255")).toBe(false); // 100.64/10 の直前
    expect(blocked("11.0.0.1")).toBe(false); // 10/8 の直後
  });

  it("理由の文言にアドレスが含まれる", () => {
    expect(blockedIpReason("127.0.0.1")).toContain("127.0.0.1");
  });
});

describe("blockedIpReason — IPv6", () => {
  it("loopback と unspecified を遮断する", () => {
    expect(blocked("::1")).toBe(true);
    expect(blocked("::")).toBe(true);
  });

  it("ユニークローカルを遮断する", () => {
    expect(blocked("fc00::1")).toBe(true);
    expect(blocked("fd00:ec2::254")).toBe(true);
  });

  it("link-local を遮断する", () => {
    expect(blocked("fe80::1")).toBe(true);
    expect(blocked("fe80::a9fe:a9fe")).toBe(true);
  });

  it("ゾーンID付きでも遮断する", () => {
    expect(blocked("fe80::1%eth0")).toBe(true);
  });

  it("IPv4射影を剥がして再検査する", () => {
    // ここを剥がさないと ::ffff:127.0.0.1 で loopback に届く
    expect(blocked("::ffff:127.0.0.1")).toBe(true);
    expect(blocked("::ffff:169.254.169.254")).toBe(true);
    expect(blocked("::ffff:8.8.8.8")).toBe(false);
  });

  it("NAT64 を剥がして再検査する", () => {
    expect(blocked("64:ff9b::7f00:1")).toBe(true); // 127.0.0.1
    expect(blocked("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
  });

  it("6to4 に包まれた内部アドレスを遮断する", () => {
    expect(blocked("2002:7f00:1::1")).toBe(true); // 127.0.0.1
  });

  it("マルチキャストと文書用を遮断する", () => {
    expect(blocked("ff02::1")).toBe(true);
    expect(blocked("2001:db8::1")).toBe(true);
  });

  it("通常のグローバルアドレスは通す", () => {
    expect(blocked("2606:4700:4700::1111")).toBe(false);
    expect(blocked("2001:4860:4860::8888")).toBe(false);
  });

  it("IPアドレスとして読めない文字列は遮断する", () => {
    // 解釈できないものを通すと、検査をすり抜ける経路になる
    expect(blocked("not-an-ip")).toBe(true);
    expect(blocked("")).toBe(true);
    expect(blocked("999.999.999.999")).toBe(true);
  });
});

describe("blockedHostReason", () => {
  it("内部向けの名前を遮断する", () => {
    expect(blockedHostReason("localhost")).not.toBeNull();
    expect(blockedHostReason("LOCALHOST")).not.toBeNull();
    expect(blockedHostReason("metadata.google.internal")).not.toBeNull();
    expect(blockedHostReason("db.internal")).not.toBeNull();
    expect(blockedHostReason("printer.local")).not.toBeNull();
  });

  it("末尾ドット付きでも遮断する", () => {
    expect(blockedHostReason("localhost.")).not.toBeNull();
  });

  it("通常のホスト名は通す", () => {
    expect(blockedHostReason("example.co.jp")).toBeNull();
    expect(blockedHostReason("invoice.rakurakumeisai.jp")).toBeNull();
  });

  it("空のホスト名は遮断する", () => {
    expect(blockedHostReason("")).not.toBeNull();
  });

  it("IPアドレスが直接書かれている場合も検査する", () => {
    // ホストがIPリテラルだと Node は名前解決をしないので lookup の差し込みが
    // 呼ばれない。ここで弾かないと内部アドレスへ素通しになる（実測で確認済み）
    expect(blockedHostReason("127.0.0.1")).not.toBeNull();
    expect(blockedHostReason("169.254.169.254")).not.toBeNull();
    expect(blockedHostReason("10.0.0.1")).not.toBeNull();
  });

  it("角括弧付きのIPv6リテラルも検査する", () => {
    expect(blockedHostReason("[::1]")).not.toBeNull();
    expect(blockedHostReason("[fe80::1]")).not.toBeNull();
    expect(blockedHostReason("[::ffff:127.0.0.1]")).not.toBeNull();
  });

  it("グローバルなIPリテラルは通す", () => {
    expect(blockedHostReason("8.8.8.8")).toBeNull();
    expect(blockedHostReason("[2606:4700:4700::1111]")).toBeNull();
  });
});
