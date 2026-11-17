import crypto from "crypto"

/**
 * RFC 6238 time-based one-time passwords — the 6-digit codes an authenticator app
 * (Google Authenticator, 1Password, Authy…) shows. HMAC-SHA1, 30-second steps: the
 * defaults every authenticator app assumes when it scans an `otpauth://` QR code.
 *
 * Written against node:crypto rather than a dependency because the whole algorithm is
 * the twenty lines below, and the RFC's own test vectors pin it
 * (__tests__/security/admin-totp.test.ts).
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** Decodes base32, ignoring spaces, dashes, padding and case. Null when it is not base32. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase()
  if (!clean) return null
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx < 0) return null
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A fresh 160-bit secret, base32-encoded (the length RFC 4226 recommends for SHA-1). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

/** The code for one 30-second step. `digits` is only ever changed by the RFC test vectors. */
export function totpAt(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = crypto.createHmac("sha1", key).update(msg).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const bin = mac.readUInt32BE(offset) & 0x7fffffff
  return String(bin % 10 ** digits).padStart(digits, "0")
}

export function totpCounter(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS)
}

/**
 * Checks a submitted code against the current step and one step either side (clock
 * drift between the phone and the server). Returns the matching step so the caller can
 * refuse a replay of the same code, or null.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), window = 1): number | null {
  const key = base32Decode(secretBase32)
  const submitted = String(code ?? "").replace(/\s/g, "")
  if (!key || key.length < 10 || !/^\d{6}$/.test(submitted)) return null
  const now = totpCounter(nowMs)
  let matched: number | null = null
  // Every candidate is compared, in constant time, so the response time does not say
  // which step (if any) matched.
  for (let delta = -window; delta <= window; delta++) {
    const expected = Buffer.from(totpAt(key, now + delta))
    if (crypto.timingSafeEqual(expected, Buffer.from(submitted)) && matched === null) matched = now + delta
  }
  return matched
}

/** The `otpauth://` URI an authenticator app reads from a QR code. */
export function totpAuthUri(secretBase32: string, account: string, issuer = "AllFantasy Admin"): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
