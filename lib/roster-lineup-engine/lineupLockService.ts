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

export async function resolveFullLineupLockContext(args: LineupLockResolveArgs): Promise<LineupLockContext> {
  const now = args.now ?? new Date()
  const nbaSurvivor = args.sport.toUpperCase() === 'NBA' && String(args.leagueVariant ?? '').toLowerCase() === 'survivor'
  const base: LineupLockResult = evaluateLineupLock({
    sport: args.sport,
    now,
    leagueWeek: args.leagueWeek,
    editingWeek: args.editingWeek,
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

  const kick = nbaSurvivor && args.editingWeek === args.leagueWeek
    ? await resolveNbaSurvivorGameDayLocks(args, now)
    : computePerPlayerKickoffLocks(args.playerData, now)

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
