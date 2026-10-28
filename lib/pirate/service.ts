import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { addPlayerToRosterData, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { lastWeekOfPlayoffRound, readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { isPirateLeague, isProtectionLocked, protectedIds, readPirateRules } from './rules'
import { evaluatePirateLineup } from './lineupLegality'
import { assessPirateLineupEvidence } from './lineupEvidence'

type Db = PrismaClient

function refusal(message: string): never {
  throw new Error(message)
}

async function nativePirateLeague(leagueId: string, db: Db = prisma) {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, leagueType: true, leagueVariant: true, sport: true, season: true, settings: true, playoffStartWeek: true, playoffWeeksPerRound: true, rosterSize: true },
  })
  if (!league || !isPirateLeague(league)) refusal('Pirate League not found.')
  if (league.platform !== 'manual' && league.platform !== 'allfantasy' && league.platform !== 'af') {
    refusal('Automatic claims require an AllFantasy-hosted league.')
  }
  if (!['NFL', 'NBA', 'MLB', 'NHL'].includes(String(league.sport))) refusal('This sport is not supported by Pirate League.')
  return league
}

export async function pirateLockAt(sport: string, season: number, week: number, db: Db = prisma): Promise<Date | null> {
  const [game, fantasy] = await Promise.all([
    db.gameSchedule.findFirst({
      where: { sportType: sport, season, weekOrRound: week, startTime: { not: null } },
      orderBy: { startTime: 'asc' },
      select: { startTime: true },
    }),
    db.fantasyScheduleGame.findFirst({
      where: { sport, season: String(season), week, kickoffTime: { not: null } },
      orderBy: { kickoffTime: 'asc' },
      select: { kickoffTime: true },
    }),
  ])
  const dates = [game?.startTime, fantasy?.kickoffTime].filter((value): value is Date => value instanceof Date)
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null
}

async function activeSeason(leagueId: string, db: Db = prisma) {
  const season = await db.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, season: true, currentWeek: true, totalWeeks: true, playoffStartWeek: true },
  })
  if (!season) refusal('The league season has not been created yet.')
  return season
}

export async function pirateWeekState(leagueId: string, db: Db = prisma) {
  const league = await nativePirateLeague(leagueId, db)
  const season = await activeSeason(leagueId, db)
  const current = Math.max(1, season.currentWeek)
  const currentMatchups = await db.redraftMatchup.findMany({
    where: { seasonId: season.id, week: current, isMedianMatchup: false },
    select: { status: true },
  })
  const currentFinal = currentMatchups.length > 0 && currentMatchups.every((row) => row.status === 'final')
  const week = currentFinal && current < season.totalWeeks ? current + 1 : current
  const lockAt = await pirateLockAt(String(league.sport), season.season, week, db)
  return { league, season, week, lockAt, rules: readPirateRules(league.settings) }
}

export async function savePirateProtections(input: {
  leagueId: string
  actorUserId: string
  rosterId: string
  week: number
  playerIds: string[]
  now?: Date
}, db: Db = prisma) {
  const state = await pirateWeekState(input.leagueId, db)
  const now = input.now ?? new Date()
  if (state.week !== input.week) refusal('Protections may only be changed for the upcoming scoring period.')
  const roster = await db.redraftRoster.findFirst({
    where: { id: input.rosterId, seasonId: state.season.id, ownerId: input.actorUserId },
    select: { id: true },
  })
  if (!roster) refusal('You do not manage this roster.')
  if (!state.lockAt) refusal('Protection deadline is unavailable until the sport schedule is loaded.')

  const uniqueIds = [...new Set(input.playerIds.map((id) => String(id).trim()).filter(Boolean))]
  const existing = await db.pirateProtectionSet.findUnique({
    where: { leagueId_seasonId_week_rosterId: {
      leagueId: input.leagueId, seasonId: state.season.id, week: input.week, rosterId: input.rosterId,
    } },
  })
  if (existing?.status === 'void') refusal('All protections were voided for this period.')
  const effectiveLock = existing?.lockAt && existing.lockAt < state.lockAt ? existing.lockAt : state.lockAt
  const late = isProtectionLocked(effectiveLock, now)
  const overLimit = uniqueIds.length > state.rules.protectionLimit
  if (late && existing?.status === 'active' &&
      JSON.stringify(protectedIds(existing).slice().sort()) === JSON.stringify(uniqueIds.slice().sort())) {
    return { set: existing, message: 'Protection locks are unchanged.' }
  }
  if (late || overLimit) {
    const result = await db.pirateProtectionSet.upsert({
      where: { leagueId_seasonId_week_rosterId: {
        leagueId: input.leagueId, seasonId: state.season.id, week: input.week, rosterId: input.rosterId,
      } },
      create: {
        leagueId: input.leagueId, seasonId: state.season.id, week: input.week, rosterId: input.rosterId,
        playerIds: [], lockAt: effectiveLock, status: 'void', voidReason: late ? 'late_change' : 'over_limit', actorUserId: input.actorUserId,
      },
      update: { playerIds: [], status: 'void', voidReason: late ? 'late_change' : 'over_limit', actorUserId: input.actorUserId },
    })
    return { set: result, message: late ? 'A change after the first game voided all protections.' : 'More than the allowed number voided all protections.' }
  }
  const owned = await db.redraftRosterPlayer.findMany({
    where: { rosterId: input.rosterId, playerId: { in: uniqueIds }, droppedAt: null },
    select: { playerId: true },
  })
  if (owned.length !== uniqueIds.length) refusal('Every protected player must be active on your roster.')
  const set = await db.pirateProtectionSet.upsert({
    where: { leagueId_seasonId_week_rosterId: {
      leagueId: input.leagueId, seasonId: state.season.id, week: input.week, rosterId: input.rosterId,
    } },
    create: {
      leagueId: input.leagueId, seasonId: state.season.id, week: input.week, rosterId: input.rosterId,
      playerIds: uniqueIds, lockAt: effectiveLock, actorUserId: input.actorUserId,
    },
    update: { playerIds: uniqueIds, actorUserId: input.actorUserId },
  })
  return { set, message: `${uniqueIds.length} of ${state.rules.protectionLimit} players protected.` }
}

