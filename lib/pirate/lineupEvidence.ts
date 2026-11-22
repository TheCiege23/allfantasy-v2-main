import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createInjuryRowMatcher, injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'
import { injuryStaleAfterHours } from '@/lib/injuries/injuryRecency'
import { isHealthyDesignation, isOutDesignation, isRuledOut } from '@/lib/core-app/injuryStatus'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { allowedPositionsForSlot, cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import { addPlayerToRosterData, removePlayerFromRosterData, getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { certifyPirateWaiverWitness } from './waiverEvidence'
import { countTowardRosterLimit, leagueRosterLimit } from '@/lib/league/rosterLimit'
import { readCommissionerRosterLocks } from '@/lib/league/commissioner-roster-lock'
import { evaluatePirateLineup, pirateActivationSection, type PirateLineupFinding, type PirateLineupPlayer, type PirateLineupPlan } from './lineupLegality'
import { piratePlanPlayerData, searchPirateLineupPlan } from './lineupPlans'
import { isPirateLeague } from './rules'

type Db = PrismaClient
type EvidencePlayer = PirateLineupPlayer & { team: string | null; kickoffAt: string | null; availabilityKnown: boolean; starterSlotIndex?: number | null; aliases?: string[]; certifiedEventAt?: string; checkedAt?: string }
export type PirateLineupEvidence = {
  version: 1 | 2 | 3; week: number; eventAt: string; scoringDay: string | null; phase: 'before' | 'after'
  capturedAt: string; sport: string; starterSlots: Array<[string, number]>; rulesHash: string
  mode: string; terminalEvent: boolean; lineupCertified: boolean; scheduleWarnings: string[]; injuryFeedFresh: boolean
  injurySyncAt: string | null
  injuryReports: Array<{ playerName: string; team: string | null; position: string | null; status: string | null; source: string; fetchedAt: string; reportedAt: string | null }>
  waiverPoolCertified: false; waiverState: { type: string | null; nextRunAt: string | null; processingLocked: boolean | null }
  players: EvidencePlayer[]; waivers: EvidencePlayer[]
  plans?: PirateLineupPlan[]
}

const WINDOW_MS = 7 * 60 * 1000
const INJURY_FRESH_MS = 30 * 60 * 1000
const EVENT_TYPE = 'pirate_lineup_evidence'
const knownStatus = (status: string | null | undefined) => !!status?.trim() &&
  !['UNKNOWN', 'NA', 'N/A', 'UNREVEALED'].includes(status.trim().toUpperCase())

function asEvidence(value: unknown): PirateLineupEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<PirateLineupEvidence>
  return (row.version === 1 || row.version === 2 || row.version === 3) && typeof row.eventAt === 'string' && Array.isArray(row.players) && Array.isArray(row.starterSlots)
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
  const [{ resolveCurrentLockTeams }, { getRosterTemplateForLeague }] = await Promise.all([
    import('@/lib/redraft/lineupLockCurrentTeam'), import('@/lib/multi-sport/MultiSportRosterService'),
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
    // A report's week can be an expected return week. Include every unexpired
    // season report so an unknown return date cannot vanish and imply health.
    db.sportsInjury.findMany({ where: { sport, expiresAt: { gt: now },
      OR: [{ season: input.season }, { season: null }] },
      orderBy: { fetchedAt: 'desc' }, take: 5000,
      select: { playerId: true, playerName: true, team: true, position: true, sport: true, status: true, date: true, fetchedAt: true, source: true } }),
    db.leagueWaiverSettings.findUnique({ where: { leagueId: input.leagueId }, select: { waiverType: true } }),
    db.leagueWaiverState.findUnique({ where: { leagueId: input.leagueId }, select: { nextRunAt: true, processingLocked: true } }),
    db.providerSyncState.findFirst({ where: { provider: 'injuries-cron', entityType: 'injuries', sport, key: 'lineup-evidence-v2' },
      select: { lastSuccessAt: true, lastErrorAt: true, recordsSkipped: true } }),
    resolveCurrentLockTeams(db, { sport, platform: league.platform, playerIds: allPlayers.map((p) => p.playerId) }),
  ])
  const injuryFeedFresh = !!injurySync?.lastSuccessAt &&
    now.getTime() >= injurySync.lastSuccessAt.getTime() && now.getTime() - injurySync.lastSuccessAt.getTime() <= INJURY_FRESH_MS &&
    (!injurySync.lastErrorAt || injurySync.lastErrorAt <= injurySync.lastSuccessAt) && !injurySync.recordsSkipped && injuries.length < 5000
  const injuryMatch = createInjuryRowMatcher(injuries, sport)
  const reportKnown = (report: typeof injuries[number] | null | undefined) => !report || (knownStatus(report.status) &&
    (isHealthyDesignation(report.status) || (isRuledOut(report.status) && !isOutDesignation(report.status)) ||
      now.getTime() - injuryClaimAsOf(report).getTime() <= injuryStaleAfterHours(sport) * 60 * 60 * 1000))
  const reportedNames = new Set(injuries.map((row) => normalizeMatchName(row.playerName)))
  const injuryIdentityKnown = (name: string, match: ReturnType<typeof injuryMatch>) =>
    !(match && 'ambiguous' in match) && (!!match || !reportedNames.has(normalizeMatchName(name)))
  const reportsCertified = (match: ReturnType<typeof injuryMatch>) => {
    const reports = match && 'rows' in match ? match.rows : []
    // All matching providers must be understandable and agree on activity.
    // An unrelated player's unknown report does not invalidate this roster.
    return reports.every(reportKnown) && new Set(reports.map(row => cannotStart({ injuryStatus: row.status }))).size <= 1
  }
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
    schedule: [...schedule.byTeam.entries()].map(([team, at]) => [team, at.toISOString()]).sort(),
    dailySchedule: lock.mode === 'daily' ? [...schedule.byTeamDay ?? []].map(([team, days]) =>
      [team, [...days].map(([day, at]) => [day, at.toISOString()]).sort()]).sort() : null })).digest('hex')
  const dailyRows = lock.mode === 'daily' ? await db.redraftDailyLineup.findMany({ where: {
    leagueId: input.leagueId, rosterId: { in: rosters.map((r) => r.id) }, season: input.season, week: input.week,
    scoringDay: { in: [...new Set(events.map(([, day]) => day).filter((day): day is string => !!day))].map((day) => new Date(`${day}T00:00:00Z`)) },
  }, select: { rosterId: true, playerId: true, scoringDay: true, slotType: true } }) : []
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
      const weeklyCertified = !!roster.legacyRoster && tokensMatch && saved.length > 0 &&
        currentStarters.size === savedStarters.length && new Set(savedStarters.map((row) => row.slotIndex)).size === savedStarters.length &&
        savedStarters.every((row) => currentStarters.get(row.playerId) === row.slotIndex && !!slotTokens[row.slotIndex])
      const dayRows = dailyRows.filter((r) => r.rosterId === roster.id && r.scoringDay.toISOString().slice(0, 10) === scoringDay)
      const daySlots = new Map(dayRows.map((r) => [r.playerId, r.slotType]))
      const lineupCertified = lock.mode === 'daily' ? !!scoringDay && tokensMatch && dayRows.length === roster.players.length &&
        new Set(dayRows.map((r) => r.playerId)).size === dayRows.length && roster.players.every((p) => daySlots.has(p.playerId)) : weeklyCertified
      const dayIndices = new Map<string, number>()
      if (lock.mode === 'daily') for (const token of capacities.keys()) {
        const indices = slotTokens.flatMap((s, i) => s === token ? [i] : [])
        dayRows.filter((r) => normalizeToken(r.slotType) === token).sort((a, b) => a.playerId.localeCompare(b.playerId))
          .forEach((r, i) => { if (indices[i] != null) dayIndices.set(r.playerId, indices[i]) })
      }
      const players: EvidencePlayer[] = roster.players.map((p) => {
        const team = currentTeams.has(p.playerId) ? currentTeams.get(p.playerId) ?? null : p.team
        const teamDates = lockTeamLookupKeys(sport, team)
        const kickoff = lock.mode === 'daily' && scoringDay
          ? teamDates.map((key) => schedule.byTeamDay?.get(key)?.get(scoringDay)).find((d): d is Date => !!d)
          : teamDates.map((key) => schedule.byTeam.get(key)).find((d): d is Date => !!d)
        const assignment = savedByPlayer.get(p.playerId)
        const weeklySlot = assignment?.section === 'starters' && weeklyCertified ? slotTokens[assignment.slotIndex]
          : assignment && assignment.section !== 'starters' ? assignment.section : p.slotType
        const effectiveSlot = lock.mode === 'daily'
          ? daySlots.get(p.playerId) ?? p.slotType
          : weeklySlot
        const hit = injuryMatch({ name: p.playerName, team, position: p.position })
        const report = hit && 'rows' in hit ? hit.rows[0] : null
        const availabilityKnown = injuryFeedFresh && injuryIdentityKnown(p.playerName, hit) && reportsCertified(hit) &&
          (sport !== 'NFL' || currentTeams.has(p.playerId) || p.position === 'DEF') &&
          (!!kickoff || p.byeWeek === input.week || (lock.mode === 'daily' && teamDates.some((key) => schedule.byTeam.has(key)))) &&
          // A stored bye can belong to the player's former club. Conflicting
          // schedule evidence must be reviewed before any protection penalty.
          !(kickoff && p.byeWeek === input.week)
        return { playerId: p.playerId, playerName: p.playerName, position: p.position,
          slotType: effectiveSlot, team, byeWeek: p.byeWeek, availabilityKnown,
          starterSlotIndex: lock.mode === 'daily' ? dayIndices.get(p.playerId) ?? null
            : assignment?.section === 'starters' && lineupCertified ? assignment.slotIndex : null,
          ...(lock.mode === 'daily' ? { hasGameOnScoringDay: !!kickoff } : {}),
          injuryStatus: report?.status ?? null,
          kickoffAt: kickoff?.toISOString() ?? null,
          activationBeforeLock: !rosterLocked && !!pirateActivationSection(effectiveSlot) &&
            !!kickoff && kickoff.getTime() >= time && (lock.mode !== 'first_game_of_week' || time === schedule.firstKickoff?.getTime()),
          addableBeforeLock: !rosterLocked && (normalizeToken(effectiveSlot) === 'BENCH' || capacities.has(normalizeToken(effectiveSlot))) &&
            !!kickoff && kickoff.getTime() >= time &&
            (lock.mode !== 'first_game_of_week' || time === schedule.firstKickoff?.getTime()),
          lockedAtSnapshot: lock.mode === 'first_game_of_week' ? !!schedule.firstKickoff && observedAt >= schedule.firstKickoff
            : !!kickoff && kickoff.getTime() <= observedAt.getTime() }
      })
      const carriedWitnesses = new Map<string, EvidencePlayer>()
      const carriedPlans: PirateLineupPlan[] = []
      for (const row of earlierEvents) {
        if (row.rosterId !== roster.id) continue
        const old = asEvidence(row.metadata)
        if (!old || old.phase !== 'before' || old.scoringDay !== scoringDay || old.mode !== lock.mode) continue
        if (old.eventAt === eventAt && old.version === 3) carriedPlans.push(...old.plans ?? [])
        for (const player of old.waivers ?? []) {
          if (player.kickoffAt && new Date(player.kickoffAt).getTime() >= time && !carriedWitnesses.has(player.playerId)) carriedWitnesses.set(player.playerId, player)
        }
      }
      let waivers: EvidencePlayer[] = [...carriedWitnesses.values()].map((player) => {
        const match = injuryMatch({ name: player.playerName, team: player.team, position: player.position })
        const report = match && 'rows' in match ? match.rows[0] : null
        const kickoff = lockTeamLookupKeys(sport, player.team).map((key) => lock.mode === 'daily' && scoringDay
          ? schedule.byTeamDay?.get(key)?.get(scoringDay) : schedule.byTeam.get(key)).find((d): d is Date => !!d)
        return { ...player, injuryStatus: report?.status ?? null,
          availabilityKnown: injuryFeedFresh && injuryIdentityKnown(player.playerName, match) && reportsCertified(match) && kickoff?.toISOString() === player.kickoffAt,
          addableBeforeLock: player.certifiedEventAt === eventAt && player.addableBeforeLock === true &&
            !(player.aliases ?? [player.playerId]).some((id) => rosteredIds.has(id)) }
      })
      const limit = leagueRosterLimit(league, 20)
      const hasRoom = countTowardRosterLimit(roster.legacyRoster?.playerData, limit.counts) < limit.limit
      let plans = carriedPlans
      if (phase === 'before' && lineupCertified && !rosterLocked && roster.legacyRoster &&
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
              const kickoff = lockTeamLookupKeys(sport, team).map((key) => lock.mode === 'daily' && scoringDay
                ? schedule.byTeamDay?.get(key)?.get(scoringDay) : schedule.byTeam.get(key)).find((d): d is Date => !!d)
              if (!kickoff || kickoff.getTime() < time || cannotStart({ injuryStatus: row.status })) continue
              const match = injuryMatch({ name: row.full_name, team, position: row.position })
              if (!injuryIdentityKnown(row.full_name, match)) continue
              const report = match && 'rows' in match ? match.rows[0] : null
              if (!reportsCertified(match)) continue
              const candidate: EvidencePlayer = { playerId: unified.playerId, playerName: row.full_name, position: row.position,
                slotType: 'WAIVER', injuryStatus: report?.status ?? null, team, kickoffAt: kickoff.toISOString(),
                availabilityKnown: injuryFeedFresh, addableBeforeLock: true, lockedAtSnapshot: false, aliases, certifiedEventAt: eventAt }
              const drops = hasRoom ? [null] : players.filter((p) => normalizeToken(p.slotType) === 'BENCH' &&
                !p.lockedAtSnapshot && p.addableBeforeLock === true).map((p) => p.playerId)
              for (const dropPlayerId of drops) {
                const option = { ...candidate, dropPlayerId }
                if (evaluateWith([option]).decision !== 'forfeit') continue
                // Prove the entire lineup after this exact move; independent
                // successful transactions cannot be assumed combinable.
                if (++probed > 8) break
                if (await certifyPirateWaiverWitness({ leagueId: input.leagueId, rosterId: roster.legacyRoster.id,
                  actorUserId: roster.ownerId, playerId: candidate.playerId, dropPlayerId, now: input.now })) {
                  waivers = [{ ...option, checkedAt: (input.now ?? new Date()).toISOString() }]
                  break
                }
              }
              if (waivers.some((p) => p.certifiedEventAt === eventAt && p.addableBeforeLock) || probed > 8) break
            }
          } catch {
            // An unavailable pool leaves the waiver evidence incomplete.
          }
        }
      }
      if (phase === 'before' && lineupCertified && !rosterLocked && !league.lockAllMoves && roster.legacyRoster &&
          (lock.mode !== 'first_game_of_week' || time === schedule.firstKickoff?.getTime()) &&
          players.every((p) => p.availabilityKnown) && !waivers.some((p) => p.addableBeforeLock)) {
        const config = resolveRedraftRosterConfig(sport, league.settings)
        const baseline = evaluatePirateLineup({ sport, week: input.week, rosterConfig: config, roster: players, waivers: [],
          lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: false })
        if (baseline.decision === 'review' && baseline.issues.length) try {
          const [{ loadLeagueWaiverPlayerPool }, { normalizePoolRowToUnified }, { previewRosterLineupWithEngine }] = await Promise.all([
            import('@/lib/waiver-wire/current-nba-player-pool'), import('@/lib/player-data/normalizeProviderPlayer'),
            import('@/lib/roster-lineup-engine/lineupService'),
          ])
          poolPromise ??= loadLeagueWaiverPlayerPool({ id: input.leagueId, ...league })
          const candidates: EvidencePlayer[] = []
          const byPosition = new Map<string, number>()
          // A pool outage does not prevent proving a legal on-roster activation.
          for (const row of await poolPromise.catch(() => [])) {
            const position = normalizeToken(row.position)
            if ((byPosition.get(position) ?? 0) >= 3 || ![...capacities.keys()].some((slot) => allowedPositionsForSlot(sport, slot).includes(position))) continue
            const unified = normalizePoolRowToUnified(row, league.sport).unified
            const aliases = [...new Set([unified.playerId, row.player_id, row.external_source_id].filter((id): id is string => !!id))]
            if (aliases.some((id) => rosteredIds.has(id) || candidates.some((c) => c.aliases?.includes(id)))) continue
            const team = row.team_abbreviation ?? row.team ?? null
            const kickoff = lockTeamLookupKeys(sport, team).map((key) => lock.mode === 'daily' && scoringDay
              ? schedule.byTeamDay?.get(key)?.get(scoringDay) : schedule.byTeam.get(key)).find((d): d is Date => !!d)
            const match = injuryMatch({ name: row.full_name, team, position: row.position })
            const report = match && 'rows' in match ? match.rows[0] : null
            if (!kickoff || kickoff.getTime() < time || cannotStart({ injuryStatus: row.status }) || cannotStart({ injuryStatus: report?.status }) ||
                !injuryIdentityKnown(row.full_name, match) || !reportsCertified(match)) continue
            candidates.push({ playerId: unified.playerId, playerName: row.full_name, position: row.position, slotType: 'WAIVER',
              team, kickoffAt: kickoff.toISOString(), availabilityKnown: true, injuryStatus: report?.status ?? null,
              addableBeforeLock: true, lockedAtSnapshot: false, aliases, certifiedEventAt: eventAt,
              ...(lock.mode === 'daily' ? { hasGameOnScoringDay: true } : {}) })
            byPosition.set(position, (byPosition.get(position) ?? 0) + 1)
            if (candidates.length >= 24) break
          }
          const legacy = roster.legacyRoster
          const plan = await searchPirateLineupPlan({ sport, week: input.week, eventAt, rosterConfig: config, roster: players,
            waivers: candidates, activeCount: countTowardRosterLimit(legacy.playerData, limit.counts), activeLimit: limit.limit,
            now: () => input.now ?? new Date(), certify: async (proposed) => {
              let virtual: unknown = legacy.playerData, priorDrops = 0, priorAcquisitions = 0
              for (const step of proposed.steps.filter((s) => s.kind === 'pickup')) {
                if (!await certifyPirateWaiverWitness({ leagueId: input.leagueId, rosterId: legacy.id, actorUserId: roster.ownerId,
                  playerId: step.playerId, dropPlayerId: step.dropPlayerId, now: input.now },
                { playerData: virtual, priorDrops, priorAcquisitions })) return false
                if (step.dropPlayerId) { virtual = removePlayerFromRosterData(virtual, step.dropPlayerId); priorDrops++ }
                virtual = addPlayerToRosterData(virtual, step.playerId); priorAcquisitions++
              }
              const addedIds = new Set(proposed.steps.filter((s) => s.kind === 'pickup').map((s) => s.playerId))
              const participants = [...players, ...candidates.filter((p) => addedIds.has(p.playerId))]
              const preview = async (next: Record<string, unknown> | null) => !!next && (await previewRosterLineupWithEngine({
                leagueId: input.leagueId, rosterId: legacy.id, actorUserId: roster.ownerId,
                season: input.season, week: input.week, nextPlayerData: next })).ok
              // The mobile move flow activates reserves onto the bench first.
              // Prove that intermediate save, including shared bench capacity;
              // a hypothetical direct reserve-to-starter shortcut is insufficient.
              const activationSteps: PirateLineupPlan['steps'] = proposed.steps.filter((s) => s.kind === 'pickup')
              const originalAssignment = players.filter((p) => capacities.has(normalizeToken(p.slotType))).map((p) => ({
                playerId: p.playerId, slotType: normalizeToken(p.slotType), slotIndex: p.starterSlotIndex ?? -1,
              }))
              for (const step of proposed.steps.filter((s) => s.kind === 'activate')) {
                activationSteps.push(step)
                const intermediate = piratePlanPlayerData(virtual, participants, { ...proposed, steps: [...activationSteps],
                  assignment: originalAssignment }, slotTokens)
                if (!intermediate || getNormalizedLineupSections(intermediate).bench.length > config.benchSlots || !await preview(intermediate)) return false
              }
              const next = piratePlanPlayerData(virtual, participants, proposed, slotTokens)
              if (!next) return false
              return preview(next)
            } })
          if (plan) {
            plans = [plan]
            const addedIds = new Set(plan.steps.filter((s) => s.kind === 'pickup').map((s) => s.playerId))
            waivers = candidates.filter((p) => addedIds.has(p.playerId)).map((p) => ({ ...p, checkedAt: plan.checkedAt, jointPlanOnly: true }))
          }
        } catch { /* Missing data or any refused step leaves protections for review. */ }
      }
      const snapshotAt = input.now ?? new Date()
      if ((observationStartedAt.getTime() < time) !== (snapshotAt.getTime() < time) || Math.abs(snapshotAt.getTime() - time) > WINDOW_MS) continue
      const terminalEvent = (lock.mode === 'first_game_of_week' && time === schedule.firstKickoff?.getTime()) ||
        (lock.mode === 'per_player_kickoff' && time === Math.max(...[...schedule.byTeam.values()].map((at) => at.getTime()))) ||
        (lock.mode === 'daily' && scoringDay != null && time === Math.max(...[...schedule.byTeamDay?.values() ?? []]
          .map((days) => days.get(scoringDay)?.getTime() ?? -Infinity)))
      const evidence: PirateLineupEvidence = { version: 3, week: input.week, eventAt, scoringDay, phase, terminalEvent, lineupCertified, plans,
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
  if (![2, 3].includes(before.version) || before.version !== after.version) return review('Older or mixed snapshots lack matching provider agreement checks. Protections stay for commissioner review.')
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
  if ((after.mode === 'daily' && (after.version !== 3 || !after.scoringDay)) || after.mode === 'manual' ||
      ((!before.terminalEvent || !after.terminalEvent) && !frozenInvalidStarter)) {
    return review('This lock does not close every remaining starting slot; commissioner review is required.')
  }
  const identity = (e: PirateLineupEvidence) => e.players.map((p) =>
    JSON.stringify([p.playerId, p.position, p.team, p.kickoffAt, p.byeWeek, p.injuryStatus, p.hasGameOnScoringDay])).sort().join('|')
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
    const dropBefore = prior?.dropPlayerId ? beforePlayers.get(prior.dropPlayerId) : null
    const dropAfter = p.dropPlayerId ? after.players.find((player) => player.playerId === p.dropPlayerId) : null
    const dropCertified = p.dropPlayerId == null || (!!dropBefore && !!dropAfter &&
      normalizeToken(dropBefore.slotType) === 'BENCH' && normalizeToken(dropAfter.slotType) === 'BENCH' &&
      dropBefore.addableBeforeLock === true && !dropBefore.lockedAtSnapshot)
    return prior?.certifiedEventAt === after.eventAt && prior.addableBeforeLock === true && p.addableBeforeLock === true &&
      prior.jointPlanOnly === p.jointPlanOnly &&
      (prior.dropPlayerId ?? null) === (p.dropPlayerId ?? null) && dropCertified &&
      prior.availabilityKnown && p.availabilityKnown && prior.team === p.team && prior.position === p.position &&
      prior.kickoffAt === p.kickoffAt && prior.injuryStatus === p.injuryStatus &&
      !!prior.checkedAt && new Date(prior.checkedAt).getTime() < at && at - new Date(prior.checkedAt).getTime() <= WINDOW_MS
  })
  const certifiedPlans = before.version === 3 ? (before.plans ?? []).filter((plan) => {
    if (plan.eventAt !== after.eventAt || !after.plans?.some((p) => JSON.stringify(p) === JSON.stringify(plan))) return false
    const checked = new Date(plan.checkedAt).getTime()
    if (!Number.isFinite(checked) || checked >= at || at - checked > WINDOW_MS || !plan.steps.length || plan.steps.length > 3) return false
    if (new Set(plan.steps.map((s) => s.playerId)).size !== plan.steps.length) return false
    const drops = plan.steps.flatMap((s) => s.dropPlayerId ? [s.dropPlayerId] : [])
    if (new Set(drops).size !== drops.length || drops.some((id) => plan.assignment.some((p) => p.playerId === id))) return false
    return plan.steps.every((step) => {
      if (step.kind === 'activate') {
        const prior = beforePlayers.get(step.playerId), actual = after.players.find((p) => p.playerId === step.playerId)
        return !!prior && !!actual && !!pirateActivationSection(prior.slotType) && prior.slotType === step.fromSlot &&
          actual.slotType === prior.slotType && prior.activationBeforeLock === true && !prior.lockedAtSnapshot && !step.dropPlayerId
      }
      if (step.kind !== 'pickup' || !waivers.some((p) => p.playerId === step.playerId && p.jointPlanOnly)) return false
      if (!step.dropPlayerId) return true
      const prior = beforePlayers.get(step.dropPlayerId), actual = after.players.find((p) => p.playerId === step.dropPlayerId)
      return !!prior && !!actual && normalizeToken(prior.slotType) === 'BENCH' && normalizeToken(actual.slotType) === 'BENCH' &&
        prior.addableBeforeLock === true && !prior.lockedAtSnapshot
    })
  }) : []
  const finding = evaluatePirateLineup({ sport: after.sport, week: after.week,
    rosterConfig: { starterCapacities: new Map(after.starterSlots), benchSlots: 0, irSlots: 0, taxiSlots: 0, maxRosterSize: 100, source: 'commissioner' },
    roster, waivers, certifiedPlans, lineupAtLockCertified: certified, availabilityAtLockCertified: certified, waiverPoolCertified: false })
  if (finding.issues.some((issue) => issue.includes('position-ineligible') || issue.includes('extra starter'))) {
    return { ...finding, decision: 'review' as const,
      reason: 'Starter eligibility or slot counts need verification, including any secondary positions. Protections stay during review.' }
  }
  if (finding.decision === 'forfeit') {
    const activeAtOwnGame = finding.replacementIds.every((id) => {
      const player = [...after.players, ...after.waivers ?? []].find((p) => p.playerId === id)
      if (!player?.kickoffAt) return false
      if (new Date(player.kickoffAt).getTime() <= at) return true
      return laterEvidence.some((e) => {
        const actual = [...e.players, ...e.waivers ?? []].find((p) => p.playerId === id)
        const captured = new Date(e.capturedAt).getTime(), gameAt = new Date(player.kickoffAt!).getTime()
        return e.version === after.version && e.week === after.week && e.sport === after.sport && e.mode === after.mode && e.scoringDay === after.scoringDay && e.phase === 'after' &&
          e.eventAt === player.kickoffAt && captured >= gameAt && captured - gameAt <= WINDOW_MS &&
          e.injuryFeedFresh && !e.scheduleWarnings.length && actual?.availabilityKnown === true &&
          actual.kickoffAt === player.kickoffAt && actual.team === player.team && actual.byeWeek !== after.week && !cannotStart(actual)
      })
    })
    if (!activeAtOwnGame) return review('A proposed legal lineup includes players whose activity at their own game lock is not proven.')
  }
  return finding
}

