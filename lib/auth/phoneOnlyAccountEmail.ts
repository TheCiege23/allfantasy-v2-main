import { createHash } from "node:crypto"

/** AppUser.email is required today; keep phone-only accounts out of email delivery. */
const DOMAIN = "@phone.allfantasy.invalid"

export function phoneOnlyAccountEmail(phone: string): string {
  const digest = createHash("sha256").update(phone).digest("hex")
  return `phone-${digest}${DOMAIN}`
}

export function isPhoneOnlyAccountEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.endsWith(DOMAIN)
}
