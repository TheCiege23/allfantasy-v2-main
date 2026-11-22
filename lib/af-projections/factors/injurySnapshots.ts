import type { PrismaClient } from '@prisma/client'

import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'
import { createInjuryRowMatcher } from '@/lib/injuries/matchInjuryRows'

/**
 * EACH PLAYER'S INJURY DESIGNATION AS IT STOOD BEFORE HIS GAME KICKED OFF (owner, 2026-11-22: "injury … news" as a
 * measured projection factor). NFL only — the sport whose designations are weekly and published before a fixed kickoff.
 *
 * WHY A SNAPSHOT AND NOT A READ. `SportsInjury` keeps ONE row per player per source and overwrites it, so after the
 * game it says what is true now (often "Out" for the injury that happened IN the game), never what was known before.
 * `injury_reports` kept dated rows but has had no NFL writer since 2026-09-16. Learning "Questionable players score
 * X% of their average" from a post-game status would learn the injury, not the designation.
 *
 * So the maintenance cron captures, at most every 30 minutes, each Sleeper-keyed NFL player's current designation for
 * every team whose game has NOT kicked off, into one `sportsDataCache` row per week. A team's entries FREEZE at its
 * kickoff: later captures copy them forward untouched. What the learner reads for a week is therefore the last
 * designation seen before that player's own kickoff — never later news.
 *
 * Levels: `clear` (no designation — the baseline), `questionable`, `doubtful`. Out / IR / PUP / suspended players
 * have no game line to learn from, so they are not a level; they are recorded as `out` for completeness and skipped
 * by the learner, which only sees players who played.
 *
 * A team NOT in a week's snapshot (captures began mid-week, or the cron was down) gives its players NO level — absent
 * data is never read as "clear". Every read and write is contained; nothing here can fail a projection.
 */

export type InjuryLevel = 'clear' | 'questionable' | 'doubtful' | 'out'

export type InjurySnapshot = {
  season: number
  week: number
  /** Last capture of any team. */
  capturedAt: string
  /** Teams captured before kickoff: kickoff time and when their entries were last written (frozen at kickoff). */
  teams: Record<string, { kickoffAt: string; capturedAt: string }>
  /** Sleeper id → designation level and team. Only designated players; a captured team's other players are clear. */
  players: Record<string, { level: Exclude<InjuryLevel, 'clear'>; team: string }>
}

export const INJURY_SNAPSHOT_KEY = (season: number, week: number) => `af-projections:injury-snapshot:NFL:${season}:${week}`
export const INJURY_CAPTURE_EVERY_MS = 30 * 60_000
/** Kept long enough for the learner's ~14-month look-back. */
const SNAPSHOT_TTL_MS = 450 * 86_400_000

/** A provider's designation → level, or null when it states none we can use. PURE. */
export function injuryLevel(status: string | null | undefined): InjuryLevel | null {
  const t = String(status ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!t) return null
  if (t === 'active' || t === 'healthy' || t === 'na' || t === 'none' || t === 'probable') return 'clear'
  if (t === 'q' || t.startsWith('questionable') || t === 'gtd' || t.includes('game time') || t === 'day to day') return 'questionable'
  if (t === 'd' || t.startsWith('doubtful')) return 'doubtful'
  if (t === 'o' || t.startsWith('out') || t === 'ir' || t.includes('injured reserve') || t.includes('injury reserve') || t === 'pup' || t.includes('physically unable') || t.startsWith('susp') || t === 'nfi' || t === 'cov' || t.includes('covid')) return 'out'
  return null
}

/**
 * The level a stored snapshot gives one player for his game, or undefined when the snapshot cannot speak for him: his
 * team was never captured before kickoff, or he was ruled out (no game line follows). PURE.
 */
export function snapshotLevelFor(snapshot: InjurySnapshot | null | undefined, sleeperId: string, teamCode: string | null): string | undefined {
  if (!snapshot) return undefined
  const hit = snapshot.players[sleeperId]
  if (hit) return hit.level === 'out' ? undefined : hit.level
  return teamCode && snapshot.teams[teamCode] ? 'clear' : undefined
}

/**
 * Merge one capture into the week's snapshot. Teams already kicked off keep exactly what they had; teams not yet
 * kicked off are replaced by this capture (a player cleared since the last capture drops out). PURE.
 */
export function mergeInjuryCapture(
  prior: InjurySnapshot | null,
  capture: { season: number; week: number; at: Date; kickoffs: ReadonlyMap<string, Date>; designations: ReadonlyMap<string, { level: Exclude<InjuryLevel, 'clear'>; team: string }> },
): InjurySnapshot {
  const atIso = capture.at.toISOString()
  const teams: InjurySnapshot['teams'] = {}
  const players: InjurySnapshot['players'] = {}
  const open = new Set<string>()
  for (const [team, kickoff] of capture.kickoffs) if (kickoff.getTime() > capture.at.getTime()) open.add(team)
  // Frozen: every team already captured whose kickoff has passed (or that this capture no longer schedules).
  if (prior && prior.season === capture.season && prior.week === capture.week) {
    for (const [team, t] of Object.entries(prior.teams)) if (!open.has(team)) teams[team] = t
    for (const [id, p] of Object.entries(prior.players)) if (!open.has(p.team) && teams[p.team]) players[id] = p
  }
  for (const team of open) teams[team] = { kickoffAt: capture.kickoffs.get(team)!.toISOString(), capturedAt: atIso }
  for (const [id, d] of capture.designations) if (open.has(d.team)) players[id] = d
  return { season: capture.season, week: capture.week, capturedAt: atIso, teams, players }
}

