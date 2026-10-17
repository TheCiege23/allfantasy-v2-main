import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueVariantFor, pricesOnDynastyChart } from '@/lib/core-app/valueBook'
import { getFantasyCalcChartDbFirst } from '@/lib/fantasycalc-db'
import { marketContextFor } from '@/lib/trade-intel/marketContext'
import {
  draftedIdForName,
  keeperCostsBySleeperId,
  measureKeeperCostRule,
  type KeeperCostRule,
  type KeeperDraftPick,
} from './importedKeeperCost'

/**
 * Keeper cost for the players in one trade, shown BESIDE the grade — never folded into the letter
 * (Guap, 2026-09-28: "show it beside the letter" until the costs are checked on real leagues).
 *
 * 🛑 THE COST IS PRICED ON THE GRADE'S OWN CHART (2026-09-28, corrected). The first version priced a
 * keeper round with `lib/trade-value/formats/keeper.ts`, which values it as a dynasty ROOKIE pick —
 * a first-rounder at 950 units. In a keeper league, keeping a player at a 3rd costs next season's
 * 3rd in a full re-draft: the player you would take there, on the same chart the player himself is
 * priced on. Pricing it as a rookie pick understated every cost and overstated every surplus. Now:
 *
 *   value  the player's market value from the ONE grade's receipt (same chart as the letter)
 *   cost   the value of the player at that round's overall pick (mid-round) on that same chart
 *
 * DB-first: `leagues`, `dw_draft_facts`, and the FantasyCalc chart through its read-through cache
 * (lib/fantasycalc-db.ts). Never throws — a keeper note that cannot be read is absent, not an
 * error on the grade.
 */

export type TradeKeeperCostLine = {
  name: string
  costRound: number
  keptThisSeason: boolean
  /** What the chosen round buys in this league, on the grade's chart — null when it could not be read. */
  costValue: number | null
  /** Value left once that pick is taken out, as a share of his value, floored at 0 — null without both numbers. */
  surplusShare: number | null
  sentence: string
}

export type TradeKeeperCosts =
  | { applies: false }
  | {
      applies: true
      rule: KeeperCostRule
      lines: TradeKeeperCostLine[]
      /** Traded players with no keeper cost on file (not in this season's draft, or a name we cannot pin). */
      notOnFile: string[]
      /** Why nothing is priced, when the league's rule is not measured. */
      note: string | null
    }

export type TradeKeeperPlayer = {
  name: string
  /** His market value in the ONE grade's receipt — the chart the letter used. Null when the grade has none. */
  value: number | null
  /** Every Sleeper id a player with this name carries — the matcher keeps the one this league drafted. */
  candidateIds: readonly string[]
}

type LeagueRow = { settings: unknown; leagueType: string | null; leagueSize: number | null }

type Deps = {
  loadLeague: (leagueId: string) => Promise<LeagueRow | null>
  loadPicks: (leagueId: string) => Promise<KeeperDraftPick[]>
  /** Player values on this league's chart, highest first. */
  loadChartValues: (league: LeagueRow, teams: number) => Promise<number[]>
}

const defaultDeps: Deps = {
  loadLeague: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueType: true, leagueSize: true } }),
  loadPicks: async (leagueId) => {
    const rows = await prisma.draftFact.findMany({
      where: { leagueId, season: { not: null } },
      select: { playerId: true, season: true, round: true, metadata: true },
    })
    return rows.map((r) => ({
      playerId: r.playerId,
      season: r.season as number,
      round: r.round,
      isKeeper:
        !!r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
        && (r.metadata as Record<string, unknown>).isKeeper === true,
    }))
  },
  /*
   * The same request the one grade makes (lib/trade-value-console/leagueTradePricing.ts): the chart
   * `pricesOnDynastyChart` picks, the league's QB count, team count and reception weight.
   */
  loadChartValues: async (league, teams) => {
    const ctx = marketContextFor(league.settings, league.leagueType, teams)
    const ppr = ctx.scoring.format === 'ppr' ? 1 : ctx.scoring.format === 'half_ppr' ? 0.5 : 0
    const { players } = await getFantasyCalcChartDbFirst(
      { isDynasty: pricesOnDynastyChart(ctx.variant), numQbs: ctx.variant.superflex ? 2 : 1, numTeams: teams, ppr },
      { maxStaleMs: 1000 * 60 * 60 * 2 },
    )
    return players
      .filter((p) => String(p.player?.position ?? '').toUpperCase() !== 'PICK' && Number.isFinite(p.value))
      .map((p) => p.value)
      .sort((a, b) => b - a)
  },
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** What a round buys in this league: the player at its middle overall pick, on the chart given. */
export function roundCostOnChart(round: number, teams: number, chartDesc: readonly number[]): number | null {
  if (!(round >= 1) || !(teams >= 2)) return null
  const overall = Math.round((round - 1) * teams + (teams + 1) / 2)
  const v = chartDesc[overall - 1]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function loadTradeKeeperCosts(
  args: { leagueId: string; players: readonly TradeKeeperPlayer[] },
  deps: Deps = defaultDeps,
): Promise<TradeKeeperCosts> {
  try {
    const league = await deps.loadLeague(args.leagueId)
    if (!league || !leagueVariantFor(league.settings, league.leagueType).keeper) return { applies: false }

    const picks = await deps.loadPicks(args.leagueId)
    const rule = measureKeeperCostRule(picks)
    if (rule.rule !== 'same_round') {
      return { applies: true, rule, lines: [], notOnFile: [], note: `Keeper cost not priced: ${rule.reason}.` }
    }

    const costs = keeperCostsBySleeperId(picks, rule)
    const teams = league.leagueSize && league.leagueSize >= 2 ? league.leagueSize : null
    const chart = teams ? await deps.loadChartValues(league, teams).catch(() => [] as number[]) : []

    const lines: TradeKeeperCostLine[] = []
    const notOnFile: string[] = []
    for (const p of args.players) {
      const id = draftedIdForName(p.candidateIds, costs)
      const cost = id ? costs.get(id) : undefined
      if (!cost) {
        notOnFile.push(p.name)
        continue
      }
      const ord = ordinal(cost.costRound)
      const kept = cost.keptThisSeason ? ` (he was kept at a ${ord} this season)` : ''
      const costValue = teams ? roundCostOnChart(cost.costRound, teams, chart) : null
      const value = p.value != null && Number.isFinite(p.value) && p.value > 0 ? p.value : null
      let sentence = `${p.name} keeps at a ${ord} next season${kept}.`
      let surplusShare: number | null = null
      if (value != null && costValue != null && teams) {
        const surplus = Math.round(value - costValue)
        surplusShare = Math.max(0, surplus / value)
        const where = Math.round((cost.costRound - 1) * teams + (teams + 1) / 2)
        sentence +=
          surplus >= 0
            ? ` He is worth ${Math.round(value).toLocaleString()}; a ${ord} here buys about ${Math.round(costValue).toLocaleString()} (the ${ordinal(where)} player on the same chart), so keeping him is worth ${surplus.toLocaleString()} more than the pick.`
            : ` He is worth ${Math.round(value).toLocaleString()}; a ${ord} here buys about ${Math.round(costValue).toLocaleString()} (the ${ordinal(where)} player on the same chart), so keeping him costs ${Math.abs(surplus).toLocaleString()} more than he is worth.`
      }
      lines.push({ name: p.name, costRound: cost.costRound, keptThisSeason: cost.keptThisSeason, costValue, surplusShare, sentence })
    }
    return { applies: true, rule, lines, notOnFile, note: null }
  } catch {
    return { applies: false }
  }
}
