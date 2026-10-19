import 'server-only'

import { prisma } from '@/lib/prisma'
import { readRequiredStarterCount } from '@/lib/commissioner-hub/requiredStarters'
import { resolveByeWeekMap } from '@/lib/core-app/byeWeekMap'
import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import { auditLineups, describeFinding, isFlagged, type TeamSeasonSummary, type TeamWeekFinding } from './lineupIntegrity'

/**
 * Lineup-integrity monitor — reads. Rules in ./lineupIntegrity.
 *
 * DB-first: every input is already stored. Lineups are `league_player_weekly_scores` (the Sleeper
 * matchups feed the import already ingests: `isStarter`, `points`, `isFinalized`); clubs and names
 * are `SportsPlayer`; byes come from `SportsGame` through `resolveByeWeekMap`; injury status is
 * `SportsInjury` through `readInjuryStatusById`. Nothing here calls a provider.
 *
 * ⚠ SLEEPER NFL LEAGUES ONLY, SAID OUT LOUD RATHER THAN GUESSED. AllFantasy-run leagues do not keep
 * each week's starters at lock — `RedraftMatchup.lineupSnapshots` holds team totals, and
 * `RedraftRosterPlayer` is the CURRENT lineup — so auditing one would audit next week's lineup and
 * call it last week's. Best ball has no lineup to audit. Other sports have no weekly lock.
 *
 * Tiers: the latest finished week is free (it feeds the Commissioner Action Queue); the full-season
 * evidence report is `commissioner_integrity_monitoring`, the plan the integrity monitor already uses.
 */

export const INTEGRITY_FEATURE = 'commissioner_integrity_monitoring'

type LeagueRow = {
  id: string
  platform: string | null
  platformLeagueId: string | null
  season: number
  sport: unknown
  settings: unknown
  starters: unknown
  leagueType: string | null
  bestBallMode: boolean | null
  userId: string | null
}

export type LineupIntegrityReport =
  | { supported: false; reason: 'not_sleeper' | 'not_nfl' | 'best_ball' | 'no_lineup_rules' }
  | {
      supported: true
      season: number
      weeks: number[]
      latestWeek: number | null
      requiredStarters: number
      findings: Array<TeamWeekFinding & { text: string; flagged: boolean }>
      summary: TeamSeasonSummary[] | null
      fullSeason: boolean
      basis: string
    }

const BASIS =
  'Starting lineups are the ones Sleeper recorded for each finished week. An empty slot is a starting slot with no player in it. A bye starter is a player whose NFL team had no game that week. “Listed Out/IR now” means the starter scored 0 and is on the injury report today — injury status is not stored as it was at kickoff, so treat that one as a lead, not proof.'

const LEAGUE_SELECT = {
  id: true, platform: true, platformLeagueId: true, season: true, sport: true, settings: true, starters: true,
  leagueType: true, bestBallMode: true, userId: true,
} as const

function unsupported(league: LeagueRow): LineupIntegrityReport | null {
  if (String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) return { supported: false, reason: 'not_sleeper' }
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return { supported: false, reason: 'not_nfl' }
  const s = (league.settings ?? {}) as Record<string, unknown>
  if (league.bestBallMode || String(league.leagueType ?? '').toLowerCase() === 'best_ball' || s.best_ball || s.bestBall) {
    return { supported: false, reason: 'best_ball' }
  }
  if (readRequiredStarterCount(league) <= 0) return { supported: false, reason: 'no_lineup_rules' }
  return null
}

export async function integrityEntitled(ownerUserId: string | null): Promise<boolean> {
  if (!ownerUserId) return false
  try {
    return (await new FeatureGateService().evaluateUserFeatureAccess(ownerUserId, INTEGRITY_FEATURE)).allowed
  } catch {
    return false
  }
}

