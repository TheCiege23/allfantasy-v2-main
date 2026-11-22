import type { PrismaClient } from '@prisma/client'

import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'
import { createInjuryRowMatcher } from '@/lib/injuries/matchInjuryRows'
import { easternDayKey } from '@/lib/redraft/lineupLock'

/**
 * EACH PLAYER'S INJURY DESIGNATION AS IT STOOD BEFORE HIS GAME STARTED (owner, 2026-11-22: "injury … news" as a
 * measured projection factor; "build the NBA/NHL injury snapshots"). NFL, NBA and NHL — the sports whose designations
 * are published ahead of a scheduled start.
 *
 * WHY A SNAPSHOT AND NOT A READ. `SportsInjury` keeps ONE row per player per source and overwrites it, so after the
 * game it says what is true now (often "Out" for the injury that happened IN the game), never what was known before.
 * `injury_reports` kept dated rows but has had no writer since 2026-09-16. Learning "Questionable players score X% of
 * their average" from a post-game status would learn the injury, not the designation.
 *
 * So the maintenance cron captures, at most every 30 minutes per sport, each player's current designation for every
 * team whose game has NOT started, into one `sportsDataCache` row per PERIOD — the NFL week, or the US-Eastern game
 * date for NBA and NHL. A team's entries FREEZE at its start: later captures copy them forward untouched. What the
 * learner reads for a period is therefore the last designation seen before that player's own game.
 *
 * Players are keyed the way each sport's game lines are: NFL by Sleeper id, NBA and NHL by `PlayerIdentityMap.id`
 * (the `rolling_insights_live` game-log key). Measured 2026-11-22: 468 of 468 recent NBA and 773 of 773 NHL game-log
 * ids are identity ids with a current team.
 *
 * Levels: `clear` (no designation — the baseline), `probable`, `questionable` (also day-to-day), `doubtful`. Out / IR /
 * suspended players have no game line to learn from, so they are recorded as `out` and give no level.
 *
 * A team NOT in a period's snapshot (captures began late, the cron was down) gives its players NO level — absent data
 * is never read as "clear". Every read and write is contained; nothing here can fail a projection.
 */

export const INJURY_SNAPSHOT_SPORTS = ['NFL', 'NBA', 'NHL'] as const
export type InjurySnapshotSport = (typeof INJURY_SNAPSHOT_SPORTS)[number]

export type InjuryLevel = 'clear' | 'probable' | 'questionable' | 'doubtful' | 'out'
type Designated = Exclude<InjuryLevel, 'clear'>

export type InjurySnapshot = {
  sport: string
  /** `season:week` (NFL) or `YYYY-MM-DD`, the US-Eastern game date (NBA, NHL). */
  period: string
  /** Last capture of any team. */
  capturedAt: string
  /** Teams captured before their start: start time and when their entries were last written (frozen at start). */
  teams: Record<string, { kickoffAt: string; capturedAt: string }>
  /** Player key → designation and team. Only designated players; a captured team's other players are clear. */
  players: Record<string, { level: Designated; team: string }>
}

export const nflPeriod = (season: number, week: number) => `${season}:${week}`
export const INJURY_SNAPSHOT_KEY = (sport: string, period: string) => `af-projections:injury-snapshot:${sport.toUpperCase()}:${period}`
export const INJURY_CAPTURE_EVERY_MS = 30 * 60_000
/** Daily sports: capture the games starting within this window. */
const DAILY_HORIZON_MS = 30 * 3_600_000
/** Kept long enough for the learner's ~14-month look-back. */
const SNAPSHOT_TTL_MS = 450 * 86_400_000

/** The US-Eastern calendar date of an instant, `YYYY-MM-DD` — the date a daily sport's game log carries, and the same
 * day key the daily outlook uses (`lineupLock.easternDayKey`). PURE. */
export const easternDate = (d: Date) => easternDayKey(d)

/** A provider's designation → level, or null when it states none we can use. PURE. */
export function injuryLevel(status: string | null | undefined): InjuryLevel | null {
  const t = String(status ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!t) return null
  if (t === 'active' || t === 'healthy' || t === 'na' || t === 'none' || t === 'available') return 'clear'
  if (t === 'p' || t.startsWith('probable')) return 'probable'
  if (t === 'q' || t.startsWith('questionable') || t === 'gtd' || t.includes('game time') || t === 'day to day' || t === 'dtd') return 'questionable'
  if (t === 'd' || t.startsWith('doubtful')) return 'doubtful'
  if (t === 'o' || t.startsWith('out') || t === 'ir' || t.startsWith('ir ') || t.includes('injured reserve') || t.includes('injury reserve') || t === 'pup' || t.includes('physically unable') || t.startsWith('susp') || t === 'nfi' || t === 'cov' || t.includes('covid') || t === 'ltir') return 'out'
  return null
}

