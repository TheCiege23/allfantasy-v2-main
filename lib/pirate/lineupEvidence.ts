import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createInjuryRowMatcher } from '@/lib/injuries/matchInjuryRows'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { allowedPositionsForSlot, cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { certifyPirateWaiverWitness } from './waiverEvidence'
import { countTowardRosterLimit, leagueRosterLimit } from '@/lib/league/rosterLimit'
import { readCommissionerRosterLocks } from '@/lib/league/commissioner-roster-lock'
import { evaluatePirateLineup, type PirateLineupFinding, type PirateLineupPlayer } from './lineupLegality'
import { isPirateLeague } from './rules'

type Db = PrismaClient
type EvidencePlayer = PirateLineupPlayer & { team: string | null; kickoffAt: string | null; availabilityKnown: boolean; starterSlotIndex?: number | null; aliases?: string[]; certifiedEventAt?: string; checkedAt?: string }
export type PirateLineupEvidence = {
  version: 1; week: number; eventAt: string; scoringDay: string | null; phase: 'before' | 'after'
  capturedAt: string; sport: string; starterSlots: Array<[string, number]>; rulesHash: string
  mode: string; terminalEvent: boolean; lineupCertified: boolean; scheduleWarnings: string[]; injuryFeedFresh: boolean
  injurySyncAt: string | null
  injuryReports: Array<{ playerName: string; team: string | null; position: string | null; status: string | null; source: string; fetchedAt: string; reportedAt: string | null }>
  waiverPoolCertified: false; waiverState: { type: string | null; nextRunAt: string | null; processingLocked: boolean | null }
  players: EvidencePlayer[]; waivers: EvidencePlayer[]
}

const WINDOW_MS = 7 * 60 * 1000
const INJURY_FRESH_MS = 30 * 60 * 1000
const EVENT_TYPE = 'pirate_lineup_evidence'
const knownStatus = (status: string | null | undefined) => !!status?.trim() &&
  !['UNKNOWN', 'NA', 'N/A', 'UNREVEALED'].includes(status.trim().toUpperCase())

function asEvidence(value: unknown): PirateLineupEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<PirateLineupEvidence>
  return row.version === 1 && typeof row.eventAt === 'string' && Array.isArray(row.players) && Array.isArray(row.starterSlots)
    ? row as PirateLineupEvidence : null
}

