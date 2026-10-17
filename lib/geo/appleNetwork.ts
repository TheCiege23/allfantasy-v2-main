/**
 * Apple Inc.'s own network: 17.0.0.0/8 (AS714) and 2620:149::/32.
 *
 * WHY THE VPN GATE LETS IT THROUGH. App Store review runs from Apple's
 * corporate network, and a data-centre or proxy vendor can classify that as
 * "hosting" — which the VPN gate refuses (middleware, owner's rule of
 * 2026-09-24). A reviewer who cannot sign in rejects the app as broken. Apple's
 * network is an enterprise LAN, not an anonymizer anyone can buy, so it is
 * treated as an ordinary connection: NOT anonymized. That is all it gets.
 *
 * ⚠ WHAT THIS DOES NOT DO. It does not skip any STATE rule — a request from
 * this range is still placed by its edge geo and still refused in Washington
 * like anyone else. And it is not iCloud Private Relay: Relay egress is run by
 * partner networks, not these ranges, and callers still consult Apple's Relay
 * feed first, so a listed Relay address keeps the Relay rule even here.
 *
 * Edge-runtime safe: string parsing only, no `node:net`.
 */

function ipv4FirstOctet(ip: string): number | null {
  const m = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(ip)
  if (!m) return null
  const n = Number(m[1])
  return n <= 255 ? n : null
}

export function isAppleCorporateNetwork(rawIp: string | null | undefined): boolean {
  if (typeof rawIp !== "string") return false
  let ip = rawIp.trim().toLowerCase()
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1)
  // IPv4-mapped IPv6 (::ffff:17.1.2.3) is the IPv4 address.
  if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length)

  if (ip.includes(".")) return ipv4FirstOctet(ip) === 17

  // 2620:149::/32 — the first two hextets are 2620 and 0149. An empty second
  // group ("2620::…") is zero, so it does not match.
  const groups = ip.split(":")
  if (groups.length < 3 || groups[0] !== "2620" || !groups[1]) return false
  return /^[0-9a-f]{1,4}$/.test(groups[1]) && parseInt(groups[1], 16) === 0x149
}
