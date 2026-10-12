import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { hydrateRedraftLineupLocksForRosters } from '@/lib/redraft/lineupLock'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import {
  applyNflRedraftStatCorrection,
  buildNflRedraftLiveScoringRuntimeState,
  buildScoringRuntimeEvent,
  buildScoringRuntimeEvents,
  calculateNflRedraftFantasyPoints,
  normalizeNflRedraftPlayerStats,
  resolveNflRedraftScoringSettings,
  type NflRedraftLiveScoringRuntimeState,
  type NflRedraftRuntimeScoreInput,
  type NflRedraftRuntimeTeamInput,
} from './canonicalNflRedraftScoringRuntime'

export type NflRedraftLiveScoringResolved =
  | {
      ok: true
      state: NflRedraftLiveScoringRuntimeState
      season: { id: string; leagueId: string; sport: string; season: number; currentWeek: number; status: string }
    }
  | {
      ok: false
      reason: 'season_not_found' | 'league_not_found' | 'not_nfl_redraft'
    }

export type NflRedraftStatPayloadRow = {
  playerId: string
  stats: unknown
  isFinalized?: boolean | null
  source?: string | null
}

function positiveWeek(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : Math.max(1, fallback)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asNumberMap(value: unknown): Record<string, number> {
  const raw = asRecord(value)
  const out: Record<string, number> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val
  }
  return out
}

/**
 * Roster id → the Sleeper id `player_weekly_scores` is keyed on, or null when there is none.
 *
 * 🛑 `player_weekly_scores` is unique on playerId + week + season + sport and SHARED BY EVERY LEAGUE, in
 * Sleeper's id space. An ESPN / Fleaflicker roster holds that platform's ids, and the same digits are a
 * different man (Fleaflicker 13761 Josh Allen is a Sleeper DL), so a read by the raw id finds a stranger's
 * week and a write by it overwrites his row. One translation for the read and both writers in this file,
 * the same one the score sync uses (`sleeperLookupId`): a native league's ids pass through, a foreign
 * id goes through the crosswalk, and one with no one-to-one Sleeper id resolves to null — never itself.
 */
async function sleeperIdLookup(
  platform: string | null | undefined,
  rosterIds: readonly string[],
): Promise<(rosterId: string) => string | null> {
  const crosswalk = await crosswalkToSleeperIds(String(platform ?? ''), 'NFL', [...rosterIds]).catch(
    () => new Map<string, string>(),
  )
  return (rosterId) => sleeperLookupId(platform, rosterId, crosswalk)
}

function categoryPointsFromLeagueSettings(settings: unknown): Record<string, number> {
  const root = asRecord(settings)
  return asNumberMap(asRecord(root.sportConfig).categoryPoints)
}

function serializeSnapshot(input: {
  existing: unknown
  matchup: NflRedraftLiveScoringRuntimeState['matchups'][number]
  generatedAtIso: string
}): Record<string, unknown> {
  const existing = asRecord(input.existing)
  const compactTeam = (team: typeof input.matchup.home | null) =>
    team
      ? {
          rosterId: team.rosterId,
          starterCount: team.starterCount,
          scoredStarterCount: team.scoredStarterCount,
          points: team.starterTotal,
          benchPoints: team.benchTotal,
          missingPlayerIds: team.missingStarterPlayerIds,
          allFinal: team.allStartersFinal,
          lineupLegal: team.lineupLegal,
          illegalLineupIssues: team.illegalLineupIssues,
        }
      : null
  const starterRefreshRows = [
    ...input.matchup.home.starters,
    ...(input.matchup.away?.starters ?? []),
  ]
  const latest = (values: Array<string | null>) => {
    const sorted = values.filter((value): value is string => Boolean(value)).sort()
    return sorted[sorted.length - 1] ?? null
  }

  return {
    ...existing,
    redraftScoring: {
      scoredAt: input.generatedAtIso,
      isComplete: input.matchup.complete,
      home: compactTeam(input.matchup.home),
      away: compactTeam(input.matchup.away),
      missingPlayerIds: input.matchup.missingStarterPlayerIds,
    },
    redraftLiveScoring: {
      source: 'canonical_nfl_redraft_live_scoring_runtime',
      scoredAt: input.generatedAtIso,
      matchupId: input.matchup.matchupId,
      week: input.matchup.week,
      status: input.matchup.status,
      winnerRosterId: input.matchup.winnerRosterId,
      loserRosterId: input.matchup.loserRosterId,
      tied: input.matchup.tied,
      correctionVersion: input.matchup.correctionVersion,
      homeScore: input.matchup.homeScore,
      awayScore: input.matchup.awayScore,
      scoringRefreshTimestamp: latest(starterRefreshRows.map((player) => player.scoringRefreshTimestamp)),
      matchupRefreshTimestamp: latest(starterRefreshRows.map((player) => player.matchupRefreshTimestamp)),
    },
  }
}

