import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isPublicIp } from "./ip";

/** Its message is written to be safe to show to a user or to a model. */
export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

const DEFAULT_MAX_BYTES = 8192;
const DEFAULT_TIMEOUT_MS = 10_000;

// A dotted host name with a letters-only (or punycode) top level, so IP
// addresses and single-label names such as "localhost" can never match.
const HOST_PATTERN =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function cleanHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Lower-cases, de-duplicates and validates an allowlist; throws on a bad entry. */
export function normaliseAllowedHosts(hosts: readonly string[]): string[] {
  const result = new Set<string>();
  for (const raw of hosts) {
    const host = cleanHost(raw);
    if (!HOST_PATTERN.test(host)) {
      throw new SafeFetchError(`Invalid host in the allowlist: ${raw.slice(0, 60)}`);
    }
    result.add(host);
  }
  return [...result];
}

/** "example.com" matches only itself; "*.example.com" matches subdomains only. */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry
  );
}

export function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  const allowed = normaliseAllowedHosts(allowedHosts);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("That is not a valid URL");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("Only https:// URLs are allowed");
  if (url.username || url.password) {
    throw new SafeFetchError("URLs with credentials are not allowed");
  }
  if (url.port && url.port !== "443") {
    throw new SafeFetchError("Only the default https port is allowed");
  }

  const host = cleanHost(url.hostname);
  // The URL parser has already turned 2130706433 or 0x7f.1 into 127.0.0.1.
  if (isIP(host) !== 0 || host.startsWith("[")) {
    throw new SafeFetchError("IP addresses are not allowed, use a host name");
  }
  if (!hostAllowed(host, allowed)) throw new SafeFetchError("That host is not allowed");
  return url;
}

export type Resolved = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Resolved[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

/**
 * A `lookup` for net/tls that refuses private addresses. It runs at connect
 * time and its answer is the address the socket connects to, so there is no
 * gap between "checked" and "used" for DNS rebinding to slip through. If ANY
 * answer is private the whole lookup fails, so a mixed answer cannot be used
 * to sneak one through.
 */
export function createSafeLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const first = addresses[0];
        if (!first) {
          callback(new SafeFetchError("The host did not resolve"), "", 0);
          return;
        }
        if (addresses.some((entry) => !isPublicIp(entry.address))) {
          callback(
            new SafeFetchError("That host resolves to a private or reserved address"),
            "",
            0
          );
          return;
        }
        // Node asks for every address when it tries IPv4 and IPv6 in turn.
        if (options.all) {
          callback(
            null,
            addresses.map(({ address, family }) => ({ address, family }))
          );
          return;
        }
        callback(null, first.address, first.family);
      },
      (error: unknown) => callback(error as Error, "", 0)
    );
  };
}

export type SafeGetResult = {
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
};

function toSafeError(error: unknown): Error {
  if (error instanceof SafeFetchError) return error;
  const details = error as { cause?: unknown; code?: string; name?: string } | null;
  if (details?.cause instanceof SafeFetchError) return details.cause;
  if (details?.name === "AbortError" || details?.name === "TimeoutError" || details?.code === "ABORT_ERR") {
    return new SafeFetchError("The request timed out");
  }
  if (details?.code === "ENOTFOUND" || details?.code === "EAI_AGAIN") {
    return new SafeFetchError("That host could not be found");
  }
  return new SafeFetchError("The request failed");
}

/**
 * GET an allowlisted https page: no redirects, text or JSON only, capped
 * size, hard timeout, and private addresses refused at connect time.
 */
export function safeGet(options: {
  url: string;
  allowedHosts: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  lookup?: LookupFunction;
}): Promise<SafeGetResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = assertAllowedUrl(options.url, options.allowedHosts);
    } catch (error) {
      reject(error);
      return;
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    let settled = false;
    const succeed = (result: SafeGetResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(toSafeError(error));
    };

    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: cleanHost(url.hostname),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "User-Agent": "Sovereign-Agent/1.0", Accept: "text/*, application/json;q=0.9" },
        lookup: options.lookup ?? createSafeLookup(),
        agent: false,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

        if (status >= 300 && status < 400) {
          response.destroy();
          succeed({ status, contentType, body: "Redirects are not followed.", truncated: false });
          return;
        }
        const textual =
          contentType === "" ||
          contentType.startsWith("text/") ||
          contentType === "application/json" ||
          contentType.endsWith("+json");
        if (!textual) {
          response.destroy();
          fail(new SafeFetchError("Only text and JSON responses are supported"));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const finish = () =>
          succeed({ status, contentType, body: Buffer.concat(chunks).toString("utf8"), truncated });

        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            size = maxBytes;
            truncated = true;
            response.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        response.on("end", finish);
        response.on("error", fail);
      }
    );
    request.on("error", fail);
    request.end();
  });
}