/** Persist one immutable snapshot on each side of a sport-specific lineup lock. */
export async function capturePirateLineupEvidence(input: {
  leagueId: string; seasonId: string; season: number; week: number; now?: Date
}, db: Db = prisma): Promise<number> {
  const now = input.now ?? new Date()
  const league = await db.league.findUnique({ where: { id: input.leagueId },
    select: { sport: true, settings: true, platform: true, lockAllMoves: true, leagueType: true, leagueVariant: true,
      isDynasty: true, bestBallMode: true, guillotineMode: true, keeperPhaseActive: true, rosterSize: true, irSlots: true } })
  if (!league || !isPirateLeague(league) || !['manual', 'allfantasy', 'af'].includes(league.platform)) return 0
  const sport = String(league.sport)
  if (!['NFL', 'NBA', 'MLB', 'NHL'].includes(sport)) return 0
  const { buildWeekKickoffMap, lockTeamLookupKeys, readLineupLockSettings } = await import('@/lib/redraft/lineupLock')
  const lock = readLineupLockSettings(league.settings, sport)
  if (lock.mode === 'manual' || lock.overrides.length || lock.manualLockedWeeks.has(input.week)) return 0
  const schedule = await buildWeekKickoffMap(db, { sport, season: input.season, week: input.week })
  const dayByEvent = new Map<number, string | null>()
  if (lock.mode === 'daily') {
    for (const [day, at] of [...schedule.byTeamDay?.values() ?? []].flatMap((days) => [...days.entries()])) {
      dayByEvent.set(at.getTime(), day)
    }
  } else if (lock.mode === 'first_game_of_week') {
    if (schedule.firstKickoff) dayByEvent.set(schedule.firstKickoff.getTime(), null)
    // Later game starts establish whether a proposed replacement actually
    // remained active when his own game began.
    for (const at of schedule.byTeam.values()) dayByEvent.set(at.getTime(), null)
  } else {
    for (const at of schedule.byTeam.values()) dayByEvent.set(at.getTime(), null)
  }
  const events = [...dayByEvent.entries()].filter(([at]) => Math.abs(at - now.getTime()) <= WINDOW_MS)
  if (!events.length) return 0
  const [{ resolveCurrentLockTeams }, { getRosterTemplateForLeague }, { loadDailyLineups, dailySlotFor }] = await Promise.all([
    import('@/lib/redraft/lineupLockCurrentTeam'), import('@/lib/multi-sport/MultiSportRosterService'), import('@/lib/redraft/dailyLineups'),
  ])
  const observationStartedAt = input.now ?? new Date()
  const rosters = await db.redraftRoster.findMany({ where: { seasonId: input.seasonId },
    select: { id: true, ownerId: true, legacyRoster: { select: { id: true, playerData: true, platformUserId: true } }, players: { where: { droppedAt: null },
      select: { playerId: true, playerName: true, position: true, team: true, sport: true, slotType: true, byeWeek: true } } } })
  const allPlayers = rosters.flatMap((roster) => roster.players)
  const rosterLocks = readCommissionerRosterLocks(league.settings)
  const lockedTeams = Object.keys(rosterLocks).length ? await db.leagueTeam.findMany({ where: {
    leagueId: input.leagueId, id: { in: Object.keys(rosterLocks) },
  }, select: { externalId: true, platformUserId: true, claimedByUserId: true } }) : []
  const [injuries, waiverSettings, waiverState, injurySync, currentTeams] = await Promise.all([
    db.sportsInjury.findMany({ where: { sport, expiresAt: { gt: now },
      AND: [{ OR: [{ season: input.season }, { season: null }] }, { OR: [{ week: input.week }, { week: null }] }] },
      orderBy: { fetchedAt: 'desc' }, take: 5000,
      select: { playerId: true, playerName: true, team: true, position: true, sport: true, status: true, date: true, fetchedAt: true, source: true } }),
    db.leagueWaiverSettings.findUnique({ where: { leagueId: input.leagueId }, select: { waiverType: true } }),
    db.leagueWaiverState.findUnique({ where: { leagueId: input.leagueId }, select: { nextRunAt: true, processingLocked: true } }),
    db.providerSyncState.findFirst({ where: { provider: 'injuries-cron', entityType: 'injuries', sport, key: 'lineup-evidence' },
      select: { lastSuccessAt: true, lastErrorAt: true, recordsSkipped: true } }),
    resolveCurrentLockTeams(db, { sport, platform: league.platform, playerIds: allPlayers.map((p) => p.playerId) }),
  ])
  const injuryFeedFresh = !!injurySync?.lastSuccessAt &&
    now.getTime() >= injurySync.lastSuccessAt.getTime() && now.getTime() - injurySync.lastSuccessAt.getTime() <= INJURY_FRESH_MS &&
    (!injurySync.lastErrorAt || injurySync.lastErrorAt <= injurySync.lastSuccessAt) && !injurySync.recordsSkipped && injuries.length < 5000
  const injuryMatch = createInjuryRowMatcher(injuries, sport)
  const reportedNames = new Set(injuries.map((row) => normalizeMatchName(row.playerName)))
  const injuryIdentityKnown = (name: string, match: ReturnType<typeof injuryMatch>) =>
    !(match && 'ambiguous' in match) && (!!match || !reportedNames.has(normalizeMatchName(name)))
  const starterSlots = [...resolveRedraftRosterConfig(sport, league.settings).starterCapacities.entries()]
  const template = await getRosterTemplateForLeague(league.sport, getFormatTypeForVariant(league.sport, league.leagueVariant), input.leagueId)
  const expanded = resolveLineupStarterSlots(league, template)
  const capacities = new Map(starterSlots)
  const slotTokens = expanded.map((slot) => {
    const direct = normalizeToken(slot.label)
    return capacities.has(direct) ? direct : normalizeToken(slot.label.replace(/\d+$/, ''))
  })
  const tokensMatch = JSON.stringify([...new Set(slotTokens)].sort().map((slot) => [slot, slotTokens.filter((s) => s === slot).length])) ===
    JSON.stringify([...starterSlots].sort(([a], [b]) => a.localeCompare(b)))
  const assignments = await db.afRosterLineupAssignment.findMany({ where: {
    rosterId: { in: rosters.flatMap((r) => r.legacyRoster ? [r.legacyRoster.id] : []) }, season: input.season, week: input.week,
  }, select: { rosterId: true, playerId: true, section: true, slotIndex: true } })
  const rulesHash = createHash('sha256').update(JSON.stringify({ starterSlots, slotTokens, rosterLocks, mode: lock.mode, lockAllMoves: league.lockAllMoves,
    schedule: [...schedule.byTeam.entries()].map(([team, at]) => [team, at.toISOString()]).sort() })).digest('hex')
  const dailyLineups = lock.mode === 'daily'
    ? await loadDailyLineups(db, { redraftRosterIds: rosters.map((r) => r.id),
      window: { start: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), end: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000) } })
    : null
  const observedAt = input.now ?? new Date()
  const earlierEvents = await db.redraftLeagueTransaction.findMany({ where: {
    leagueId: input.leagueId, seasonId: input.seasonId, type: EVENT_TYPE, metadata: { path: ['week'], equals: input.week },
  }, orderBy: { createdAt: 'desc' }, take: 1000, select: { rosterId: true, metadata: true } })
  const rosteredIds = new Set(rosters.flatMap((r) => [
    ...r.players.map((p) => p.playerId), ...getRosterPlayerIds(r.legacyRoster?.playerData),
  ]))
  let poolPromise: Promise<PoolPlayerRecord[]> | undefined
  let written = 0
  for (const [time, scoringDay] of events) {
    // A query spanning the boundary is not a snapshot of either side of lock.
    if ((observationStartedAt.getTime() < time) !== (observedAt.getTime() < time) || Math.abs(observedAt.getTime() - time) > WINDOW_MS) continue
    const phase = observedAt.getTime() < time ? 'before' : 'after'
    const eventAt = new Date(time).toISOString()
    const prior = await db.redraftLeagueTransaction.findMany({ where: {
      leagueId: input.leagueId, seasonId: input.seasonId, type: EVENT_TYPE,
      createdAt: { gte: new Date(time - WINDOW_MS - 60_000), lte: new Date(time + WINDOW_MS + 60_000) },
    }, select: { rosterId: true, metadata: true } })
    const recorded = new Set(prior.flatMap((row) => {
      const e = asEvidence(row.metadata)
      return e?.week === input.week && e.eventAt === eventAt && e.phase === phase ? [row.rosterId] : []
    }))
    for (const roster of rosters) {
      if (recorded.has(roster.id)) continue
      const saved = assignments.filter((row) => row.rosterId === roster.legacyRoster?.id)
      const rosterLocked = lockedTeams.some((team) => team.externalId === roster.legacyRoster?.id ||
        (roster.legacyRoster?.platformUserId != null &&
          (team.platformUserId === roster.legacyRoster.platformUserId || team.claimedByUserId === roster.legacyRoster.platformUserId)))
      const savedByPlayer = new Map(saved.map((row) => [row.playerId, row]))
      const sections = getNormalizedLineupSections(roster.legacyRoster?.playerData)
      const currentStarters = new Map(sections.starters.map((row) => [String(row.id), starterSlotIndexOf(row)]))
      const savedStarters = saved.filter((row) => row.section === 'starters')
      const lineupCertified = !!roster.legacyRoster && tokensMatch && saved.length > 0 &&
        currentStarters.size === savedStarters.length && new Set(savedStarters.map((row) => row.slotIndex)).size === savedStarters.length &&
        savedStarters.every((row) => currentStarters.get(row.playerId) === row.slotIndex && !!slotTokens[row.slotIndex])
      const players: EvidencePlayer[] = roster.players.map((p) => {
        const team = currentTeams.has(p.playerId) ? currentTeams.get(p.playerId) ?? null : p.team
        const teamDates = lockTeamLookupKeys(sport, team)
        const kickoff = lock.mode === 'daily' && scoringDay
          ? teamDates.map((key) => schedule.byTeamDay?.get(key)?.get(scoringDay)).find((d): d is Date => !!d)
          : teamDates.map((key) => schedule.byTeam.get(key)).find((d): d is Date => !!d)
        const assignment = savedByPlayer.get(p.playerId)
        const weeklySlot = assignment?.section === 'starters' && lineupCertified ? slotTokens[assignment.slotIndex]
          : assignment && assignment.section !== 'starters' ? assignment.section : p.slotType
        const effectiveSlot = dailyLineups && scoringDay
          ? dailySlotFor(dailyLineups, roster.id, p.playerId, new Date(`${scoringDay}T00:00:00.000Z`)) ?? p.slotType
          : weeklySlot
        const hit = injuryMatch({ name: p.playerName, team, position: p.position })
        const report = hit && 'rows' in hit ? hit.rows[0] : null
        const availabilityKnown = injuryFeedFresh && injuryIdentityKnown(p.playerName, hit) && (!report || knownStatus(report.status)) &&
          (sport !== 'NFL' || currentTeams.has(p.playerId) || p.position === 'DEF') && (!!kickoff || p.byeWeek === input.week) &&
          // A stored bye can belong to the player's former club. Conflicting
          // schedule evidence must be reviewed before any protection penalty.
          !(kickoff && p.byeWeek === input.week)
        return { playerId: p.playerId, playerName: p.playerName, position: p.position,
          slotType: effectiveSlot, team, byeWeek: p.byeWeek, availabilityKnown,
          starterSlotIndex: assignment?.section === 'starters' && lineupCertified ? assignment.slotIndex : null,
          injuryStatus: report?.status ?? null,
          kickoffAt: kickoff?.toISOString() ?? null,
          addableBeforeLock: !rosterLocked && (normalizeToken(effectiveSlot) === 'BENCH' || capacities.has(normalizeToken(effectiveSlot))) &&
            !!kickoff && kickoff.getTime() >= time &&
            (lock.mode !== 'first_game_of_week' || time === schedule.firstKickoff?.getTime()),
          lockedAtSnapshot: lock.mode === 'first_game_of_week' ? !!schedule.firstKickoff && observedAt >= schedule.firstKickoff
            : !!kickoff && kickoff.getTime() <= observedAt.getTime() }
      })
      const carriedWitnesses = new Map<string, EvidencePlayer>()
      for (const row of earlierEvents) {
        if (row.rosterId !== roster.id) continue
        const old = asEvidence(row.metadata)
        if (!old || old.phase !== 'before') continue
        for (const player of old.waivers ?? []) {
          if (player.kickoffAt && new Date(player.kickoffAt).getTime() >= time) carriedWitnesses.set(player.playerId, player)
        }
      }
      let waivers: EvidencePlayer[] = [...carriedWitnesses.values()].map((player) => {
        const match = injuryMatch({ name: player.playerName, team: player.team, position: player.position })
        const report = match && 'rows' in match ? match.rows[0] : null
        const kickoff = lockTeamLookupKeys(sport, player.team).map((key) => schedule.byTeam.get(key)).find((d): d is Date => !!d)
        return { ...player, injuryStatus: report?.status ?? null,
          availabilityKnown: injuryFeedFresh && injuryIdentityKnown(player.playerName, match) && (!report || knownStatus(report.status)) && kickoff?.toISOString() === player.kickoffAt,
          addableBeforeLock: player.certifiedEventAt === eventAt && player.addableBeforeLock === true &&
            !(player.aliases ?? [player.playerId]).some((id) => rosteredIds.has(id)) }
      })
      const limit = leagueRosterLimit(league, 20)
      const hasRoom = countTowardRosterLimit(roster.legacyRoster?.playerData, limit.counts) < limit.limit
      if (phase === 'before' && lineupCertified && !rosterLocked && roster.legacyRoster && hasRoom &&
          (lock.mode !== 'first_game_of_week' || time === schedule.firstKickoff?.getTime()) &&
          !waivers.some((p) => p.addableBeforeLock) && players.every((p) => p.availabilityKnown)) {
        const evaluateWith = (candidates: EvidencePlayer[]) => evaluatePirateLineup({ sport, week: input.week,
          rosterConfig: resolveRedraftRosterConfig(sport, league.settings), roster: players, waivers: candidates,
          lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: false })
        const baseline = evaluateWith([])
        if (baseline.decision === 'review' && baseline.issues.length > 0) {
          try {
            const [{ loadLeagueWaiverPlayerPool }, { normalizePoolRowToUnified }] = await Promise.all([
              import('@/lib/waiver-wire/current-nba-player-pool'), import('@/lib/player-data/normalizeProviderPlayer'),
            ])
            poolPromise ??= loadLeagueWaiverPlayerPool({ id: input.leagueId, ...league })
            const pool = await poolPromise
            let probed = 0
            for (const row of pool) {
              const unified = normalizePoolRowToUnified(row, league.sport).unified
              const aliases = [...new Set([unified.playerId, row.player_id, row.external_source_id].filter((id): id is string => !!id))]
              if (aliases.some((id) => rosteredIds.has(id))) continue
              const team = row.team_abbreviation ?? row.team ?? null
              const kickoff = lockTeamLookupKeys(sport, team).map((key) => schedule.byTeam.get(key)).find((d): d is Date => !!d)
              if (!kickoff || kickoff.getTime() < time || cannotStart({ injuryStatus: row.status })) continue
              const match = injuryMatch({ name: row.full_name, team, position: row.position })
              if (!injuryIdentityKnown(row.full_name, match)) continue
              const report = match && 'rows' in match ? match.rows[0] : null
              if (report && !knownStatus(report.status)) continue
              const candidate: EvidencePlayer = { playerId: unified.playerId, playerName: row.full_name, position: row.position,
                slotType: 'WAIVER', injuryStatus: report?.status ?? null, team, kickoffAt: kickoff.toISOString(),
                availabilityKnown: injuryFeedFresh, addableBeforeLock: true, lockedAtSnapshot: false, aliases, certifiedEventAt: eventAt }
              if (evaluateWith([candidate]).decision !== 'forfeit') continue
              // One no-drop pickup proves the complete legal lineup without
              // assuming that independent adds or drops can be combined.
              if (++probed > 4) break
              if (await certifyPirateWaiverWitness({ leagueId: input.leagueId, rosterId: roster.legacyRoster.id,
                actorUserId: roster.ownerId, playerId: candidate.playerId, now: input.now })) {
                waivers = [{ ...candidate, checkedAt: (input.now ?? new Date()).toISOString() }]
                break
              }
            }
          } catch {
            // An unavailable pool leaves the waiver evidence incomplete.
          }
        }
      }
      const snapshotAt = input.now ?? new Date()
      if ((observationStartedAt.getTime() < time) !== (snapshotAt.getTime() < time) || Math.abs(snapshotAt.getTime() - time) > WINDOW_MS) continue
      const terminalEvent = (lock.mode === 'first_game_of_week' && time === schedule.firstKickoff?.getTime()) ||
        (lock.mode === 'per_player_kickoff' && time === Math.max(...[...schedule.byTeam.values()].map((at) => at.getTime()))) ||
        (lock.mode === 'daily' && scoringDay != null && time === Math.max(...[...schedule.byTeamDay?.values() ?? []]
          .map((days) => days.get(scoringDay)?.getTime() ?? -Infinity)))
      const evidence: PirateLineupEvidence = { version: 1, week: input.week, eventAt, scoringDay, phase, terminalEvent, lineupCertified,
        capturedAt: snapshotAt.toISOString(), mode: lock.mode, sport, starterSlots, rulesHash,
        scheduleWarnings: [...schedule.warnings, ...(league.lockAllMoves ? ['Commissioner locked roster moves.'] : []),
          ...(rosterLocked ? ['Commissioner locked this roster.'] : [])], injuryFeedFresh,
        injurySyncAt: injurySync?.lastSuccessAt?.toISOString() ?? null,
        injuryReports: injuries.filter((row) => [...players, ...waivers].some((p) => normalizeMatchName(p.playerName) === normalizeMatchName(row.playerName)))
          .map((row) => ({ playerName: row.playerName, team: row.team, position: row.position, status: row.status, source: row.source,
            fetchedAt: row.fetchedAt.toISOString(), reportedAt: row.date?.toISOString() ?? null })),
        waiverPoolCertified: false,
        waiverState: { type: waiverSettings?.waiverType ?? null,
          nextRunAt: waiverState?.nextRunAt?.toISOString() ?? null,
          processingLocked: waiverState?.processingLocked ?? null }, players, waivers }
      const id = `pirate_evidence_${createHash('sha256').update(`${input.seasonId}:${input.week}:${roster.id}:${eventAt}:${phase}`).digest('hex')}`
      const inserted = await db.redraftLeagueTransaction.createMany({ data: [{ id, leagueId: input.leagueId,
        seasonId: input.seasonId, rosterId: roster.id, type: EVENT_TYPE,
        metadata: evidence as unknown as Prisma.InputJsonValue }], skipDuplicates: true })
      written += inserted.count
    }
  }
  return written
}