async function resolveSeason(input: { seasonId?: string | null; leagueId?: string | null }) {
  return prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
  })
}

function eventTitle(event: CanonicalLeagueRuntimeEvent): string {
  switch (event.type) {
    case 'scoring.period.opened':
      return `Week ${event.payload.week ?? ''} scoring opened`
    case 'scoring.team_score.updated':
      return 'Team score updated'
    case 'scoring.matchup_score.updated':
      return 'Matchup score updated'
    case 'matchup.finalized':
      return 'Matchup finalized'
    case 'standings.recalculated':
      return 'Standings recalculated'
    case 'lineup.illegal.flagged':
      return 'Illegal lineup flagged'
    case 'scoring.stat_correction.applied':
      return 'Stat correction applied'
    case 'commissioner.scoring_correction':
      return 'Commissioner scoring correction'
    default:
      return event.type.replace(/\./g, ' ')
  }
}

async function recordLeagueEvents(events: CanonicalLeagueRuntimeEvent[]) {
  if (!events.length) return
  try {
    await prisma.leagueEvent.createMany({
      data: events.map((event) => ({
        leagueId: event.leagueId,
        eventType: event.type,
        title: eventTitle(event),
        description: null,
        payload: toPrismaJsonInput(event.payload),
        visibility: 'league',
        createdAt: new Date(event.occurredAtIso),
      })),
    })
  } catch {
    // Scoring persistence should not fail if the event trail is unavailable.
  }
}

async function recordScoringAudit(input: {
  actorUserId: string
  action: string
  seasonId: string
  details: Record<string, unknown>
}) {
  try {
    await (prisma as any).adminAuditLog?.create({
      data: {
        adminUserId: input.actorUserId,
        action: input.action,
        targetType: 'redraft_season',
        targetId: input.seasonId,
        details: toPrismaJsonInput(input.details),
      },
    })
  } catch {
    // Audit logging is best-effort for local/test runtimes with older schemas.
  }
}

