/**
 * Phase 7D — Read-only drift probe: compare PlayerGameStat-derived starter points vs
 * PlayerWeeklyScore and vs RedraftMatchup / TeamPerformance (best-effort).
 * Does not mutate the database. Not for end-user scoring.
 */
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeRosterScoreForWeek } from '@/lib/multi-sport/MultiSportMatchupScoringService'
import { leagueUsesC2CEngine } from '@/lib/c2c/scoringEngine'
import { leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'

const EPS_MATCH = 0.02
const EPS_WARN = 0.5

export type StatDriftSeverity = 'none' | 'info' | 'warning' | 'critical'

export type StatDriftPlayerRow = {
  playerId: string
  side: 'home' | 'away'
  sport: string
  pgsPoints: number | null
  pwsPoints: number | null
  delta: number | null
  missingPgs: boolean
  missingPws: boolean
}

export type StatDriftTeamRow = {
  side: 'home' | 'away'
  rosterId: string
  redraftMatchupScore: number | null
  sumPwsStarters: number
  sumPgsStarters: number
  deltaRedraftVsPgs: number | null
  deltaTeamPerfVsPgs: number | null
  teamPerformancePoints: number | null
  teamPerformanceTeamId: string | null
}

export type StatDriftProbeResult = {
  leagueId: string
  season: number
  week: number
  matchupId: string | null
  checkedPlayers: number
  checkedTeams: number
  mismatchedPlayers: StatDriftPlayerRow[]
  mismatchedTeams: StatDriftTeamRow[]
  missingWeeklyScores: number
  missingGameStats: number
  severity: StatDriftSeverity
  notes: string[]
}

export type StatDriftProbeParams = {
  leagueId: string
  season: number
  week: number
  matchupId?: string
  /** For structured logs (e.g. api route name) */
  jobName?: string
}

function logDrift(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event,
      subsystem: 'stat_drift_probe',
      ...payload,
    }),
  )
}

export function computeStatDriftSeverity(input: {
  mismatchedPlayers: StatDriftPlayerRow[]
  mismatchedTeams: StatDriftTeamRow[]
  missingWeeklyScores: number
  missingGameStats: number
}): StatDriftSeverity {
  const badPlayer = input.mismatchedPlayers.some(
    (r) => r.delta != null && Math.abs(r.delta) > EPS_WARN,
  )
  const badTeam = input.mismatchedTeams.some((t) => {
    const a = t.deltaRedraftVsPgs != null && Math.abs(t.deltaRedraftVsPgs) > EPS_WARN
    const b = t.deltaTeamPerfVsPgs != null && Math.abs(t.deltaTeamPerfVsPgs) > EPS_WARN
    return a || b
  })
  if (badPlayer || badTeam) return 'critical'

  const warnPlayer = input.mismatchedPlayers.some(
    (r) => r.delta != null && Math.abs(r.delta) > EPS_MATCH,
  )
  const warnTeam = input.mismatchedTeams.some((t) => {
    const a = t.deltaRedraftVsPgs != null && Math.abs(t.deltaRedraftVsPgs) > EPS_MATCH
    const b = t.deltaTeamPerfVsPgs != null && Math.abs(t.deltaTeamPerfVsPgs) > EPS_MATCH
    return a || b
  })
  if (warnPlayer || warnTeam) return 'warning'

  if (input.missingWeeklyScores > 0 || input.missingGameStats > 0) return 'info'
  if (input.mismatchedPlayers.length > 0 || input.mismatchedTeams.length > 0) return 'info'
  return 'none'
}

async function resolveTeamPerformancePoints(
  leagueId: string,
  season: number,
  week: number,
  roster: { id: string; ownerId: string },
): Promise<{ teamId: string | null; points: number | null }> {
  const team =
    (await prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: roster.ownerId },
      select: { id: true },
    })) ??
    (await prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: roster.id },
      select: { id: true },
    }))
  if (!team) return { teamId: null, points: null }
  const perf = await prisma.teamPerformance.findUnique({
    where: {
      teamId_season_week: { teamId: team.id, season, week },
    },
    select: { points: true },
  })
  return { teamId: team.id, points: perf?.points != null ? Number(perf.points) : null }
}

async function starterRows(rosterId: string) {
  return prisma.redraftRosterPlayer.findMany({
    where: {
      rosterId,
      droppedAt: null,
      slotType: { notIn: ['bench', 'taxi', 'devy'] },
    },
    select: { playerId: true, sport: true },
  })
}

