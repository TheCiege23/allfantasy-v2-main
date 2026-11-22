/**
 * The admin second factor: who has an authenticator secret, and whether codes are required.
 *
 * `ADMIN_TOTP_SECRETS` holds one entry per administrator, separated by commas, semicolons
 * or newlines:
 *
 *     founder@example.com=JBSWY3DPEHPK3PXP…,somehandle=KRSXG5CTMVRXEZLU…
 *
 * The key is an admin email or username (either one the access check already trusts — see
 * lib/adminAuth.ts); the value is a base32 secret from `scripts/admin-totp-enroll.ts`.
 *
 * 🛑 SETTING THE VARIABLE IS WHAT TURNS THE REQUIREMENT ON, FOR EVERY ADMIN AT ONCE. With
 * any valid entry present, no human reaches /admin without a code — an admin who has no
 * entry is locked out until they get one. That is deliberate: a second factor that only
 * applies to the people who opted in leaves every other admin account as the way round it.
 * Rollback is deleting the variable.
 */

export function parseAdminTotpSecrets(raw = process.env.ADMIN_TOTP_SECRETS): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of String(raw ?? "").split(/[\n\r,;]+/)) {
    const eq = entry.indexOf("=")
    if (eq <= 0) continue
    const identity = entry.slice(0, eq).trim().toLowerCase()
    const secret = entry.slice(eq + 1).replace(/[\s=-]/g, "").toUpperCase()
    // A malformed entry is skipped, never treated as "no secret needed".
    if (identity && /^[A-Z2-7]{16,}$/.test(secret)) map.set(identity, secret)
  }
  return map
}

export function adminTotpRequired(): boolean {
  return parseAdminTotpSecrets().size > 0
}

/** The secret for the first identity that has one, or null. */
export function adminTotpSecretFor(
  identities: Array<string | null | undefined>,
): { identity: string; secret: string } | null {
  const map = parseAdminTotpSecrets()
  for (const raw of identities) {
    const identity = String(raw ?? "").trim().toLowerCase()
    if (!identity) continue
    const secret = map.get(identity)
    if (secret) return { identity, secret }
  }
  return null
}
