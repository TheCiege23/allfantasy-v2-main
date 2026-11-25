/**
 * Lineup lock resolution: weekly/daily policies + league flags + optional per-player kickoff heuristic.
 */
import { evaluateLineupLock, type LineupLockResult } from '@/lib/league/lineup-lock'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { resolveConceptRosterLineupRules } from './conceptRosterRules'
import type { LineupLockContext } from './types'
import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { resolveEffectiveRedraftWeek } from '@/lib/season-week/effectiveRedraftWeek'

export type LineupLockResolveArgs = {
  leagueId: string
  rosterId: string
  sport: string
  leagueVariant: string | null | undefined
  settings: unknown
  leagueWeek: number
  editingWeek: number
  season: number
  now?: Date
  playerData: unknown
  lockAllMoves?: boolean | null
  lifecycleState?: string
}

function weekFromSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

/**
 * Best-effort per-player lock when `gameTime` parses to a time in the past.
 */
export function computePerPlayerKickoffLocks(
  playerData: unknown,
  now: Date,
): { lockedPlayerIds: string[]; reasons: Record<string, string> } {
  const sections = getNormalizedLineupSections(playerData)
  const lockedPlayerIds: string[] = []
  const reasons: Record<string, string> = {}
  const keys: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  for (const section of keys) {
    for (const row of sections[section]) {
      const o = row as Record<string, unknown>
      const id = String(o.id ?? '').trim()
      if (!id) continue
      const gtRaw = String(o.gameTime ?? o.game_time ?? '').trim()
      if (!gtRaw || gtRaw === '—' || gtRaw === '-') continue
      const t = Date.parse(gtRaw)
      if (!Number.isNaN(t) && t <= now.getTime()) {
        lockedPlayerIds.push(id)
        reasons[id] = 'Player is locked (game time in the past).'
      }
    }
  }
  return { lockedPlayerIds, reasons }
}

/** A basketball player stays locked after his first counting tipoff of the fantasy week. */
export function nbaSurvivorGameDayLocks(
  players: Array<{ playerId: string; team: string | null }>,
  games: Array<{ homeTeam: string | null; awayTeam: string | null; startTime: Date | null }>,
  now: Date,
  selectedGameStarts: ReadonlyMap<string, Date> = new Map(),
): { lockedPlayerIds: string[]; reasons: Record<string, string> } {
  const firstStartByTeam = new Map<string, Date>()
  for (const game of games) {
    if (!game.startTime) continue
    for (const team of [game.homeTeam, game.awayTeam]) {
      const key = nbaTeamKey(team)
      if (key && (!firstStartByTeam.has(key) || game.startTime < firstStartByTeam.get(key)!)) firstStartByTeam.set(key, game.startTime)
    }
  }
  const lockedPlayerIds: string[] = []
  const reasons: Record<string, string> = {}
  for (const player of players) {
    const lockAt = selectedGameStarts.get(player.playerId) ?? firstStartByTeam.get(nbaTeamKey(player.team))
    if (!lockAt || lockAt > now) continue
    lockedPlayerIds.push(player.playerId)
    reasons[player.playerId] = 'This player is locked for the fantasy week because their NBA game has started.'
  }
  return { lockedPlayerIds, reasons }
}

const NBA_TEAM_NAMES: Record<string, string> = {
  HAWKS: 'ATL', CELTICS: 'BOS', NETS: 'BKN', HORNETS: 'CHA', BULLS: 'CHI',
  CAVALIERS: 'CLE', MAVERICKS: 'DAL', NUGGETS: 'DEN', PISTONS: 'DET',
  WARRIORS: 'GSW', ROCKETS: 'HOU', PACERS: 'IND', CLIPPERS: 'LAC', LAKERS: 'LAL',
  GRIZZLIES: 'MEM', HEAT: 'MIA', BUCKS: 'MIL', TIMBERWOLVES: 'MIN',
  PELICANS: 'NOP', KNICKS: 'NYK', THUNDER: 'OKC', MAGIC: 'ORL',
  '76ERS': 'PHI', SIXERS: 'PHI', SUNS: 'PHX', 'TRAIL BLAZERS': 'POR',
  KINGS: 'SAC', SPURS: 'SAS', RAPTORS: 'TOR', JAZZ: 'UTA', WIZARDS: 'WAS',
}