export async function runStatDriftProbe(params: StatDriftProbeParams): Promise<StatDriftProbeResult> {
  const notes: string[] = []
  const jobName = params.jobName ?? 'stat_drift_probe'
  logDrift('stat_drift_probe_started', {
    jobName,
    leagueId: params.leagueId,
    season: params.season,
    week: params.week,
  })

  const empty = (): StatDriftProbeResult => ({
    leagueId: params.leagueId,
    season: params.season,
    week: params.week,
    matchupId: null,
    checkedPlayers: 0,
    checkedTeams: 0,
    mismatchedPlayers: [],
    mismatchedTeams: [],
    missingWeeklyScores: 0,
    missingGameStats: 0,
    severity: 'info',
    notes,
  })

  try {
    const league = await prisma.league.findUnique({
      where: { id: params.leagueId },
      select: { id: true, sport: true, leagueVariant: true, settings: true },
    })
    if (!league) {
      notes.push('league_not_found')
      const r = empty()
      r.notes = notes
      logDrift('stat_drift_probe_failed', { jobName, leagueId: params.leagueId, reason: 'league_not_found' })
      return r
    }

    if (await leagueUsesC2CEngine(params.leagueId)) {
      notes.push('c2c_engine_probe_skipped_matchup_compare')
      const r = empty()
      r.notes = notes
      logDrift('stat_drift_probe_completed', {
        jobName,
        leagueId: params.leagueId,
        severity: r.severity,
        checkedPlayers: 0,
        stat_drift_detected: false,
      })
      return r
    }

    const useDevy = await leagueUsesDevyEngine(params.leagueId)
    if (useDevy) {
      notes.push('devy_engine_pgs_player_compare_skipped_use_official_team_score_path')
    }

    const seasonRow = await prisma.redraftSeason.findFirst({
      where: { leagueId: params.leagueId, season: params.season },
      select: { id: true },
    })
    if (!seasonRow) {
      notes.push('redraft_season_not_found_for_season_year')
      const r = empty()
      r.notes = notes
      logDrift('stat_drift_probe_completed', {
        jobName,
        leagueId: params.leagueId,
        severity: 'info',
        checkedPlayers: 0,
        stat_drift_detected: false,
      })
      return r
    }

    const matchup = await prisma.redraftMatchup.findFirst({
      where: {
        leagueId: params.leagueId,
        seasonId: seasonRow.id,
        week: params.week,
        ...(params.matchupId ? { id: params.matchupId } : {}),
        status: { in: ['scheduled', 'active'] },
      },
      include: {
        homeRoster: true,
        awayRoster: true,
      },
      orderBy: { id: 'asc' },
    })

    if (!matchup || !matchup.homeRoster) {
      notes.push('no_redraft_matchup_found_for_week')
      const r = empty()
      r.notes = notes
      logDrift('stat_drift_probe_completed', {
        jobName,
        leagueId: params.leagueId,
        severity: 'info',
        checkedPlayers: 0,
        stat_drift_detected: false,
      })
      return r
    }

    const leagueSport = league.sport as LeagueSport
    const settings = league.settings as Record<string, unknown> | null | undefined
    const formatType =
      typeof settings?.league_variant === 'string'
        ? String(settings.league_variant)
        : league.leagueVariant
          ? String(league.leagueVariant)
          : undefined

    const mismatchedPlayers: StatDriftPlayerRow[] = []
    const mismatchedTeams: StatDriftTeamRow[] = []
    let missingWeeklyScores = 0
    let missingGameStats = 0
    let checkedPlayers = 0
    let checkedTeams = 0

    async function probeSide(
      side: 'home' | 'away',
      roster: { id: string; ownerId: string } | null,
      matchupScore: number,
    ) {
      if (!roster) return
      checkedTeams++
      const starters = await starterRows(roster.id)
      if (starters.length === 0) {
        notes.push(`${side}_no_starters`)
        return
      }
      const starterIds = starters.map((s) => s.playerId)
      checkedPlayers += starterIds.length

      const pwsRows = await Promise.all(
        starters.map((s) =>
          prisma.playerWeeklyScore.findUnique({
            where: {
              playerId_week_season_sport: {
                playerId: s.playerId,
                week: params.week,
                season: params.season,
                sport: s.sport,
              },
            },
            select: { fantasyPts: true },
          }),
        ),
      )

      let sumPws = 0
      for (let i = 0; i < starters.length; i++) {
        const row = pwsRows[i]
        if (row == null || row.fantasyPts == null) missingWeeklyScores++
        sumPws += row?.fantasyPts != null ? Number(row.fantasyPts) : 0
      }

      let sumPgs = 0
      const pgsByPlayer: Record<string, number> = {}
      if (!useDevy) {
        const pgs = await computeRosterScoreForWeek({
          leagueId: params.leagueId,
          leagueSport,
          season: params.season,
          weekOrRound: params.week,
          rosterPlayerIds: starterIds,
          starterPlayerIds: starterIds,
          formatType,
        })
        Object.assign(pgsByPlayer, pgs.byPlayerId)
        sumPgs = pgs.totalPoints

        const pgsStatChecks = await Promise.all(
          starterIds.map((playerId) =>
            prisma.playerGameStat.findFirst({
              where: {
                playerId,
                sportType: leagueSport,
                season: params.season,
                weekOrRound: params.week,
              },
              select: { id: true },
            }),
          ),
        )
        for (const row of pgsStatChecks) {
          if (!row) missingGameStats++
        }

        for (let i = 0; i < starters.length; i++) {
          const s = starters[i]!
          const pwsRow = pwsRows[i]
          const pws = pwsRow?.fantasyPts != null ? Number(pwsRow.fantasyPts) : 0
          const missingPws = pwsRow == null || pwsRow.fantasyPts == null
          const pgs = pgsByPlayer[s.playerId] ?? 0
          const missingPgs = !pgsStatChecks[i]
          const delta = Math.round((pws - pgs) * 100) / 100
          if (Math.abs(pws - pgs) > EPS_MATCH) {
            mismatchedPlayers.push({
              playerId: s.playerId,
              side,
              sport: s.sport,
              pgsPoints: pgs,
              pwsPoints: pws,
              delta,
              missingPgs,
              missingPws,
            })
          }
        }
      }

      const tp = await resolveTeamPerformancePoints(params.leagueId, params.season, params.week, roster)

      if (!useDevy) {
        const deltaRedraftVsPgs = Math.round((matchupScore - sumPgs) * 100) / 100
        const deltaTeamPerfVsPgs =
          tp.points != null ? Math.round((tp.points - sumPgs) * 100) / 100 : null
        const teamMismatch =
          Math.abs(deltaRedraftVsPgs) > EPS_MATCH ||
          (deltaTeamPerfVsPgs != null && Math.abs(deltaTeamPerfVsPgs) > EPS_MATCH)
        if (teamMismatch) {
          mismatchedTeams.push({
            side,
            rosterId: roster.id,
            redraftMatchupScore: matchupScore,
            sumPwsStarters: Math.round(sumPws * 100) / 100,
            sumPgsStarters: Math.round(sumPgs * 100) / 100,
            deltaRedraftVsPgs,
            deltaTeamPerfVsPgs,
            teamPerformancePoints: tp.points,
            teamPerformanceTeamId: tp.teamId,
          })
        }
      }
    }

    await probeSide('home', matchup.homeRoster, matchup.homeScore)
    await probeSide('away', matchup.awayRoster, matchup.awayScore ?? 0)

    const severity = computeStatDriftSeverity({
      mismatchedPlayers,
      mismatchedTeams,
      missingWeeklyScores,
      missingGameStats,
    })

    const statDriftDetected =
      severity !== 'none' ||
      mismatchedPlayers.length > 0 ||
      mismatchedTeams.length > 0

    if (statDriftDetected) {
      logDrift('stat_drift_detected', {
        jobName,
        leagueId: params.leagueId,
        season: params.season,
        week: params.week,
        severity,
        mismatchedPlayerCount: mismatchedPlayers.length,
        mismatchedTeamCount: mismatchedTeams.length,
        missingWeeklyScores,
        missingGameStats,
      })
    }

    logDrift('stat_drift_probe_completed', {
      jobName,
      leagueId: params.leagueId,
      season: params.season,
      week: params.week,
      severity,
      checkedPlayers,
      checkedTeams,
      stat_drift_detected: statDriftDetected,
    })

    return {
      leagueId: params.leagueId,
      season: params.season,
      week: params.week,
      matchupId: matchup.id,
      checkedPlayers,
      checkedTeams,
      mismatchedPlayers,
      mismatchedTeams,
      missingWeeklyScores,
      missingGameStats,
      severity,
      notes,
    }
  } catch (err) {
    logDrift('stat_drift_probe_failed', {
      jobName,
      leagueId: params.leagueId,
      reason: err instanceof Error ? err.message : String(err),
    })
    notes.push('probe_exception')
    const r = empty()
    r.notes = notes
    r.severity = 'critical'
    return r
  }
}
