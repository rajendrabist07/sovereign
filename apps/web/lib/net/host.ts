// Host name rules shared by the server (safe-fetch) and the workflow editor.
// Pure: no Node imports, so a browser bundle can use it.

/** Its message is written to be safe to show to a user or to a model. */
export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

// A dotted host name with a letters-only (or punycode) top level, so IP
// addresses and single-label names such as "localhost" can never match.
const HOST_PATTERN =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function cleanHost(value: string): string {
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
