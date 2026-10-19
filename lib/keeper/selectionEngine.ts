import { prisma } from '@/lib/prisma'
import { computeKeeperEligibility } from './eligibilityEngine'
import { executeSeasonCarryover } from './carryoverEngine'
import type { ConflictReport, SubmitKeeperResult } from './types'
import { placeTeamKeepers, placedKeeperLabel, resolveKeeperRules } from './keeperRules'

export async function openKeeperSelectionPhase(
  leagueId: string,
  incomingSeasonId: string,
  deadline: Date,
): Promise<{ id: string }> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) throw new Error('League not found')

  const outgoing = await prisma.redraftSeason.findFirst({
    where: { leagueId, NOT: { id: incomingSeasonId } },
    orderBy: { createdAt: 'desc' },
  })
  if (outgoing?.id) {
    await computeKeeperEligibility(leagueId, outgoing.id)
  }

  const session = await prisma.keeperSelectionSession.upsert({
    where: { seasonId: incomingSeasonId },
    create: {
      leagueId,
      seasonId: incomingSeasonId,
      status: 'open',
      deadline,
      totalTeams: league.leagueSize ?? league.teams.length,
    },
    update: {
      status: 'open',
      deadline,
      teamsSubmitted: 0,
      teamsLocked: 0,
      conflictsResolved: false,
    },
  })

  await prisma.league.update({
    where: { id: leagueId },
    data: { keeperPhaseActive: true, dynastySeasonPhase: 'offseason' },
  })

  return session
}

export async function submitKeeperSelections(
  rosterId: string,
  leagueId: string,
  seasonId: string,
  playerIds: string[],
): Promise<SubmitKeeperResult> {
  const league = await prisma.league.findFirst({ where: { id: leagueId } })
  if (!league) throw new Error('League not found')

  const maxKeepers = league.keeperCount ?? 3
  if (playerIds.length > maxKeepers) {
    throw new Error(`At most ${maxKeepers} keepers`)
  }

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, leagueId, seasonId },
    include: { players: true },
  })
  if (!roster) throw new Error('Roster not found')

  const elig = await prisma.keeperEligibility.findMany({
    where: { seasonId, rosterId, playerId: { in: playerIds } },
  })
  const eligMap = new Map(elig.map((e) => [e.playerId, e]))

  const valid: SubmitKeeperResult['valid'] = []
  const conflicted: SubmitKeeperResult['conflicted'] = []
  const cost: SubmitKeeperResult['cost'] = []
  const warnings: string[] = []

  const candidates: {
    pid: string
    e: (typeof elig)[0]
  }[] = []

  for (const pid of playerIds) {
    const e = eligMap.get(pid)
    if (!e?.isEligible) {
      conflicted.push({ playerIds: [pid], reason: e?.ineligibleReason ?? 'ineligible' })
      continue
    }
    const onRoster = roster.players.some((p) => p.playerId === pid && !p.droppedAt)
    if (!onRoster) {
      conflicted.push({ playerIds: [pid], reason: 'not_on_roster' })
      continue
    }
    candidates.push({ pid, e })
  }

  /*
   * Which pick each round-cost keeper uses (lib/keeper/keeperRules.ts). Two keepers costing the
   * same round either move (lose_round_before / lose_round_after) or are refused for the manager
   * to choose (player_chooses / reject_both). The stored `costRound` is the pick actually used,
   * which is what the carryover forfeits and the next draft places.
   */
  const rules = resolveKeeperRules(league)
  const latestDraft = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { rounds: true },
  })
  const placement = placeTeamKeepers(
    rules,
    candidates.flatMap(({ pid, e }) => (e.projectedCostRound != null ? [{ playerId: pid, costRound: e.projectedCostRound }] : [])),
    { totalRounds: latestDraft?.rounds ?? Math.max(15, ...candidates.map((c) => c.e.projectedCostRound ?? 1)) },
  )
  const placedById = new Map(placement.placed.map((p) => [p.playerId, p]))
  const refusedById = new Map(placement.refused.map((r) => [r.playerId, r]))
  const refusedByRound = new Map<number, string[]>()
  for (const r of placement.refused) {
    if (r.reason !== 'same_round') {
      conflicted.push({ playerIds: [r.playerId], reason: r.reason })
      continue
    }
    refusedByRound.set(r.costRound, [...(refusedByRound.get(r.costRound) ?? []), r.playerId])
  }
  for (const [round, ids] of refusedByRound) {
    // In the order the manager listed them, as before.
    ids.sort((x, y) => playerIds.indexOf(x) - playerIds.indexOf(y))
    conflicted.push({ playerIds: ids, reason: `duplicate_round_${round}` })
  }

  for (const { pid, e } of candidates) {
    if (refusedById.has(pid)) {
      if (rules.sameRoundRule === 'reject_both') {
        await prisma.keeperRecord.deleteMany({
          where: { seasonId, rosterId, playerId: pid },
        })
      }
      continue
    }

    const spot = placedById.get(pid)
    const costRound = spot ? spot.round : e.projectedCostRound
    const costLabel = spot ? placedKeeperLabel(spot) : e.projectedCost
    if (spot && spot.round !== spot.costRound) warnings.push(`${pid}: ${costLabel}`)

    const player = roster.players.find((p) => p.playerId === pid)!
    const rec = await prisma.keeperRecord.upsert({
      where: {
        seasonId_rosterId_playerId: {
          seasonId,
          rosterId,
          playerId: pid,
        },
      },
      create: {
        leagueId,
        seasonId,
        rosterId,
        playerId: pid,
        playerName: player.playerName,
        position: player.position,
        team: player.team,
        sport: player.sport,
        originalDraftYear: new Date().getFullYear(),
        yearsKept: 1,
        costRound,
        costAuctionValue: e.projectedCostAuction,
        costLabel,
        status: 'pending',
        acquisitionType: player.acquisitionType,
      },
      update: {
        costRound,
        costAuctionValue: e.projectedCostAuction,
        costLabel,
        status: 'pending',
        submittedAt: new Date(),
      },
    })
    valid.push(rec)
    cost.push({
      playerId: pid,
      costLabel,
      costRound,
    })
  }

  await prisma.keeperSelectionSession.updateMany({
    where: { seasonId, leagueId },
    data: { teamsSubmitted: { increment: 1 } },
  })

  return { valid, conflicted, cost, warnings }
}

