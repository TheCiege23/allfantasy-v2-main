/**
 * Shares that bring people in (2026-11-15) — PURE. Most of the app's share buttons (the "AllFantasy
 * saved me" card, the weekly post, the player MVP, the Trade Center / H2H / ledger / Guillotine cards)
 * shared an image or text with NO link back, so a friend who liked it had nowhere to go — and a
 * referral was never credited. Every one of them now carries the sharer's own referral link.
 *
 * The link is `https://allfantasy.ai/?ref=CODE` (ReferralService.buildReferralLink): the landing page
 * mounts ReferralTracker, which records the click and sets the `af_ref` cookie that signup reads —
 * email AND OAuth (lib/auth/SocialAccountLinkingService.ts) — so the sharer is credited.
 *
 * ⚠ NOT `/signup?ref=`: the auth pages bail the global chrome, so the tracker never runs there. The
 * landing is the door that counts the click.
 */

// Generated codes are 10 characters of A-Z/2-9 (ReferralService); the collision fallback can carry lowercase base-36.
const CODE = /^[A-Za-z0-9]{4,16}$/

/** A link this module will put in a share: absolute https, with a well-formed `ref` code. */
export function isReferralLink(link: unknown): link is string {
  if (typeof link !== 'string' || !link.startsWith('https://')) return false
  try {
    const u = new URL(link)
    return CODE.test(u.searchParams.get('ref') ?? '')
  } catch {
    return false
  }
}

/** The text with the link on its own line — once. A missing or malformed link leaves the text as it was. */
export function withShareLink(text: string, link: string | null | undefined): string {
  if (!isReferralLink(link)) return text
  if (text.includes(link)) return text
  return text ? `${text}\n${link}` : link
}

/** "allfantasy.ai/?ref=CODE" — the link as it reads printed on a share image. */
export function referralLinkLabel(link: string | null | undefined): string | null {
  if (!isReferralLink(link)) return null
  const u = new URL(link)
  return `${u.host.replace(/^www\./, '')}/?ref=${u.searchParams.get('ref')}`
}

/**
 * Where a public share page's "Try AllFantasy" goes: the landing with the sharer's code, so the click
 * is counted and the signup credited — or plain signup when the sharer has no code. Never `/app`, which
 * sends a visitor without an account to a sign-in wall.
 */
export function shareLandingHref(code: string | null | undefined): string {
  const c = typeof code === 'string' ? code.trim() : ''
  return CODE.test(c) ? `/?ref=${encodeURIComponent(c)}` : '/signup'
}

/** The `ref` code a referral link carries, or null. */
export function referralCodeOf(link: string | null | undefined): string | null {
  if (!isReferralLink(link)) return null
  return new URL(link).searchParams.get('ref')
}

/**
 * A leaguemate invite (2026-11-15): the same URL with the inviter's code as `ref`, so a leaguemate who
 * signs up through it is credited — and their first league earns both a free week of AF Pro
 * (lib/referral/proWeek.ts). Works on an absolute URL or a site path; an existing `ref` is replaced, and
 * a missing or malformed code leaves the URL exactly as it was.
 */
export function withReferralCode(url: string, code: string | null | undefined): string {
  const c = typeof code === 'string' ? code.trim() : ''
  if (!CODE.test(c) || !url) return url
  try {
    const absolute = /^https?:\/\//i.test(url)
    const u = new URL(url, 'https://allfantasy.ai')
    u.searchParams.set('ref', c)
    return absolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`
  } catch {
    return url
  }
}

/** True for a well-formed referral code. */
export function isReferralCode(code: unknown): code is string {
  return typeof code === 'string' && CODE.test(code.trim())
}
