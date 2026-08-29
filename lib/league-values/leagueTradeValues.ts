/**
 * Every player a trade surface can price from the LEAGUE rather than from a market.
 *
 * FantasyCalc prices offence. It prices no defenders and no kickers, so before this seam
 * those players reached a trade grade with nothing — `pricePlayer` returned `unpriced: true`
 * for every one of them (see `lib/hybrid-valuation.ts`). This module is the single place
 * that answers "what does THIS league's own rulebook say these players are worth", and it
 * hands back one name-keyed map so a caller wires one thing rather than two.
 *
 * ⚠ THE TWO HALVES ARE BUILT ON DELIBERATELY DIFFERENT PRINCIPLES, AND FLATTENING THEM WOULD
 * DESTROY THE HONEST PART.
 *
 *   DEFENDERS ARE RANKED. Value over replacement against the league's own scoring and
 *   starting slots orders them almost exactly as a market would (Spearman ~0.9 on the
 *   offensive control), so `idpTradeValues` ranks the board and prices the rank.
 *
 *   KICKERS ARE NOT RANKED, ON PURPOSE. Kicker rank does not persist — year over year the
 *   correlation is NEGATIVE in all six measured season pairs (mean -0.455), and within a
 *   season it is indistinguishable from zero. Every kicker in a league therefore gets the
 *   SAME value. That is a finding, not a gap; see `lib/kicker-values/leagueKickerValue.ts`.
 *
 * A caller that "improves" the kicker half by sorting it is undoing a measurement.
 */

import type { PrismaClient } from '@prisma/client'

import { getLeagueInfo, getLeagueRosters, getPlayersBySport } from '@/lib/sleeper-client'
import { loadIdpTradeValuesByName } from '@/lib/idp-projections/idpTradeValues'
import { resolveLeagueKickerValue, type LeagueKickerValue } from '@/lib/kicker-values/leagueKickerValue'

/** Sleeper's kicker position vocabulary, which is NOT just `K`. */
const KICKER_POSITIONS = new Set(['K', 'PK', 'KICKER', 'PLACE KICKER', 'K/P'])

/**
 * ⚠ `isKickerPosition` IN `lib/idp-kicker-values.ts` TESTS `=== 'K'` AND MISSES 85 ROWS.
 * Measured on production: the NFL `SportsPlayer` table carries K:298, PK:61, Kicker:22,
 * `Place Kicker`:1 and K/P:1. Sleeper's own player index is more consistent than that, but
 * this map is fed from both, so the check is drawn over the whole observed vocabulary.
 */
export function isKickerPositionLoose(position: string | null | undefined): boolean {
  return KICKER_POSITIONS.has(String(position ?? '').trim().toUpperCase())
}

export type LeagueValueBasis = 'idp-vorp' | 'kicker-flat'

export interface LeagueNamedValue {
  value: number
  position: string
  /** Which of the two constructions produced this number. Never collapse these. */
  basis: LeagueValueBasis
}

export interface LeagueTradeValues {
  /** Lowercased, trimmed full name -> value. Only unambiguous names appear. */
  byNameLower: ReadonlyMap<string, LeagueNamedValue>
  idp: {
    skipped: Awaited<ReturnType<typeof loadIdpTradeValuesByName>>['skipped']
    coverage: Awaited<ReturnType<typeof loadIdpTradeValuesByName>>['coverage']
    ambiguousNames: string[]
  }
  kicker: LeagueKickerValue & { named: number }
}

const EMPTY: LeagueTradeValues = {
  byNameLower: new Map(),
  idp: { skipped: 'no_league_id', coverage: { defenders: 0, projected: 0, priced: 0, named: 0 }, ambiguousNames: [] },
  kicker: {
    value: null,
    replacementRank: 0,
    scarcity: 0,
    rankPredictability: 'none',
    basis: 'No league context.',
    named: 0,
  },
}

export interface LoadLeagueTradeValuesArgs {
  prisma: PrismaClient
  platformLeagueId: string | null | undefined
  isDynasty: boolean
  prefetched?: {
    rosters?: Array<{ players?: string[] | null }> | null
    rosterPositions?: readonly string[] | null
    numTeams?: number | null
    players?: Record<string, { full_name?: string | null; position?: string | null }> | null
  }
}

