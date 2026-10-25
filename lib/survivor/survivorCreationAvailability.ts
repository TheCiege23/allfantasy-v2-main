/** New Survivor league creation rollout. Existing leagues remain playable in every sport. */
export const SURVIVOR_CREATION_SPORTS = ['NBA', 'NFL', 'NHL'] as const

export function isSurvivorCreationSportAvailable(sport: string): boolean {
  return (SURVIVOR_CREATION_SPORTS as readonly string[]).includes(sport.trim().toUpperCase())
}

/** Sports where a fresh create starts on Survivor. NFL can create Survivor but starts on Guillotine. */
export const SURVIVOR_DEFAULT_FORMAT_SPORTS = ['NBA'] as const

export function isSurvivorDefaultFormatSport(sport: string): boolean {
  return (SURVIVOR_DEFAULT_FORMAT_SPORTS as readonly string[]).includes(sport.trim().toUpperCase())
}

export const SURVIVOR_CREATION_UNAVAILABLE_MESSAGE =
  'New Survivor leagues are available for NBA, NFL and NHL. Other sports will be added after their season flows are ready.'

/**
 * ⚠ ALLFANTASY TAKES NO PAYMENTS OF ANY KIND. Every Survivor league is free to create and run.
 * "Paid" is only a label: the league collects dues off the app (LeagueSafe, FanCred) and the
 * commissioner marks each manager paid in League Dues. Nothing here charges, holds or moves money.
 */
export const SURVIVOR_DUES_OFF_APP_NOTE =
  'AllFantasy never collects or holds money. Collect dues on LeagueSafe or FanCred, then mark each manager paid in League Dues.'

export type SurvivorEntryFee = { mode: 'free' | 'paid'; amountCents: number | null }

/** Reads the free/paid label from a create payload. The dues amount is optional; a bad one is an error. */
export function readSurvivorEntryFee(modeRaw: unknown, centsRaw: unknown): SurvivorEntryFee | { error: string } {
  const mode = String(modeRaw ?? 'free').toLowerCase().trim() === 'paid' ? 'paid' : 'free'
  if (mode === 'free' || centsRaw == null || centsRaw === '') return { mode, amountCents: null }
  const cents = typeof centsRaw === 'number' ? centsRaw : Number(centsRaw)
  if (!Number.isInteger(cents) || cents < 1 || cents > 10_000_000) {
    return { error: 'Enter a dues amount greater than zero, or leave it blank.' }
  }
  return { mode, amountCents: cents }
}

/** The wizard's optional dues text as cents: null when blank, 'invalid' when it is not a positive amount. */
export function parseSurvivorDuesUsd(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/^\$/, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid'
  const cents = Math.round(Number(t) * 100)
  return cents >= 1 && cents <= 10_000_000 ? cents : 'invalid'
}

/** League Dues starts switched on for a paid-labeled league, in the shape the dues route stores (dollars). */
export function survivorDuesTrackerSeed(amountCents: number | null) {
  return {
    enabled: true,
    amount: amountCents == null ? null : amountCents / 100,
    currency: 'USD',
    paymentLink: null,
    paymentProvider: null,
    entries: [],
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}