export function nbaTeamKey(value: string | null | undefined): string {
  const key = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ')
  if (!key) return ''
  const aliases: Record<string, string> = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', PHO: 'PHX', UTH: 'UTA', BKL: 'BKN', BRK: 'BKN' }
  if (aliases[key]) return aliases[key]
  if (key.length <= 3) return key
  for (const [name, code] of Object.entries(NBA_TEAM_NAMES)) {
    if (key === name || key.endsWith(` ${name}`)) return code
  }
  return key
}

async function resolveNbaSurvivorGameDayLocks(args: LineupLockResolveArgs, now: Date) {
  await ensureDailySportSeasonStart('NBA', args.season, { db: prisma as never })
  const window = resolveDailySportWeekWindow('NBA', args.season, args.editingWeek)
  if (!window) throw new Error('NBA Survivor lineup cannot be edited without a verified fantasy-week calendar.')
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { redraftRosterId: true, platformUserId: true } })
  if (!roster?.redraftRosterId) return { lockedPlayerIds: [], reasons: {} }
  const mode = args.settings && typeof args.settings === 'object' && !Array.isArray(args.settings)
    ? (args.settings as Record<string, unknown>).nbaWeeklyScoringMode : null
  const [players, games, picks] = await Promise.all([
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: roster.redraftRosterId, droppedAt: null },
      select: { playerId: true, team: true },
    }),
    readWeekGames(prisma, {
      sport: 'NBA', season: args.season, week: args.editingWeek, seasonType: 'regular',
      dateWindow: window, now,
    }),
    mode === 'one_game_per_player' && roster.platformUserId
      ? prisma.survivorCommissionerAction.findMany({
          where: { leagueId: args.leagueId, week: args.editingWeek, actionType: 'nba_game_pick', targetUserId: roster.platformUserId },
          select: { newState: true },
        }) : Promise.resolve([]),
  ])
  const selectedStarts = new Map<string, Date>()
  for (const pick of picks) {
    if (!pick.newState || typeof pick.newState !== 'object' || Array.isArray(pick.newState)) continue
    const state = pick.newState as Record<string, unknown>
    if (typeof state.playerId !== 'string' || typeof state.startAt !== 'string') continue
    const start = new Date(state.startAt)
    if (!Number.isNaN(start.getTime()) && games.some(game => game.startTime?.getTime() === start.getTime())) selectedStarts.set(state.playerId, start)
  }
  return nbaSurvivorGameDayLocks(players, games, now, selectedStarts)
}

/*
 * 🛑 A NATIVE NBA / MLB / NHL / NCAAB LINEUP COULD BENCH A PLAYER AFTER HE HAD PLAYED THAT WEEK.
 *
 * For daily sports `evaluateLineupLock` only locks the WHOLE lineup from 6 PM ET to midnight and
 * reopens it every morning, and the per-player lock below it (`computePerPlayerKickoffLocks`) reads
 * a `gameTime` the CLIENT sent on the previous save — '—' when the UI had none, so it never locks,
 * and refreshed to the next game by any save, so a second save unlocks him. Meanwhile a native save
 * syncs slot types onto the redraft roster (`syncRedraftSlotTypesForLineup`), and the week is
 * scored from the slot each player holds at scoring time (`calculateTeamScore` via
 * `loadWeekLineups`), crediting him the WHOLE week's points. So a manager could bench a starter the
 * morning after a bad game and erase it from the week, or start a player whose games were done.
 *
 * The redraft lineup route already enforces the right rule from the schedule: a player locks at his
 * team's first game of the fantasy week and stays locked (`hydrateRedraftLineupLocks`, default
 * `per_player_kickoff`, honouring the league's lock mode and commissioner overrides). This applies the
 * same derivation here, so both save paths agree. NBA Survivor keeps its own pick-aware lock above.
 */
/*
 * 🛑 AND NFL, NCAAF AND SOCCER HAD NO SCHEDULE LOCK ON THIS PATH AT ALL (2026-11-23). They relied on the
 * whole-lineup time windows in `evaluateLineupLock` — whose Thursday branch could never run (Wed–Sat
 * returned "unlocked" first), so a Thursday-night starter could be benched on Friday and his points erased,
 * and NCAAF Saturdays never locked — plus the client-sent `gameTime` heuristic below. Owner's rule: in every
 * sport, a player whose game has started cannot be moved in or out; only best ball is exempt. Every sport
 * the schedule lock knows (lib/redraft/lineupLock.ts) is locked from the schedule now.
 */