/**
 * Build the league's full non-market value map.
 *
 * Never throws. An empty map means "price the way you always did", which is correct for the
 * great majority of leagues.
 */
export async function loadLeagueTradeValues(
  args: LoadLeagueTradeValuesArgs,
): Promise<LeagueTradeValues> {
  const leagueId = args.platformLeagueId
  if (!leagueId) return EMPTY

  try {
    /*
     * The IDP half gates itself on the league's scoring before touching a provider, so
     * calling it first costs one indexed read for the ~100 of 110 leagues that score no IDP.
     */
    const idp = await loadIdpTradeValuesByName({
      prisma: args.prisma,
      platformLeagueId: leagueId,
      isDynasty: args.isDynasty,
      prefetched: args.prefetched,
    })

    const merged = new Map<string, LeagueNamedValue>()
    for (const [name, entry] of idp.byNameLower) {
      merged.set(name, { value: entry.value, position: entry.position, basis: 'idp-vorp' })
    }

    /*
     * The kicker half needs the league's slots and its rostered players. Both may already be
     * in hand from the IDP pass or from the caller; only fetch what is genuinely missing, and
     * only when the league actually starts a kicker.
     */
    let rosterPositions = args.prefetched?.rosterPositions ?? null
    let numTeams = args.prefetched?.numTeams ?? null
    if (!rosterPositions || !numTeams) {
      const info = await getLeagueInfo(leagueId).catch(() => null)
      rosterPositions = rosterPositions ?? (info?.roster_positions as string[] | undefined) ?? null
      numTeams = numTeams ?? info?.total_rosters ?? null
    }

    const kickerValue = resolveLeagueKickerValue({
      rosterPositions,
      numTeams: numTeams ?? 12,
      isDynasty: args.isDynasty,
    })

    let namedKickers = 0
    if (kickerValue.value != null) {
      const rosters = args.prefetched?.rosters ?? (await getLeagueRosters(leagueId).catch(() => []))
      const rosterPlayerIds = [
        ...new Set(
          (rosters ?? []).flatMap((r) =>
            Array.isArray(r?.players) ? r.players.filter((p): p is string => typeof p === 'string' && !!p) : [],
          ),
        ),
      ]

      if (rosterPlayerIds.length > 0) {
        type PlayerIndex = Record<string, { full_name?: string | null; position?: string | null }>
        const players: PlayerIndex =
          args.prefetched?.players ?? ((await getPlayersBySport('nfl').catch(() => ({}))) as PlayerIndex)

        /*
         * ⚠ THE SAME AMBIGUITY GUARD THE IDP JOIN USES, AND IT MATTERS AS MUCH HERE. The
         * evaluator prices by name; emitting a kicker's value under a name the league also
         * uses for someone else would hand that price to whoever the trade actually names.
         * Ambiguity is assessed over the league's ROSTERED set — the only players that can
         * genuinely be confused — not the ~11k Sleeper index full of retirees.
         */
        const nameCounts = new Map<string, number>()
        for (const pid of rosterPlayerIds) {
          const nm = players?.[pid]?.full_name?.trim().toLowerCase()
          if (!nm) continue
          nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1)
        }

        for (const pid of rosterPlayerIds) {
          const info = players?.[pid]
          if (!isKickerPositionLoose(info?.position)) continue
          const nm = info?.full_name?.trim().toLowerCase()
          if (!nm || (nameCounts.get(nm) ?? 0) > 1) continue
          // A defender already holding this name wins: his value is player-specific, the
          // kicker's is positional, so overwriting it would lose the more informative number.
          if (merged.has(nm)) continue
          merged.set(nm, { value: kickerValue.value, position: 'K', basis: 'kicker-flat' })
          namedKickers++
        }
      }
    }

    return {
      byNameLower: merged,
      idp: { skipped: idp.skipped, coverage: idp.coverage, ambiguousNames: idp.ambiguousNames },
      kicker: { ...kickerValue, named: namedKickers },
    }
  } catch {
    return EMPTY
  }
}
