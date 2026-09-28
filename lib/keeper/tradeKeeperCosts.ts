import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueVariantFor } from '@/lib/core-app/valueBook'
import { keeperModel } from '@/lib/trade-value/formats/keeper'
import type { LeagueShape } from '@/lib/trade-value/leagueShape'
import {
  draftedIdForName,
  keeperCostsBySleeperId,
  measureKeeperCostRule,
  type KeeperCostRule,
  type KeeperDraftPick,
} from './importedKeeperCost'

/**
 * Keeper cost for the players in one trade, shown BESIDE the grade — never folded into the letter
 * (Guap, 2026-09-28: "show it beside the letter" until the costs are checked on real leagues). The
 * keeper model's own contract says the same: the surplus is what the CONTRACT is worth, reported
 * next to the base value, because he still scores points this season whatever he costs next year.
 *
 * DB-first: `leagues` and `dw_draft_facts`. No provider call. Never throws — a keeper note that
 * cannot be read is absent, not an error on the grade.
 */

export type TradeKeeperCostLine = {
  name: string
  costRound: number
  keptThisSeason: boolean
  /** Share of his value left once the pick he costs is taken out, floored at 0 — null without a league shape. */
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
  /** The value the trade priced him at, on the grade's scale. */
  value: number
  position?: string | null
  /** Every Sleeper id a player with this name carries — the matcher keeps the one this league drafted. */
  candidateIds: readonly string[]
}

type Deps = {
  loadLeague: (leagueId: string) => Promise<{ settings: unknown; leagueType: string | null } | null>
  loadPicks: (leagueId: string) => Promise<KeeperDraftPick[]>
}

const defaultDeps: Deps = {
  loadLeague: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueType: true } }),
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
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export async function loadTradeKeeperCosts(
  args: { leagueId: string; players: readonly TradeKeeperPlayer[]; shape: LeagueShape | null },
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
    const lines: TradeKeeperCostLine[] = []
    const notOnFile: string[] = []
    for (const p of args.players) {
      const id = draftedIdForName(p.candidateIds, costs)
      const cost = id ? costs.get(id) : undefined
      if (!cost) {
        notOnFile.push(p.name)
        continue
      }
      const adj = args.shape
        ? keeperModel.adjust({ base: p.value, position: p.position ?? null, shape: args.shape, assetState: { costRound: cost.costRound } })
        : null
      const kept = cost.keptThisSeason ? ` (kept at a ${ordinal(cost.costRound)} this season)` : ''
      lines.push({
        name: p.name,
        costRound: cost.costRound,
        keptThisSeason: cost.keptThisSeason,
        surplusShare: adj ? adj.multiplier : null,
        sentence: adj
          ? `${p.name}${kept}: ${adj.reason}`
          : `${p.name} keeps at a ${ordinal(cost.costRound)} next season${kept}.`,
      })
    }
    return { applies: true, rule, lines, notOnFile, note: null }
  } catch {
    return { applies: false }
  }
}
