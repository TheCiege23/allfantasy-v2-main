/**
 * A partner inquiry from /partners (owner's "partner contact" item, 2026-11-17). PURE: validation and the
 * email's text, so every refusal is testable without a request.
 *
 * Delivery is an email to the owner (app/api/partners/inquiry/route.ts). There is no table for inbound leads,
 * and adding one is a migration only the owner applies — so the route tells the visitor "sent" ONLY when the
 * email provider accepted the message, and otherwise hands them the address to write to. A lead is never
 * silently dropped.
 */

export const LEAGUE_COUNT_OPTIONS = ['Under 100', '100 to 1,000', '1,000 to 10,000', 'More than 10,000', 'Not sure yet'] as const
export type LeagueCount = (typeof LEAGUE_COUNT_OPTIONS)[number]

/** Where a visitor writes when the form cannot deliver. Public on /contact already. */
export const PARTNER_FALLBACK_EMAIL = 'support@allfantasy.ai'

export const INQUIRY_LIMITS = { name: 100, email: 200, company: 120, website: 200, message: 2000 } as const

export type PartnerInquiry = {
  name: string
  email: string
  company: string
  website: string | null
  leagueCount: LeagueCount | null
  message: string | null
}

export type InquiryField = keyof PartnerInquiry

export type ParsedInquiry =
  | { ok: true; value: PartnerInquiry }
  /** `bot` is the honeypot: answer exactly as a success would, and send nothing. */
  | { ok: false; bot: true }
  | { ok: false; bot: false; errors: Partial<Record<InquiryField, string>> }

// One line, no control characters: a value that ends up in an email SUBJECT must not carry a header break.
const oneLine = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '')
const multiLine = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : ''

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeWebsite(raw: string): string | null | 'invalid' {
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return 'invalid'
    return u.toString()
  } catch {
    return 'invalid'
  }
}

export function parsePartnerInquiry(body: unknown): ParsedInquiry {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  // The honeypot: a field people never see. Anything in it is a form-filling script.
  if (oneLine(b.fax)) return { ok: false, bot: true }

  const name = oneLine(b.name)
  const email = oneLine(b.email).toLowerCase()
  const company = oneLine(b.company)
  const websiteRaw = oneLine(b.website)
  const message = multiLine(b.message)
  const leagueCountRaw = oneLine(b.leagueCount)

  const errors: Partial<Record<InquiryField, string>> = {}
  if (!name) errors.name = 'Add your name.'
  else if (name.length > INQUIRY_LIMITS.name) errors.name = `Keep your name under ${INQUIRY_LIMITS.name} characters.`
  if (!email) errors.email = 'Add your work email.'
  else if (email.length > INQUIRY_LIMITS.email || !EMAIL.test(email)) errors.email = 'Check the email address.'
  if (!company) errors.company = 'Add your company or platform.'
  else if (company.length > INQUIRY_LIMITS.company) errors.company = `Keep this under ${INQUIRY_LIMITS.company} characters.`
  const website = normalizeWebsite(websiteRaw)
  if (website === 'invalid' || (website && website.length > INQUIRY_LIMITS.website)) errors.website = 'Check the website address.'
  if (message.length > INQUIRY_LIMITS.message) errors.message = `Keep the message under ${INQUIRY_LIMITS.message} characters.`
  const leagueCount = leagueCountRaw ? (LEAGUE_COUNT_OPTIONS as readonly string[]).includes(leagueCountRaw) ? (leagueCountRaw as LeagueCount) : undefined : null
  if (leagueCount === undefined) errors.leagueCount = 'Pick one of the options.'

  if (Object.keys(errors).length) return { ok: false, bot: false, errors }
  return {
    ok: true,
    value: { name, email, company, website: website === 'invalid' ? null : website, leagueCount: leagueCount ?? null, message: message || null },
  }
}

/** The owner's email. Plain lines: the sender flattens HTML to text, so structure is carried by " · " and labels. */
export function inquiryEmail(q: PartnerInquiry, receivedAt: Date): { subject: string; body: string } {
  const lines: Array<[string, string]> = [
    ['Name', q.name],
    ['Email', q.email],
    ['Company', q.company],
    ['Website', q.website ?? '(none)'],
    ['Leagues', q.leagueCount ?? '(not given)'],
    ['Message', q.message ?? '(none)'],
    ['Received', receivedAt.toISOString()],
  ]
  return {
    subject: `Partner inquiry: ${q.company} (${q.name})`.slice(0, 180),
    body: `New partner inquiry from allfantasy.ai/partners. Reply to ${q.email}. · ${lines.map(([k, v]) => `${k}: ${v}`).join(' · ')}`,
  }
}
