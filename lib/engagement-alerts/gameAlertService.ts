import 'server-only'
import { isSupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { gamePlayAlerts, gameStateAlerts, type GameObservation } from './gameEvents'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

export type GameAlertState = { observation: GameObservation; seen: string[]; playsInitialized?: boolean }

/** One source per game, persisted independently of an open browser or server process. */
export async function observeGameAlerts(sport: string, observation: GameObservation, detail: LiveGameDetail | null, userIds: string[]): Promise<number> {
  const cacheKey = `engagement:game:v1:${sport}:${observation.gameId}`
  // A read failure must not look like first-run bootstrap and consume unseen events.
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })
  const state = cached?.data as unknown as GameAlertState | null
  const plays = detail ? gamePlayAlerts(detail) : []
  const seen = new Set(state?.seen ?? [])
  const alerts = state ? [...gameStateAlerts(sport, state.observation, observation), ...(state.playsInitialized ? plays : [])] : []
  if (!state?.playsInitialized) for (const p of plays) seen.add(p.key)
  let sent = 0
  for (const alert of alerts) {
    if (seen.has(alert.key)) continue
    const eventKey = `${cacheKey}:${alert.key}`
    const result = await dispatchNotification({
      userIds: [...new Set(userIds)], category: alert.type === 'game_scoring_play' || alert.type === 'game_big_play' ? 'performance_alerts' : 'matchup_results',
      type: alert.type, title: alert.title, body: alert.body,
      actionHref: `/core/live?sport=${encodeURIComponent(sport)}`,
      severity: alert.type === 'game_close' ? 'high' : 'medium',
      dedupePrefix: eventKey, skipChannels: { sms: true },
      meta: { sport, gameId: observation.gameId, eventKey, pushTag: eventKey, triggeredAt: new Date().toISOString() },
    })
    if (result.failed > 0) throw new Error(`Game alert dispatch failed: ${eventKey}`)
    seen.add(alert.key)
    sent += result.delivered
  }
  const data = { observation, seen: [...seen], playsInitialized: !!detail || /scheduled|^STATUS_PRE$/i.test(observation.status) || state?.playsInitialized === true } as unknown as object
  const expiresAt = new Date(Date.now() + 7 * 86400_000)
  await prisma.sportsDataCache.upsert({ where: { cacheKey }, update: { data, expiresAt }, create: { cacheKey, data, expiresAt } })
  return sent
}

/** Explicit sport interests plus members of leagues in that sport; never broadcast across sports. */
export async function sportAlertAudience(sport: string): Promise<string[]> {
  const [profiles, leagues] = await Promise.all([
    prisma.userProfile.findMany({ where: { preferredSports: { array_contains: [sport] } }, select: { userId: true } }),
    isSupportedSport(sport) ? prisma.league.findMany({ where: { sport }, select: { userId: true, teams: { select: { claimedByUserId: true } } } }) : Promise.resolve([]),
  ])
  return [...new Set([...profiles.map(p => p.userId), ...leagues.flatMap(l => [l.userId, ...l.teams.map(t => t.claimedByUserId)])].filter((id): id is string => !!id))]
}