export async function resolveNflRedraftLiveScoringRuntime(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  now?: Date
}): Promise<NflRedraftLiveScoringResolved> {
  const season = await resolveSeason(input)
  if (!season) return { ok: false, reason: 'season_not_found' }
  if (String(season.sport).toUpperCase() !== 'NFL') return { ok: false, reason: 'not_nfl_redraft' }

  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  if (rules.general.sport !== 'NFL' || rules.general.format !== 'redraft') return { ok: false, reason: 'not_nfl_redraft' }

  const week = positiveWeek(input.week, season.currentWeek || 1)
  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true, platform: true } })
  const rosterConfig = resolveRedraftRosterConfig(season.sport, league?.settings ?? null)
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    orderBy: { id: 'asc' },
  })
  const storedRosterPlayers = await prisma.redraftRosterPlayer.findMany({
    where: { roster: { seasonId: season.id, leagueId: season.leagueId }, droppedAt: null },
    orderBy: { addedAt: 'asc' },
  })
  // `RedraftRosterPlayer.isLocked` is never stored as true: the lineup lock is derived from the
  // game schedule at read time (lib/redraft/lineupLock.ts), so it is only meaningful after this.
  const { players: rosterPlayers } = await hydrateRedraftLineupLocksForRosters(prisma, {
    sport: season.sport,
    season: season.season,
    week,
    leagueSettings: league?.settings ?? null,
    players: storedRosterPlayers,
    now: input.now,
  })
  const playersByRosterId = new Map<string, typeof rosterPlayers>()
  for (const player of rosterPlayers) {
    const rows = playersByRosterId.get(player.rosterId) ?? []
    rows.push(player)
    playersByRosterId.set(player.rosterId, rows)
  }
  const playerIds = Array.from(new Set(rosterPlayers.map((player) => player.playerId)))
  const sports = Array.from(new Set(rosterPlayers.map((player) => player.sport)))
  /*
   * 🛑 `player_weekly_scores` IS IN SLEEPER'S ID SPACE AND AN IMPORTED ROSTER IS NOT. The score sync
   * translates an ESPN / Fleaflicker roster id through the crosswalk and writes under the Sleeper id
   * (playerWeeklyScoreService.ts); read by the raw roster id, this found nothing for a foreign league —
   * or, where the digits collide, a stranger's week (Fleaflicker 13761 Josh Allen is a Sleeper DL; ESPN
   * 12483 Matthew Stafford is Jack Bech). Translated the same way here (`sleeperLookupId`), with every
   * row mapped back to the roster id the lineup speaks; an id that does not translate reads nothing.
   * This runtime is NFL-only (gated above), so the translation always applies.
   */
  const lookupOf = await sleeperIdLookup(league?.platform, playerIds)
  const rosterIdsBySleeperId = new Map<string, string[]>()
  for (const id of playerIds) {
    const sleeperId = lookupOf(id)
    if (sleeperId) rosterIdsBySleeperId.set(sleeperId, [...(rosterIdsBySleeperId.get(sleeperId) ?? []), id])
  }
  const lookupIds = [...rosterIdsBySleeperId.keys()]
  const scores = lookupIds.length
    ? await prisma.playerWeeklyScore.findMany({
        where: { playerId: { in: lookupIds }, week, season: season.season, sport: { in: sports } },
      })
    : []
  const unifiedRows = lookupIds.length
    ? await getNormalizedPlayerData({
        surface: 'matchup',
        leagueId: season.leagueId,
        playerIds: lookupIds,
        limit: Math.max(lookupIds.length, 1),
      }).catch(() => [])
    : []
  const unifiedById = new Map(unifiedRows.map((row) => {
    const wire = serializeUnifiedPlayerForApi(row)
    return [wire.id, wire] as const
  }))
  const scoreRows: NflRedraftRuntimeScoreInput[] = scores.flatMap((score) =>
    (rosterIdsBySleeperId.get(score.playerId) ?? []).map((rosterPlayerId) => ({
      playerId: rosterPlayerId,
      sport: score.sport,
      stats: asRecord(score.stats),
      isFinalized: score.isFinalized,
      source: 'player_weekly_scores',
      updatedAtIso: score.updatedAt.toISOString(),
    })),
  )

  const teamInputs: NflRedraftRuntimeTeamInput[] = rosters.map((roster) => {
    const players = (playersByRosterId.get(roster.id) ?? []).map((player) => {
      const lookupId = lookupOf(player.playerId)
      const unified = lookupId ? unifiedById.get(lookupId) : undefined
      const canonical = unified?.nflRedraft ?? null
      return {
        rosterId: roster.id,
        playerId: player.playerId,
        playerName: canonical?.displayName ?? player.playerName,
        position: canonical?.fantasyPosition ?? player.position,
        team: canonical?.teamAbbr ?? player.team,
        sport: player.sport,
        slotType: player.slotType,
        // Not `unified?.injuryStatus` — a stored snapshot column; see the same line in /api/redraft/roster.
        injuryStatus: canonical?.injury.designation ?? player.injuryStatus,
        providerInjuryLabel: canonical?.injury.designation ?? null,
        activeStatus: canonical?.activeStatus ?? null,
        isLocked: player.isLocked,
        headshotUrl: canonical?.media.headshot.url ?? unified?.headshotUrl ?? null,
        teamLogoUrl: canonical?.media.teamLogo.url ?? unified?.teamLogoUrl ?? null,
        projectedPoints: canonical?.currentProjection.weeklyProjectedPoints ?? unified?.projectedPoints ?? null,
        playerDataLastUpdatedAt: canonical?.lastUpdatedAt ?? null,
        playerDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
        canonicalNflRedraft: canonical,
        canonicalLiveScoringContext: unified?.nflRedraftLiveScoringContext ?? null,
      }
    })
    const validation = validateRedraftLineup({
      sport: season.sport,
      week,
      players,
      rosterConfig,
    })
    return {
      rosterId: roster.id,
      displayName: roster.teamName ?? roster.ownerName ?? null,
      ownerName: roster.ownerName,
      divisionId: null,
      divisionName: null,
      players,
      validationIssues: validation.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        playerId: issue.playerId ?? null,
      })),
    }
  })

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
    orderBy: { id: 'asc' },
  })
  const state = buildNflRedraftLiveScoringRuntimeState({
    leagueId: season.leagueId,
    seasonId: season.id,
    season: season.season,
    week,
    rules,
    teams: teamInputs,
    matchups: matchups.map((matchup) => ({
      matchupId: matchup.id,
      week: matchup.week,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      status: matchup.status,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
    })),
    scoreRows,
    categoryPoints: categoryPointsFromLeagueSettings(league?.settings ?? null),
    now: input.now,
  })

  return {
    ok: true,
    state,
    season: {
      id: season.id,
      leagueId: season.leagueId,
      sport: season.sport,
      season: season.season,
      currentWeek: season.currentWeek,
      status: season.status,
    },
  }
}