export async function validateAllConflicts(
  leagueId: string,
  sessionId: string,
): Promise<ConflictReport> {
  const session = await prisma.keeperSelectionSession.findFirst({
    where: { id: sessionId, leagueId },
  })
  if (!session) return []

  const records = await prisma.keeperRecord.findMany({
    where: { leagueId, seasonId: session.seasonId, status: { not: 'rejected' } },
  })

  const byRoster = new Map<string, typeof records>()
  for (const r of records) {
    const list = byRoster.get(r.rosterId) ?? []
    list.push(r)
    byRoster.set(r.rosterId, list)
  }

  const report: ConflictReport = []
  for (const [rosterId, list] of byRoster) {
    const byRound = new Map<number, string[]>()
    for (const r of list) {
      if (r.costRound == null) continue
      const arr = byRound.get(r.costRound) ?? []
      arr.push(r.playerId)
      byRound.set(r.costRound, arr)
    }
    const conflicts: ConflictReport[0]['conflicts'] = []
    for (const [costRound, playerIds] of byRound) {
      if (playerIds.length > 1) conflicts.push({ costRound, playerIds })
    }
    if (conflicts.length) report.push({ rosterId, conflicts })
  }
  return report
}

export async function lockKeeperSelections(leagueId: string, sessionId: string): Promise<void> {
  const session = await prisma.keeperSelectionSession.findFirst({
    where: { id: sessionId, leagueId },
  })
  if (!session) throw new Error('Session not found')

  const wasAlreadyLocked = session.status === 'locked'

  await prisma.keeperRecord.updateMany({
    where: { leagueId, seasonId: session.seasonId, status: 'pending' },
    data: { status: 'locked', lockedAt: new Date() },
  })

  await prisma.keeperSelectionSession.update({
    where: { id: sessionId },
    data: { status: 'locked', lockedAt: new Date() },
  })

  await prisma.league.update({
    where: { id: leagueId },
    data: { keeperPhaseActive: false },
  })

  // Materialize locked keepers onto the incoming season's rosters. Guarded on
  // `wasAlreadyLocked` because `executeSeasonCarryover` creates roster-player
  // rows rather than upserting them — re-running it on an already-locked
  // session (a repeat commissioner click, or the deadline sweep racing a
  // manual lock) would duplicate every kept player instead of no-op'ing.
  if (!wasAlreadyLocked) {
    const outgoing = await prisma.redraftSeason.findFirst({
      where: { leagueId, NOT: { id: session.seasonId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (outgoing) {
      try {
        await executeSeasonCarryover(leagueId, outgoing.id, session.seasonId)
      } catch (error) {
        console.error('[keeper] executeSeasonCarryover failed after lock', {
          leagueId,
          sessionId,
          incomingSeasonId: session.seasonId,
          outgoingSeasonId: outgoing.id,
          error,
        })
      }
    }
  }
}

/** Cron: lock sessions past deadline */
export async function processKeeperDeadlines(): Promise<{ locked: string[] }> {
  const now = new Date()
  const open = await prisma.keeperSelectionSession.findMany({
    where: { status: 'open', deadline: { lte: now } },
  })
  const locked: string[] = []
  for (const s of open) {
    await lockKeeperSelections(s.leagueId, s.id)
    locked.push(s.id)
  }
  return { locked }
}