/**
 * The level a stored snapshot gives one player for his game, or undefined when the snapshot cannot speak for him: his
 * team was never captured before its start, or he was ruled out (no game line follows). PURE.
 */
export function snapshotLevelFor(snapshot: InjurySnapshot | null | undefined, playerKey: string, teamCode: string | null): string | undefined {
  if (!snapshot) return undefined
  const hit = snapshot.players[playerKey]
  if (hit) return hit.level === 'out' ? undefined : hit.level
  return teamCode && snapshot.teams[teamCode] ? 'clear' : undefined
}

/**
 * Merge one capture into the period's snapshot. Teams already started keep exactly what they had; teams not yet
 * started are replaced by this capture (a player cleared since the last capture drops out). PURE.
 */
export function mergeInjuryCapture(
  prior: InjurySnapshot | null,
  capture: { sport: string; period: string; at: Date; kickoffs: ReadonlyMap<string, Date>; designations: ReadonlyMap<string, { level: Designated; team: string }> },
): InjurySnapshot {
  const atIso = capture.at.toISOString()
  const teams: InjurySnapshot['teams'] = {}
  const players: InjurySnapshot['players'] = {}
  const open = new Set<string>()
  for (const [team, kickoff] of capture.kickoffs) if (kickoff.getTime() > capture.at.getTime()) open.add(team)
  // Frozen: every team already captured whose start has passed (or that this capture no longer schedules).
  if (prior && prior.sport === capture.sport && prior.period === capture.period) {
    for (const [team, t] of Object.entries(prior.teams)) if (!open.has(team)) teams[team] = t
    for (const [id, p] of Object.entries(prior.players)) if (!open.has(p.team) && teams[p.team]) players[id] = p
  }
  for (const team of open) teams[team] = { kickoffAt: capture.kickoffs.get(team)!.toISOString(), capturedAt: atIso }
  for (const [id, d] of capture.designations) if (open.has(d.team)) players[id] = d
  return { sport: capture.sport, period: capture.period, capturedAt: atIso, teams, players }
}

type CaptureDb = Pick<PrismaClient, 'sportsGame' | 'sportsInjury' | 'playerIdentityMap' | 'sportsDataCache'>
type Game = { homeTeam: string; awayTeam: string; startTime: Date | null }

