import { isIP } from "node:net";

type Cidr4 = readonly [base: number, bits: number];

function v4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIPv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((n) => !(n >= 0 && n <= 255))) return null;
  const [a = 0, b = 0, c = 0, d = 0] = nums;
  return v4ToInt(a, b, c, d);
}

// Everything here is reserved, private or otherwise not a public internet host.
const BLOCKED_V4: readonly Cidr4[] = [
  [v4ToInt(0, 0, 0, 0), 8],
  [v4ToInt(10, 0, 0, 0), 8],
  [v4ToInt(100, 64, 0, 0), 10],
  [v4ToInt(127, 0, 0, 0), 8],
  [v4ToInt(169, 254, 0, 0), 16],
  [v4ToInt(172, 16, 0, 0), 12],
  [v4ToInt(192, 0, 0, 0), 24],
  [v4ToInt(192, 0, 2, 0), 24],
  [v4ToInt(192, 88, 99, 0), 24],
  [v4ToInt(192, 168, 0, 0), 16],
  [v4ToInt(198, 18, 0, 0), 15],
  [v4ToInt(198, 51, 100, 0), 24],
  [v4ToInt(203, 0, 113, 0), 24],
  [v4ToInt(224, 0, 0, 0), 4],
  [v4ToInt(240, 0, 0, 0), 4]
];

function inCidr(ip: number, [base, bits]: Cidr4): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPublicIPv4(ip: number): boolean {
  return !BLOCKED_V4.some((range) => inCidr(ip, range));
}

/** Eight 16-bit groups, or null when the text is not a valid IPv6 address. */
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  let tail: number[] = [];
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [v4 >>> 16, v4 & 0xffff];
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];

  let all: string[];
  if (halves.length === 1) {
    all = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    all = [...head, ...Array.from({ length: missing }, () => "0"), ...rest];
  }
  if (all.length !== 8) return null;

  const groups = all.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  if (groups.some((group) => Number.isNaN(group))) return null;
  if (tail.length === 2) {
    groups[6] = tail[0] ?? 0;
    groups[7] = tail[1] ?? 0;
  }
  return groups;
}

function isPublicIPv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = (hi: number, lo: number) => isPublicIPv4(((hi << 16) | lo) >>> 0);

  // ::/96: the unspecified address, loopback and IPv4-compatible addresses.
  if ((g0 | g1 | g2 | g3 | g4 | g5) === 0) return false;
  // ::ffff:0:0/96: an IPv4 address in IPv6 clothes. Judge the IPv4 part.
  if ((g0 | g1 | g2 | g3 | g4) === 0 && g5 === 0xffff) return embedded(g6, g7);
  // 64:ff9b::/96 (NAT64) also carries an IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b && (g2 | g3 | g4 | g5) === 0) return embedded(g6, g7);

  // Only global unicast 2000::/3 can be a public host.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4 carries an IPv4 address
  return true;
}

/**
 * True only for an address that can be a host on the public internet.
 * Anything that is not an IP address, or that cannot be parsed, is refused:
 * unknown means no.
 */
export function isPublicIp(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const ip = parseIPv4(address);
    return ip !== null && isPublicIPv4(ip);
  }
  if (kind === 6) {
    const groups = parseIPv6(address);
    return groups !== null && isPublicIPv6(groups);
  }
  return false;
}
