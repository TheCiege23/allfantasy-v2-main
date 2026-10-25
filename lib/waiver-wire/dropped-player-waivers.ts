/**
 * A player a team drops goes ON WAIVERS for the league's waiver period (`League.waiverHours`, the
 * hub's "Waiver period"), and only then becomes a free agent. While he is on waivers:
 *   - nobody can add him as a free agent — the add/drop route answers WAIVER_REQUIRED and the screen
 *     opens the claim form instead;
 *   - claims on him run in the league's own order (FAAB, rolling, reverse standings — the processor's
 *     `orderClaimsForProcessing`), at the next waiver run;
 *   - the team that dropped him cannot claim him back.
 *
 * The drop is read from `WaiverTransaction.dropPlayerId` / `processedAt`, which every native drop
 * writes: the instant add/drop (free-agent-service.ts) and an awarded claim (process-engine.ts).
 * Trades move players between rosters and free nobody, and there is no commissioner remove-player
 * path on the waiver wire, so neither needs a hold of its own.
 *
 * FCFS leagues — the "Free agency only" preset among them — and a 0-hour waiver period have no
 * waiver period at all: a dropped player is a free agent at once, exactly as before.
 */
import { prisma } from '@/lib/prisma'

export const DROPPED_PLAYER_ON_WAIVERS_MESSAGE =
  'This player was dropped recently and is on waivers until he clears. Submit a claim for the next waiver run.'

export const DROPPER_RECLAIM_MESSAGE =
  'You dropped this player, so you cannot claim him back until he clears waivers.'

export type DroppedPlayerHold = {
  playerId: string
  droppedAt: Date
  /** When he clears waivers and becomes a free agent. */
  until: Date
  /** The generic `Roster.id` that dropped him. */
  droppedByRosterId: string
}

/** The league's after-drop waiver period in hours, or 0 when it has none (FCFS, or 0 hours). */
export function droppedPlayerWaiverHours(input: {
  normalizedWaiverType: string | null | undefined
  waiverHours: number | null | undefined
}): number {
  if (input.normalizedWaiverType === 'fcfs') return 0
  const h = Number(input.waiverHours)
  return Number.isFinite(h) && h > 0 ? h : 0
}

/**
 * The live holds, one per player, from drop rows in any order: the LATEST drop of a player decides,
 * and a drop older than the period is no hold.
 */
export function activeDropHolds(
  rows: ReadonlyArray<{ dropPlayerId: string | null; processedAt: Date | string; rosterId: string }>,
  now: Date,
  hours: number,
): Map<string, DroppedPlayerHold> {
  const out = new Map<string, DroppedPlayerHold>()
  if (!(hours > 0)) return out
  for (const row of rows) {
    if (!row.dropPlayerId) continue
    const droppedAt = new Date(row.processedAt)
    if (!Number.isFinite(droppedAt.getTime())) continue
    const prev = out.get(row.dropPlayerId)
    if (prev && prev.droppedAt >= droppedAt) continue
    out.set(row.dropPlayerId, {
      playerId: row.dropPlayerId,
      droppedAt,
      until: new Date(droppedAt.getTime() + hours * 3_600_000),
      droppedByRosterId: row.rosterId,
    })
  }
  for (const [id, hold] of out) if (hold.until <= now) out.delete(id)
  return out
}

/** The league's waiver period, read from the League column and the effective waiver type. */
export async function loadDroppedPlayerWaiverHours(leagueId: string, normalizedWaiverType: string | null | undefined): Promise<number> {
  if (normalizedWaiverType === 'fcfs') return 0
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { waiverHours: true } })
  return droppedPlayerWaiverHours({ normalizedWaiverType, waiverHours: league?.waiverHours ?? null })
}

/** The live holds in a league, optionally only for `playerIds`. */
export async function loadDroppedPlayerHolds(
  leagueId: string,
  hours: number,
  opts: { now?: Date; playerIds?: readonly string[] } = {},
): Promise<Map<string, DroppedPlayerHold>> {
  const now = opts.now ?? new Date()
  if (!(hours > 0)) return new Map()
  if (opts.playerIds && opts.playerIds.length === 0) return new Map()
  const rows = await prisma.waiverTransaction.findMany({
    where: {
      leagueId,
      dropPlayerId: opts.playerIds ? { in: [...opts.playerIds] } : { not: null },
      processedAt: { gte: new Date(now.getTime() - hours * 3_600_000) },
    },
    select: { dropPlayerId: true, processedAt: true, rosterId: true },
  })
  return activeDropHolds(rows, now, hours)
}

/** The hold on one player, or null when he is not on waivers. */
export async function loadDroppedPlayerHold(
  leagueId: string,
  playerId: string,
  hours: number,
  now: Date = new Date(),
): Promise<DroppedPlayerHold | null> {
  const holds = await loadDroppedPlayerHolds(leagueId, hours, { now, playerIds: [playerId] })
  return holds.get(playerId) ?? null
}