/** Each period to capture now, with every team's start in it (earliest start per team: feeds duplicate games). */
async function periodsToCapture(db: Pick<PrismaClient, 'sportsGame'>, sport: InjurySnapshotSport, now: Date): Promise<Array<{ period: string; kickoffs: Map<string, Date> }>> {
  const kickoffsOf = (games: Game[], periodOf: (d: Date) => string | null) => {
    const by = new Map<string, Map<string, Date>>()
    for (const g of games) {
      if (!g.startTime) continue
      const period = periodOf(g.startTime)
      if (!period) continue
      const m = by.get(period) ?? new Map<string, Date>()
      for (const t of [g.homeTeam, g.awayTeam]) {
        const code = projectionTeamKey(sport, t)
        if (!code) continue
        const prev = m.get(code)
        if (!prev || g.startTime.getTime() < prev.getTime()) m.set(code, g.startTime)
      }
      by.set(period, m)
    }
    return [...by].map(([period, kickoffs]) => ({ period, kickoffs }))
  }
  if (sport === 'NFL') {
    const next = await db.sportsGame.findFirst({
      where: { sport: 'NFL', startTime: { gt: now }, week: { not: null }, season: { not: null } },
      orderBy: { startTime: 'asc' },
      select: { season: true, week: true, seasonType: true },
    })
    if (!next?.season || !next.week) return []
    const games = await db.sportsGame.findMany({
      where: { sport: 'NFL', season: next.season, week: next.week, ...(next.seasonType ? { seasonType: next.seasonType } : {}) },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    const period = nflPeriod(next.season, next.week)
    return kickoffsOf(games, () => period)
  }
  // Daily: every game starting soon, grouped by its US-Eastern date — the date its game log will carry.
  const games = await db.sportsGame.findMany({
    where: { sport, startTime: { gt: now, lte: new Date(now.getTime() + DAILY_HORIZON_MS) } },
    select: { homeTeam: true, awayTeam: true, startTime: true },
  })
  return kickoffsOf(games, easternDate)
}

export type InjuryCaptureResult =
  | { sport: string; status: 'no_games' }
  | { sport: string; status: 'fresh'; periods: string[] }
  | { sport: string; status: 'captured'; periods: string[]; openTeams: number; designated: number }

/** Capture one sport's upcoming designations (at most every 30 minutes per period). */
export async function captureInjurySnapshot(db: CaptureDb, sport: InjurySnapshotSport, opts: { now?: Date } = {}): Promise<InjuryCaptureResult> {
  const now = opts.now ?? new Date()
  const periods = await periodsToCapture(db, sport, now)
  if (!periods.length) return { sport, status: 'no_games' }
  const keys = periods.map((p) => INJURY_SNAPSHOT_KEY(sport, p.period))
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } }).catch(() => [])
  const priorBy = new Map(rows.map((r) => [r.cacheKey, (r.data as InjurySnapshot | null) ?? null]))
  const due = periods.filter((p) => {
    const at = Date.parse(priorBy.get(INJURY_SNAPSHOT_KEY(sport, p.period))?.capturedAt ?? '')
    return !(Number.isFinite(at) && now.getTime() - at < INJURY_CAPTURE_EVERY_MS)
  })
  if (!due.length) return { sport, status: 'fresh', periods: periods.map((p) => p.period) }

  const open = new Set<string>()
  for (const p of due) for (const [t, k] of p.kickoffs) if (k.getTime() > now.getTime()) open.add(t)

  const designations = new Map<string, { level: Designated; team: string }>()
  if (open.size) {
    // Every live row from every source: the matcher picks each athlete's newest CLAIM (a morning "Active" beats last
    // night's "Questionable") and binds by name + team + position, refusing names it cannot tell apart.
    const injuries = await db.sportsInjury.findMany({
      where: { sport: { in: [sport, sport.toLowerCase()] }, expiresAt: { gt: now }, status: { not: null } },
      select: { playerName: true, team: true, position: true, status: true, date: true, fetchedAt: true },
    })
    const match = createInjuryRowMatcher(injuries, sport)
    const roster = await db.playerIdentityMap.findMany({
      where: { sport, currentTeam: { not: null }, ...(sport === 'NFL' ? { sleeperId: { not: null } } : {}) },
      select: { id: true, sleeperId: true, canonicalName: true, currentTeam: true, position: true },
    })
    for (const p of roster) {
      const team = projectionTeamKey(sport, p.currentTeam)
      const key = sport === 'NFL' ? p.sleeperId : p.id
      if (!team || !key || !open.has(team)) continue
      const hit = match({ name: p.canonicalName, team: p.currentTeam, position: p.position })
      if (!hit || !('rows' in hit)) continue
      const level = injuryLevel(hit.rows[0]?.status)
      if (level && level !== 'clear') designations.set(key, { level, team })
    }
  }

  const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS)
  for (const p of due) {
    const key = INJURY_SNAPSHOT_KEY(sport, p.period)
    const snapshot = mergeInjuryCapture(priorBy.get(key) ?? null, { sport, period: p.period, at: now, kickoffs: p.kickoffs, designations })
    await db.sportsDataCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, expiresAt, data: snapshot as unknown as object },
      update: { expiresAt, data: snapshot as unknown as object },
    })
  }
  return { sport, status: 'captured', periods: due.map((p) => p.period), openTeams: open.size, designated: designations.size }
}

/** The maintenance cron's tick: every snapshot sport, each contained so one sport's failure never stops another. */
export async function captureInjurySnapshots(db: CaptureDb, opts: { now?: Date } = {}) {
  const out: Array<InjuryCaptureResult | { sport: string; status: 'error'; error: string }> = []
  for (const sport of INJURY_SNAPSHOT_SPORTS) {
    out.push(await captureInjurySnapshot(db, sport, opts).catch((e) => ({ sport, status: 'error' as const, error: e instanceof Error ? e.message.slice(0, 120) : 'capture failed' })))
  }
  return out
}

/** Stored snapshots for these periods, keyed by period. Missing or unreadable periods are simply absent. */
export async function loadInjurySnapshots(db: Pick<PrismaClient, 'sportsDataCache'>, sport: string, periods: ReadonlyArray<string>): Promise<Map<string, InjurySnapshot>> {
  const out = new Map<string, InjurySnapshot>()
  const keys = [...new Set(periods.map((p) => INJURY_SNAPSHOT_KEY(sport, p)))]
  if (!keys.length) return out
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { data: true } }).catch(() => [])
  for (const r of rows) {
    const s = r.data as InjurySnapshot | null
    if (s && s.sport === sport.toUpperCase() && typeof s.period === 'string' && s.teams && s.players) out.set(s.period, s)
  }
  return out
}
