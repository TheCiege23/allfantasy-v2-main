import 'server-only'

import { prisma } from '@/lib/prisma'
import { readRequiredStarterCount } from '@/lib/commissioner-hub/requiredStarters'
import { resolveByeWeekMap } from '@/lib/core-app/byeWeekMap'
import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { loadNativeLineupCards } from '@/lib/integrity/nativeLineupCards'
import { auditLineups, describeFinding, isFlagged, type TeamSeasonSummary, type TeamWeekFinding, type WeeklyStarterRow } from './lineupIntegrity'

/**
 * Lineup-integrity monitor — reads. Rules in ./lineupIntegrity.
 *
 * DB-first: every input is already stored. Lineups are `league_player_weekly_scores` (the Sleeper
 * matchups feed the import already ingests: `isStarter`, `points`, `isFinalized`); clubs and names
 * are `SportsPlayer`; byes come from `SportsGame` through `resolveByeWeekMap`; injury status is
 * `SportsInjury` through `readInjuryStatusById`. Nothing here calls a provider.
 *
 * Two sources, one audit:
 *   Sleeper      `league_player_weekly_scores` — the starters Sleeper recorded each finished week
 *   AllFantasy   `af_roster_lineup_assignments` through `loadNativeLineupCards` — the lineup each
 *                team SAVED for that week, the same record matchup scoring uses. A team with no saved
 *                lineup for a week is not audited that week (never its current lineup, which can
 *                already be next week's). Byes come from the roster row's `byeWeek`; "did not play"
 *                means no stat line in `player_weekly_scores` that week.
 *
 * ⚠ NFL ONLY, BEST BALL NEVER, AND IMPORTED LEAGUES OTHER THAN SLEEPER ARE SAID TO BE UNSUPPORTED
 * rather than guessed at. Other sports have no weekly lock; best ball has no lineup to audit.
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
  | { supported: false; reason: 'unsupported_platform' | 'not_nfl' | 'best_ball' | 'no_lineup_rules' }
  | {
      supported: true
      season: number
      weeks: number[]
      latestWeek: number | null
      requiredStarters: number
      /** `playerNames`: the finding's players by id, where known — an accusation names people, not ids. */
      findings: Array<TeamWeekFinding & { text: string; flagged: boolean; playerNames: Record<string, string> }>
      summary: TeamSeasonSummary[] | null
      fullSeason: boolean
      basis: string
    }

const BASIS: Record<'sleeper' | 'native', string> = {
  sleeper:
    'Starting lineups are the ones Sleeper recorded for each finished week. An empty slot is a starting slot with no player in it. A bye starter is a player whose NFL team had no game that week. “Listed Out/IR” means the starter scored 0 and is on the injury report today — injury status is not stored as it was at kickoff, so treat that one as a lead, not proof.',
  native:
    'Starting lineups are the ones each team saved for that week — the same lineups the matchups were scored from. A team that never saved a lineup for a week is left out of that week. An empty slot is a starting slot with no player in it. A bye starter is a player whose NFL team had no game that week. “Listed Out/IR” means the starter recorded no stats that week and carries an Out or IR status as last synced — treat it as a lead, not proof.',
}

const LEAGUE_SELECT = {
  id: true, platform: true, platformLeagueId: true, season: true, sport: true, settings: true, starters: true,
  leagueType: true, bestBallMode: true, userId: true,
} as const

function sourceOf(league: LeagueRow): 'sleeper' | 'native' | null {
  if (resolveWriteAuthority(league.platform) === 'NATIVE') return 'native'
  if (String(league.platform ?? '').toLowerCase() === 'sleeper' && league.platformLeagueId) return 'sleeper'
  return null
}

function unsupported(league: LeagueRow): LineupIntegrityReport | null {
  const source = sourceOf(league)
  if (!source) return { supported: false, reason: 'unsupported_platform' }
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return { supported: false, reason: 'not_nfl' }
  const s = (league.settings ?? {}) as Record<string, unknown>
  if (league.bestBallMode || String(league.leagueType ?? '').toLowerCase() === 'best_ball' || s.best_ball || s.bestBall) {
    return { supported: false, reason: 'best_ball' }
  }
  // An AllFantasy league without readable slot rules still gets the bye check; Sleeper's audit is
  // built on counting slots, so without the rules there is nothing honest to say.
  if (source === 'sleeper' && readRequiredStarterCount(league) <= 0) return { supported: false, reason: 'no_lineup_rules' }
  return null
}

type SourceRows = {
  rows: WeeklyStarterRow[]
  allWeeks: number[]
  nameById: Map<string, string>
  clubByPlayer: Map<string, string | null>
  ruledOutNow: Set<string>
  teamNameByRoster: Map<string, string>
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

  const source = sourceOf(league)!
  const data = source === 'native' ? await readNativeRows(league, opts.fullSeason) : await readSleeperRows(league, opts.fullSeason)
  const allWeeks = data.allWeeks
  const latestWeek = allWeeks.at(-1) ?? null
  const scoped = data.rows
  const { nameById, clubByPlayer, ruledOutNow, teamNameByRoster } = data
  const byeWeekByClub = source === 'sleeper' ? await resolveByeWeekMap(league.season, 'NFL') : {}

  const audit = auditLineups({ rows: scoped, requiredStarters, byeWeekByClub, clubByPlayer, ruledOutNow, teamNameByRoster })
  const playerName = (id: string) => nameById.get(id) ?? `player ${id}`
  return {
    supported: true,
    season: league.season,
    weeks: opts.fullSeason ? allWeeks : latestWeek != null ? [latestWeek] : [],
    latestWeek,
    requiredStarters,
    findings: audit.findings.map((f) => ({
      ...f,
      text: describeFinding(f, playerName),
      flagged: isFlagged(f),
      playerNames: Object.fromEntries([...f.byeStarters, ...f.ruledOutStarters].flatMap((id) => (nameById.has(id) ? [[id, nameById.get(id)!]] : []))),
    })),
    summary: opts.fullSeason ? audit.summary : null,
    fullSeason: opts.fullSeason,
    basis: BASIS[source],
  }
}