export async function persistNflRedraftLiveScoringWeek(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  actorUserId?: string | null
  includePlayerEvents?: boolean
}): Promise<{ ok: true; state: NflRedraftLiveScoringRuntimeState; standings: Awaited<ReturnType<typeof updateStandings>> }> {
  const resolved = await resolveNflRedraftLiveScoringRuntime(input)
  if (!resolved.ok) throw new Error(resolved.reason)

  const matchupRows = await prisma.redraftMatchup.findMany({
    where: { seasonId: resolved.state.seasonId, week: resolved.state.week },
    select: { id: true, lineupSnapshots: true },
  })
  const existingById = new Map(matchupRows.map((row) => [row.id, row.lineupSnapshots]))
  for (const matchup of resolved.state.matchups) {
    await prisma.redraftMatchup.update({
      where: { id: matchup.matchupId },
      data: {
        homeScore: matchup.homeScore,
        awayScore: matchup.awayScore ?? 0,
        status:
          matchup.status === 'final'
            ? 'final'
            : matchup.status === 'live' || matchup.status === 'illegal_lineup'
              ? 'active'
              : 'scheduled',
        lineupSnapshots: toPrismaJsonInput(serializeSnapshot({
          existing: existingById.get(matchup.matchupId),
          matchup,
          generatedAtIso: resolved.state.generatedAtIso,
        })),
      },
    })
  }

  const standings = await updateStandings(resolved.state.seasonId, resolved.state.week)
  const events = buildScoringRuntimeEvents({
    state: resolved.state,
    actorUserId: input.actorUserId ?? null,
    includePlayerEvents: input.includePlayerEvents,
  })
  await recordLeagueEvents(events)
  await recordScoringAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: 'redraft_live_scoring_recalculate',
    seasonId: resolved.state.seasonId,
    details: {
      week: resolved.state.week,
      matchupCount: resolved.state.coverage.matchupCount,
      finalizedMatchups: resolved.state.coverage.finalizedMatchups,
      correctionVersion: resolved.state.coverage.correctionVersion,
    },
  })

  return { ok: true, state: resolved.state, standings }
}