export async function seedPirateClaims(leagueId: string, db: Db = prisma) {
  const league = await nativePirateLeague(leagueId, db)
  const season = await activeSeason(leagueId, db)
  const rules = readPirateRules(league.settings)
  const regular = await db.redraftMatchup.findMany({
    where: {
      leagueId, seasonId: season.id, status: 'final', isMedianMatchup: false,
      awayRosterId: { not: null }, week: { lt: season.playoffStartWeek },
    },
    select: { id: true, week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
  })
  const finalRound = rules.playoffClaims ? await db.redraftPlayoffRound.findFirst({
    where: { seasonId: season.id, roundNumber: { lt: 100 } }, orderBy: { roundNumber: 'desc' }, select: { roundNumber: true },
  }) : null
  const playoff = rules.playoffClaims ? await db.redraftPlayoffMatchup.findMany({
    where: { seasonId: season.id, status: 'final', homeRosterId: { not: null }, awayRosterId: { not: null },
      round: { roundNumber: { lt: 100 } } },
    select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true,
      round: { select: { roundNumber: true } } },
  }) : []
  const candidates = [
    ...regular.map((matchup) => ({ ...matchup, playoffMatchupId: null as string | null, matchupId: matchup.id as string | null })),
    ...playoff.map((matchup) => ({ ...matchup,
      week: lastWeekOfPlayoffRound({ playoffStartWeek: season.playoffStartWeek,
        roundNumber: matchup.round.roundNumber, weeksPerRound: league.playoffWeeksPerRound,
        finalRoundNumber: finalRound?.roundNumber, championshipLength: readChampionshipLength(league.settings) }),
      matchupId: null as string | null, playoffMatchupId: matchup.id as string | null,
    })),
  ]
  const existing = await db.pirateClaim.findMany({
    where: { leagueId, seasonId: season.id,
      OR: [{ matchupId: { in: regular.map((matchup) => matchup.id) } },
        { playoffMatchupId: { in: playoff.map((matchup) => matchup.id) } }] },
    select: { matchupId: true, playoffMatchupId: true, claimCycle: true, status: true },
  })
  const keyOf = (claim: { matchupId: string | null; playoffMatchupId: string | null }) => claim.matchupId ?? claim.playoffMatchupId
  const blocked = new Set(existing.filter((claim) => !['reversed', 'score_corrected'].includes(claim.status)).map(keyOf))
  const now = new Date()
  const rows = candidates.flatMap((matchup) => {
    if (!matchup.homeRosterId || !matchup.awayRosterId || matchup.homeScore == null || matchup.awayScore == null || matchup.homeScore === matchup.awayScore) return []
    if (blocked.has(matchup.id)) return []
    const homeWon = matchup.homeScore > matchup.awayScore
    return [{
      leagueId, seasonId: season.id, week: matchup.week, matchupId: matchup.matchupId,
      playoffMatchupId: matchup.playoffMatchupId,
      claimCycle: 1 + Math.max(-1, ...existing.filter((claim) => keyOf(claim) === matchup.id).map((claim) => claim.claimCycle)),
      winnerRosterId: homeWon ? matchup.homeRosterId : matchup.awayRosterId,
      loserRosterId: homeWon ? matchup.awayRosterId : matchup.homeRosterId,
      selectionDeadlineAt: new Date(now.getTime() + rules.selectionHours * 60 * 60 * 1000),
    }]
  })
  if (!rows.length) {
    await applyAutomaticPirateLineupRulings(leagueId, db)
    return 0
  }
  const created = await db.pirateClaim.createMany({ data: rows, skipDuplicates: true })
  await applyAutomaticPirateLineupRulings(leagueId, db)
  if (created.count) await queuePirateClaimReminders(leagueId, db).catch((error) => console.warn('[pirate] claim reminder queue failed', error))
  return created.count
}

function winnerOfMatchup(matchup: { homeScore: number | null; awayScore: number | null; homeRosterId: string | null; awayRosterId: string | null }): string | null {
  if (matchup.homeScore == null || matchup.awayScore == null || matchup.homeScore === matchup.awayScore) return null
  return matchup.homeScore > matchup.awayScore ? matchup.homeRosterId : matchup.awayRosterId
}

type ClaimMatchupRef = { matchupId: string | null; playoffMatchupId: string | null }

async function readClaimMatchup(claim: ClaimMatchupRef, db: Db) {
  const select = { status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true } as const
  return claim.playoffMatchupId
    ? db.redraftPlayoffMatchup.findUnique({ where: { id: claim.playoffMatchupId }, select })
    : claim.matchupId ? db.redraftMatchup.findUnique({ where: { id: claim.matchupId }, select }) : null
}

