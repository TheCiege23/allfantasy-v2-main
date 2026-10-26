/**
 * A player a team drops goes ON WAIVERS for the league's waiver period (`League.waiverHours`, the
 * hub's "Waiver period"), and only then becomes a free agent. While he is on waivers:
 *   - nobody can add him as a free agent — the add/drop route answers WAIVER_REQUIRED and the screen
 *     opens the claim form instead;
 *   - a claim on him is accepted and stays pending: it runs at the FIRST waiver run after his hold
 *     ends (`until`), never earlier, and there competes with the other claims on him in the league's
 *     own order (FAAB, rolling, reverse standings — the processor's `orderClaimsForProcessing`);
 *   - once he clears, a pending claim on him still keeps him off the free-agent list until that run
 *     (the add/drop route), so the claims are not beaten to him by a first-come add;
 *   - the team that dropped him cannot claim him back.
 *
 * The drop is read from `WaiverTransaction.dropPlayerId` / `processedAt`, which every native drop
 * writes: the instant add/drop (free-agent-service.ts) and an awarded claim (process-engine.ts).
 * Trades move players between rosters and free nobody, and there is no commissioner remove-player
 * path on the waiver wire, so neither needs a hold of its own.
 *
 * FCFS leagues — the "Free agency only" preset among them — and a 0-hour waiver period have no
 * waiver period at all: a dropped player is a free agent at once, exactly as before.
 *
 * PER PLAYER TYPE. A commissioner can give a position its own period
 * (`waiverEngineConfig.dropped_player_hold_hours_by_position`, the hub's "Waiver period by
 * position"), e.g. kickers and defenses clear in 0 hours while everyone else waits 24. A position
 * not listed uses the league period; a position can be longer than it as well as shorter. In football
 * leagues an IDP group key (DL, LB, DB) covers the detailed positions the canonical position service
 * puts in it, and DST / D/ST read as DEF and PK as K.
 * The position is read from the player tables; a player whose position cannot be found takes the
 * league period. FCFS still has no hold for anyone.
 */
import { prisma } from '@/lib/prisma'
import { droppedPlayerHoldPolicy, holdHoursForPosition, maxHoldHours, type DroppedPlayerHoldPolicy } from './hold-by-position'

export {
  HOLD_HOURS_BY_POSITION_KEY,
  MAX_HOLD_HOURS,
  droppedPlayerHoldPolicy,
  droppedPlayerWaiverHours,
  holdHoursForPosition,
  maxHoldHours,
  normalizeHoldPosition,
  parseHoldHoursByPositionInput,
  readHoldHoursByPosition,
  type DroppedPlayerHoldPolicy,
} from './hold-by-position'

export const DROPPED_PLAYER_ON_WAIVERS_MESSAGE =
  'This player was dropped recently and is on waivers until he clears. Submit a claim; it runs at the first waiver run after he clears.'

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

/**
 * The live holds, one per player, from drop rows in any order: the LATEST drop of a player decides,
 * and a drop older than the period is no hold.
 */
export function activeDropHolds(
  rows: ReadonlyArray<{ dropPlayerId: string | null; processedAt: Date | string; rosterId: string }>,
  now: Date,
  hours: number | ((playerId: string) => number),
): Map<string, DroppedPlayerHold> {
  const out = new Map<string, DroppedPlayerHold>()
  const hoursFor = typeof hours === 'number' ? () => hours : hours
  if (typeof hours === 'number' && !(hours > 0)) return out
  for (const row of rows) {
    if (!row.dropPlayerId) continue
    const droppedAt = new Date(row.processedAt)
    if (!Number.isFinite(droppedAt.getTime())) continue
    const prev = out.get(row.dropPlayerId)
    if (prev && prev.droppedAt >= droppedAt) continue
    const h = hoursFor(row.dropPlayerId)
    out.set(row.dropPlayerId, {
      playerId: row.dropPlayerId,
      droppedAt,
      until: new Date(droppedAt.getTime() + (h > 0 ? h : 0) * 3_600_000),
      droppedByRosterId: row.rosterId,
    })
  }
  for (const [id, hold] of out) if (hold.until <= now) out.delete(id)
  return out
}