export async function ingestNflRedraftStatPayload(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  rows: NflRedraftStatPayloadRow[]
  actorUserId?: string | null
  source?: string | null
}): Promise<{
  synced: number
  skipped: string[]
  /** Roster ids of a foreign league with no one-to-one Sleeper id: not written (also listed in `skipped`). */
  untranslatedForeignPlayerIds: string[]
  state: NflRedraftLiveScoringRuntimeState
}> {
  const season = await resolveSeason(input)
  if (!season) throw new Error('season_not_found')
  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) throw new Error('league_not_found')
  const week = positiveWeek(input.week, season.currentWeek || 1)
  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true, platform: true } })
  const settings = resolveNflRedraftScoringSettings({
    rules,
    categoryPoints: categoryPointsFromLeagueSettings(league?.settings ?? null),
  })
  const rosterPlayers = await prisma.redraftRosterPlayer.findMany({
    where: { roster: { seasonId: season.id, leagueId: season.leagueId }, droppedAt: null },
    select: { playerId: true, playerName: true, position: true, sport: true },
  })
  const playerById = new Map(rosterPlayers.map((player) => [player.playerId, player]))
  // Rows arrive keyed on roster ids; the score is written under the Sleeper id (see `sleeperIdLookup`).
  const sleeperIdOf = await sleeperIdLookup(league?.platform, [...playerById.keys()])
  const skipped: string[] = []
  const untranslatedForeignPlayerIds: string[] = []
  let synced = 0

  for (const row of input.rows) {
    const player = playerById.get(row.playerId)
    if (!player) {
      skipped.push(row.playerId)
      continue
    }
    const scoreId = sleeperIdOf(player.playerId)
    if (!scoreId) {
      untranslatedForeignPlayerIds.push(row.playerId)
      skipped.push(row.playerId)
      continue
    }
    const stats = normalizeNflRedraftPlayerStats({
      playerId: player.playerId,
      position: player.position,
      rawStats: row.stats,
    })
    if (!Object.keys(stats).length) {
      skipped.push(row.playerId)
      continue
    }
    const calculation = calculateNflRedraftFantasyPoints({ settings, stats, position: player.position })
    await prisma.playerWeeklyScore.upsert({
      where: {
        playerId_week_season_sport: {
          playerId: scoreId,
          week,
          season: season.season,
          sport: player.sport,
        },
      },
      update: {
        stats,
        fantasyPts: calculation.points,
        isFinalized: row.isFinalized === true,
      },
      create: {
        playerId: scoreId,
        week,
        season: season.season,
        sport: player.sport,
        stats,
        fantasyPts: calculation.points,
        isFinalized: row.isFinalized === true,
      },
    })
    synced += 1
  }

  await recordScoringAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: 'redraft_stat_payload_ingest',
    seasonId: season.id,
    details: { week, source: input.source ?? null, synced, skipped, untranslatedForeignPlayerIds },
  })
  const persisted = await persistNflRedraftLiveScoringWeek({
    seasonId: season.id,
    week,
    actorUserId: input.actorUserId,
    includePlayerEvents: true,
  })
  return { synced, skipped, untranslatedForeignPlayerIds, state: persisted.state }
}