export async function getPirateDashboard(leagueId: string, actorUserId: string, db: Db = prisma) {
  const state = await pirateWeekState(leagueId, db)
  const rosterLimit = state.league.rosterSize && state.league.rosterSize > 0
    ? state.league.rosterSize
    : resolveRedraftRosterConfig(String(state.league.sport), state.league.settings).maxRosterSize
  const rosters = await db.redraftRoster.findMany({
    where: { seasonId: state.season.id },
    select: {
      id: true, ownerId: true, ownerName: true, teamName: true,
      players: { where: { droppedAt: null }, select: { id: true, playerId: true, playerName: true, position: true, team: true, slotType: true, injuryStatus: true, byeWeek: true } },
    },
  })
  const claims = await db.pirateClaim.findMany({
    where: { leagueId, seasonId: state.season.id },
    orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  })
  const matchupRows = await Promise.all(claims.map((claim) => readClaimMatchup(claim, db)))
  const displayedClaims = claims.map((claim, index) => {
    const matchup = matchupRows[index]
    const winner = matchup?.homeScore == null || matchup?.awayScore == null || matchup.homeScore === matchup.awayScore ? null
      : matchup.homeScore > matchup.awayScore ? matchup.homeRosterId : matchup.awayRosterId
    return { ...claim, scoreCorrectionNeedsReversal: claim.status === 'transferred' && matchup?.status === 'final' && winner !== claim.winnerRosterId }
  })
  const protections = await db.pirateProtectionSet.findMany({
    where: {
      leagueId, seasonId: state.season.id,
      week: { in: [...new Set([state.week, ...claims.map((claim) => claim.week)])] },
    },
    select: { rosterId: true, week: true, playerIds: true, status: true, voidReason: true, updatedAt: true },
  })
  const rulingEvents = await db.redraftLeagueTransaction.findMany({
    where: { leagueId, seasonId: state.season.id, type: 'pirate_lineup_ruling' },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { createdAt: true, metadata: true },
  })
  const lineupRulings = rulingEvents.flatMap((event) => {
    const item = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown> : {}
    return typeof item.claimId === 'string' && (item.decision === 'forfeit' || item.decision === 'excused')
      ? [{ claimId: item.claimId, decision: item.decision, reason: String(item.reason ?? ''), createdAt: event.createdAt,
        source: item.source === 'automatic' ? 'automatic' : 'commissioner' }]
      : []
  }).filter((event, index, rows) => rows.findIndex((other) => other.claimId === event.claimId) === index)
  const config = resolveRedraftRosterConfig(String(state.league.sport), state.league.settings)
  const lineupPreviews = Object.fromEntries(claims.map((claim) => {
    const loser = rosters.find((roster) => roster.id === claim.loserRosterId)
    const finding = evaluatePirateLineup({
      sport: String(state.league.sport), week: claim.week, rosterConfig: config,
      roster: (loser?.players ?? []).map((player) => ({ ...player, addableBeforeLock: false })),
      waivers: [], lineupAtLockCertified: false, availabilityAtLockCertified: false, waiverPoolCertified: false,
    })
    return [claim.id, { issues: finding.issues, reason: 'Current stored roster only; verify the actual lineup and available players at lock.' }]
  }))
  const evidenceByPeriod = new Map<string, ReturnType<typeof assessPirateLineupEvidence>>()
  const lineupEvidence = Object.fromEntries(await Promise.all(claims.map(async (claim) => {
    const key = `${claim.loserRosterId}:${claim.week}`
    if (!evidenceByPeriod.has(key)) evidenceByPeriod.set(key, assessPirateLineupEvidence({ leagueId,
      seasonId: state.season.id, rosterId: claim.loserRosterId, week: claim.week }, db))
    return [claim.id, await evidenceByPeriod.get(key)]
  })))
  return {
    league: { id: state.league.id, name: (await db.league.findUnique({ where: { id: leagueId }, select: { name: true } }))?.name, sport: state.league.sport, rosterLimit },
    rules: state.rules,
    season: state.season,
    week: state.week,
    lockAt: state.lockAt,
    canEditProtections: !isProtectionLocked(state.lockAt),
    myRosterId: rosters.find((roster) => roster.ownerId === actorUserId)?.id ?? null,
    rosters,
    protections,
    lineupRulings,
    lineupPreviews,
    lineupEvidence,
    claims: displayedClaims,
  }
}

async function managedRoster(seasonId: string, rosterId: string, actorUserId: string, db: Db = prisma) {
  const roster = await db.redraftRoster.findFirst({
    where: { id: rosterId, seasonId, ownerId: actorUserId },
    select: { id: true },
  })
  if (!roster) refusal('You do not manage this roster.')
}

