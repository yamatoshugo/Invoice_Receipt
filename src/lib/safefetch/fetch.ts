import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { blockedHostReason, blockedIpReason } from "./ip";
import { parseHttpUrl } from "./url";

/**
 * 外部URLの取得。ここだけがネットワークに触る。
 *
 * 判断は一切しない（PDFかログインかは classifyFetched が決める）。
 * そうしておくと、判断の部分がモック無しでテストできる。
 *
 * node の fetch ではなく node:https を直接使うのは、DNS解決に割り込むため。
 * 先に dns.lookup で調べてから fetch すると、その隙に別のIPへ解決し直される
 * （DNSリバインディング）。lookup を差し替えれば、検査した値と接続先が必ず一致する。
 */

export interface FetchOptions {
  maxBytes: number;
  maxRedirects: number;
  perHopTimeoutMs: number;
  totalTimeoutMs: number;
}

export const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  maxBytes: 20 * 1024 * 1024,
  maxRedirects: 5,
  perHopTimeoutMs: 15_000,
  totalTimeoutMs: 45_000,
};

export type FetchOutcome =
  | {
      kind: "ok";
      status: number;
      contentType: string | null;
      contentDisposition: string | null;
      charset: string | null;
      finalUrl: string;
      hops: string[];
      body: Buffer;
    }
  /** 上限を超えた。途中で打ち切っている */
  | { kind: "too-large"; limitBytes: number; hops: string[] }
  /** 内部アドレスへの到達・非http(s)スキームなど、こちらの判断で止めた */
  | { kind: "blocked"; reason: string; hops: string[] }
  /** DNS失敗・TLS失敗・タイムアウトなど */
  | { kind: "network"; reason: string; hops: string[] };

class SsrfBlockedError extends Error {}

/**
 * 検査を通したIPだけをソケットへ渡す lookup。
 *
 * Node 20以降は autoSelectFamily が既定で有効で all:true の配列を期待するため、
 * all の有無の両方に正しく答える（片方だけだと接続が壊れる）。
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    const done = callback as (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void;
    if (err) return done(err);
    const list = addresses as LookupAddress[];
    const safe = list.filter((a) => blockedIpReason(a.address) === null);
    if (safe.length === 0) {
      const reason = list[0] ? blockedIpReason(list[0].address) : "解決できませんでした";
      return done(new SsrfBlockedError(`${hostname} は${reason ?? "内部アドレス"}`));
    }
    if (typeof options === "object" && options?.all) return done(null, safe);
    return done(null, safe[0]!.address, safe[0]!.family);
  });
};

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer | null;
  /** リダイレクト先（絶対URL）。無ければ null */
  location: string | null;
  tooLarge: boolean;
}

function requestOnce(url: URL, options: FetchOptions, deadline: number): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const agent = url.protocol === "https:" ? https : http;
    const req = agent.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup: guardedLookup,
        headers: {
          host: url.host,
          // 正直な UA を送る。騙るとサイト側の規約に触れうるし、
          // 弾かれた場合は LOGIN_REQUIRED / FAILED として人に回るだけで済む
          "user-agent": "InvoiceReceipt/1.0 (+invoice fetcher)",
          accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
          "accept-language": "ja,en;q=0.8",
          // 圧縮を断る。gzipを受けると、小さなレスポンスが展開後に巨大化する
          // 経路（解凍爆弾）ができ、サイズ上限が意味を失う
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location
          ? new URL(res.headers.location, url).toString()
          : null;

        // リダイレクトなら本文は読まずに捨てる
        if (location && status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: null, location, tooLarge: false });
          return;
        }

        // Content-Length は早期棄却にだけ使う。無いことも嘘のこともある
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          req.destroy();
          resolve({ status, headers: res.headers, body: null, location: null, tooLarge: true });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy();
            resolve({ status, headers: res.headers, body: null, location: null, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks),
            location: null,
            tooLarge: false,
          }),
        );
        res.on("error", reject);
      },
    );

    req.setTimeout(Math.min(options.perHopTimeoutMs, Math.max(1, deadline - Date.now())), () => {
      req.destroy(new Error("応答がありませんでした（タイムアウト）"));
    });
    req.on("error", reject);
    req.end();
  });
}

/** URLを取得する。リダイレクトは自分で1ホップずつ追い、毎回IPを検査し直す */
export async function fetchDocument(
  rawUrl: string,
  options: FetchOptions = DEFAULT_FETCH_OPTIONS,
): Promise<FetchOutcome> {
  const hops: string[] = [];
  const deadline = Date.now() + options.totalTimeoutMs;

  let current = parseHttpUrl(rawUrl);
  if (!current) return { kind: "blocked", reason: "http/https のURLではありません", hops };

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const hostReason = blockedHostReason(current.hostname);
    if (hostReason) return { kind: "blocked", reason: hostReason, hops };
    hops.push(current.toString());

    if (Date.now() >= deadline) {
      return { kind: "network", reason: "時間内に取得できませんでした", hops };
    }

    let result: HopResult;
    try {
      result = await requestOnce(current, options, deadline);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        return { kind: "blocked", reason: error.message, hops };
      }
      const message = error instanceof Error ? error.message : "取得に失敗しました";
      return { kind: "network", reason: message, hops };
    }

    if (result.tooLarge) return { kind: "too-large", limitBytes: options.maxBytes, hops };

    if (result.location) {
      // リダイレクト先のスキームを検査し直す。ここを忘れるのが典型的な穴
      const next = parseHttpUrl(result.location);
      if (!next) {
        return { kind: "blocked", reason: "転送先が http/https ではありません", hops };
      }
      current = next;
      continue;
    }

    const contentType = asString(result.headers["content-type"]);
    return {
      kind: "ok",
      status: result.status,
      contentType,
      contentDisposition: asString(result.headers["content-disposition"]),
      charset: charsetOf(contentType),
      finalUrl: current.toString(),
      hops,
      body: result.body ?? Buffer.alloc(0),
    };
  }

  return { kind: "network", reason: "転送が多すぎます", hops };
}

function asString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function charsetOf(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  return m ? m[1]! : null;
}
