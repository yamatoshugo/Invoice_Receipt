import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchDocument } from "./index";

/**
 * SSRF遮断が実際に効くことの実測。
 * * 純関数のテストでは「判定が正しいか」しか証明できず、
 * 「その判定が接続経路に繋がっているか」は分からない。
 * 実際にローカルへサーバーを立て、番兵として一度も叩かれないことを確かめる。
 *
 * このテストは一度、本物の漏れを見つけている:
 * ホストがIPリテラル（http://127.0.0.1/）の場合、Node は名前解決を行わないので
 * lookup の差し込みが呼ばれず、内部アドレスへ素通しになっていた。
 */
let server: http.Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end("%PDF-1.7 should-not-be-reached");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

describe("fetchDocument のSSRF遮断（実測）", () => {
  it("127.0.0.1 を遮断する", async () => {
    expect((await fetchDocument(`http://127.0.0.1:${port}/secret`)).kind).toBe("blocked");
  });

  it("localhost を遮断する", async () => {
    expect((await fetchDocument(`http://localhost:${port}/secret`)).kind).toBe("blocked");
  });

  it("DNSで127.0.0.1に解決される名前を遮断する", async () => {
    // lookup の差し込みが効いていなければ、ここで番兵が叩かれる。
    // 名前解決自体ができない環境では network になるが、いずれにせよ到達はしない
    const r = await fetchDocument(`http://localtest.me:${port}/secret`);
    expect(["blocked", "network"]).toContain(r.kind);
  });

  it("クラウドのメタデータを遮断する", async () => {
    expect((await fetchDocument("http://169.254.169.254/latest/meta-data/")).kind).toBe("blocked");
  });

  it("file:// を遮断する", async () => {
    expect((await fetchDocument("file:///etc/passwd")).kind).toBe("blocked");
  });

  it("番兵サーバーが一度も叩かれていない", () => {
    expect(hits).toBe(0);
  });
});