/** A missing or uncertain fact always leaves the protections for commissioner review. */
export function evaluatePirateEvidencePair(before: PirateLineupEvidence, after: PirateLineupEvidence, laterEvidence: PirateLineupEvidence[] = []) {
  const review = (reason: string) => ({ decision: 'review' as const, issues: [] as string[], replacementIds: [] as string[], reason })
  const at = new Date(after.eventAt).getTime()
  const beforeAt = new Date(before.capturedAt).getTime(), afterAt = new Date(after.capturedAt).getTime()
  if (!Number.isFinite(at) || !Number.isFinite(beforeAt) || !Number.isFinite(afterAt) || before.phase !== 'before' || after.phase !== 'after' ||
      before.eventAt !== after.eventAt || before.week !== after.week || before.sport !== after.sport || before.mode !== after.mode ||
      before.scoringDay !== after.scoringDay || beforeAt >= at || afterAt < at || at - beforeAt > WINDOW_MS || afterAt - at > WINDOW_MS) {
    return review('A matching pair of snapshots immediately before and after lock is missing.')
  }
  const beforePlayers = new Map(before.players.map((p) => [p.playerId, p]))
  const capacities = new Map(after.starterSlots)
  const frozenInvalidStarter = after.players.some((p) => capacities.has(normalizeToken(p.slotType)) &&
    p.lockedAtSnapshot === true && !beforePlayers.get(p.playerId)?.lockedAtSnapshot && p.kickoffAt === after.eventAt &&
    (cannotStart(p) || !allowedPositionsForSlot(after.sport, p.slotType).includes(normalizeToken(p.position))))
  if (after.mode === 'daily' || after.mode === 'manual' ||
      ((!before.terminalEvent || !after.terminalEvent) && !frozenInvalidStarter)) {
    return review('This lock does not close every remaining starting slot; commissioner review is required.')
  }
  const identity = (e: PirateLineupEvidence) => e.players.map((p) =>
    JSON.stringify([p.playerId, p.position, p.team, p.kickoffAt, p.byeWeek, p.injuryStatus])).sort().join('|')
  const unchangedLockedSlots = after.players.every((p) => !beforePlayers.get(p.playerId)?.lockedAtSnapshot ||
    beforePlayers.get(p.playerId)?.slotType === p.slotType)
  const certified = before.lineupCertified && after.lineupCertified && identity(before) === identity(after) && unchangedLockedSlots && before.rulesHash === after.rulesHash &&
    before.injuryFeedFresh && after.injuryFeedFresh &&
    before.players.every((p) => p.availabilityKnown) && after.players.every((p) => p.availabilityKnown) &&
    !before.scheduleWarnings.length && !after.scheduleWarnings.length
  const roster = after.players.map((p) => ({ ...p,
    addableBeforeLock: beforePlayers.get(p.playerId)?.addableBeforeLock === true,
    lockedAtSnapshot: beforePlayers.get(p.playerId)?.lockedAtSnapshot === true }))
  const waiverBefore = new Map((before.waivers ?? []).map((p) => [p.playerId, p]))
  const waivers = (after.waivers ?? []).filter((p) => {
    const prior = waiverBefore.get(p.playerId)
    return prior?.certifiedEventAt === after.eventAt && prior.addableBeforeLock === true && p.addableBeforeLock === true &&
      prior.availabilityKnown && p.availabilityKnown && prior.team === p.team && prior.position === p.position &&
      prior.kickoffAt === p.kickoffAt && prior.injuryStatus === p.injuryStatus &&
      !!prior.checkedAt && new Date(prior.checkedAt).getTime() < at && at - new Date(prior.checkedAt).getTime() <= WINDOW_MS
  })
  const finding = evaluatePirateLineup({ sport: after.sport, week: after.week,
    rosterConfig: { starterCapacities: new Map(after.starterSlots), benchSlots: 0, irSlots: 0, taxiSlots: 0, maxRosterSize: 100, source: 'commissioner' },
    roster, waivers, lineupAtLockCertified: certified, availabilityAtLockCertified: certified, waiverPoolCertified: false })
  if (finding.decision === 'forfeit') {
    const activeAtOwnGame = finding.replacementIds.every((id) => {
      const player = [...after.players, ...after.waivers ?? []].find((p) => p.playerId === id)
      if (!player?.kickoffAt) return false
      if (new Date(player.kickoffAt).getTime() <= at) return true
      return laterEvidence.some((e) => {
        const actual = [...e.players, ...e.waivers ?? []].find((p) => p.playerId === id)
        const captured = new Date(e.capturedAt).getTime(), gameAt = new Date(player.kickoffAt!).getTime()
        return e.week === after.week && e.sport === after.sport && e.mode === after.mode && e.phase === 'after' &&
          e.eventAt === player.kickoffAt && captured >= gameAt && captured - gameAt <= WINDOW_MS &&
          e.injuryFeedFresh && !e.scheduleWarnings.length && actual?.availabilityKnown === true &&
          actual.kickoffAt === player.kickoffAt && actual.team === player.team && actual.byeWeek !== after.week && !cannotStart(actual)
      })
    })
    if (!activeAtOwnGame) return review('A proposed legal lineup includes players whose activity at their own game lock is not proven.')
  }
  return finding
}

