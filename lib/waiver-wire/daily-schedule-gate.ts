/**
 * Loads the per-day waiver schedule's transaction policy for a league (lib/waivers/dailyWaiverSchedule.ts)
 * and the after-drop waiver hold. Used by the claim service and the add/drop route.
 *
 * Returns null when the league has no ENABLED daily schedule: every caller then keeps its existing
 * rules, byte for byte.
 */
import { prisma } from '@/lib/prisma'
import {
  readDailyWaiverScheduleFromSettings,
  resolveDailyTransactionPolicy,
  isWithinDropHold,
  DAILY_DROP_HOLD_MESSAGE,
  type DailyTransactionPolicy,
} from '@/lib/waivers/dailyWaiverSchedule'
import { getLeagueWaiverState } from './waiver-state-service'

export type LoadedDailyPolicy = {
  policy: DailyTransactionPolicy
  /** After-drop waiver period in hours (`League.waiverHours`). */
  holdHours: number
}

export async function loadDailyTransactionPolicy(
  leagueId: string,
  now: Date = new Date(),
): Promise<LoadedDailyPolicy | null> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { settings: true, timezone: true, waiverHours: true },
  })
  const schedule = readDailyWaiverScheduleFromSettings(league?.settings)
  if (!league || !schedule?.enabled) return null

  const [state, pendingClaimCount] = await Promise.all([
    getLeagueWaiverState(leagueId).catch(() => null),
    (prisma as any).waiverClaim.count({ where: { leagueId, status: 'pending' } }).catch(() => 0),
  ])
  const lastRunAt = state?.lastRunAt ? new Date(state.lastRunAt) : null
  const policy = resolveDailyTransactionPolicy(schedule, now, league.timezone, {
    lastRunAt,
    pendingClaimCount: Number(pendingClaimCount) || 0,
  })
  if (!policy) return null
  return { policy, holdHours: typeof league.waiverHours === 'number' ? league.waiverHours : 0 }
}

/** True when `playerId` was dropped in this league inside the after-drop waiver period. */
export async function isPlayerInDropHold(
  leagueId: string,
  playerId: string,
  holdHours: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (!holdHours || holdHours <= 0) return false
  const since = new Date(now.getTime() - holdHours * 3_600_000)
  const recent = await (prisma as any).waiverTransaction.findFirst({
    where: { leagueId, dropPlayerId: playerId, processedAt: { gte: since } },
    orderBy: { processedAt: 'desc' },
    select: { processedAt: true },
  })
  return isWithinDropHold(recent?.processedAt ? new Date(recent.processedAt) : null, now, holdHours)
}

/**
 * The immediate-add decision under a daily schedule: null = allowed, else the refusal message
 * (locked day, waiver day, before today's run cleared, or the player is still in the drop hold).
 */
export async function dailyScheduleImmediateAddRefusal(
  leagueId: string,
  loaded: LoadedDailyPolicy,
  addPlayerId: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!loaded.policy.immediateAddsAllowed) return loaded.policy.immediateRefusal
  const held = await isPlayerInDropHold(leagueId, addPlayerId, loaded.holdHours, now).catch(() => false)
  return held ? DAILY_DROP_HOLD_MESSAGE : null
}