const SCHEDULE_LOCK_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NCAAF', 'NBA', 'MLB', 'NHL', 'NCAAB', 'SOCCER'])

/** The schedule told us nothing: no games stored for the week, or a sport it cannot read. */
const SCHEDULE_UNKNOWN = /no .* games found|not locked|fall open/i

export type ScheduleLocks = { lockedPlayerIds: string[]; reasons: Record<string, string>; scheduleKnown: boolean }

export async function resolveDailySportWeeklyLocks(
  args: LineupLockResolveArgs,
  now: Date,
): Promise<ScheduleLocks | null> {
  const sport = args.sport.toUpperCase()
  // A past week is view-only already. A FUTURE week is locked by THIS week's schedule: a save writes the
  // roster's current slots (syncRedraftSlotTypesForLineup), so "editing week 13" moved week 12's lineup
  // with no lock at all.
  if (!SCHEDULE_LOCK_SPORTS.has(sport) || args.editingWeek < args.leagueWeek) return null
  const roster = await prisma.roster.findUnique({ where: { id: args.rosterId }, select: { redraftRosterId: true } })
  if (!roster?.redraftRosterId) return null
  const players: Array<{ playerId: string; team: string | null; isLocked?: boolean | null }> =
    await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: roster.redraftRosterId, droppedAt: null },
      select: { playerId: true, team: true },
    })
  const { players: stamped, warnings } = await hydrateRedraftLineupLocks(prisma, {
    sport,
    season: args.season,
    week: args.leagueWeek,
    rosterId: roster.redraftRosterId,
    leagueSettings: args.settings,
    players,
    now,
  })
  const lockedPlayerIds: string[] = []
  const reasons: Record<string, string> = {}
  for (const p of stamped) {
    if (!p.isLocked) continue
    lockedPlayerIds.push(p.playerId)
    reasons[p.playerId] = isDailyLineupScoringEnabled(args.settings, sport)
      ? "This player's game today has started; he is locked until tomorrow."
      : "This player's first game of the fantasy week has started; he is locked until the week ends."
  }
  return { lockedPlayerIds, reasons, scheduleKnown: !warnings.some((w) => SCHEDULE_UNKNOWN.test(w)) }
}

/** The whole-lineup time-of-day guesses that a known schedule replaces. */
const TIME_WINDOW_POLICIES: ReadonlySet<string> = new Set(['football_weekly', 'soccer_matchday', 'daily_slate'])

export async function resolveSpecialtyLineupGuard(
  leagueId: string,
  rosterId: string,
  leagueVariant: string | null | undefined,
): Promise<{ blocked: boolean; reason?: string }> {
  const spec = getSpecialtySpecByVariant(leagueVariant ?? null)
  if (!spec?.rosterGuard) return { blocked: false }
  try {
    const canAct = await spec.rosterGuard(leagueId, rosterId)
    if (canAct) return { blocked: false }
    return {
      blocked: true,
      reason: 'Specialty league rules prevent lineup changes right now.',
    }
  } catch {
    return { blocked: false }
  }
}

/**
 * Persist lock snapshot for roster/week (cache for clients and audits).
 */
export async function upsertAfLineupLockState(input: {
  leagueId: string
  rosterId: string
  season: number
  week: number
  globalLocked: boolean
  lockedPlayerIds: string[]
  policy: string
  reason?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  await prisma.afLineupLockState.upsert({
    where: {
      rosterId_season_week: {
        rosterId: input.rosterId,
        season: input.season,
        week: input.week,
      },
    },
    create: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      season: input.season,
      week: input.week,
      globalLocked: input.globalLocked,
      lockedPlayerIds: input.lockedPlayerIds,
      policy: input.policy,
      reason: input.reason ?? null,
      metadata: toPrismaNullableJsonInput(input.metadata),
    },
    update: {
      globalLocked: input.globalLocked,
      lockedPlayerIds: input.lockedPlayerIds,
      policy: input.policy,
      reason: input.reason ?? null,
      metadata: toPrismaNullableJsonInput(input.metadata),
      computedAt: new Date(),
    },
  })
}

const LOCK_WEEK_TTL_MS = 60_000
const lockWeekCache = new Map<string, { at: number; week: number | null }>()

