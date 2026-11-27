import 'server-only'

/**
 * The player card's keeper line in a KEEPER league: what keeping him costs under the league's rule, and
 * what that is worth (./keeperCardCostLine for the words).
 *
 * Shown only when:
 *   - the league is a keeper league (`leagueVariantFor(...).keeper`) — never in redraft / dynasty;
 *   - its COMMISSIONER holds AF Commissioner or AF Supreme (./keeperCommissionerPlan) — the commissioner's plan
 *     unlocks it for the whole league, so every member viewing the card sees it;
 *   - the league prices keepers by round (`round_based` / `inflation`; `free` says so; auction: absent).
 *
 * The cost round is the eligibility engine's own derivation (./eligibilityEngine): the round he last
 * cost — his keeper round if he was kept, else where he was drafted, else a pickup — through
 * `keeperCostRound`. The value is the Keepers tab's own measure (./keeperValueReport): his FantasyCalc
 * market rank, read DB-first (./keeperMarketValues), against the pick his round uses. NFL only.
 *
 * Never throws: a keeper line that cannot be read is absent, not an error on the card.
 */

import { prisma } from '@/lib/prisma'
import { leagueVariantFor } from '@/lib/core-app/valueBook'
import { keeperNameKey, keeperPlayerKeys } from './keeperPlayerKey'
import { keeperCostRound, resolveKeeperRules } from './keeperRules'
import { commissionerHasKeeperAutomation } from './keeperCommissionerPlan'
import { loadKeeperMarketRanks } from './keeperMarketValues'
import { describeKeeperCardCost, type PlayerKeeperCost, type PlayerKeeperCostBasis } from './keeperCardCostLine'

export type { PlayerKeeperCost } from './keeperCardCostLine'

type Subject = { leagueId: string; sleeperId: string | null; externalId: string | null; name: string; position: string | null }

export async function loadPlayerKeeperCardCost(subject: Subject): Promise<PlayerKeeperCost | null> {
  try {
    const league = await prisma.league.findUnique({
      where: { id: subject.leagueId },
      select: {
        userId: true, sport: true, settings: true, leagueType: true, leagueSize: true, scoringPresetId: true,
        keeperCostSystem: true, keeperRoundPenalty: true, keeperInflationRate: true, keeperConflictRule: true,
      },
    })
    if (!league || !leagueVariantFor(league.settings, league.leagueType).keeper) return null
    if (!(await commissionerHasKeeperAutomation(league.userId))) return null

    const rules = resolveKeeperRules(league)
    if (rules.costSystem === 'auction_value') return null
    if (rules.costSystem === 'free') {
      return { costRound: null, canKeep: true, headline: 'Keeper cost: free', detail: 'This league charges no pick to keep a player', value: null }
    }

    const ids = [subject.sleeperId, subject.externalId].map((v) => v?.trim()).filter((v): v is string => Boolean(v))
    const keys = new Set([...ids, keeperNameKey(subject.name, subject.position)])
    const matches = (row: { playerId?: string | null; playerName?: string | null; position?: string | null }) =>
      keeperPlayerKeys(row).some((k) => keys.has(k))
    const who = { OR: [...(ids.length ? [{ playerId: { in: ids } }] : []), { playerName: subject.name }] }

    const [keeps, picks, latestDraft] = await Promise.all([
      prisma.keeperRecord.findMany({
        where: { leagueId: subject.leagueId, status: 'locked', ...who },
        select: { playerId: true, playerName: true, position: true, costRound: true },
        orderBy: { lockedAt: 'desc' },
      }),
      prisma.draftPick.findMany({
        where: { session: { leagueId: subject.leagueId }, ...who },
        select: { playerId: true, playerName: true, position: true, round: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.draftSession.findFirst({
        where: { leagueId: subject.leagueId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { rounds: true },
      }),
    ])
    const myKeeps = keeps.filter(matches)
    const lastKept = myKeeps.find((k) => k.costRound != null)?.costRound ?? null
    const drafted = picks.find(matches)?.round ?? null
    const lastRound = lastKept ?? drafted
    const basis: PlayerKeeperCostBasis = lastKept != null ? 'kept' : drafted != null ? 'drafted' : 'waiver'
    const totalRounds = latestDraft?.rounds ?? Math.max(15, drafted ?? 1)
    const cost = keeperCostRound(rules, { lastRound, yearsKept: myKeeps.length, totalRounds })

    const teams = league.leagueSize && league.leagueSize >= 2 ? league.leagueSize : null
    let valuation: Parameters<typeof describeKeeperCardCost>[0]['valuation'] = null
    if (cost.ok && teams) {
      const rankOf = await loadKeeperMarketRanks(league, teams).catch(() => null)
      if (rankOf) valuation = { marketRank: rankOf({ playerId: subject.sleeperId ?? subject.externalId ?? '', name: subject.name, position: subject.position }), teams }
    }
    return describeKeeperCardCost({ rules, cost, basis, lastRound, valuation })
  } catch {
    return null
  }
}
