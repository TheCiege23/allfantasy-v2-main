/**
 * The phone number someone typed on the /support card BEFORE paying, carried to the thank-you
 * page AFTER Stripe (app/support/SupportMonthlyCard → app/support/welcome/SignInNextTime).
 *
 * In sessionStorage, deliberately not in Stripe metadata or the database: it is a convenience for
 * this one tab, and an unverified number must never be saved as a way into an account. The
 * thank-you page texts it a code and the number is saved only once that code comes back
 * (/api/verify/phone/check). Same tab, same origin, so it survives the trip to Stripe and back.
 * Read once, then gone.
 */

const KEY = "af:support-phone"

export type SupportPhoneHandoff = { phone: string; smsConsent: true }

export function saveSupportPhone(phone: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ phone, smsConsent: true }))
  } catch {
    /* storage blocked: the thank-you page simply asks instead */
  }
}

export function clearSupportPhone(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/** The saved number, removed as it is read. Null when there is none or it is malformed. */
export function takeSupportPhone(): SupportPhoneHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SupportPhoneHandoff>
    if (typeof parsed.phone !== "string" || parsed.phone.replace(/\D/g, "").length < 10 || parsed.smsConsent !== true) return null
    return { phone: parsed.phone.slice(0, 32), smsConsent: true }
  } catch {
    return null
  }
}
