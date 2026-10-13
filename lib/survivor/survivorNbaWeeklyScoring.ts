import 'server-only'

import { prisma } from '@/lib/prisma'
import { readWeekGames, type WeekGameRow } from '@/lib/redraft/weekGames'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { calculateScoreFromSportConfig, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { nbaTeamKey } from '@/lib/roster-lineup-engine/lineupLockService'
import { readLineupLockSettings } from '@/lib/redraft/lineupLock'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

type GameOption = { gameKey: string; startAt: string; opponent: string; homeTeam: string | null; awayTeam: string | null }
type PlayerOption = { playerId: string; playerName: string; position: string; team: string | null; games: GameOption[]; selectedGameKey: string | null; countingGameKey: string | null; canChange: boolean }

function gameKey(game: WeekGameRow): string {
  return `${game.startTime?.toISOString() ?? ''}:${nbaTeamKey(game.homeTeam)}:${nbaTeamKey(game.awayTeam)}`
}

function gamesForTeam(games: WeekGameRow[], team: string | null, acquiredAt?: Date): WeekGameRow[] {
  const key = nbaTeamKey(team)
  if (!key) return []
  return games.filter(game => game.startTime && (!acquiredAt || game.startTime > acquiredAt) && (nbaTeamKey(game.homeTeam) === key || nbaTeamKey(game.awayTeam) === key))
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime())
}

function readPickState(value: unknown): { playerId: string; gameKey: string; startAt: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Record<string, unknown>
  return typeof state.playerId === 'string' && typeof state.gameKey === 'string' && typeof state.startAt === 'string'
    ? { playerId: state.playerId, gameKey: state.gameKey, startAt: state.startAt }
    : null
}

async function loadRosterWeek(leagueId: string, legacyRosterId: string, week: number, now: Date) {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, survivorMode: true, settings: true } }),
    prisma.roster.findFirst({ where: { id: legacyRosterId, leagueId }, select: { redraftRosterId: true, platformUserId: true } }),
  ])
  if (!league?.survivorMode || league.sport !== 'NBA' || !roster?.redraftRosterId || !roster.platformUserId) return null
  const window = resolveDailySportWeekWindow('NBA', league.season, week)
  if (!window) return null
  const [games, players, picks] = await Promise.all([
    readWeekGames(prisma, { sport: 'NBA', season: league.season, week, seasonType: 'regular', dateWindow: window, now }),
    prisma.redraftRosterPlayer.findMany({ where: { rosterId: roster.redraftRosterId, droppedAt: null }, select: { playerId: true, playerName: true, position: true, team: true, sport: true, slotType: true, addedAt: true } }),
    prisma.survivorCommissionerAction.findMany({ where: { leagueId, week, actionType: 'nba_game_pick', targetUserId: roster.platformUserId }, select: { newState: true } }),
  ])
  const pickByPlayer = new Map(picks.map(pick => readPickState(pick.newState)).filter((pick): pick is NonNullable<typeof pick> => Boolean(pick)).map(pick => [pick.playerId, pick]))
  return { league, roster, games, players, pickByPlayer }
}

export async function getNbaSurvivorGameOptions(input: { leagueId: string; rosterId: string; week: number; now?: Date }): Promise<{ ok: true; season: number; week: number; players: PlayerOption[] } | { ok: false; error: string }> {
  const now = input.now ?? new Date()
  const week = await loadRosterWeek(input.leagueId, input.rosterId, input.week, now)
  if (!week) return { ok: false, error: 'NBA Survivor roster or verified week calendar is unavailable.' }
  const players: PlayerOption[] = week.players.map(player => {
    const fixtures = gamesForTeam(week.games, player.team, player.addedAt)
    const pick = week.pickByPlayer.get(player.playerId)
    const chosen = fixtures.find(game => gameKey(game) === pick?.gameKey) ?? null
    const first = fixtures[0] ?? null
    const counting = pick ? chosen : first
    return {
      playerId: player.playerId, playerName: player.playerName, position: player.position, team: player.team,
      games: fixtures.map(game => ({ gameKey: gameKey(game), startAt: game.startTime!.toISOString(),
        opponent: nbaTeamKey(game.homeTeam) === nbaTeamKey(player.team) ? nbaTeamKey(game.awayTeam) : nbaTeamKey(game.homeTeam),
        homeTeam: game.homeTeam, awayTeam: game.awayTeam })),
      selectedGameKey: chosen ? gameKey(chosen) : null,
      countingGameKey: counting ? gameKey(counting) : null,
      canChange: Boolean((counting?.startTime ?? first?.startTime) && (counting?.startTime ?? first?.startTime)! > now),
    }
  })
  return { ok: true, season: week.league.season, week: input.week, players }
}