async function readSleeperRows(league: LeagueRow, fullSeason: boolean): Promise<SourceRows> {
  const raw = await prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: league.platformLeagueId!, seasonYear: league.season, isFinalized: true, isStarter: true },
    select: { week: true, rosterId: true, playerId: true, isStarter: true, points: true },
  })
  const allWeeks = [...new Set(raw.map((r) => r.week))].sort((a, b) => a - b)
  const latest = allWeeks.at(-1)
  const rows: WeeklyStarterRow[] = raw
    .filter((r) => fullSeason || r.week === latest)
    .map((r) => ({ week: r.week, rosterId: r.rosterId == null ? null : String(r.rosterId), playerId: r.playerId, isStarter: r.isStarter, didNotPlay: (r.points ?? 0) === 0 }))

  const ids = [...new Set(rows.map((r) => r.playerId))]
  const [players, teams] = await Promise.all([
    ids.length ? prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true, team: true, position: true } }) : Promise.resolve([]),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, teamName: true, ownerName: true } }),
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
  const zeroIds = [...new Set(rows.filter((r) => r.didNotPlay).map((r) => r.playerId))]
  const ruledOutNow = new Set<string>()
  if (zeroIds.length > 0) {
    const names = new Map(zeroIds.flatMap((id) => (nameById.get(id) ? [[id, [nameById.get(id)!]] as const] : [])))
    const status = await readInjuryStatusById('NFL', names, new Map(zeroIds.map((id) => [id, clubByPlayer.get(id) ?? null])), new Map(zeroIds.map((id) => [id, positionById.get(id) ?? null])))
    for (const [id, st] of status) if (isRuledOut(st)) ruledOutNow.add(id)
  }

  const teamNameByRoster = new Map<string, string>()
  for (const t of teams) {
    if (t.externalId) teamNameByRoster.set(String(t.externalId), t.teamName?.trim() || t.ownerName?.trim() || `Team ${t.externalId}`)
  }
  return { rows, allWeeks, nameById, clubByPlayer, ruledOutNow, teamNameByRoster }
}

/** AllFantasy-run leagues: each finished week's SAVED lineups (see the header). */
async function readNativeRows(league: LeagueRow, fullSeason: boolean): Promise<SourceRows> {
  const empty: SourceRows = { rows: [], allWeeks: [], nameById: new Map(), clubByPlayer: new Map(), ruledOutNow: new Set(), teamNameByRoster: new Map() }
  const season =
    (await prisma.redraftSeason.findFirst({ where: { leagueId: league.id, season: league.season }, orderBy: { createdAt: 'desc' }, select: { id: true, season: true } })) ??
    (await prisma.redraftSeason.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: 'desc' }, select: { id: true, season: true } }))
  if (!season) return empty

  const [matchups, rosters] = await Promise.all([
    prisma.redraftMatchup.findMany({ where: { seasonId: season.id, isMedianMatchup: false }, select: { week: true, status: true } }),
    prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, teamName: true, ownerName: true } }),
  ])
  // A week is finished only when every one of its games is final.
  const byWeek = new Map<number, boolean>()
  for (const m of matchups) byWeek.set(m.week, (byWeek.get(m.week) ?? true) && m.status === 'final')
  const allWeeks = [...byWeek.entries()].filter(([, done]) => done).map(([w]) => w).sort((a, b) => a - b)
  if (allWeeks.length === 0 || rosters.length === 0) return { ...empty, allWeeks }

  const weeks = fullSeason ? allWeeks : [allWeeks.at(-1)!]
  const rosterIds = rosters.map((r) => r.id)
  const rows: WeeklyStarterRow[] = []
  const ruledOutNow = new Set<string>()
  for (const week of weeks) {
    const cards = await loadNativeLineupCards(prisma, { redraftRosterIds: rosterIds, season: season.season, week })
    for (const card of cards.values()) {
      for (const st of card.starters) {
        rows.push({ week, rosterId: card.rosterId, playerId: st.playerId, isStarter: true, didNotPlay: false, byeWeek: st.byeWeek ?? null })
        if (isRuledOut(st.status)) ruledOutNow.add(st.playerId)
      }
    }
  }

  // "Did not play": no stat line for that player that week.
  const ids = [...new Set(rows.map((r) => r.playerId))]
  const [statRows, players] = ids.length
    ? await Promise.all([
        prisma.playerWeeklyScore.findMany({ where: { playerId: { in: ids }, season: season.season, week: { in: weeks } }, select: { playerId: true, week: true } }),
        prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, playerId: { in: ids } }, select: { playerId: true, playerName: true, team: true } }),
      ])
    : [[], []]
  const played = new Set(statRows.map((r) => `${r.playerId}:${r.week}`))
  for (const r of rows) r.didNotPlay = !played.has(`${r.playerId}:${r.week}`)

  const nameById = new Map<string, string>()
  const clubByPlayer = new Map<string, string | null>()
  for (const p of players) {
    if (!nameById.has(p.playerId)) nameById.set(p.playerId, p.playerName)
    if (!clubByPlayer.get(p.playerId)) clubByPlayer.set(p.playerId, p.team ? p.team.toUpperCase() : null)
  }
  const teamNameByRoster = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'A team']))
  return { rows, allWeeks, nameById, clubByPlayer, ruledOutNow, teamNameByRoster }
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