export async function applyNflRedraftStatCorrectionToSeason(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  playerId: string
  correctedStats: unknown
  isFinalized?: boolean | null
  reason?: string | null
  actorUserId?: string | null
}): Promise<{ correctionVersion: number; state: NflRedraftLiveScoringRuntimeState }> {
  const season = await resolveSeason(input)
  if (!season) throw new Error('season_not_found')
  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) throw new Error('league_not_found')
  const week = positiveWeek(input.week, season.currentWeek || 1)
  const rosterPlayer = await prisma.redraftRosterPlayer.findFirst({
    where: { playerId: input.playerId, roster: { seasonId: season.id, leagueId: season.leagueId }, droppedAt: null },
    select: { playerId: true, position: true, sport: true },
  })
  if (!rosterPlayer) throw new Error('player_not_rostered')

  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true, platform: true } })
  /*
   * The previous line is READ and the correction WRITTEN under the Sleeper id (see `sleeperIdLookup`). A
   * foreign roster id with none is refused before either — audited, so the refusal is counted — rather
   * than correcting, and overwriting, whoever holds those digits in Sleeper's space.
   */
  const scoreId = (await sleeperIdLookup(league?.platform, [rosterPlayer.playerId]))(rosterPlayer.playerId)
  if (!scoreId) {
    await recordScoringAudit({
      actorUserId: input.actorUserId ?? 'system',
      action: 'redraft_stat_correction_refused',
      seasonId: season.id,
      details: { week, playerId: rosterPlayer.playerId, reason: 'player_id_not_translatable', platform: league?.platform ?? null },
    })
    throw new Error('player_id_not_translatable')
  }

  const existing = await prisma.playerWeeklyScore.findUnique({
    where: {
      playerId_week_season_sport: {
        playerId: scoreId,
        week,
        season: season.season,
        sport: rosterPlayer.sport,
      },
    },
  })
  const correction = applyNflRedraftStatCorrection({
    playerId: rosterPlayer.playerId,
    position: rosterPlayer.position,
    previousStats: asRecord(existing?.stats),
    correctedStats: input.correctedStats,
  })
  const settings = resolveNflRedraftScoringSettings({
    rules,
    categoryPoints: categoryPointsFromLeagueSettings(league?.settings ?? null),
  })
  const calculation = calculateNflRedraftFantasyPoints({
    settings,
    stats: correction.normalizedStats,
    position: rosterPlayer.position,
  })

  await prisma.playerWeeklyScore.upsert({
    where: {
      playerId_week_season_sport: {
        playerId: scoreId,
        week,
        season: season.season,
        sport: rosterPlayer.sport,
      },
    },
    update: {
      stats: correction.normalizedStats,
      fantasyPts: calculation.points,
      isFinalized: input.isFinalized === true || existing?.isFinalized === true,
    },
    create: {
      playerId: scoreId,
      week,
      season: season.season,
      sport: rosterPlayer.sport,
      stats: correction.normalizedStats,
      fantasyPts: calculation.points,
      isFinalized: input.isFinalized === true,
    },
  })

  const correctionEvents = [
    buildScoringRuntimeEvent({
      leagueId: season.leagueId,
      type: 'scoring.stat_correction.applied',
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: season.id,
        week,
        playerId: rosterPlayer.playerId,
        correctionVersion: correction.correctionVersion,
        reason: input.reason ?? null,
      },
    }),
    buildScoringRuntimeEvent({
      leagueId: season.leagueId,
      type: 'commissioner.scoring_correction',
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: season.id,
        week,
        playerId: rosterPlayer.playerId,
        correctionVersion: correction.correctionVersion,
      },
    }),
  ]
  await recordLeagueEvents(correctionEvents)
  await recordScoringAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: 'redraft_stat_correction',
    seasonId: season.id,
    details: {
      week,
      playerId: rosterPlayer.playerId,
      correctionVersion: correction.correctionVersion,
      reason: input.reason ?? null,
      fantasyPts: calculation.points,
    },
  })

  const persisted = await persistNflRedraftLiveScoringWeek({
    seasonId: season.id,
    week,
    actorUserId: input.actorUserId,
    includePlayerEvents: true,
  })
  return { correctionVersion: correction.correctionVersion, state: persisted.state }
}