/** The report for one league. `fullSeason` false limits it to the latest finished week. */
export async function readLineupIntegrity(leagueId: string, opts: { fullSeason: boolean }): Promise<LineupIntegrityReport | null> {
  const league = (await prisma.league.findUnique({ where: { id: leagueId }, select: LEAGUE_SELECT })) as LeagueRow | null
  if (!league) return null
  const refusal = unsupported(league)
  if (refusal) return refusal
  const requiredStarters = readRequiredStarterCount(league)

  const rows = await prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: league.platformLeagueId!, seasonYear: league.season, isFinalized: true, isStarter: true },
    select: { week: true, rosterId: true, playerId: true, isStarter: true, points: true },
  })
  const allWeeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b)
  const latestWeek = allWeeks.at(-1) ?? null
  const scoped = opts.fullSeason ? rows : rows.filter((r) => r.week === latestWeek)

  const ids = [...new Set(scoped.map((r) => r.playerId))]
  const [players, teams, byeWeekByClub] = await Promise.all([
    ids.length ? prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true, team: true, position: true } }) : Promise.resolve([]),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, teamName: true, ownerName: true } }),
    resolveByeWeekMap(league.season, 'NFL'),
  ])
  const nameById = new Map<string, string>()
  const clubByPlayer = new Map<string, string | null>()
  const positionById = new Map<string, string | null>()
  for (const p of players) {
    if (!p.sleeperId) continue
    if (!nameById.has(p.sleeperId)) nameById.set(p.sleeperId, p.name)
    if (!clubByPlayer.get(p.sleeperId)) clubByPlayer.set(p.sleeperId, p.team ? p.team.toUpperCase() : null)
    if (!positionById.get(p.sleeperId)) positionById.set(p.sleeperId, p.position ?? null)
  }

  // Only zero-point starters can be the soft signal, so only they are looked up.
  const zeroIds = [...new Set(scoped.filter((r) => (r.points ?? 0) === 0).map((r) => r.playerId))]
  const ruledOutNow = new Set<string>()
  if (zeroIds.length > 0) {
    const names = new Map(zeroIds.flatMap((id) => (nameById.get(id) ? [[id, [nameById.get(id)!]] as const] : [])))
    const status = await readInjuryStatusById('NFL', names, new Map(zeroIds.map((id) => [id, clubByPlayer.get(id) ?? null])), new Map(zeroIds.map((id) => [id, positionById.get(id) ?? null])))
    for (const [id, st] of status) if (isRuledOut(st)) ruledOutNow.add(id)
  }

  const teamNameByRoster = new Map<number, string>()
  for (const t of teams) {
    const n = Number(t.externalId)
    if (Number.isInteger(n)) teamNameByRoster.set(n, t.teamName?.trim() || t.ownerName?.trim() || `Team ${n}`)
  }

  const audit = auditLineups({ rows: scoped, requiredStarters, byeWeekByClub, clubByPlayer, ruledOutNow, teamNameByRoster })
  const playerName = (id: string) => nameById.get(id) ?? `player ${id}`
  return {
    supported: true,
    season: league.season,
    weeks: opts.fullSeason ? allWeeks : latestWeek != null ? [latestWeek] : [],
    latestWeek,
    requiredStarters,
    findings: audit.findings.map((f) => ({ ...f, text: describeFinding(f, playerName), flagged: isFlagged(f) })),
    summary: opts.fullSeason ? audit.summary : null,
    fullSeason: opts.fullSeason,
    basis: BASIS,
  }
}

/**
 * Commissioner Action Queue: one task per team with a hard finding in the latest finished week.
 * Keyed by season and week, so it re-detects from stored rows on every scan and closes itself when
 * the next week becomes the latest — the queue is for what is current; the report keeps the record.
 */
export async function readLineupIntegrityTasks(leagueId: string): Promise<WorkspaceTaskCandidate[]> {
  const report = await readLineupIntegrity(leagueId, { fullSeason: false })
  if (!report || !report.supported) return []
  const id = encodeURIComponent(leagueId)
  return report.findings
    .filter((f) => f.flagged)
    .map((f) => ({
      sourceKey: `operational:lineup-integrity:${f.rosterId}:${report.season}:${f.week}:v1`,
      title: 'Lineup could not score',
      description: f.text,
      priority: 'elevated' as const,
      automationCandidate: false,
      relatedLinks: [{ label: 'Review league', moduleId: 'settings', href: `/core/commissioner?league=${id}#ch-lineup-integrity` }],
    }))
}
