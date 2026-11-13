import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { isIdpLeagueVariant } from './idpLeagueVariant'
import { isGuillotineLeague } from './teamElimination'

/**
 * The league formats a person plays, for the /core home's format guide (2026-11-12, owner: Home is
 * where users learn how different leagues on different platforms work).
 *
 * Each league can be several formats at once — a dynasty best ball superflex league is three — so
 * this returns a set per league and counts across them. Every test reuses the predicate the rest of
 * the app already gates on (best ball, guillotine, IDP), so the guide cannot call a league something
 * its own screens do not.
 *
 * ⚠ SUPERFLEX AND TE PREMIUM ARE READ FROM THE SCORING LABEL. There is no column for either; the
 * label ("PPR Superflex TEP") is what the league list already prints, so a league the list calls
 * superflex is the one counted here, and one whose label omits it is not guessed at.
 *
 * PURE and client-safe.
 */

export const FORMAT_KEYS = [
  'redraft',
  'dynasty',
  'keeper',
  'devy',
  'best-ball',
  'guillotine',
  'survivor',
  'zombie',
  'idp',
  'superflex',
  'te-premium',
] as const

export type FormatKey = (typeof FORMAT_KEYS)[number]

type FormatLeagueRow = {
  isDynasty?: boolean | null
  leagueType?: string | null
  leagueVariant?: string | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  scoring?: string | null
}

const has = (value: string | null | undefined, re: RegExp) => re.test(String(value ?? ''))

export function leagueFormats(row: FormatLeagueRow): FormatKey[] {
  const type = row.leagueType
  const variant = row.leagueVariant
  const out = new Set<FormatKey>()

  // How long you keep players — exactly one of these per league.
  if (has(variant, /devy/i) || has(type, /devy/i)) out.add('devy')
  if (row.isDynasty === true || has(type, /dynasty/i) || has(variant, /dynasty/i)) out.add('dynasty')
  else if (has(type, /keeper/i) || has(variant, /keeper/i)) out.add('keeper')
  if (!out.has('dynasty') && !out.has('keeper') && !out.has('devy')) out.add('redraft')

  // How the season is played.
  if (isBestBallLeague(variant, row.bestBallMode)) out.add('best-ball')
  if (isGuillotineLeague({ guillotineMode: row.guillotineMode, leagueVariant: variant })) out.add('guillotine')
  if (has(variant, /survivor/i)) out.add('survivor')
  if (has(variant, /zombie/i)) out.add('zombie')

  // Who you start and how they score.
  if (isIdpLeagueVariant(variant)) out.add('idp')
  if (has(row.scoring, /superflex|super flex|\bsf\b|\b2qb\b/i)) out.add('superflex')
  if (has(row.scoring, /\btep\b|te[\s_-]?premium/i)) out.add('te-premium')

  return FORMAT_KEYS.filter((k) => out.has(k))
}

export type FormatCount = { key: FormatKey; count: number }

/** How many of the given leagues are each format, most common first (catalog order breaks ties). */
export function countFormats(rows: readonly FormatLeagueRow[]): FormatCount[] {
  const counts = new Map<FormatKey, number>()
  for (const row of rows) for (const key of leagueFormats(row)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return FORMAT_KEYS.filter((k) => counts.has(k))
    .map((key) => ({ key, count: counts.get(key)! }))
    .sort((a, b) => b.count - a.count || FORMAT_KEYS.indexOf(a.key) - FORMAT_KEYS.indexOf(b.key))
}
