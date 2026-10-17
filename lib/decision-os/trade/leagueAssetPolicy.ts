import 'server-only'

import { prisma } from '@/lib/prisma'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'
import { applyDevyPricing, pickPolicyRefusal, priceHeldDevyAssets, type HeldDevyPlayer } from './leagueAssetRules'

/**
 * The league half of Phase 9's asset rules (`./leagueAssetRules.ts`), shared by `createLeagueTradeGrader`
 * and the Trade Center console — the deal and its counters — so no chart-path grade can price a pick or
 * a devy prospect differently from another.
 *
 * DB-first: `DevyRights` and `DevyPlayer`. No provider call.
 *
 * ⚠ A PROSPECT IS PRICED ONLY WHEN THIS LEAGUE HOLDS HIM. The league type is not the evidence: an
 * imported "dynasty" league can carry devy rights and a "devy" label can carry none. Rights held here
 * are the fact, and matching inside them — by id, or a name only one held prospect carries — is how a
 * college player avoids being priced as the stranger who shares his name.
 */

export type DevyPricedSide = {
  lines: TradeConsolePlayerLine[]
  priced: PricedAsset[]
  devyPriced: number
  unmeasured: string[]
}

export type LeagueAssetPolicy = {
  /** Why the deal's picks cannot be priced in this league, or null. */
  pickRefusal(assets: readonly TradeAssetInput[]): string | null
  /** Price the lines the chart could not, when they are prospects this league holds. */
  priceDevy(side: { inputs: readonly TradeAssetInput[]; lines: TradeConsolePlayerLine[]; priced: PricedAsset[] }): Promise<DevyPricedSide>
}

/**
 * Rights that no longer make him a prospect held here. Exported so the per-league Devy tab
 * (`lib/core-app/devyLeagueTab.ts`) counts "held" exactly as the grade prices it.
 */
export const DEVY_RIGHTS_NOT_HELD_STATES: readonly string[] = ['PROMOTED_TO_PRO', 'RIGHTS_EXPIRED']

export async function loadHeldDevyPlayers(leagueId: string): Promise<HeldDevyPlayer[]> {
  const rights = await prisma.devyRights
    .findMany({ where: { leagueId, state: { notIn: [...DEVY_RIGHTS_NOT_HELD_STATES] } }, select: { devyPlayerId: true } })
    .catch(() => [] as Array<{ devyPlayerId: string }>)
  const ids = [...new Set(rights.map((r) => r.devyPlayerId))]
  if (ids.length === 0) return []
  const rows = await prisma.devyPlayer
    .findMany({
      where: { id: { in: ids }, graduatedToNFL: false },
      select: {
        id: true,
        name: true,
        position: true,
        ppaSeasonTotal: true,
        recruitingComposite: true,
        recruitingStars: true,
        draftEligibleYear: true,
      },
    })
    .catch(() => [])
  return rows.map((r) => ({
    devyPlayerId: r.id,
    name: r.name,
    position: r.position ?? null,
    ppaSeasonTotal: r.ppaSeasonTotal ?? null,
    recruitingComposite: r.recruitingComposite ?? null,
    recruitingStars: r.recruitingStars ?? null,
    draftEligibleYear: r.draftEligibleYear ?? null,
  }))
}

/**
 * The trade evaluator's first pricing pass, given the grade's devy rule (2026-09-28, see
 * `priceHeldDevyAssets`). Same conditions as `priceDevy` below: an NFL league with a known season, and
 * prospects THIS league holds. `leagueId` must be a league the caller is a member of — the route
 * passes the id `resolveEvaluationLeagueId` returned, the one the grade itself uses. Never throws.
 */
export async function priceEvaluatorDevy(
  args: { leagueId: string; prices: readonly PricedAsset[] },
  deps: {
    loadHeld: (leagueId: string) => Promise<HeldDevyPlayer[]>
    loadLeague: (leagueId: string) => Promise<{ sport: string | null; season: number | null } | null>
  } = {
    loadHeld: loadHeldDevyPlayers,
    loadLeague: async (leagueId) => {
      const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } }).catch(() => null)
      return row ? { sport: String(row.sport), season: row.season } : null
    },
  },
): Promise<{ prices: PricedAsset[]; devyPriced: string[]; unmeasured: string[] }> {
  const unchanged = { prices: [...args.prices], devyPriced: [] as string[], unmeasured: [] as string[] }
  try {
    if (!args.prices.some((p) => p.unpriced)) return unchanged
    const league = await deps.loadLeague(args.leagueId)
    if (!league || String(league.sport ?? '').toUpperCase() !== 'NFL' || league.season == null) return unchanged
    const held = await deps.loadHeld(args.leagueId).catch(() => [] as HeldDevyPlayer[])
    if (held.length === 0) return unchanged
    return priceHeldDevyAssets({ prices: args.prices, held, currentSeason: league.season })
  } catch {
    return unchanged
  }
}

export type LeagueAssetPolicyDeps = { loadHeld: (leagueId: string) => Promise<HeldDevyPlayer[]> }

export function createLeagueAssetPolicy(
  league: { id: string; sport: string; leagueType: LeagueTypeBasis; season?: number | null; status?: string | null },
  deps: LeagueAssetPolicyDeps = { loadHeld: loadHeldDevyPlayers },
): LeagueAssetPolicy {
  const isNfl = String(league.sport).toUpperCase() === 'NFL'
  let held: Promise<HeldDevyPlayer[]> | null = null
  const heldOnce = () => (held ??= deps.loadHeld(league.id).catch(() => []))

  return {
    pickRefusal(assets) {
      return pickPolicyRefusal({
        sport: league.sport,
        leagueType: league.leagueType.type,
        leagueSeason: league.season ?? null,
        leagueStatus: league.status ?? null,
        assets,
      })
    },
    async priceDevy(side) {
      const unchanged: DevyPricedSide = { lines: side.lines, priced: side.priced, devyPriced: 0, unmeasured: [] }
      // Nothing the chart missed, or no season to measure the wait from: nothing to read.
      if (!isNfl || league.season == null || !side.lines.some((l) => l.unpriced)) return unchanged
      const list = await heldOnce()
      if (list.length === 0) return unchanged
      return applyDevyPricing({ inputs: side.inputs, lines: side.lines, priced: side.priced, held: list, currentSeason: league.season })
    },
  }
}
