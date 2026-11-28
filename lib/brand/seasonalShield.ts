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
