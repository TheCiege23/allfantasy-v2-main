/**
 * Fantasy OS Phase 5C — gateway-backed runtime consumer ports (Parts 4 & 6).
 *
 * The context ASSEMBLY is pure + fully testable; the DB port classes are thin (read certified snapshots via the
 * repository, then assemble). These ENRICH the existing deterministic Trade/Lineup engines with canonical sports
 * facts — they never override lock or scoring authority. Fail closed: unresolved identity ⇒ Insufficient Evidence,
 * missing schedule ⇒ lock `unknown` (no auto-switch), missing projection stays `null` (never 0).
 */
import type { SportsDataContext } from '../contracts'
import { computeLockStatus, type LockStatus } from '../runtime/lock'

/** The certified player fields these ports consume (a subset of the stored canonical record). */
export type CertifiedPlayerRecord = {
  canonicalPlayerId: string
  displayName: string
  sport: string
  positions: string[]
  teamId: string | null
  injuryStatus: string | null
  active: boolean
}

export type PlayerGameFacts = { gameId: string | null; scheduledStart: string | null; gameStatus: string | null; opponentTeamId: string | null } | null

export function isResolved(canonicalPlayerId: string): boolean {
  return Boolean(canonicalPlayerId) && !canonicalPlayerId.startsWith('unresolved:')
}

// ── Lineup / Start-Sit (Part 6) ─────────────────────────────────────────────────
export type LineupPlayerSportsContext = {
  canonicalPlayerId: string
  gameId: string | null
  scheduledStart: string | null
  gameStatus: string | null
  lockStatus: LockStatus
  injuryStatus: string | null
  activeStatus: string | null
  projectedFantasyPoints: number | null
  weatherRisk: string | null
  snapshotVersion: string
  dataContext: SportsDataContext
}

export function assembleLineupContext(input: {
  player: CertifiedPlayerRecord
  game: PlayerGameFacts
  now: Date
  freshness: SportsDataContext
  lockOffsetMinutes?: number
}): LineupPlayerSportsContext {
  const lockStatus = computeLockStatus({
    scheduledStart: input.game?.scheduledStart ?? null,
    gameStatus: input.game?.gameStatus ?? null,
    now: input.now,
    lockOffsetMinutes: input.lockOffsetMinutes,
  })
  return {
    canonicalPlayerId: input.player.canonicalPlayerId,
    gameId: input.game?.gameId ?? null,
    scheduledStart: input.game?.scheduledStart ?? null,
    gameStatus: input.game?.gameStatus ?? null,
    lockStatus, // 'unknown' when schedule is missing → auto-switch must fail closed
    injuryStatus: input.player.injuryStatus,
    activeStatus: input.player.active ? 'active' : 'inactive',
    projectedFantasyPoints: null, // no projections capability certified yet — never defaulted to 0
    weatherRisk: null, // no weather capability certified yet
    snapshotVersion: input.freshness.snapshotVersions[0] ?? 'unavailable',
    dataContext: input.freshness,
  }
}

// ── Trade (Part 4) ──────────────────────────────────────────────────────────────
export type TradePlayerSportsContext = {
  canonicalPlayerId: string
  displayName: string
  sport: string
  positions: string[]
  teamId: string | null
  injuryStatus: string | null
  activeStatus: string | null
  recentStats: Record<string, number | null>
  projection: number | null
  upcomingGame: { gameId: string | null; startTime: string | null; opponentTeamId: string | null }
  snapshotVersion: string
  dataContext: SportsDataContext
}

export type TradeContextResult = { resolved: true; context: TradePlayerSportsContext } | { resolved: false; reason: 'Insufficient Evidence'; dataContext: SportsDataContext }

export function assembleTradeContext(input: { player: CertifiedPlayerRecord; game: PlayerGameFacts; freshness: SportsDataContext }): TradeContextResult {
  if (!isResolved(input.player.canonicalPlayerId)) {
    return { resolved: false, reason: 'Insufficient Evidence', dataContext: input.freshness }
  }
  return {
    resolved: true,
    context: {
      canonicalPlayerId: input.player.canonicalPlayerId,
      displayName: input.player.displayName,
      sport: input.player.sport,
      positions: input.player.positions,
      teamId: input.player.teamId,
      injuryStatus: input.player.injuryStatus,
      activeStatus: input.player.active ? 'active' : 'inactive',
      recentStats: {}, // no statistics capability certified yet — empty, never fabricated zeros
      projection: null, // no projections capability certified yet — null, never 0
      upcomingGame: { gameId: input.game?.gameId ?? null, startTime: input.game?.scheduledStart ?? null, opponentTeamId: input.game?.opponentTeamId ?? null },
      snapshotVersion: input.freshness.snapshotVersions[0] ?? 'unavailable',
      dataContext: input.freshness,
    },
  }
}
