/**
 * The Dynasty Era deck at the top of /core's league Home: what makes a dynasty league read as one at a
 * glance — which year of the dynasty this is, who hangs in the rafters, the draft capital you hold, how
 * old the lineup you start is, and your taxi squad.
 *
 * Built only for a dynasty league (`usesDynastyBackground`, the same rule the /core shell stamp and the
 * /league/[id] workspace use). In practice that is an IMPORTED league: a native league's Home redirects
 * to /league/[id], whose own dynasty extras (DynastyLeagueHomeExtras) already show these.
 *
 * ⚠ NOTHING HERE IS ESTIMATED. Every block is a fact already stored — `league_seasons` /
 * `league_championships`, the future-pick inventory, `SportsPlayer.age`, the roster's taxi section —
 * read by the loaders this module is fed from (lib/core-app/dynastyOutlook.ts,
 * lib/league/dynastyChampionRafters.ts). A block whose read is missing or empty is null and the deck
 * draws nothing for it; the deck itself still renders, because the era band alone is what tells a
 * dynasty league from any other.
 */
import type { ChampionRafters } from '@/lib/league/dynastyHomeExtras'
import type { DynastyOutlook } from './dynastyOutlook'
import { dynastySeasonClock, type DynastySeasonClockSource } from '@/lib/league-media/dynastySeasonClock'
import { dynastyYearOf } from '@/lib/dynasty-core/dynastyDetails'

export type DynastyDeckPickSeason = {
  season: number
  picks: Array<{ round: number; label: string; via: string | null }>
}

export type DynastyHomeDeck = {
  /** "Year N · season". `year` is null when the league's first season is not on file — never guessed. */
  clock: { year: number | null; season: number } | null
  rafters: ChampionRafters | null
  picks: {
    total: number
    firstRounders: number
    seasons: DynastyDeckPickSeason[]
    /** `partial` when the inventory could only rebuild some drafts (importedFuturePicks coverage). */
    partial: boolean
  } | null
  ages: {
    medianStarterAge: number
    known: number
    total: number
    youngCore: number
    /** Starters at or past their position's usual decline age (dynastyOutlook's rule of thumb). */
    aging: number
  } | null
  taxi: { count: number; slots: number } | null
}

/** Taxi-squad ids on a stored roster blob: top-level `taxi`, else `lineup_sections.taxi`. */
export function taxiIdsOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const o = playerData as Record<string, unknown>
  const pick = (arr: unknown) =>
    Array.isArray(arr)
      ? arr
          .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : v && typeof v === 'object' ? String((v as Record<string, unknown>).playerId ?? (v as Record<string, unknown>).id ?? '') : ''))
          .filter((id) => id && id !== '0' && id !== 'null')
      : []
  const top = pick(o.taxi)
  if (top.length) return [...new Set(top)]
  const sections = o.lineup_sections
  return sections && typeof sections === 'object' ? [...new Set(pick((sections as Record<string, unknown>).taxi))] : []
}

/** Starter ids on a stored roster blob (`starters`, Sleeper's "0" empty-slot marker dropped). */
export function starterIdsOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const starters = (playerData as Record<string, unknown>).starters
  return Array.isArray(starters)
    ? starters.map((v) => String(v ?? '').trim()).filter((id) => id && id !== '0' && id !== 'null')
    : []
}

export function buildDynastyHomeDeck(input: {
  league: DynastySeasonClockSource
  /** Earliest season the league's history holds (`loadChampionHistory`), for Year N on an import. */
  firstSeasonOnFile: number | null
  rafters: ChampionRafters | null
  outlook: DynastyOutlook | null
  taxi: { count: number; slots: number } | null
}): DynastyHomeDeck {
  const base = dynastySeasonClock(input.league)
  const clock = base
    ? { season: base.season, year: base.year ?? dynastyYearOf(base.season, input.firstSeasonOnFile) }
    : null

  let picks: DynastyHomeDeck['picks'] = null
  if (input.outlook?.picks.available) {
    const seasons = input.outlook.picks.bySeason
      .map((s) => ({ season: s.season, picks: s.picks.map((p) => ({ round: p.round, label: p.label, via: p.fromTeamName })) }))
      .filter((s) => s.picks.length > 0)
    const all = seasons.flatMap((s) => s.picks)
    if (all.length > 0) {
      picks = {
        total: all.length,
        firstRounders: all.filter((p) => p.round === 1).length,
        seasons,
        partial: input.outlook.picks.coverage !== 'complete',
      }
    }
  }

  const a = input.outlook?.ages
  const ages: DynastyHomeDeck['ages'] = a?.available
    ? { medianStarterAge: a.medianStarterAge, known: a.known, total: a.total, youngCore: a.youngCore, aging: a.aging.length }
    : null

  const taxi = input.taxi && (input.taxi.slots > 0 || input.taxi.count > 0) ? input.taxi : null

  return { clock, rafters: input.rafters, picks, ages, taxi }
}
