import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withKeeperSessionLock } from './keeperSessionLock'
import { computeKeeperEligibility } from './eligibilityEngine'
import { executeSeasonCarryover } from './carryoverEngine'
import type { ConflictReport, SubmitKeeperResult } from './types'
import { isWaiverCostLabel, placeTeamKeepers, placedKeeperLabel, readWaiverStack, resolveKeeperRules, stackWaiverKeeperCosts } from './keeperRules'
import { KEEPER_SUBMITTED_NONE, applyMissedDeadlineRule, preloadMissedDeadlineRanks, type MissedDeadlinePreload } from './missedDeadlineService'
import { resolveKeeperSourceRoster } from './keeperSourceRoster'

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
  return withKeeperSessionLock(leagueId, seasonId, (db) =>
    submitKeeperSelectionsLocked(db, rosterId, leagueId, seasonId, playerIds))
}

async function submitKeeperSelectionsLocked(
  db: Prisma.TransactionClient,
  rosterId: string,
  leagueId: string,
  seasonId: string,
  playerIds: string[],
): Promise<SubmitKeeperResult> {
  const session = await db.keeperSelectionSession.findFirst({ where: { leagueId, seasonId } })
  if (session && (session.status !== 'open' || session.deadline && new Date(session.deadline).getTime() <= Date.now())) {
    throw new Error('Keeper selections are closed')
  }
  const league = await db.league.findFirst({ where: { id: leagueId } })
  if (!league) throw new Error('League not found')

  const maxKeepers = league.keeperCount ?? 3
  if (playerIds.length > maxKeepers) {
    throw new Error(`At most ${maxKeepers} keepers`)
  }

  const roster = await db.redraftRoster.findFirst({
    where: { id: rosterId, leagueId, seasonId },
    include: { players: true },
  })
  if (!roster) throw new Error('Roster not found')

  if (playerIds.length === 0) {
    // Persist the deliberate choice atomically; a failed write must not report success.
    await db.leagueAuditLog.create({ data: { leagueId, actionType: KEEPER_SUBMITTED_NONE, entityType: 'keeper_session', entityId: seasonId, metadata: { rosterId } } })
  }

  // The window's roster is next season's empty shell; the keepable players and their eligibility rows
  // are on this owner's roster in the season just played (lib/keeper/keeperSourceRoster.ts). Records
  // are still written under the window's season and roster: lock, carryover and the next draft read those.
  const source = await resolveKeeperSourceRoster({ leagueId, seasonId, rosterId }, db)
  const sourcePlayers = source.mapped
    ? source.rosterId
      ? await db.redraftRosterPlayer.findMany({ where: { rosterId: source.rosterId } })
      : []
    : roster.players

  const elig = source.rosterId
    ? await db.keeperEligibility.findMany({
        where: { seasonId: source.seasonId, rosterId: source.rosterId, playerId: { in: playerIds } },
      })
    : []
  const eligMap = new Map(elig.map((e) => [e.playerId, e]))

  const valid: SubmitKeeperResult['valid'] = []
  const conflicted: SubmitKeeperResult['conflicted'] = []
  const cost: SubmitKeeperResult['cost'] = []
  const warnings: string[] = []

  const candidates: {
    pid: string
    e: (typeof elig)[0]
  }[] = []

  // A keeper the commissioner rejected stays rejected: saving him again does not put him back.
  const rejected = new Set(
    (await db.keeperRecord.findMany({ where: { leagueId, seasonId, rosterId, status: 'rejected', playerId: { in: playerIds } }, select: { playerId: true } })).map((r) => r.playerId),
  )

  for (const pid of playerIds) {
    if (rejected.has(pid)) {
      conflicted.push({ playerIds: [pid], reason: 'rejected_by_commissioner' })
      continue
    }
    const e = eligMap.get(pid)
    if (!e?.isEligible) {
      conflicted.push({ playerIds: [pid], reason: e?.ineligibleReason ?? 'ineligible' })
      continue
    }
    const onRoster = sourcePlayers.some((p) => p.playerId === pid && !p.droppedAt)
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
  const latestDraft = await db.draftSession.findFirst({
    where: { leagueId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { rounds: true },
  })
  const totalRounds = latestDraft?.rounds ?? Math.max(15, ...candidates.map((c) => c.e.projectedCostRound ?? 1))
  // Several undrafted pickups stack: last round, the round before, … in the order the manager listed them.
  const priced = candidates.flatMap(({ pid, e }) =>
    e.projectedCostRound != null ? [{ playerId: pid, costRound: e.projectedCostRound, waiver: isWaiverCostLabel(e.projectedCost) }] : [])
  const stacked = readWaiverStack(league.settings) ? stackWaiverKeeperCosts(priced, { totalRounds }) : priced
  const placement = placeTeamKeepers(
    rules,
    stacked.map(({ playerId, costRound }) => ({ playerId, costRound })),
    { totalRounds },
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
        await db.keeperRecord.deleteMany({
          where: { seasonId, rosterId, playerId: pid },
        })
      }
      continue
    }

    const spot = placedById.get(pid)
    const costRound = spot ? spot.round : e.projectedCostRound
    const costLabel = spot ? placedKeeperLabel(spot) : e.projectedCost
    if (spot && spot.round !== spot.costRound) warnings.push(`${pid}: ${costLabel}`)

    const player = sourcePlayers.find((p) => p.playerId === pid && !p.droppedAt)!
    /*
     * This keep's season as a keeper: the seasons he was already a LOCKED keeper (the eligibility
     * row's history count, the same one the max-years rule uses) plus this one. It was the constant
     * 1, so every record said "first year". Selection is refused once the session locks (above), so
     * the history here never already includes this season.
     */
    const yearsKept = Math.max(0, e.yearsKept ?? 0) + 1
    const rec = await db.keeperRecord.upsert({
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
        yearsKept,
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
        yearsKept,
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

  /*
   * 🛑 THE LIST A MANAGER SAVES IS THEIR SELECTION. The Keepers tab posts every ticked player, but a
   * save only ever added: untick a player and save, and his record stayed on file, was locked with
   * the rest, cost a pick and could put the team over the keeper limit (the limit is checked against
   * the list sent, not what is stored). Saving nobody left every earlier keeper in place too. A
   * pending or commissioner-confirmed keeper the list no longer names is removed. Locked and rejected
   * records are never touched.
   */
  await db.keeperRecord.deleteMany({ where: { leagueId, seasonId, rosterId, status: { in: ['pending', 'confirmed'] }, playerId: { notIn: playerIds } } })

  /*
   * How many TEAMS have submitted, counted, not incremented. It went up by one on every save, so one
   * manager saving twice read "2 of 4 teams submitted" to the commissioner (walked locally
   * 2026-11-20), and a refused pick counted too. A team has submitted when it holds a keeper on
   * file or has deliberately kept nobody.
   */
  const [withKeepers, keptNobody] = await Promise.all([
    db.keeperRecord.findMany({ where: { leagueId, seasonId, status: { not: 'rejected' } }, select: { rosterId: true }, distinct: ['rosterId'] }),
    db.leagueAuditLog.findMany({ where: { leagueId, actionType: KEEPER_SUBMITTED_NONE, entityType: 'keeper_session', entityId: seasonId }, select: { metadata: true } }),
  ])
  const submitted = new Set(withKeepers.map((r) => r.rosterId))
  for (const row of keptNobody) {
    const id = (row.metadata as { rosterId?: unknown } | null)?.rosterId
    if (typeof id === 'string' && id) submitted.add(id)
  }
  await db.keeperSelectionSession.updateMany({
    where: { seasonId, leagueId },
    data: { teamsSubmitted: submitted.size },
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
  const initial = await prisma.keeperSelectionSession.findFirst({ where: { id: sessionId, leagueId } })
  if (!initial) throw new Error('Session not found')

  // 🛑 The missed-deadline rule's market ranks (a board sport's league value board, or the NFL chart)
  // are loaded HERE, before the lock's transaction opens — never inside it, where a slow board build
  // would hold the advisory lock and the transaction open. A failed load is `rankOf: null`: no defaults.
  const preload: MissedDeadlinePreload = initial.status === 'locked'
    ? { rankOf: null }
    : await preloadMissedDeadlineRanks(leagueId, initial.seasonId).catch(() => ({ rankOf: null }))

  const session = await withKeeperSessionLock(leagueId, initial.seasonId, async (db) => {
    // Re-read after the lock: another deadline runner may have completed while we waited.
    const current = await db.keeperSelectionSession.findFirst({ where: { id: sessionId, leagueId } })
    if (!current) throw new Error('Session not found')
    if (current.status === 'locked') return null

    // A provider/value failure keeps the old no-default behavior. A savepoint removes ALL
    // partially created defaults before locking the manager selections already on file.
    await db.$executeRaw`SAVEPOINT keeper_defaults`
    try {
      await applyMissedDeadlineRule(leagueId, current.seasonId, db, preload)
      await db.$executeRaw`RELEASE SAVEPOINT keeper_defaults`
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT keeper_defaults`
      await db.$executeRaw`RELEASE SAVEPOINT keeper_defaults`
      console.error('[keeper] missed-deadline rule failed; defaults rolled back', { leagueId, sessionId, error: error instanceof Error ? error.message : error })
    }

    /*
     * 🛑 A KEEPER THE COMMISSIONER CONFIRMED WAS DROPPED AT THE LOCK. The dashboard's Confirm button
     * sets `confirmed`; the lock promoted only `pending`, and the carryover, the pick forfeits and the
     * next draft all read `locked`. So approving a keeper was the one way to lose him: he stayed in
     * the pool and the team kept its pick. Both statuses lock; `rejected` never does.
     */
    await db.keeperRecord.updateMany({
      where: { leagueId, seasonId: current.seasonId, status: { in: ['pending', 'confirmed'] } },
      data: { status: 'locked', lockedAt: new Date() },
    })
    await db.keeperSelectionSession.update({ where: { id: sessionId }, data: { status: 'locked', lockedAt: new Date() } })
    await db.league.update({ where: { id: leagueId }, data: { keeperPhaseActive: false } })
    return current
  })

  // Only the transaction that changed open -> locked materializes the season carryover.
  if (!session) return
  const outgoing = await prisma.redraftSeason.findFirst({
    where: { leagueId, NOT: { id: session.seasonId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (outgoing) {
    try {
      await executeSeasonCarryover(leagueId, outgoing.id, session.seasonId)
    } catch (error) {
      console.error('[keeper] executeSeasonCarryover failed after lock', { leagueId, sessionId, incomingSeasonId: session.seasonId, outgoingSeasonId: outgoing.id, error })
    }
  }

  // AF Commissioner: the locked keepers go straight onto a draft board that is already waiting
  // (./keeperAutoBoard). Off, unentitled or no pre-draft board → nothing happens; never throws.
  const { autoPlaceKeepersIfEnabled } = await import('./keeperAutoBoard')
  await autoPlaceKeepersIfEnabled(leagueId)
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