/** Proven roster replacements or one verified pickup can forfeit; an incomplete waiver pool never excuses automatically. */
export async function assessPirateLineupEvidence(input: {
  leagueId: string; seasonId: string; rosterId: string; week: number
}, db: Db = prisma) {
  const rows = await db.redraftLeagueTransaction.findMany({ where: { leagueId: input.leagueId, seasonId: input.seasonId,
    rosterId: input.rosterId, type: EVENT_TYPE, metadata: { path: ['week'], equals: input.week } },
    orderBy: { createdAt: 'desc' }, take: 250, select: { id: true, metadata: true } })
  const pairs = new Map<string, { before?: { id: string; data: PirateLineupEvidence }; after?: { id: string; data: PirateLineupEvidence } }>()
  for (const row of rows) {
    const data = asEvidence(row.metadata)
    if (!data || data.week !== input.week) continue
    const pair = pairs.get(data.eventAt) ?? {}
    pair[data.phase] ??= { id: row.id, data }
    pairs.set(data.eventAt, pair)
  }
  const ordered = [...pairs.values()].filter((p) => p.before && p.after)
    .sort((a, b) => Number(b.after!.data.terminalEvent) - Number(a.after!.data.terminalEvent) || b.after!.data.eventAt.localeCompare(a.after!.data.eventAt))
  const snapshots = rows.flatMap((row) => {
    const data = asEvidence(row.metadata)
    return data ? [{ id: row.id, data }] : []
  })
  let finalLineup: Promise<Array<{ playerId: string; section: string; slotIndex: number }>> | undefined
  const finalLineupMatches = async (snapshot: PirateLineupEvidence) => {
    finalLineup ??= (async () => {
      const roster = await db.redraftRoster.findFirst({ where: { id: input.rosterId, leagueId: input.leagueId, seasonId: input.seasonId },
        select: { legacyRoster: { select: { id: true } }, season: { select: { season: true } } } })
      return roster?.legacyRoster ? db.afRosterLineupAssignment.findMany({ where: { rosterId: roster.legacyRoster.id,
        season: roster.season.season, week: input.week }, select: { playerId: true, section: true, slotIndex: true } }) : []
    })()
    const saved = await finalLineup
    if (!saved.length) return false
    const capacities = new Map(snapshot.starterSlots)
    const starters = snapshot.players.filter((p) => capacities.has(normalizeToken(p.slotType)))
    if (starters.some((p) => p.starterSlotIndex == null)) return false
    const key = (id: string, index: number) => `${index}:${id}`
    return starters.map((p) => key(p.playerId, p.starterSlotIndex!)).sort().join('|') ===
      saved.filter((p) => p.section === 'starters').map((p) => key(p.playerId, p.slotIndex)).sort().join('|')
  }
  const decorate = (finding: PirateLineupFinding, evidence: Array<{ id: string; data: PirateLineupEvidence }>) => {
    const latest = evidence[evidence.length - 1]
    return { ...finding, evidenceIds: evidence.map((e) => e.id), eventAt: latest.data.eventAt,
      snapshotCount: snapshots.length,
      snapshot: { capturedAt: latest.data.capturedAt, injurySyncAt: latest.data.injurySyncAt,
        lineupCertified: latest.data.lineupCertified, waiverWitnessCount: (latest.data.waivers ?? []).filter((p) => p.addableBeforeLock).length,
        players: [...latest.data.players, ...latest.data.waivers ?? []].map((p) => ({
          playerId: p.playerId, playerName: p.playerName, slotType: p.slotType,
          injuryStatus: p.injuryStatus ?? null, kickoffAt: p.kickoffAt, availabilityKnown: p.availabilityKnown,
          waiverVerified: p.slotType === 'WAIVER' && p.addableBeforeLock === true && p.certifiedEventAt === latest.data.eventAt,
        })) } }
  }
  for (const pair of ordered) {
    const before = pair.before!, after = pair.after!
    const result = evaluatePirateEvidencePair(before.data, after.data, snapshots.map((e) => e.data))
    if (result.decision === 'forfeit') {
      // A partial schedule must not make an early empty slot look final. The
      // period's saved lineup must still confirm the captured violation.
      if (!await finalLineupMatches(after.data)) continue
      const participantGames = new Set([...after.data.players, ...after.data.waivers ?? []]
        .filter((p) => result.replacementIds.includes(p.playerId)).map((p) => p.kickoffAt))
      return { ...decorate(result, [before, after]), evidenceIds: [...new Set([before.id, after.id,
        ...snapshots.filter((e) => e.data.phase === 'after' && participantGames.has(e.data.eventAt)).map((e) => e.id)])] }
    }
    if (result.decision === 'legal' && after.data.mode === 'first_game_of_week')
      return decorate(result, [before, after])
  }
  const latest = ordered[0]
  if (latest) {
    const finding = evaluatePirateEvidencePair(latest.before!.data, latest.after!.data, snapshots.map((e) => e.data))
    return decorate(finding.decision === 'forfeit' ? { ...finding, decision: 'review',
      reason: 'The period’s final saved lineup does not confirm this captured violation. Commissioner review is required.' } : finding,
    [latest.before!, latest.after!])
  }
  return snapshots.length ? decorate({ decision: 'review', issues: [], replacementIds: [],
    reason: 'A matching pair of snapshots immediately before and after lock is missing. Protections stay while the commissioner reviews.' }, [snapshots[0]]) : null
}