export async function saveNbaSurvivorGamePick(input: { leagueId: string; rosterId: string; userId: string; week: number; playerId: string; gameKey: string; now?: Date }): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date()
  const week = await loadRosterWeek(input.leagueId, input.rosterId, input.week, now)
  if (!week || week.roster.platformUserId !== input.userId) return { ok: false, error: 'Only this roster’s manager may choose a game.' }
  const player = week.players.find(row => row.playerId === input.playerId)
  if (!player) return { ok: false, error: 'This player is no longer on your roster.' }
  const fixtures = gamesForTeam(week.games, player.team, player.addedAt)
  const chosen = fixtures.find(game => gameKey(game) === input.gameKey)
  if (!chosen?.startTime) return { ok: false, error: 'Choose a scheduled game for this player’s team this week.' }
  const existing = week.pickByPlayer.get(player.playerId)
  const currentStart = existing ? fixtures.find(game => gameKey(game) === existing.gameKey)?.startTime ?? fixtures[0]?.startTime : fixtures[0]?.startTime
  if (!currentStart || currentStart <= now || chosen.startTime <= now) return { ok: false, error: 'This player’s counting game has started; the weekly choice is locked.' }
  const id = `nba-game-pick:${input.leagueId}:${week.league.season}:${input.week}:${player.playerId}`
  return withSurvivorSetupTransaction(input.leagueId, async tx => {
    const previous = await tx.survivorCommissionerAction.findUnique({ where: { id }, select: { newState: true } })
    const selected = readPickState(previous?.newState)
    const originalStart = selected ? fixtures.find(game => gameKey(game) === selected.gameKey)?.startTime ?? fixtures[0]?.startTime : fixtures[0]?.startTime
    if (!originalStart || originalStart <= new Date() || chosen.startTime <= new Date()) return { ok: false as const, error: 'This player’s counting game has started; the weekly choice is locked.' }
    const newState = { playerId: player.playerId, gameKey: input.gameKey, startAt: chosen.startTime.toISOString(), rosterId: input.rosterId, selectedBy: input.userId }
    await tx.survivorCommissionerAction.upsert({ where: { id },
      create: { id, leagueId: input.leagueId, commissionerId: input.userId, week: input.week, actionType: 'nba_game_pick', targetUserId: input.userId, description: 'Manager selected an NBA counting game.', newState, wasConfirmed: true },
      update: { previousState: previous?.newState ?? undefined, newState, executedAt: new Date() },
    })
    return { ok: true as const }
  })
}

export async function scoreNbaSurvivorOneGameRoster(input: { leagueId: string; legacyRosterId: string; week: number; season: number }): Promise<{ pts: number; allFinalized: boolean }> {
  const week = await loadRosterWeek(input.leagueId, input.legacyRosterId, input.week, new Date())
  if (!week || week.league.season !== input.season || week.games.length === 0) return { pts: 0, allFinalized: false }
  const lineups = await loadWeekLineups(prisma, { redraftRosterIds: [week.roster.redraftRosterId!], season: input.season, week: input.week })
  const starters = week.players.filter(player => isScoringStarterSlot(weekSlotType(player, lineups)))
  if (!starters.length) return { pts: 0, allFinalized: false }
  let points = 0
  let allFinalized = true
  for (const player of starters) {
    const fixtures = gamesForTeam(week.games, player.team, player.addedAt)
    const pick = week.pickByPlayer.get(player.playerId)
    const fixture = pick ? fixtures.find(game => gameKey(game) === pick.gameKey) : fixtures[0]
    if (!fixture?.startTime) { allFinalized = false; continue }
    const weekly = await prisma.playerWeeklyScore.findUnique({ where: { playerId_week_season_sport: { playerId: player.playerId, week: input.week, season: input.season, sport: 'NBA' } }, select: { isFinalized: true } })
    if (!weekly?.isFinalized) { allFinalized = false; continue }
    const gameDate = easternCalendarDay(fixture.startTime)
    if (!gameDate) { allFinalized = false; continue }
    const stats = await prisma.playerGameStat.findMany({ where: { playerId: player.playerId, sportType: 'NBA', season: input.season, gameDate }, select: { normalizedStatMap: true, team: true, opponent: true, gameId: true } })
    const team = nbaTeamKey(player.team)
    const opponent = nbaTeamKey(fixture.homeTeam) === team ? nbaTeamKey(fixture.awayTeam) : nbaTeamKey(fixture.homeTeam)
    const matched = stats.filter(row => nbaTeamKey(row.team) === team && nbaTeamKey(row.opponent) === opponent)
    if (matched.length > 1) { allFinalized = false; continue }
    // A player with a finalized weekly row but no line in the chosen game did
    // not play that game; the choice scores zero rather than a later game.
    if (matched.length === 1) points += await calculateScoreFromSportConfig(input.leagueId, player.playerId, input.week, matched[0].normalizedStatMap as Record<string, number>, player.position)
  }
  return { pts: Math.round(points * 100) / 100, allFinalized }
}

/** Keep the native redraft roster GET and PUT aligned with the selected game. */
export async function applyNbaSurvivorPickLineupLocks<T extends { playerId: string; isLocked?: boolean | null }>(input: {
  leagueId: string; redraftRosterId: string; week: number; settings: unknown; players: T[]
}): Promise<T[]> {
  if (normalizeSurvivorFoundationSettings(input.settings as Record<string, unknown>).nbaWeeklyScoringMode !== 'one_game_per_player') return input.players
  if (readLineupLockSettings(input.settings).mode !== 'per_player_kickoff') return input.players
  const legacy = await prisma.roster.findFirst({ where: { leagueId: input.leagueId, redraftRosterId: input.redraftRosterId }, select: { id: true } })
  if (!legacy) throw new Error('NBA Survivor lineup lock requires its linked league roster.')
  const options = await getNbaSurvivorGameOptions({ leagueId: input.leagueId, rosterId: legacy.id, week })
  if (!options.ok) throw new Error(options.error)
  const byPlayer = new Map(options.players.map(row => [row.playerId, row]))
  return input.players.map(player => {
    const option = byPlayer.get(player.playerId)
    return option?.countingGameKey ? { ...player, isLocked: !option.canChange } : player
  })
}