/** A commissioner applies the legal-lineup exception only after checking lock-time evidence. */
export async function commissionerRulePirateLineup(input: {
  leagueId: string; claimId: string; actorUserId: string
  decision: 'forfeit' | 'excused'; reason: string; now?: Date
  automaticEvidenceIds?: string[]
}, db: Db = prisma) {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 1000) refusal('Explain the lock-time lineup and replacement evidence in 10–1000 characters.')
  const claim = await db.pirateClaim.findFirst({ where: { id: input.claimId, leagueId: input.leagueId } })
  if (!claim) refusal('Claim not found in this league.')
  if (!['awaiting_selection', 'selection_expired', 'pending', 'countered'].includes(claim.status)) {
    refusal('This claim is processing or complete. Resolve the transfer before changing its lineup ruling.')
  }
  const matchup = await readClaimMatchup(claim, db)
  if (!matchup || matchup.status !== 'final' || winnerOfMatchup(matchup) !== claim.winnerRosterId) {
    refusal('The matchup is not final with this winner.')
  }
  const league = await nativePirateLeague(input.leagueId, db)
  const season = await db.redraftSeason.findUnique({ where: { id: claim.seasonId }, select: { season: true } })
  if (!season) refusal('Claim season not found.')
  const lockAt = await pirateLockAt(String(league.sport), season.season, claim.week, db)
  if (!lockAt) refusal('The period lock is unavailable. Record the game schedule before ruling.')
  const key = { leagueId: claim.leagueId, seasonId: claim.seasonId, week: claim.week, rosterId: claim.loserRosterId }
  return db.$transaction(async (tx) => {
    const current = await tx.pirateClaim.findUnique({ where: { id: claim.id }, select: { status: true, playerId: true, resolutionNote: true } })
    if (!current || !['awaiting_selection', 'selection_expired', 'pending', 'countered'].includes(current.status)) refusal('The claim changed while you were ruling.')
    if (input.automaticEvidenceIds) {
      const ruled = await tx.redraftLeagueTransaction.findFirst({ where: {
        leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.loserRosterId, type: 'pirate_lineup_ruling',
        metadata: { path: ['week'], equals: claim.week },
      }, select: { id: true } })
      if (ruled) return { decision: input.decision, reason: 'A recorded ruling already takes precedence.', reopenedSelection: false }
    }
    const set = await tx.pirateProtectionSet.findUnique({ where: { leagueId_seasonId_week_rosterId: key } })
    if (set?.status === 'void' && set.voidReason !== 'illegal_lineup') refusal('This protection set was voided for another rule; a lineup ruling cannot restore it.')
    let reopened = false
    if (input.decision === 'forfeit') {
      if (set?.status === 'active') {
        await tx.pirateProtectionSet.update({ where: { id: set.id }, data: { status: 'void', voidReason: 'illegal_lineup', actorUserId: input.actorUserId } })
      } else if (!set) {
        await tx.pirateProtectionSet.create({ data: { ...key, lockAt, playerIds: [], status: 'void', voidReason: 'illegal_lineup', actorUserId: input.actorUserId } })
      }
    } else if (set?.status === 'void' && set.voidReason === 'illegal_lineup') {
      const restoredIds = Array.isArray(set.playerIds) ? set.playerIds.filter((id): id is string => typeof id === 'string') : []
      if (current.playerId && restoredIds.includes(current.playerId)) {
        const now = input.now ?? new Date()
        const changed = await tx.pirateClaim.updateMany({
          where: { id: claim.id, status: current.status },
          data: { status: 'awaiting_selection', playerId: null, offeredPlayerId: null, counterPlayerId: null,
            selectedAt: null, respondedAt: null, deadlineAt: null,
            selectionDeadlineAt: new Date(now.getTime() + readPirateRules(league.settings).selectionHours * 60 * 60 * 1000),
            resolutionNote: [current.resolutionNote, 'Lineup ruling restored a protected player; winner selection reopened.'].filter(Boolean).join(' ') },
        })
        if (changed.count !== 1) refusal('The claim changed while you were ruling.')
        reopened = true
      }
      await tx.pirateProtectionSet.update({ where: { id: set.id }, data: { status: 'active', voidReason: null, actorUserId: input.actorUserId } })
    }
    await tx.redraftLeagueTransaction.create({ data: {
      leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.loserRosterId,
      type: 'pirate_lineup_ruling',
      metadata: { claimId: claim.id, week: claim.week, decision: input.decision, reason,
        actorUserId: input.actorUserId, recordedAt: (input.now ?? new Date()).toISOString(),
        source: input.automaticEvidenceIds ? 'automatic' : 'commissioner', evidenceIds: input.automaticEvidenceIds ?? [],
        previousProtectionStatus: set?.status ?? null, previousVoidReason: set?.voidReason ?? null, reopenedSelection: reopened },
    } })
    return { decision: input.decision, reason, reopenedSelection: reopened }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/** Automatic evidence never replaces a commissioner's recorded ruling. */
async function applyAutomaticPirateLineupRulings(leagueId: string, db: Db) {
  const claims = await db.pirateClaim.findMany({ where: { leagueId,
    status: { in: ['awaiting_selection', 'selection_expired', 'pending', 'countered'] } },
    orderBy: { createdAt: 'desc' }, take: 50 })
  for (const claim of claims) {
    const ruled = await db.redraftLeagueTransaction.findFirst({ where: { leagueId, seasonId: claim.seasonId,
      rosterId: claim.loserRosterId, type: 'pirate_lineup_ruling', metadata: { path: ['week'], equals: claim.week } }, select: { id: true } })
    if (ruled) continue
    const protection = await db.pirateProtectionSet.findUnique({ where: { leagueId_seasonId_week_rosterId: {
      leagueId, seasonId: claim.seasonId, week: claim.week, rosterId: claim.loserRosterId,
    } }, select: { status: true, voidReason: true } })
    if (protection?.status === 'void') continue
    const finding = await assessPirateLineupEvidence({ leagueId, seasonId: claim.seasonId,
      rosterId: claim.loserRosterId, week: claim.week }, db)
    if (finding?.decision !== 'forfeit') continue
    await commissionerRulePirateLineup({ leagueId, claimId: claim.id, actorUserId: 'system:pirate-lineup', decision: 'forfeit',
      reason: `${finding.reason} Lock evidence: ${finding.eventAt}. ${finding.issues.join('; ')}`.slice(0, 1000),
      automaticEvidenceIds: finding.evidenceIds }, db)
  }
}

async function assertClaimablePlayer(claim: {
  leagueId: string; seasonId: string; week: number; loserRosterId: string
}, playerId: string, db: Db = prisma) {
  const player = await db.redraftRosterPlayer.findFirst({
    where: { rosterId: claim.loserRosterId, playerId, droppedAt: null },
    select: { id: true, playerName: true },
  })
  if (!player) refusal('That player is no longer on the losing roster.')
  const set = await db.pirateProtectionSet.findUnique({
    where: { leagueId_seasonId_week_rosterId: {
      leagueId: claim.leagueId, seasonId: claim.seasonId, week: claim.week, rosterId: claim.loserRosterId,
    } },
    select: { playerIds: true, status: true },
  })
  if (protectedIds(set).includes(playerId)) refusal('That player was protected for this matchup.')
  return player
}

async function selectPirateClaimInternal(input: {
  claimId: string; actorUserId: string; playerId: string; offeredPlayerId?: string | null; now?: Date
}, db: Db, commissionerOverride: boolean) {
  const claim = await db.pirateClaim.findUnique({ where: { id: input.claimId } })
  if (!claim || !(claim.status === 'awaiting_selection' || commissionerOverride && claim.status === 'selection_expired')) refusal('This claim is no longer open for selection.')
  const league = await nativePirateLeague(claim.leagueId, db)
  if (!commissionerOverride) await managedRoster(claim.seasonId, claim.winnerRosterId, input.actorUserId, db)
  const now = input.now ?? new Date()
  const matchup = await readClaimMatchup(claim, db)
  if (!matchup || matchup.status !== 'final' || winnerOfMatchup(matchup) !== claim.winnerRosterId) {
    refusal('The finalized matchup no longer names this winner. Wait for score correction review.')
  }
  if (!commissionerOverride && claim.selectionDeadlineAt && now >= claim.selectionDeadlineAt) refusal('The winner selection deadline has passed. Ask the commissioner to review this claim.')
  const season = await db.redraftSeason.findUnique({ where: { id: claim.seasonId }, select: { season: true } })
  if (!season) refusal('The claim season is unavailable.')
  const nextLock = await pirateLockAt(String(league.sport), season.season, claim.week + 1, db)
  if (!commissionerOverride && nextLock && now >= nextLock) refusal('The next scoring period has started. This claim needs commissioner review.')
  await assertClaimablePlayer(claim, input.playerId, db)
  if (input.offeredPlayerId) {
    const offered = await db.redraftRosterPlayer.findFirst({
      where: { rosterId: claim.winnerRosterId, playerId: input.offeredPlayerId, droppedAt: null },
      select: { id: true },
    })
    if (!offered) refusal('The offered player is not on your roster.')
  }
  const hours = readPirateRules(league.settings).claimHours
  const timeDeadline = new Date(now.getTime() + hours * 60 * 60 * 1000)
  const deadlineAt = timeDeadline
  const updated = await db.pirateClaim.updateMany({
    where: { id: claim.id, status: claim.status },
    data: {
      playerId: input.playerId, offeredPlayerId: input.offeredPlayerId ?? null,
      selectedAt: now, deadlineAt, status: 'pending',
      ...(commissionerOverride ? { resolutionNote: `Commissioner ${input.actorUserId} selected a player for the winner.` } : {}),
    },
  })
  if (updated.count !== 1) refusal('This claim was selected by another request.')
  await queuePirateClaimReminders(claim.leagueId, db).catch((error) => console.warn('[pirate] claim reminder queue failed', error))
  return db.pirateClaim.findUniqueOrThrow({ where: { id: claim.id } })
}

export async function selectPirateClaim(input: {
  claimId: string; actorUserId: string; playerId: string; offeredPlayerId?: string | null; now?: Date
}, db: Db = prisma) {
  return selectPirateClaimInternal(input, db, false)
}

/** Caller must pass the authenticated commissioner after the route-level commissioner gate. */
export async function commissionerSelectPirateClaim(input: {
  leagueId: string; claimId: string; actorUserId: string; playerId: string; now?: Date
}, db: Db = prisma) {
  const claim = await db.pirateClaim.findFirst({ where: { id: input.claimId, leagueId: input.leagueId }, select: { id: true } })
  if (!claim) refusal('Claim not found in this league.')
  return selectPirateClaimInternal({ ...input, offeredPlayerId: null }, db, true)
}

/** Void preserves the record and releases a selected player's claim reservation. */
export async function commissionerVoidPirateClaim(input: {
  leagueId: string; claimId: string; actorUserId: string; reason: string; now?: Date
}, db: Db = prisma) {
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 500) refusal('Provide a reason between 5 and 500 characters.')
  const existing = await db.pirateClaim.findFirst({
    where: { id: input.claimId, leagueId: input.leagueId },
    select: { resolutionNote: true },
  })
  if (!existing) refusal('Claim not found in this league.')
  const updated = await db.pirateClaim.updateMany({
      where: { id: input.claimId, leagueId: input.leagueId, status: { in: ['awaiting_selection', 'selection_expired', 'pending', 'countered'] } },
    data: { status: 'void', resolutionNote: [existing.resolutionNote, `Commissioner ${input.actorUserId} voided the claim: ${reason}`].filter(Boolean).join(' '), respondedAt: input.now ?? new Date() },
  })
  if (updated.count !== 1) refusal('This claim cannot be voided.')
  return db.pirateClaim.findUniqueOrThrow({ where: { id: input.claimId } })
}

/** Retry a failed automatic transfer after its response window has elapsed. */
export async function commissionerRetryPirateClaim(input: {
  leagueId: string; claimId: string; actorUserId: string; now?: Date
}, db: Db = prisma) {
  const now = input.now ?? new Date()
  const claim = await db.pirateClaim.findFirst({
    where: { id: input.claimId, leagueId: input.leagueId, status: { in: ['pending', 'countered'] } },
    select: { deadlineAt: true },
  })
  if (!claim?.deadlineAt || claim.deadlineAt > now) refusal('The claim response window has not ended.')
  return settlePirateClaim({ claimId: input.claimId, note: `Commissioner ${input.actorUserId} retried the overdue claim.`, now }, db)
}

export async function settlePirateClaim(input: {
  claimId: string
  returnPlayerId?: string | null
  note: string
  now?: Date
}, db: Db = prisma) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const claim = await tx.pirateClaim.findUnique({ where: { id: input.claimId } })
    if (!claim || !['pending', 'countered'].includes(claim.status) || !claim.playerId) refusal('This claim is not ready to settle.')
    const matchup = await readClaimMatchup(claim, tx as unknown as Db)
    if (!matchup || matchup.status !== 'final' || winnerOfMatchup(matchup) !== claim.winnerRosterId) {
      refusal('The finalized matchup no longer names this winner. Transfer was stopped for score correction review.')
    }
    await assertClaimablePlayer(claim, claim.playerId, tx as unknown as Db)
    const claimed = await tx.redraftRosterPlayer.findFirst({
      where: { rosterId: claim.loserRosterId, playerId: claim.playerId, droppedAt: null },
    })
    if (!claimed) refusal('The claimed player has left the losing roster.')
    const returning = input.returnPlayerId
      ? await tx.redraftRosterPlayer.findFirst({
          where: { rosterId: claim.winnerRosterId, playerId: input.returnPlayerId, droppedAt: null },
        })
      : null
    if (input.returnPlayerId && !returning) refusal('The return player has left the winning roster.')
    const reserved = await tx.pirateClaim.updateMany({
      where: { id: claim.id, status: { in: ['pending', 'countered'] } },
      data: { status: 'processing' },
    })
    if (reserved.count !== 1) refusal('This claim is already being processed.')

    await tx.redraftRosterPlayer.update({
      where: { id: claimed.id },
      data: { rosterId: claim.winnerRosterId, slotType: 'BENCH', acquisitionType: 'pirate', isLocked: false },
    })
    if (returning) {
      await tx.redraftRosterPlayer.update({
        where: { id: returning.id },
        data: { rosterId: claim.loserRosterId, slotType: 'BENCH', acquisitionType: 'pirate_trade', isLocked: false },
      })
    }
    const mirrors = await tx.roster.findMany({
      where: { redraftRosterId: { in: [claim.winnerRosterId, claim.loserRosterId] } },
      select: { id: true, redraftRosterId: true, playerData: true },
    })
    const winnerMirror = mirrors.find((row) => row.redraftRosterId === claim.winnerRosterId)
    const loserMirror = mirrors.find((row) => row.redraftRosterId === claim.loserRosterId)
    if (winnerMirror) {
      const data = input.returnPlayerId
        ? removePlayerFromRosterData(winnerMirror.playerData, input.returnPlayerId)
        : winnerMirror.playerData
      await tx.roster.update({
        where: { id: winnerMirror.id },
        data: { playerData: addPlayerToRosterData(data, claim.playerId) as Prisma.InputJsonValue },
      })
    }
    if (loserMirror) {
      const data = removePlayerFromRosterData(loserMirror.playerData, claim.playerId)
      await tx.roster.update({
        where: { id: loserMirror.id },
        data: { playerData: input.returnPlayerId ? addPlayerToRosterData(data, input.returnPlayerId) as Prisma.InputJsonValue : data as Prisma.InputJsonValue },
      })
    }
    const metadata = {
      pirateClaimId: claim.id, matchupId: claim.matchupId, playoffMatchupId: claim.playoffMatchupId, week: claim.week,
      claimedPlayerId: claim.playerId, returnPlayerId: input.returnPlayerId ?? null, note: input.note,
    } as Prisma.InputJsonValue
    await tx.redraftLeagueTransaction.createMany({
      data: [
        { leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.winnerRosterId, type: 'pirate_claim', metadata },
        { leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.loserRosterId, type: 'pirate_loss', metadata },
      ],
    })
    const league = await tx.league.findUniqueOrThrow({ where: { id: claim.leagueId }, select: { sport: true, settings: true, rosterSize: true } })
    const maxRoster = league.rosterSize && league.rosterSize > 0 ? league.rosterSize
      : resolveRedraftRosterConfig(String(league.sport), league.settings).maxRosterSize
    const winnerCount = await tx.redraftRosterPlayer.count({ where: { rosterId: claim.winnerRosterId, droppedAt: null } })
    const graceHours = readPirateRules(league.settings).overflowGraceHours
    return tx.pirateClaim.update({
      where: { id: claim.id },
      data: { status: 'transferred', settledReturnPlayerId: input.returnPlayerId ?? null,
        overflowGraceUntil: winnerCount > maxRoster ? new Date(now.getTime() + graceHours * 60 * 60 * 1000) : null,
        transferredAt: now, respondedAt: claim.respondedAt ?? now, resolutionNote: [claim.resolutionNote, input.note].filter(Boolean).join(' ') },
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/** Reverse only a completed claim whose finalized matchup no longer names its original winner. */
export async function commissionerReversePirateClaim(input: {
  leagueId: string; claimId: string; actorUserId: string; reason: string; now?: Date
}, db: Db = prisma) {
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 500) refusal('Provide a score correction reason between 5 and 500 characters.')
  const now = input.now ?? new Date()
  const reversed = await db.$transaction(async (tx) => {
    const claim = await tx.pirateClaim.findFirst({ where: { id: input.claimId, leagueId: input.leagueId } })
    if (!claim || claim.status !== 'transferred' || !claim.playerId) refusal('Only a completed steal can be reversed.')
    const matchup = await readClaimMatchup(claim, tx as unknown as Db)
    if (!matchup || matchup.status !== 'final') refusal('The corrected matchup must be final.')
    const correctedWinner = winnerOfMatchup(matchup)
    if (correctedWinner === claim.winnerRosterId) refusal('The final score still names the original winner.')
    const stolen = await tx.redraftRosterPlayer.findFirst({
      where: { rosterId: claim.winnerRosterId, playerId: claim.playerId, droppedAt: null },
    })
    if (!stolen) refusal('The stolen player has moved again. Resolve the roster conflict before reversing.')
    const returned = claim.settledReturnPlayerId ? await tx.redraftRosterPlayer.findFirst({
      where: { rosterId: claim.loserRosterId, playerId: claim.settledReturnPlayerId, droppedAt: null },
    }) : null
    if (claim.settledReturnPlayerId && !returned) refusal('The exchanged player has moved again. Resolve the roster conflict before reversing.')
    const reserved = await tx.pirateClaim.updateMany({ where: { id: claim.id, status: 'transferred' }, data: { status: 'reversing' } })
    if (reserved.count !== 1) refusal('Another action changed this claim.')
    await tx.redraftRosterPlayer.update({ where: { id: stolen.id }, data: {
      rosterId: claim.loserRosterId, slotType: 'BENCH', acquisitionType: 'pirate_reversal', isLocked: false,
    } })
    if (returned) await tx.redraftRosterPlayer.update({ where: { id: returned.id }, data: {
      rosterId: claim.winnerRosterId, slotType: 'BENCH', acquisitionType: 'pirate_reversal', isLocked: false,
    } })
    const mirrors = await tx.roster.findMany({ where: { redraftRosterId: { in: [claim.winnerRosterId, claim.loserRosterId] } },
      select: { id: true, redraftRosterId: true, playerData: true } })
    for (const mirror of mirrors) {
      const isWinner = mirror.redraftRosterId === claim.winnerRosterId
      const removed = removePlayerFromRosterData(mirror.playerData, isWinner ? claim.playerId : claim.settledReturnPlayerId ?? '')
      const restored = isWinner ? claim.settledReturnPlayerId : claim.playerId
      await tx.roster.update({ where: { id: mirror.id }, data: {
        playerData: (restored ? addPlayerToRosterData(removed, restored) : removed) as Prisma.InputJsonValue,
      } })
    }
    const metadata = { pirateClaimId: claim.id, matchupId: claim.matchupId, playoffMatchupId: claim.playoffMatchupId, week: claim.week,
      stolenPlayerId: claim.playerId, returnedPlayerId: claim.settledReturnPlayerId,
      actorUserId: input.actorUserId, correctedWinnerRosterId: correctedWinner, reason } as Prisma.InputJsonValue
    await tx.redraftLeagueTransaction.createMany({ data: [
      { leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.winnerRosterId, type: 'pirate_reversal', metadata },
      { leagueId: claim.leagueId, seasonId: claim.seasonId, rosterId: claim.loserRosterId, type: 'pirate_reversal', metadata },
    ] })
    return tx.pirateClaim.update({ where: { id: claim.id }, data: {
      status: 'reversed', reversedAt: now, reversedByUserId: input.actorUserId, reversalReason: reason,
      resolutionNote: [claim.resolutionNote, `Reversed by ${input.actorUserId}: ${reason}`].filter(Boolean).join(' '),
    } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  await seedPirateClaims(input.leagueId, db)
  return reversed
}

export async function respondToPirateClaim(input: {
  claimId: string; actorUserId: string
  action: 'accept' | 'counter' | 'accept_counter' | 'decline_counter'
  counterPlayerId?: string | null
  now?: Date
}, db: Db = prisma) {
  const claim = await db.pirateClaim.findUnique({ where: { id: input.claimId } })
  if (!claim || !claim.playerId) refusal('Claim not found.')
  const now = input.now ?? new Date()
  const loserAction = input.action === 'accept' || input.action === 'counter'
  await managedRoster(claim.seasonId, loserAction ? claim.loserRosterId : claim.winnerRosterId, input.actorUserId, db)
  if (claim.deadlineAt && now >= claim.deadlineAt) {
    return settlePirateClaim({ claimId: claim.id, note: 'Automatic transfer after claim deadline', now }, db)
  }
  if (input.action === 'accept') {
    if (claim.status !== 'pending') refusal('The offer is not pending.')
    return settlePirateClaim({ claimId: claim.id, returnPlayerId: claim.offeredPlayerId, note: 'Accepted by losing manager', now }, db)
  }
  if (input.action === 'counter') {
    if (claim.status !== 'pending') refusal('The offer is not pending.')
    if (!input.counterPlayerId) refusal('Choose a player from the winning roster to request.')
    const player = await db.redraftRosterPlayer.findFirst({
      where: { rosterId: claim.winnerRosterId, playerId: input.counterPlayerId, droppedAt: null },
      select: { id: true },
    })
    if (!player) refusal('Requested return player is not on the winning roster.')
    return db.pirateClaim.update({
      where: { id: claim.id },
      data: { counterPlayerId: input.counterPlayerId, status: 'countered', respondedAt: now },
    })
  }
  if (claim.status !== 'countered') refusal('No counteroffer is open.')
  return settlePirateClaim({
    claimId: claim.id,
    returnPlayerId: input.action === 'accept_counter' ? claim.counterPlayerId : null,
    note: input.action === 'accept_counter' ? 'Counteroffer accepted' : 'Counteroffer declined; winner keeps the claim',
    now,
  }, db)
}

export async function maintainPirateClaims(input: { leagueId?: string; now?: Date; limit?: number } = {}, db: Db = prisma) {
  const now = input.now ?? new Date()
  const openClaims = await db.pirateClaim.findMany({ where: {
    ...(input.leagueId ? { leagueId: input.leagueId } : {}),
    status: { in: ['awaiting_selection', 'selection_expired', 'pending', 'countered'] },
  }, select: { id: true, leagueId: true, matchupId: true, playoffMatchupId: true, winnerRosterId: true, status: true, resolutionNote: true } })
  const correctedLeagues = new Set<string>()
  for (const claim of openClaims) {
    const matchup = await readClaimMatchup(claim, db)
    if (!matchup || matchup.status !== 'final') continue
    const winner = winnerOfMatchup(matchup)
    if (winner === claim.winnerRosterId) continue
    const changed = await db.pirateClaim.updateMany({ where: { id: claim.id, status: claim.status }, data: {
      status: 'score_corrected', resolutionNote: [claim.resolutionNote, 'Final score correction canceled this open claim.'].filter(Boolean).join(' '),
    } })
    if (changed.count) correctedLeagues.add(claim.leagueId)
  }
  for (const correctedLeagueId of correctedLeagues) await seedPirateClaims(correctedLeagueId, db)
  await db.pirateClaim.updateMany({
    where: { ...(input.leagueId ? { leagueId: input.leagueId } : {}), status: 'awaiting_selection', selectionDeadlineAt: { lte: now } },
    data: { status: 'selection_expired', resolutionNote: 'Winner selection deadline passed; commissioner review is available.' },
  })
  const due = await db.pirateClaim.findMany({
    where: {
      ...(input.leagueId ? { leagueId: input.leagueId } : {}),
      status: { in: ['pending', 'countered'] },
      deadlineAt: { lte: now },
    },
    orderBy: { deadlineAt: 'asc' },
    take: input.limit ?? 30,
    select: { id: true },
  })
  let transferred = 0
  let failed = 0
  for (const claim of due) {
    try {
      await settlePirateClaim({ claimId: claim.id, note: 'Automatic transfer after claim deadline', now }, db)
      transferred += 1
    } catch {
      failed += 1
    }
  }
  await queuePirateOverflowReminders(input.leagueId, now, db).catch((error) => console.warn('[pirate] overflow reminder queue failed', error))
  return { considered: due.length, transferred, failed }
}

async function queuePirateOverflowReminders(leagueId: string | undefined, now: Date, db: Db) {
  const claims = await db.pirateClaim.findMany({ where: {
    ...(leagueId ? { leagueId } : {}), status: 'transferred', overflowGraceUntil: { lte: now },
    transferredAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
  }, take: 100, select: { id: true, leagueId: true, winnerRosterId: true } })
  for (const claim of claims) {
    const [roster, league] = await Promise.all([
      db.redraftRoster.findUnique({ where: { id: claim.winnerRosterId }, select: { ownerId: true } }),
      db.league.findUnique({ where: { id: claim.leagueId }, select: { sport: true, settings: true, rosterSize: true } }),
    ])
    if (!roster || !league) continue
    const limit = league.rosterSize && league.rosterSize > 0 ? league.rosterSize
      : resolveRedraftRosterConfig(String(league.sport), league.settings).maxRosterSize
    const count = await db.redraftRosterPlayer.count({ where: { rosterId: claim.winnerRosterId, droppedAt: null } })
    if (count <= limit) continue
    await enqueuePirateReminder(db, { leagueId: claim.leagueId, userId: roster.ownerId, event: 'pirate_overflow_due',
      key: claim.id, title: 'Pirate roster needs a drop',
      body: `Your roster has ${count} players with a ${limit}-player limit. Choose whom to drop; no player will be removed automatically.` })
  }
}

function reminderId(event: string, claimOrRosterId: string, userId: string, channel: string) {
  return createHash('sha256').update(`pirate:${event}:${claimOrRosterId}:${userId}:${channel}`).digest('hex')
}

async function enqueuePirateReminder(db: Db, input: {
  leagueId: string; userId: string; event: string; key: string; title: string; body: string; sendAfter?: Date; expiresAt?: Date
}) {
  const actionHref = `/leagues/${encodeURIComponent(input.leagueId)}?tab=pirate`
  await db.notificationOutbox.createMany({
    data: (['push', 'in_app'] as const).map((channel) => ({
      id: reminderId(input.event, input.key, input.userId, channel),
      leagueId: input.leagueId, userId: input.userId, channel, eventType: input.event,
      title: input.title, body: input.body, sendAfter: input.sendAfter ?? null,
      metadata: {
        actionHref, actionLabel: 'Open Pirate Deck', notificationCategory: 'league_announcements',
        expiresAt: input.expiresAt?.toISOString(), pirateClaimId: input.key,
      },
    })),
    skipDuplicates: true,
  })
}

export async function queuePirateClaimReminders(leagueId: string, db: Db = prisma) {
  const claims = await db.pirateClaim.findMany({
    where: { leagueId, status: { in: ['awaiting_selection', 'pending', 'countered'] } },
    select: { id: true, status: true, winnerRosterId: true, loserRosterId: true, selectionDeadlineAt: true, deadlineAt: true },
  })
  if (!claims.length) return
  const rosters = await db.redraftRoster.findMany({
    where: { id: { in: claims.flatMap((claim) => [claim.winnerRosterId, claim.loserRosterId]) } },
    select: { id: true, ownerId: true },
  })
  const owner = new Map(rosters.map((roster) => [roster.id, roster.ownerId]))
  for (const claim of claims) {
    if (claim.status === 'awaiting_selection') {
      const userId = owner.get(claim.winnerRosterId)
      if (userId) await enqueuePirateReminder(db, { leagueId, userId, event: 'pirate_claim_created', key: claim.id,
        title: 'Your Pirate claim is ready', body: 'Choose an unprotected player before the selection deadline.', expiresAt: claim.selectionDeadlineAt ?? undefined })
    } else if (claim.deadlineAt) {
      const userId = owner.get(claim.loserRosterId)
      if (!userId) continue
      await enqueuePirateReminder(db, { leagueId, userId, event: 'pirate_claim_response', key: claim.id,
        title: 'A player has been claimed', body: 'Accept or counter before the player transfers automatically.', expiresAt: claim.deadlineAt })
      const reminderAt = new Date(claim.deadlineAt.getTime() - 2 * 60 * 60 * 1000)
      if (reminderAt > new Date()) await enqueuePirateReminder(db, { leagueId, userId, event: 'pirate_claim_response_reminder', key: claim.id,
        title: 'Pirate claim closes soon', body: 'You have about two hours left to accept or counter.', sendAfter: reminderAt, expiresAt: claim.deadlineAt })
    }
  }
}

export async function queuePirateProtectionReminders(leagueId: string, db: Db = prisma) {
  const state = await pirateWeekState(leagueId, db)
  if (!state.lockAt || state.lockAt <= new Date()) return
  const rosters = await db.redraftRoster.findMany({ where: { seasonId: state.season.id }, select: { id: true, ownerId: true } })
  const remindAt = new Date(state.lockAt.getTime() - 2 * 60 * 60 * 1000)
  for (const roster of rosters) if (roster.ownerId) {
    await enqueuePirateReminder(db, { leagueId, userId: roster.ownerId, event: 'pirate_protection_reminder',
      key: `${state.season.id}:${state.week}:${roster.id}`, title: 'Lock your Pirate crew',
      body: 'Choose your protected players before the first game starts.', sendAfter: remindAt, expiresAt: state.lockAt })
  }
}