/**
 * The week the league is actually playing, for the lock: the roster's redraft season, read the way
 * every other reader reads it (`resolveEffectiveRedraftWeek` — a native season's own week, an imported
 * one's from the schedule). Null when there is no redraft season or it cannot be read; the caller's
 * week then stands. Cached a minute per roster, since the automations resolve locks roster by roster.
 */
async function resolveCurrentLockWeek(leagueId: string, rosterId: string, nowMs: number): Promise<number | null> {
  const hit = lockWeekCache.get(rosterId)
  if (hit && nowMs - hit.at < LOCK_WEEK_TTL_MS) return hit.week
  let week: number | null = null
  try {
    const [roster, league] = await Promise.all([
      prisma.roster.findUnique({ where: { id: rosterId }, select: { redraftRosterId: true } }),
      prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } }),
    ])
    if (roster?.redraftRosterId && league) {
      const redraft = await prisma.redraftRoster.findUnique({
        where: { id: roster.redraftRosterId },
        select: { season: { select: { id: true, currentWeek: true } } },
      })
      if (redraft?.season) week = await resolveEffectiveRedraftWeek(redraft.season, league.platform)
    }
  } catch {
    week = null
  }
  lockWeekCache.set(rosterId, { at: nowMs, week })
  return week
}

export function clearLineupLockWeekCache(): void {
  lockWeekCache.clear()
}

/*
 * 🛑 EVERY LOCK PATH BUT ONE READ THE WEEK FROM `League.settings`, AND THAT IS NOT WHERE THE WEEK IS
 * (2026-11-25). The native lineup screen, its save, the lock-state route, Chimmy's lineup action, the
 * lineup automations and waiver eligibility all passed `settings.currentWeek` as the league week — and the
 * schedule lock below locks each player against THAT week's games. Measured on production the night
 * before the Wednesday NFL game of 2026 week 12:
 *
 *     hosted (manual) NFL leagues   7 of 7 with NO settings week  -> read as week 1   (season says 12)
 *     Sleeper NFL leagues           696 of 795 at settings week 11, the rest 1, 8, 10 or 12
 *
 * Week 1's games are all long finished, so a hosted league's lock "found" every player's game started and
 * locked the whole roster; and had a settings week ever lagged to the week before a midweek game, that
 * game's players would have been checked against last week's slate. The redraft lineup route already
 * read the right week (`resolveEffectiveRedraftWeek`); now every path does, here, once.
 *
 * A caller asking about "the current week" (editing week == the week it passed as current) is moved to
 * the real current week with it; one asking about another week explicitly keeps that week.
 */
async function withCurrentLockWeek(args: LineupLockResolveArgs, now: Date): Promise<LineupLockResolveArgs> {
  const current = await resolveCurrentLockWeek(args.leagueId, args.rosterId, now.getTime())
  if (current == null || current === args.leagueWeek) return args
  return {
    ...args,
    leagueWeek: current,
    editingWeek: args.editingWeek === args.leagueWeek ? current : args.editingWeek,
  }
}

/**
 * The players whose game this week has started, from the schedule, at the league's real current week —
 * for a path that moves players without a lineup save (a waiver or free-agent drop). Null when the
 * schedule could not be read or the sport has no schedule lock; the caller keeps its own fallback.
 */
