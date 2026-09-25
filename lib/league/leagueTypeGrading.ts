/**
 * The league type a trade grade was taken under, and HOW WE KNOW IT — said beside every grade.
 *
 * 🛑 WHY THIS EXISTS (Guap, 2026-09-25): "it needs to be explicitly expressed to the user how
 * important them selecting their league type is." The type decides which chart every trade in the
 * league is priced on — dynasty prices years of production, redraft only this season — and for an
 * imported league it is, most of the time, NOT something anyone told us. The import never asks; the
 * column holds the host platform's flag, a name match, or the `redraft` default. A grade that does
 * not say which of those it rests on reads as certain when it may be a guess.
 *
 * ⚠ THE SAME FACTS AS THE CHART, IN THE SAME ORDER. The label here and the book in
 * `lib/core-app/valueBook.ts` both read `readConfirmedLeagueConcept`, then the provider's
 * keeper/dynasty facts, then the column — so the words beside a grade cannot name a different
 * league type from the one the grade was priced on.
 *
 * CLIENT-SAFE: no prisma, no server-only imports. The grade carries the result to the screen.
 */

import {
  isLeagueConceptType,
  leagueConceptLabel,
  readConfirmedLeagueConcept,
  readProviderDynastyFact,
  readProviderKeeperFact,
  resolveLeagueConcept,
} from '@/lib/league/leagueConceptOptions'

export type LeagueTypeBasis = {
  /** The concept the grade used — `keeper`, `dynasty`, `zombie`… */
  type: string
  label: string
  /**
   * `confirmed` — a person set it. `platform` — the host platform reports it (Sleeper's dynasty or
   * keeper flag). `assumed` — our reading: a league-name match, or the redraft default when there was
   * nothing to read at all.
   */
  source: 'confirmed' | 'platform' | 'assumed'
  /** The host platform, for "from Sleeper". Null for a league created on AllFantasy. */
  platform: string | null
}

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

function platformLabel(platform: string | null | undefined): string | null {
  const key = String(platform ?? '').trim().toLowerCase()
  if (!key || key === 'native' || key === 'allfantasy' || key === 'manual') return null
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function labelFor(type: string): string {
  if (isLeagueConceptType(type)) return leagueConceptLabel(type)
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** PURE. See the module note for the order, which is the chart's order. */
export function leagueTypeBasis(args: {
  settings: unknown
  leagueType: string | null | undefined
  platform?: string | null
}): LeagueTypeBasis {
  const platform = platformLabel(args.platform)
  const confirmed = readConfirmedLeagueConcept(args.settings)
  if (confirmed) return { type: confirmed, label: labelFor(confirmed), source: 'confirmed', platform }

  const stored = String(resolveLeagueConcept(args.settings, args.leagueType) ?? '').toLowerCase()
  if ((stored === '' || stored === 'redraft' || stored === 'keeper') && readProviderKeeperFact(args.settings)) {
    return { type: 'keeper', label: labelFor('keeper'), source: 'platform', platform }
  }
  if (stored.includes('dynasty') && readProviderDynastyFact(args.settings)) {
    return { type: 'dynasty', label: labelFor('dynasty'), source: 'platform', platform }
  }
  const type = stored || 'redraft'
  return { type, label: labelFor(type), source: 'assumed', platform }
}

/** The one sentence every surface says about it. */
export const LEAGUE_TYPE_DECIDES_GRADES = 'Your league type decides how every trade in this league is graded.'

/** Why, in a manager's words — for the import screen and the league-type setting. */
export const LEAGUE_TYPE_GRADES_EXPLAINER =
  'Dynasty prices years of production, redraft only this season, and keeper sits in between. The wrong type puts every grade here on the wrong chart.'

/** "confirmed" / "from Sleeper, not confirmed" / "our guess, not confirmed". */
export function leagueTypeSourceText(basis: LeagueTypeBasis): string {
  if (basis.source === 'confirmed') return 'confirmed'
  if (basis.source === 'platform') return `from ${basis.platform ?? 'your platform'}, not confirmed`
  return 'our guess, not confirmed'
}
