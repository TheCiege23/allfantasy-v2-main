/**
 * "Apply tournament schedule": re-apply the conference season plan (./conferenceSeasonPlan) to
 * conference leagues whose season was created BEFORE the plan existed, so they still play one
 * round-robin through the tournament's championship week with no league playoffs.
 *
 * Reused, never re-implemented:
 *   - the plan and its write onto `League.settings` — `buildConferenceSeasonPlan` + `applySeasonPlan`
 *     (./conferenceLeagues), exactly what provisioning writes;
 *   - the season length — `conferenceSeasonWeeks`, the same numbers `ensureRedraftSeason` derives;
 *   - the schedule — `ensureScheduleForNewSeason` (lib/redraft/finalizeDraftToRedraftSeason), the one
 *     round-robin generator a new season gets.
 *
 * 🛑 A SEASON THAT HAS STARTED IS NEVER TOUCHED. Any scored or locked sign — a matchup that is not
 * `scheduled`, a non-zero score, a lineup snapshot, a `TeamWeekResult` row, the season moved past its
 * first week, or a finished season — refuses that league and reports it. The check is repeated inside
 * the transaction that clears the old schedule, so a week scored in between is not wiped.
 *
 * Idempotent: a league whose season already matches the plan is reported `unchanged` and not written.
 * No provider is called.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ensureScheduleForNewSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { applySeasonPlan, CONFERENCE_LEAGUE_READY } from './conferenceLeagues'
import { readSettings } from './divisionsStore'
import { buildConferenceSeasonPlan, conferenceSeasonWeeks, type ConferenceSeasonPlan } from './conferenceSeasonPlan'

export type ScheduleOutcome = 'rescheduled' | 'unchanged' | 'plan_saved' | 'started' | 'not_ready' | 'failed'

export type ScheduleApplyOutcome = { tournamentLeagueId: string; name: string; leagueId: string | null; outcome: ScheduleOutcome; error?: string }

type SeasonRow = { id: string; status: string; currentWeek: number; totalWeeks: number; playoffStartWeek: number }
type MatchupRow = { week: number; status: string; homeScore: number; awayScore: number; lineupSnapshots: unknown }

/** True when anything about the season says a week has been played, scored or locked. */
export function seasonHasStarted(season: Pick<SeasonRow, 'status' | 'currentWeek'>, matchups: MatchupRow[], scoredResults = 0): boolean {
  if (scoredResults > 0) return true
  if (['complete', 'completed', 'finished', 'archived'].includes(String(season.status).toLowerCase())) return true
  const firstWeek = matchups.length ? Math.min(...matchups.map(m => m.week)) : Math.max(1, season.currentWeek || 1)
  if ((season.currentWeek || 0) > firstWeek) return true
  return matchups.some(m => m.status !== 'scheduled' || m.homeScore !== 0 || m.awayScore !== 0 || m.lineupSnapshots != null)
}

/** True when the season already runs the plan: right length, no playoffs, scheduled through the last week. */
export function seasonMatchesPlan(season: Pick<SeasonRow, 'totalWeeks' | 'playoffStartWeek'>, matchups: Array<Pick<MatchupRow, 'week'>>, plan: ConferenceSeasonPlan): boolean {
  const want = conferenceSeasonWeeks(plan)
  return season.totalWeeks === want.totalWeeks && season.playoffStartWeek === want.playoffStartWeek && matchups.length > 0 && Math.max(...matchups.map(m => m.week)) === plan.lastWeek
}

const matchupSelect = { week: true, status: true, homeScore: true, awayScore: true, lineupSnapshots: true } as const

async function readProgress(client: Prisma.TransactionClient | typeof prisma, leagueId: string, season: { id: string; season: number }) {
  const [matchups, scored] = await Promise.all([
    client.redraftMatchup.findMany({ where: { seasonId: season.id }, select: matchupSelect }) as Promise<MatchupRow[]>,
    client.teamWeekResult.count({ where: { leagueId, season: season.season } }),
  ])
  return { matchups, scored }
}

