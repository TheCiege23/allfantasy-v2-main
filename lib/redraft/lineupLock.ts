/**
 * Redraft lineup-lock engine (NFL-first).
 *
 * Closes gap G1: players must lock when their real game kicks off so a manager
 * can't swap a player after their game has started. The lock is DERIVED from the
 * game schedule at request time (not a flag a cron must remember to set), so it
 * is always correct and impossible to "forget".
 *
 * Pure `computeLineupLock` (no DB) is the contract-tested core. `hydrateRedraft
 * LineupLocks` joins the schedule (`SportsGame`, UTC kickoffs, NFL abbreviations)
 * and stamps `isLocked` onto roster players; `lineupValidation` already rejects
 * moving a locked player, so hydrating before validation enforces the lock.
 *
 * Commissioner lock modes (`League.settings.sportConfig.lineupLockType`):
 *   - per_player_kickoff (default) — each player locks at THEIR game's kickoff.
 *   - first_game_of_week          — whole lineup locks at the week's first kickoff.
 *   - manual                      — locked only when the commissioner locks the week.
 * Emergency commissioner unlocks (postponements/data errors) always win.
 */
import type { PrismaClient } from '@prisma/client'

export type LineupLockMode = 'per_player_kickoff' | 'first_game_of_week' | 'manual'

export function resolveLineupLockMode(raw: unknown): LineupLockMode {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'first_game_of_week' || v === 'first_game' || v === 'weekly' || v === 'weekly_first_game') {
    return 'first_game_of_week'
  }
  if (v === 'manual' || v === 'commissioner' || v === 'commissioner_manual') return 'manual'
  return 'per_player_kickoff'
}

export type LockComputeInput = {
  mode: LineupLockMode
  now: Date
  /** This player's game kickoff (UTC). null = bye / no game / unresolved team. */
  playerKickoffUtc?: Date | null
  /** Earliest kickoff of the fantasy week (UTC) — used by first_game_of_week. */
  firstKickoffUtc?: Date | null
  /** Commissioner has manually locked this week (manual mode). */
  manualLocked?: boolean
  /** Commissioner emergency-unlocked this player/roster for the week. */
  emergencyUnlocked?: boolean
}

/**
 * Pure lock decision. Emergency unlock always wins. A null player kickoff (bye /
 * no game / unresolved) is treated as NOT locked (fail-open) so a legitimate
 * lineup edit is never blocked by missing schedule data.
 */
export function computeLineupLock(input: LockComputeInput): boolean {
  if (input.emergencyUnlocked) return false
  switch (input.mode) {
    case 'manual':
      return Boolean(input.manualLocked)
    case 'first_game_of_week': {
      const k = input.firstKickoffUtc
      return k != null && input.now.getTime() >= k.getTime()
    }
    case 'per_player_kickoff':
    default: {
      const k = input.playerKickoffUtc
      if (k == null) return false
      return input.now.getTime() >= k.getTime()
    }
  }
}

/** NFL abbreviation variants → canonical, so player.team matches SportsGame team. */
const NFL_TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX',
  WSH: 'WAS',
  WFT: 'WAS',
  LA: 'LAR',
  STL: 'LAR',
  SD: 'LAC',
  OAK: 'LV',
  LVR: 'LV',
  ARZ: 'ARI',
  KCC: 'KC',
  TBB: 'TB',
  NOR: 'NO',
  GBP: 'GB',
  SFO: 'SF',
  NEP: 'NE',
}

export function normalizeNflTeam(team: string | null | undefined): string {
  const u = String(team ?? '').trim().toUpperCase()
  return NFL_TEAM_ALIASES[u] ?? u
}

export type WeekKickoffs = {
  /** Normalized team abbreviation → earliest kickoff (UTC) that week. */
  byTeam: Map<string, Date>
  /** Earliest kickoff across all games that week (UTC), or null. */
  firstKickoff: Date | null
  warnings: string[]
}

/**
 * Build the per-team kickoff map for one NFL week from `SportsGame`. Prefers rows
 * whose `week` is populated (the espn_live source carries it; api_sports does
 * not), dedups duplicate provider rows to the earliest kickoff per team.
 */