/** The league's whole policy, from the League row and the effective waiver settings. */
export async function loadDroppedPlayerHoldPolicy(
  leagueId: string,
  settings: { normalizedWaiverType: string | null | undefined; waiverEngineConfig?: unknown },
): Promise<DroppedPlayerHoldPolicy> {
  if (settings.normalizedWaiverType === 'fcfs') return droppedPlayerHoldPolicy({ normalizedWaiverType: 'fcfs', waiverHours: 0 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { waiverHours: true, sport: true } })
  return droppedPlayerHoldPolicy({
    normalizedWaiverType: settings.normalizedWaiverType,
    waiverHours: league?.waiverHours ?? null,
    waiverEngineConfig: settings.waiverEngineConfig,
    sport: league?.sport ? String(league.sport) : null,
  })
}

/**
 * The positions of dropped players, by the id the drop recorded. A roster stores whichever id the
 * player was added by, so it is matched as a SportsPlayer id, external id or Sleeper id, then as a
 * Player id. Ids not found are absent (they take the league period). A failed read throws.
 */
export async function loadDroppedPlayerPositions(ids: readonly string[], sport: string | null | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const list = [...ids]
  const sportWhere = sport ? { sport: String(sport).toUpperCase() } : {}
  const sportsRows = (await prisma.sportsPlayer.findMany({
    where: { ...sportWhere, OR: [{ id: { in: list } }, { externalId: { in: list } }, { sleeperId: { in: list } }] },
    select: { id: true, externalId: true, sleeperId: true, position: true },
  })) as Array<{ id: string; externalId: string | null; sleeperId: string | null; position: string | null }>
  const wanted = new Set(list)
  for (const r of sportsRows) {
    if (!r.position) continue
    for (const key of [r.id, r.externalId, r.sleeperId]) {
      if (key && wanted.has(key) && !out.has(key)) out.set(key, r.position)
    }
  }
  const missing = list.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const players = (await prisma.player.findMany({ where: { id: { in: missing } }, select: { id: true, position: true } })) as Array<{
      id: string
      position: string | null
    }>
    for (const p of players) if (p.position) out.set(p.id, p.position)
  }
  return out
}

/**
 * The live holds in a league, optionally only for `playerIds`. Takes the league period alone (every
 * player alike) or the whole policy (per-position periods).
 */
export async function loadDroppedPlayerHolds(
  leagueId: string,
  hoursOrPolicy: number | DroppedPlayerHoldPolicy,
  opts: { now?: Date; playerIds?: readonly string[] } = {},
): Promise<Map<string, DroppedPlayerHold>> {
  const now = opts.now ?? new Date()
  const policy: DroppedPlayerHoldPolicy =
    typeof hoursOrPolicy === 'number' ? { hours: hoursOrPolicy, byPosition: {} } : hoursOrPolicy
  const window = maxHoldHours(policy)
  if (!(window > 0)) return new Map()
  if (opts.playerIds && opts.playerIds.length === 0) return new Map()
  const rows = await prisma.waiverTransaction.findMany({
    where: {
      leagueId,
      dropPlayerId: opts.playerIds ? { in: [...opts.playerIds] } : { not: null },
      processedAt: { gte: new Date(now.getTime() - window * 3_600_000) },
    },
    select: { dropPlayerId: true, processedAt: true, rosterId: true },
  })
  if (Object.keys(policy.byPosition).length === 0) return activeDropHolds(rows, now, policy.hours)
  const ids = [...new Set(rows.map((r) => r.dropPlayerId).filter((id): id is string => Boolean(id)))]
  const positions = await loadDroppedPlayerPositions(ids, policy.sport)
  return activeDropHolds(rows, now, (id) => holdHoursForPosition(policy, positions.get(id)))
}

/** The hold on one player, or null when he is not on waivers. */
export async function loadDroppedPlayerHold(
  leagueId: string,
  playerId: string,
  hoursOrPolicy: number | DroppedPlayerHoldPolicy,
  now: Date = new Date(),
): Promise<DroppedPlayerHold | null> {
  const holds = await loadDroppedPlayerHolds(leagueId, hoursOrPolicy, { now, playerIds: [playerId] })
  return holds.get(playerId) ?? null
}