type CaptureDb = Pick<PrismaClient, 'sportsGame' | 'sportsInjury' | 'playerIdentityMap' | 'sportsDataCache'>

export type InjuryCaptureTick =
  | { status: 'no_week' }
  | { status: 'fresh'; season: number; week: number }
  | { status: 'captured'; season: number; week: number; openTeams: number; designated: number; frozenTeams: number }

/** The week the next NFL kickoff belongs to, with every game of it. */
async function currentWeek(db: Pick<PrismaClient, 'sportsGame'>, now: Date) {
  const next = await db.sportsGame.findFirst({
    where: { sport: 'NFL', startTime: { gt: now }, week: { not: null }, season: { not: null } },
    orderBy: { startTime: 'asc' },
    select: { season: true, week: true, seasonType: true },
  })
  if (!next?.season || !next.week) return null
  const games = await db.sportsGame.findMany({
    where: { sport: 'NFL', season: next.season, week: next.week, ...(next.seasonType ? { seasonType: next.seasonType } : {}) },
    select: { homeTeam: true, awayTeam: true, startTime: true },
  })
  return { season: next.season, week: next.week, games }
}

/** Capture this week's designations (at most every 30 minutes). Never throws past the caller's catch. */
export async function captureNflInjurySnapshot(db: CaptureDb, opts: { now?: Date } = {}): Promise<InjuryCaptureTick> {
  const now = opts.now ?? new Date()
  const wk = await currentWeek(db, now)
  if (!wk) return { status: 'no_week' }
  const key = INJURY_SNAPSHOT_KEY(wk.season, wk.week)
  const row = await db.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } }).catch(() => null)
  const prior = (row?.data as InjurySnapshot | null | undefined) ?? null
  const last = prior ? Date.parse(prior.capturedAt) : NaN
  if (Number.isFinite(last) && now.getTime() - last < INJURY_CAPTURE_EVERY_MS) return { status: 'fresh', season: wk.season, week: wk.week }

  const kickoffs = new Map<string, Date>()
  for (const g of wk.games) {
    if (!g.startTime) continue
    for (const t of [g.homeTeam, g.awayTeam]) {
      const code = projectionTeamKey('NFL', t)
      if (code) kickoffs.set(code, g.startTime)
    }
  }
  const openTeams = [...kickoffs].filter(([, k]) => k.getTime() > now.getTime()).map(([t]) => t)

  const designations = new Map<string, { level: Exclude<InjuryLevel, 'clear'>; team: string }>()
  if (openTeams.length) {
    // Every live NFL row from every source: the matcher picks each athlete's newest CLAIM (a Sunday "Active" beats a
    // Friday "Questionable"), and binds by name + team + position, refusing names it cannot tell apart.
    const injuries = await db.sportsInjury.findMany({
      where: { sport: { in: ['NFL', 'nfl'] }, expiresAt: { gt: now }, status: { not: null } },
      select: { playerName: true, team: true, position: true, status: true, date: true, fetchedAt: true },
    })
    const match = createInjuryRowMatcher(injuries, 'NFL')
    const roster = await db.playerIdentityMap.findMany({
      where: { sport: 'NFL', sleeperId: { not: null }, currentTeam: { not: null } },
      select: { sleeperId: true, canonicalName: true, currentTeam: true, position: true },
    })
    const open = new Set(openTeams)
    for (const p of roster) {
      const team = projectionTeamKey('NFL', p.currentTeam)
      if (!team || !open.has(team) || !p.sleeperId) continue
      const hit = match({ name: p.canonicalName, team, position: p.position })
      if (!hit || !('rows' in hit)) continue
      const level = injuryLevel(hit.rows[0]?.status)
      if (level && level !== 'clear') designations.set(p.sleeperId, { level, team })
    }
  }

  const snapshot = mergeInjuryCapture(prior, { season: wk.season, week: wk.week, at: now, kickoffs, designations })
  const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS)
  await db.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, expiresAt, data: snapshot as unknown as object },
    update: { expiresAt, data: snapshot as unknown as object },
  })
  return {
    status: 'captured', season: wk.season, week: wk.week, openTeams: openTeams.length,
    designated: designations.size, frozenTeams: Object.keys(snapshot.teams).length - openTeams.length,
  }
}

/** Stored snapshots for these weeks, keyed `season:week`. Missing or unreadable weeks are simply absent. */
export async function loadInjurySnapshots(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  weeks: ReadonlyArray<{ season: number; week: number }>,
): Promise<Map<string, InjurySnapshot>> {
  const out = new Map<string, InjurySnapshot>()
  const keys = [...new Set(weeks.map((w) => INJURY_SNAPSHOT_KEY(w.season, w.week)))]
  if (!keys.length) return out
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { data: true } }).catch(() => [])
  for (const r of rows) {
    const s = r.data as InjurySnapshot | null
    if (s && typeof s.season === 'number' && typeof s.week === 'number' && s.teams && s.players) out.set(`${s.season}:${s.week}`, s)
  }
  return out
}