export async function buildWeekKickoffMap(
  prisma: PrismaClient,
  args: { sport: string; season: number; week: number },
): Promise<WeekKickoffs> {
  const warnings: string[] = []
  const byTeam = new Map<string, Date>()
  let firstKickoff: Date | null = null

  if (String(args.sport).toUpperCase() !== 'NFL') {
    warnings.push(`Lineup lock schedule lookup is wired for NFL only; ${args.sport} players are not locked.`)
    return { byTeam, firstKickoff, warnings }
  }

  const games = (await prisma.sportsGame.findMany({
    where: { sport: 'NFL', season: args.season, week: args.week, startTime: { not: null } },
    select: { homeTeam: true, awayTeam: true, startTime: true },
  })) as Array<{ homeTeam: string; awayTeam: string; startTime: Date | null }>

  for (const g of games) {
    if (!g.startTime) continue
    const kickoff = g.startTime
    if (!firstKickoff || kickoff.getTime() < firstKickoff.getTime()) firstKickoff = kickoff
    for (const team of [g.homeTeam, g.awayTeam]) {
      const key = normalizeNflTeam(team)
      if (!key) continue
      const existing = byTeam.get(key)
      if (!existing || kickoff.getTime() < existing.getTime()) byTeam.set(key, kickoff)
    }
  }

  if (games.length === 0) {
    warnings.push(`No NFL games found for season ${args.season} week ${args.week}; lineup locks fall open (no player locked).`)
  }
  return { byTeam, firstKickoff, warnings }
}

type LockOverride = { week?: number; rosterId?: string; playerId?: string }

/** Read lock mode + manual-lock weeks + emergency overrides from league settings. */
export function readLineupLockSettings(leagueSettings: unknown): {
  mode: LineupLockMode
  manualLockedWeeks: Set<number>
  overrides: LockOverride[]
} {
  const settings = (leagueSettings ?? {}) as Record<string, unknown>
  const sc = (settings.sportConfig ?? {}) as Record<string, unknown>
  const mode = resolveLineupLockMode(sc.lineupLockType)
  const manualLockedWeeks = new Set<number>(
    Array.isArray(sc.lineupLockManualWeeks)
      ? (sc.lineupLockManualWeeks as unknown[]).map((w) => Number(w)).filter((w) => Number.isFinite(w))
      : [],
  )
  const overrides: LockOverride[] = Array.isArray(sc.lineupLockOverrides)
    ? (sc.lineupLockOverrides as LockOverride[])
    : []
  return { mode, manualLockedWeeks, overrides }
}

export type LockablePlayer = {
  playerId: string
  team?: string | null
  isLocked?: boolean | null
}

/**
 * Stamp derived `isLocked` onto each roster player for the given week. Reuses the
 * pure `computeLineupLock` so what we test is what enforces. Returns the players
 * with `isLocked` set (other fields untouched) plus any schedule data warnings.
 */
export async function hydrateRedraftLineupLocks<T extends LockablePlayer>(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    rosterId: string
    leagueSettings: unknown
    players: T[]
    now?: Date
  },
): Promise<{ players: T[]; warnings: string[] }> {
  const now = args.now ?? new Date()
  const { mode, manualLockedWeeks, overrides } = readLineupLockSettings(args.leagueSettings)
  const manualLocked = manualLockedWeeks.has(args.week)

  // manual mode needs no schedule; kickoff-based modes do.
  const kickoffs =
    mode === 'manual'
      ? { byTeam: new Map<string, Date>(), firstKickoff: null as Date | null, warnings: [] as string[] }
      : await buildWeekKickoffMap(prisma, { sport: args.sport, season: args.season, week: args.week })

  const players = args.players.map((p) => {
    const emergencyUnlocked = overrides.some(
      (o) =>
        (o.week == null || Number(o.week) === args.week) &&
        (o.rosterId == null || o.rosterId === args.rosterId) &&
        (o.playerId == null || o.playerId === p.playerId),
    )
    const playerKickoffUtc = kickoffs.byTeam.get(normalizeNflTeam(p.team)) ?? null
    const isLocked = computeLineupLock({
      mode,
      now,
      playerKickoffUtc,
      firstKickoffUtc: kickoffs.firstKickoff,
      manualLocked,
      emergencyUnlocked,
    })
    return { ...p, isLocked }
  })

  return { players, warnings: kickoffs.warnings }
}
