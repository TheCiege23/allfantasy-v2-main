/**
 * Seasonal AllFantasy shield — the date decides which shield art to show.
 *
 * Only used where the shield is shown at 40px or larger: the decorations
 * (leaves, snow, fireworks) turn to noise at the 22-24px draft-bar size, so
 * that spot keeps the plain shield.
 *
 * Dates are read in US Eastern time, matching the rest of the app's
 * calendar-day logic, so the switch happens at the same moment for everyone.
 *
 * The New Year art says "2027", so it is pinned to that one window and
 * never shows in any other year.
 */

export type BrandSeason = "fall" | "winter" | "newyear"

export const PLAIN_SHIELD_SRC = "/brand/af-shield-transparent.png"

const SEASON_SRC: Record<BrandSeason, string> = {
  fall: "/brand/seasonal/af-shield-fall.webp",
  winter: "/brand/seasonal/af-shield-winter.webp",
  newyear: "/brand/seasonal/af-shield-newyear.webp",
}

function easternParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get("year"), m: get("month"), d: get("day") }
}

/**
 * fall     Oct 1 - Nov 30   (football + Thanksgiving)
 * winter   Dec 1 - Dec 30   (holiday art: bow and holly)
 * newyear  Dec 31 2026 - Jan 7 2027 only
 * otherwise null -> plain shield
 */
export function brandSeasonFor(date: Date): BrandSeason | null {
  const { y, m, d } = easternParts(date)
  if ((y === 2026 && m === 12 && d === 31) || (y === 2027 && m === 1 && d <= 7)) return "newyear"
  if (m === 10 || m === 11) return "fall"
  if (m === 12 && d <= 30) return "winter"
  return null
}

export function seasonalShieldSrc(date: Date = new Date()): string {
  const season = brandSeasonFor(date)
  return season ? SEASON_SRC[season] : PLAIN_SHIELD_SRC
}

/* ── "50% OFF" sale art ─────────────────────────────────────────────────────
 *
 * ⚠ THE SALE SHIELD IS A PROMISE ABOUT THE PRICE, SO IT ONLY SHOWS WHEN THE
 * PRICE IS REAL. There is no store-wide sale in this app. The one discount is
 * the founding-member coupon (lib/monetization/foundingMember.ts), whose size
 * lives in Stripe and is described by the owner's FOUNDING_OFFER_LABEL. So the
 * art shows only to a viewer the founding offer applies to, and only while that
 * label itself says 50%. No label, a different figure, or no offer → the
 * ordinary seasonal shield. Never decide eligibility here; take the offer the
 * server already resolved for this viewer.
 */

export type SaleArt = "gold" | "cyber" | "holiday"

const SALE_SRC: Record<SaleArt, string> = {
  gold: "/brand/sale/af-shield-sale-gold.webp",
  cyber: "/brand/sale/af-shield-sale-cyber.webp",
  holiday: "/brand/sale/af-shield-sale-holiday.webp",
}

const DAY_MS = 86_400_000

/** Day number (UTC midnight / day) of US Thanksgiving: the 4th Thursday of November. */
function thanksgivingDay(year: number): number {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay() // 0 = Sunday
  const firstThursday = 1 + ((4 - nov1 + 7) % 7)
  return Date.UTC(year, 10, firstThursday + 21) / DAY_MS
}

/**
 * gold     Black Friday weekend (Fri - Sun after Thanksgiving)
 * cyber    Cyber Monday
 * holiday  Dec 1 - Dec 25 (Cyber Monday wins if it falls on Dec 1 or 2)
 */
export function saleArtFor(date: Date): SaleArt | null {
  const { y, m, d } = easternParts(date)
  const offset = Date.UTC(y, m - 1, d) / DAY_MS - thanksgivingDay(y)
  if (offset >= 1 && offset <= 3) return "gold"
  if (offset === 4) return "cyber"
  if (m === 12 && d <= 25) return "holiday"
  return null
}

/**
 * The store-wide Black Friday → Cyber Monday sale (lib/monetization/holidaySale.ts) is the other
 * real 50% offer. During it the shield follows the sale banner's own name for the moment
 * (`holidaySaleName`: "Black Friday" Fri–Sat, "Cyber Monday" from Sunday), so the two never
 * disagree. Whether the sale is live, and whether the viewer is on the web, is the caller's job
 * (components/brand/BrandShield.tsx) — this stays a pure lookup.
 */
export function holidaySaleShieldSrc(saleName: string): string {
  return saleName === "Cyber Monday" ? SALE_SRC.cyber : SALE_SRC.gold
}

/** True only when the owner's offer label itself states 50%. */
export function isFiftyPercentOffer(label: string | null | undefined): boolean {
  return typeof label === "string" && /(^|[^\d])50\s*%/.test(label)
}

/**
 * The shield for a surface that knows this viewer's founding offer (pricing).
 * `founding` is the server-resolved view from LaunchOfferContext; null = none.
 */
export function brandShieldSrc(args: {
  date?: Date
  founding: { label: string | null } | null | undefined
}): string {
  const date = args.date ?? new Date()
  if (args.founding && isFiftyPercentOffer(args.founding.label)) {
    const art = saleArtFor(date)
    if (art) return SALE_SRC[art]
  }
  return seasonalShieldSrc(date)
}

/**
 * The whole decision BrandShield renders, as a pure function so the in-app rule is testable.
 *
 *   onWeb = false (server render, first client render, or inside the iOS / Android app)
 *     → seasonal art, ALWAYS. The apps sell at the store's price; no sale art there.
 *   onWeb = true and a live 50% holiday sale (`holidaySale`, from getHolidaySale)
 *     → gold / cyber, following the sale banner's name.
 *   onWeb = true and a `founding` offer passed (pricing only)
 *     → brandShieldSrc's founding rule.
 *   otherwise → seasonal art.
 */
export function resolveBrandShieldSrc(args: {
  now: Date
  onWeb: boolean
  holidaySale: { percentOff: number } | null
  holidaySaleName: string
  founding?: { label: string | null } | null
}): string {
  if (!args.onWeb) return seasonalShieldSrc(args.now)
  if (args.holidaySale && args.holidaySale.percentOff === 50) return holidaySaleShieldSrc(args.holidaySaleName)
  if (args.founding !== undefined) return brandShieldSrc({ date: args.now, founding: args.founding })
  return seasonalShieldSrc(args.now)
}
