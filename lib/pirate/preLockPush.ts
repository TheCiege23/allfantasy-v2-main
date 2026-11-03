import 'server-only'
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { decidePushForUser } from '@/lib/notifications/pushGate'
import { readPiratePreLockAdvice, type PiratePreLockAdvice } from './preLockAdvice'
import { pirateWeekState } from './service'

export const PIRATE_PRE_LOCK_EVENT = 'pirate_pre_lock_lineup'
const CATEGORY = 'pirate_lineup_alerts'
const LEAD_WINDOW = { min: 15 * 60000, max: 120 * 60000 }

function readyAlert(advice: PiratePreLockAdvice | null, now: Date) {
  if (!advice?.issues.length || !advice.moves.length) return null
  const lockAt = Date.parse(advice.deadlineAt)
  const expires = lockAt - LEAD_WINDOW.min
  if (!Number.isFinite(expires) || now.getTime() >= expires || lockAt - now.getTime() > LEAD_WINDOW.max) return null
  const other = advice.issues.length - 1
  return {
    body: `${advice.issues[0]}${other ? ` (+${other} more)` : ''}. A legal lineup option is available.`,
    expiresAt: new Date(expires).toISOString(),
  }
}

/** A manager gets at most one push per weekly lineup or Eastern scoring date. */
export async function queuePiratePreLockPush(leagueId: string, db: PrismaClient, now = new Date()) {
  const state = await pirateWeekState(leagueId, db)
  const owners = await db.redraftRoster.findMany({
    where: { leagueId, seasonId: state.season.id, players: { some: { droppedAt: null } } },
    select: { id: true, ownerId: true },
  })
  for (const roster of owners) {
    if (!roster.ownerId) continue
    const gate = await decidePushForUser(roster.ownerId, { category: CATEGORY, leagueId, severity: 'medium', now })
    if (!gate.allowed) continue
    const advice = await readPiratePreLockAdvice({
      leagueId, rosterId: roster.id, ownerId: roster.ownerId, season: state.season.season,
      week: state.week, now, leadWindowMs: LEAD_WINDOW,
    }, db).catch(() => null)
    const alert = readyAlert(advice, new Date())
    if (!advice || !alert) continue
    const id = createHash('sha256').update(JSON.stringify([
      PIRATE_PRE_LOCK_EVENT, state.season.id, state.week, advice.scoringDay, roster.id, roster.ownerId,
    ])).digest('hex')
    await db.notificationOutbox.createMany({
      skipDuplicates: true,
      data: [{
        id, leagueId, userId: roster.ownerId, channel: 'push', eventType: PIRATE_PRE_LOCK_EVENT,
        title: 'Fix your Pirate lineup before lock', body: alert.body,
        metadata: {
          notificationCategory: CATEGORY, expiresAt: alert.expiresAt,
          actionHref: `/league/${encodeURIComponent(leagueId)}?view=roster`, actionLabel: 'Open lineup',
          pirateRosterId: roster.id, pirateSeasonId: state.season.id, pirateWeek: state.week, pirateScoringDay: advice.scoringDay,
        },
      }],
    })
  }
}

/** Re-check ownership, date, the issue and a legal fix at delivery/retry time. */
export async function refreshPiratePreLockPush(
  leagueId: string, ownerId: string, metadata: Record<string, unknown>, db: PrismaClient,
) {
  if (typeof metadata.pirateRosterId !== 'string' || metadata.notificationCategory !== CATEGORY) return null
  const state = await pirateWeekState(leagueId, db)
  if (state.season.id !== metadata.pirateSeasonId || state.week !== metadata.pirateWeek) return null
  const advice = await readPiratePreLockAdvice({
    leagueId, rosterId: metadata.pirateRosterId, ownerId, season: state.season.season, week: state.week, leadWindowMs: LEAD_WINDOW,
  }, db)
  if (!advice || advice.scoringDay !== metadata.pirateScoringDay) return null
  return readyAlert(advice, new Date())
}
