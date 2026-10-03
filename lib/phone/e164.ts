/**
 * THE phone normalizer. Every place that turns a typed number into the stored E.164 form must use
 * this, because the stored form is a lookup key: verification writes it, and password reset,
 * phone login and phone signup all find the account by exact match on it.
 *
 * 🛑 Eleven copies used to read `startsWith("+") ? s : "+1" + s`, which turns the common US entry
 * "12014176692" into "+112014176692". Verification stored that malformed key while the
 * forgot-password screen (the one copy that got it right) looked up "+12014176692", so a phone
 * verified minutes earlier was refused as unverified. Two normalizers for one key is the bug.
 *
 * Pure and dependency-free so client components and server routes import the same function.
 */
export function normalizePhoneE164(raw: string): string {
  const digits = raw.trim().replace(/[^\d+]/g, '')
  if (!digits) return ''
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export function isValidPhoneE164(raw: string): boolean {
  return /^\+\d{10,15}$/.test(raw)
}