/** Re-apply the plan to one league. Never throws for an expected refusal; returns the outcome. */
export async function reapplyConferenceSchedule(leagueId: string, plan: ConferenceSeasonPlan): Promise<Exclude<ScheduleOutcome, 'not_ready' | 'failed'>> {
  await applySeasonPlan(leagueId, plan)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId }, orderBy: { createdAt: 'desc' },
    select: { id: true, season: true, sport: true, status: true, currentWeek: true, totalWeeks: true, playoffStartWeek: true, medianGame: true },
  })
  // No season yet: it is created from the plan just written (ensureRedraftSeason).
  if (!season) return 'plan_saved'
  const { matchups, scored } = await readProgress(prisma, leagueId, season)
  if (seasonMatchesPlan(season, matchups, plan)) return 'unchanged'
  if (seasonHasStarted(season, matchups, scored)) return 'started'

  const { totalWeeks, playoffStartWeek } = conferenceSeasonWeeks(plan)
  const startWeek = matchups.length ? Math.min(...matchups.map(m => m.week)) : Math.max(1, season.currentWeek || 1)
  const cleared = await prisma.$transaction(async tx => {
    const again = await readProgress(tx, leagueId, season)
    if (seasonHasStarted(season, again.matchups, again.scored)) return false
    await tx.redraftMatchup.deleteMany({ where: { seasonId: season.id } })
    await tx.redraftSeason.update({ where: { id: season.id }, data: { totalWeeks, playoffStartWeek } })
    return true
  })
  if (!cleared) return 'started'
  await ensureScheduleForNewSeason({ seasonId: season.id, leagueId, sport: season.sport, totalWeeks, playoffStartWeek, medianGame: season.medianGame, startWeek })
  return 'rescheduled'
}

/**
 * Apply the tournament's schedule to every linked conference league of a divisions tournament.
 * Each league is its own unit; one failing is reported and the rest carry on. Writes one audit row.
 */
export async function applyTournamentScheduleToLeagues(tournamentId: string, actorId: string): Promise<ScheduleApplyOutcome[]> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { id: true, format: true, sport: true, formatSettings: true } })
  if (!shell || shell.format !== 'divisions') return []
  const plan = buildConferenceSeasonPlan(tournamentId, readSettings(shell.formatSettings, shell.sport))
  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, divisionId: { not: null }, conferenceId: { not: null } },
    orderBy: { leagueNumber: 'asc' },
    select: { id: true, name: true, leagueId: true, status: true },
  })
  const outcomes: ScheduleApplyOutcome[] = []
  for (const tl of leagues) {
    const base = { tournamentLeagueId: tl.id, name: tl.name, leagueId: tl.leagueId }
    if (!tl.leagueId || tl.status !== CONFERENCE_LEAGUE_READY) { outcomes.push({ ...base, outcome: 'not_ready' }); continue }
    try {
      outcomes.push({ ...base, outcome: await reapplyConferenceSchedule(tl.leagueId, plan) })
    } catch (e) {
      console.warn('[tournament/divisions] schedule not applied', tl.id, e instanceof Error ? e.message : 'unknown error')
      outcomes.push({ ...base, outcome: 'failed', error: 'The schedule could not be applied. Try again.' })
    }
  }
  await prisma.tournamentAuditLog.create({ data: {
    tournamentId, actorId, actorType: 'commissioner', action: 'divisions_conference_schedules_applied', targetType: 'tournament', targetId: tournamentId,
    data: { lastWeek: plan.lastWeek, leagues: outcomes.map(o => ({ tournamentLeagueId: o.tournamentLeagueId, league: o.name, outcome: o.outcome, error: o.error ?? null })) } as Prisma.InputJsonValue,
  } })
  return outcomes
}

const OUTCOME_TEXT: Record<ScheduleOutcome, string> = {
  rescheduled: 'rescheduled',
  unchanged: 'already on the tournament schedule',
  plan_saved: 'no season yet; it starts on the tournament schedule',
  started: 'season already started, left as it is',
  not_ready: 'league not set up yet',
  failed: 'could not be updated',
}

/** One line per outcome group, for the control screen's status message. */
export function scheduleOutcomeSummary(outcomes: Array<Pick<ScheduleApplyOutcome, 'name' | 'outcome'>>): string {
  if (!outcomes.length) return 'No conference leagues yet.'
  const order: ScheduleOutcome[] = ['rescheduled', 'unchanged', 'plan_saved', 'started', 'not_ready', 'failed']
  return order
    .map(k => ({ k, names: outcomes.filter(o => o.outcome === k).map(o => o.name) }))
    .filter(g => g.names.length)
    .map(g => `${g.names.join(', ')}: ${OUTCOME_TEXT[g.k]}.`)
    .join(' ')
}
