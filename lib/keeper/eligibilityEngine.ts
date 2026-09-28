import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { KeeperEligibilityRow } from './types'

function computeCostRound(
  league: Pick<
    League,
    | 'keeperCostSystem'
    | 'keeperRoundPenalty'
    | 'keeperInflationRate'
    | 'keeperAuctionPctIncrease'
  >,
  originalRound: number | null,
  yearsKept: number,
): { costRound: number | null; costLabel: string | null; costAuction: number | null } {
  const sys = league.keeperCostSystem ?? 'round_based'
  const pen = league.keeperRoundPenalty ?? 1
  const infl = league.keeperInflationRate ?? 1
  const aucPct = league.keeperAuctionPctIncrease ?? 0.2

  if (sys === 'free') {
    return { costRound: null, costLabel: 'Free', costAuction: null }
  }

  if (sys === 'auction_value') {
    const base = 40
    const cost = base * (1 + aucPct) * (1 + yearsKept * 0.1)
    return { costRound: null, costLabel: `$${cost.toFixed(0)}`, costAuction: cost }
  }

  const or = originalRound ?? 10
  if (sys === 'inflation') {
    const costRound = Math.max(1, or - pen * (yearsKept + 1))
    return { costRound, costLabel: `Round ${costRound}`, costAuction: null }
  }

  const costRound = Math.max(1, or - pen)
  return { costRound, costLabel: `Round ${costRound}`, costAuction: null }
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
  const undraftedRound = latestDraft?.rounds ?? null

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

      // The round he last cost: his keeper round if kept last year, else where he was drafted,
      // else — a free-agent pickup — the draft's last round.
      const originalRound =
        (idKey ? lastKeptCost.get(idKey) : undefined) ??
        lastKeptCost.get(nKey) ??
        (idKey ? draftedRound.get(idKey) : undefined) ??
        draftedRound.get(nKey) ??
        undraftedRound
      const { costRound, costLabel, costAuction } = computeCostRound(league, originalRound, yearsKept)

      if (isEligible && costRound !== null && costRound < 1) {
        isEligible = false
        ineligibleReason = 'no_pick_available'
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