export async function resolveScheduleLockedPlayerIds(
  input: Pick<LineupLockResolveArgs, 'leagueId' | 'rosterId' | 'sport' | 'leagueVariant' | 'settings' | 'season' | 'leagueWeek' | 'now'>,
): Promise<string[] | null> {
  const now = input.now ?? new Date()
  try {
    const args = await withCurrentLockWeek({ ...input, editingWeek: input.leagueWeek, playerData: null }, now)
    const weekly = await resolveDailySportWeeklyLocks(args, now)
    return weekly ? weekly.lockedPlayerIds : null
  } catch (err) {
    console.warn('[lineupLockService] schedule locks unavailable:', err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function resolveFullLineupLockContext(rawArgs: LineupLockResolveArgs): Promise<LineupLockContext> {
  const now = rawArgs.now ?? new Date()
  const args = await withCurrentLockWeek(rawArgs, now)
  const nbaSurvivor = args.sport.toUpperCase() === 'NBA' && String(args.leagueVariant ?? '').toLowerCase() === 'survivor'
  const dailyLineups = isDailyLineupScoringEnabled(args.settings, args.sport)
  const base: LineupLockResult = evaluateLineupLock({
    sport: args.sport,
    now,
    leagueWeek: args.leagueWeek,
    editingWeek: args.editingWeek,
    dailyLineups,
  })

  const concept = resolveConceptRosterLineupRules(args.settings)
  let locked = nbaSurvivor && args.editingWeek === args.leagueWeek ? false : base.locked
  let reason = locked ? base.reason : undefined
  let policy: string = nbaSurvivor && args.editingWeek === args.leagueWeek ? 'nba_first_game_weekly' : base.policy

  if (args.lifecycleState === 'archived' || args.lifecycleState === 'completed') {
    locked = true
    reason = 'League season is complete.'
    policy = 'lifecycle'
  }

  if (args.lockAllMoves) {
    locked = true
    reason = 'All roster moves are locked by the commissioner.'
    policy = 'league_lock_all'
  }

  if (concept.freezeStarters) {
    locked = true
    reason = reason ?? 'Starters are frozen for this specialty phase.'
    policy = 'concept_freeze'
  }

  const specialty = await resolveSpecialtyLineupGuard(args.leagueId, args.rosterId, args.leagueVariant)
  let specialtyBlocksMoves = false
  if (specialty.blocked) {
    specialtyBlocksMoves = true
    locked = true
    reason = specialty.reason ?? reason
    policy = 'specialty_guard'
  }

  let kick = nbaSurvivor && args.editingWeek === args.leagueWeek
    ? await resolveNbaSurvivorGameDayLocks(args, now)
    : computePerPlayerKickoffLocks(args.playerData, now)
  if (!nbaSurvivor) {
    // Schedule-derived weekly locks for daily sports, added to (never replacing) the kickoff heuristic.
    // A schedule read that fails keeps the previous behaviour rather than blocking every save.
    let weeklyFailed = false
    const weekly = await resolveDailySportWeeklyLocks(args, now).catch((err: unknown) => {
      console.warn('[lineupLockService] daily-sport weekly locks unavailable:', err instanceof Error ? err.message : String(err))
      weeklyFailed = true
      return null
    })
    /*
     * 🛑 A DAILY-LINEUP LEAGUE HAS NO WHOLE-LINEUP WINDOW TO FALL BACK ON (`dailyLineups` above), so
     * the schedule-derived lock is its ONLY lock. Failing open here would let a player who has
     * already played today be moved out of today's lineup. Refuse the save until it can be checked.
     */
    const scheduleSport = SCHEDULE_LOCK_SPORTS.has(args.sport.toUpperCase())
    if (weeklyFailed && scheduleSport && args.editingWeek >= args.leagueWeek) {
      // The schedule lock is the lock now, in every sport: failing open would let a player whose game
      // has started be moved. Refuse the save until the start times can be read.
      locked = true
      reason = "Game start times could not be checked, so lineup changes are paused. Try again in a minute."
      policy = 'schedule_lock_unavailable'
    } else if (weekly?.scheduleKnown && locked && TIME_WINDOW_POLICIES.has(policy)) {
      /*
       * A known schedule replaces the time-of-day guess. The football window locked EVERY player from
       * Sunday 1 PM ET to Tuesday, so a Sunday-night or Monday-night starter could not be swapped before
       * his game; the owner's rule is per player — only those whose game has started are locked.
       */
      locked = false
      reason = undefined
      policy = 'per_player_schedule'
    }
    if (weekly && weekly.lockedPlayerIds.length > 0) {
      const ids = new Set(kick.lockedPlayerIds)
      const reasons = { ...kick.reasons }
      for (const id of weekly.lockedPlayerIds) {
        ids.add(id)
        reasons[id] = reasons[id] ?? weekly.reasons[id]
      }
      kick = { lockedPlayerIds: [...ids], reasons }
    }
  }

  return {
    locked,
    reason,
    policy,
    globalLocked: locked,
    lockedPlayerIds: kick.lockedPlayerIds,
    perPlayerReasons: kick.reasons,
    leagueBlocksMoves: Boolean(args.lockAllMoves) || args.lifecycleState === 'archived',
    specialtyBlocksMoves,
  }
}

export async function loadLeagueWeekContext(leagueId: string, settings: unknown, seasonFallback: number) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true, settings: true },
  })
  const season = league?.season ?? seasonFallback
  const week = weekFromSettings(settings ?? league?.settings)
  return { season, week }
}
