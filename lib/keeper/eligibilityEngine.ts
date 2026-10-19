import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { KeeperEligibilityRow } from './types'
import { keeperCostRound, resolveKeeperRules } from './keeperRules'

function computeCost(
  league: Pick<
    League,
    | 'keeperCostSystem'
    | 'keeperRoundPenalty'
    | 'keeperInflationRate'
    | 'keeperAuctionPctIncrease'
    | 'keeperConflictRule'
    | 'settings'
  >,
  lastRound: number | null,
  yearsKept: number,
  totalRounds: number,
): { costRound: number | null; costLabel: string | null; costAuction: number | null; ineligibleReason: string | null } {
  const rules = resolveKeeperRules(league)
  const aucPct = league.keeperAuctionPctIncrease ?? 0.2

  if (rules.costSystem === 'free') {
    return { costRound: null, costLabel: 'Free', costAuction: null, ineligibleReason: null }
  }

  if (rules.costSystem === 'auction_value') {
    const base = 40
    const cost = base * (1 + aucPct) * (1 + yearsKept * 0.1)
    return { costRound: null, costLabel: `$${cost.toFixed(0)}`, costAuction: cost, ineligibleReason: null }
  }

  // Round costs, waiver-pickup cost and the round floor: lib/keeper/keeperRules.ts.
  const cost = keeperCostRound(rules, { lastRound, yearsKept, totalRounds })
  return cost.ok
    ? { costRound: cost.costRound, costLabel: cost.label, costAuction: null, ineligibleReason: null }
    : { costRound: cost.costRound, costLabel: cost.label, costAuction: null, ineligibleReason: cost.reason }
}

export async function computeKeeperEligibility(
  leagueId: string,
  outgoingSeasonId: string,
): Promise<KeeperEligibilityRow[]> {
  const league = await prisma.league.findFirst({ where: { id: leagueId } })
  if (!league) throw new Error('League not found')

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: outgoingSeasonId, leagueId },
    include: { players: true },
  })

  /*
   * 🛑 BOTH INPUTS TO A KEEPER'S COST WERE CONSTANTS: `yearsKept = 0` and `originalRound = 8`
   * for every player. A first-round pick and a waiver pickup cost the same round, and the
   * max-years rule could never trip. The league's own history answers both.
   */
  const [picks, keeps, latestDraft] = await Promise.all([
    prisma.draftPick.findMany({
      where: { session: { leagueId } },
      select: { playerId: true, playerName: true, position: true, round: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.keeperRecord.findMany({
      where: { leagueId, status: 'locked' },
      select: { playerId: true, playerName: true, position: true, costRound: true, seasonId: true, lockedAt: true },
      orderBy: { lockedAt: 'desc' },
    }),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { rounds: true },
    }),
  ])
  const nameKey = (name: string | null | undefined, position: string | null | undefined) =>
    `${String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(position ?? '').trim().toUpperCase()}`
  const draftedRound = new Map<string, number>()
  for (const pick of picks) {
    for (const key of [pick.playerId?.trim(), nameKey(pick.playerName, pick.position)]) {
      if (key && !draftedRound.has(key)) draftedRound.set(key, pick.round)
    }
  }
  const keptCount = new Map<string, number>()
  const lastKeptCost = new Map<string, number>()
  for (const keep of keeps) {
    for (const key of [keep.playerId?.trim(), nameKey(keep.playerName, keep.position)]) {
      if (!key) continue
      keptCount.set(key, (keptCount.get(key) ?? 0) + 1)
      if (keep.costRound != null && !lastKeptCost.has(key)) lastKeptCost.set(key, keep.costRound)
    }
  }
  // Rounds in the draft: the last draft's, else the deepest round anyone was drafted in.
  const totalRounds = latestDraft?.rounds ?? Math.max(15, ...picks.map((p) => p.round))

  const out: KeeperEligibilityRow[] = []

  for (const roster of rosters) {
    for (const p of roster.players) {
      if (p.droppedAt) continue

      const idKey = p.playerId?.trim()
      const nKey = nameKey(p.playerName, p.position)
      const yearsKept = (idKey ? keptCount.get(idKey) : undefined) ?? keptCount.get(nKey) ?? 0
      let ineligibleReason: string | null = null
      let isEligible = true

      const maxY = league.keeperMaxYears ?? 3
      if (maxY > 0 && yearsKept >= maxY) {
        isEligible = false
        ineligibleReason = 'max_years_reached'
      }

      if (isEligible && league.keeperWaiverAllowed === false && p.acquisitionType === 'waiver') {
        isEligible = false
        ineligibleReason = 'not_drafted'
      }

      // The round he last cost: his keeper round if kept last year, else where he was drafted.
      // Null — a free-agent pickup — costs the league's waiver round (default: the last round).
      const lastRound =
        (idKey ? lastKeptCost.get(idKey) : undefined) ??
        lastKeptCost.get(nKey) ??
        (idKey ? draftedRound.get(idKey) : undefined) ??
        draftedRound.get(nKey) ??
        null
      const { costRound, costLabel, costAuction, ineligibleReason: costRefusal } = computeCost(league, lastRound, yearsKept, totalRounds)

      if (isEligible && costRefusal) {
        isEligible = false
        ineligibleReason = costRefusal
      }

      const row = await prisma.keeperEligibility.upsert({
        where: {
          seasonId_rosterId_playerId: {
            seasonId: outgoingSeasonId,
            rosterId: roster.id,
            playerId: p.playerId,
          },
        },
        create: {
          leagueId,
          seasonId: outgoingSeasonId,
          rosterId: roster.id,
          playerId: p.playerId,
          isEligible,
          ineligibleReason,
          yearsKept,
          projectedCost: costLabel,
          projectedCostRound: costRound,
          projectedCostAuction: costAuction,
        },
        update: {
          isEligible,
          ineligibleReason,
          yearsKept,
          projectedCost: costLabel,
          projectedCostRound: costRound,
          projectedCostAuction: costAuction,
          computedAt: new Date(),
        },
      })
      out.push(row)
    }
  }

  return out
}