/** Proven complete lineups and jointly certified move plans can forfeit; incomplete evidence always retains protections. */
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
    if (snapshot.mode === 'daily') {
      if (snapshot.version !== 3 || !snapshot.scoringDay) return false
      const saved = await db.redraftDailyLineup.findMany({ where: { leagueId: input.leagueId, rosterId: input.rosterId,
        week: input.week, scoringDay: new Date(`${snapshot.scoringDay}T00:00:00Z`) }, select: { playerId: true, slotType: true } })
      if (!saved.length || saved.length !== snapshot.players.length || new Set(saved.map((p) => p.playerId)).size !== saved.length) return false
      const key = (rows: Array<{ playerId: string; slotType: string }>) => rows.map((p) => `${normalizeToken(p.slotType)}:${p.playerId}`).sort().join('|')
      return key(saved) === key(snapshot.players)
    }
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
      snapshot: { capturedAt: latest.data.capturedAt, injurySyncAt: latest.data.injurySyncAt, scoringDay: latest.data.scoringDay,
        movePlans: (latest.data.plans ?? []).map((plan) => ({ checkedAt: plan.checkedAt, steps: plan.steps.map((step) => ({
          kind: step.kind, playerName: [...latest.data.players, ...latest.data.waivers].find((p) => p.playerId === step.playerId)?.playerName ?? step.playerId,
          fromSlot: step.fromSlot ?? null, dropPlayerName: step.dropPlayerId ? latest.data.players.find((p) => p.playerId === step.dropPlayerId)?.playerName ?? step.dropPlayerId : null,
        })) })),
        lineupCertified: latest.data.lineupCertified, waiverWitnessCount: (latest.data.waivers ?? []).filter((p) => p.addableBeforeLock).length,
        players: [...latest.data.players, ...latest.data.waivers ?? []].map((p) => ({
          playerId: p.playerId, playerName: p.playerName, slotType: p.slotType,
          injuryStatus: p.injuryStatus ?? null, kickoffAt: p.kickoffAt, availabilityKnown: p.availabilityKnown,
          hasGameOnScoringDay: p.hasGameOnScoringDay, jointPlanOnly: p.jointPlanOnly,
          waiverVerified: p.slotType === 'WAIVER' && p.addableBeforeLock === true && p.certifiedEventAt === latest.data.eventAt,
          dropPlayerName: p.dropPlayerId ? latest.data.players.find((player) => player.playerId === p.dropPlayerId)?.playerName ?? null : null,
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
