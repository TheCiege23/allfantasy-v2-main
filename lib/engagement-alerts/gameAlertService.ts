import 'server-only'
import { listSportsAlertAudience } from '@/lib/notifications/sportAudience'
import { postseasonAlerts } from './postseasonEvents'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { splitByGameAlertPushBudget, type LivePushTier } from '@/lib/notifications/liveGamePushBudget'
import { withinDailyCap } from '@/lib/follows/teamFollowAlerts'
import { gamePlayAlerts, gameStateAlerts, type GameAlert, type GameObservation } from './gameEvents'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'
import { gameDetailHref } from '@/lib/live/gameDetailLink'

export type GameAlertState = { observation: GameObservation; seen: string[]; playsInitialized?: boolean }

/**
 * Who may hear about one game.
 *   game  — followers of either team, and managers starting a player in it.
 *   broad — everyone who follows the sport (close games, overtime, postseason only).
 *   startersByAthlete — NFL only: ESPN athlete id → users starting him. Those users already get a
 *     personal "your starter" alert from lib/live/bigPlayNotifier, so the game alert skips them.
 */
export type GameAudience = { game: string[]; broad: string[]; startersByAthlete?: Map<string, Set<string>> }

/** Close-game and overtime alerts per person per day, across every sport. */
export const BROAD_GAME_ALERTS_PER_DAY = 10

/** Emails are for results, not for plays: a "19-yard catch" email read an hour later is noise. */
const EMAIL_TYPES = new Set(['game_final', 'postseason_clinch'])

function categoryFor(alert: GameAlert): NotificationCategoryId {
  if (alert.type === 'postseason_clinch') return 'breaking_news'
  if (alert.type === 'game_close') return 'live_game_alerts'
  if (alert.type === 'game_scoring_play' || alert.type === 'game_big_play') return 'performance_alerts'
  return 'matchup_results'
}

function tierFor(alert: GameAlert): LivePushTier {
  if (alert.severity === 'high') return 'major'
  return alert.type === 'game_scoring_play' || alert.type === 'game_big_play' ? 'minor' : 'major'
}

/** Recipients for one alert, before caps. */
export function recipientsFor(alert: GameAlert, audience: GameAudience): { game: string[]; broadOnly: string[] } {
  let game = [...new Set(audience.game)]
  const starters = audience.startersByAthlete
  if (starters && alert.athleteIds?.length) {
    const skip = new Set(alert.athleteIds.flatMap(id => [...(starters.get(id) ?? [])]))
    game = game.filter(id => !skip.has(id))
  }
  if ((alert.audience ?? 'game') !== 'broad') return { game, broadOnly: [] }
  const inGame = new Set(audience.game)
  return { game, broadOnly: [...new Set(audience.broad)].filter(id => !inGame.has(id)) }
}

/** One source per game, persisted independently of an open browser or server process. */
export async function observeGameAlerts(sport: string, observation: GameObservation, detail: LiveGameDetail | null, audienceInput: string[] | GameAudience): Promise<number> {
  const audience: GameAudience = Array.isArray(audienceInput) ? { game: audienceInput, broad: audienceInput } : audienceInput
  const cacheKey = `engagement:game:v1:${sport}:${observation.gameId}`
  // A read failure must not look like first-run bootstrap and consume unseen events.
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })
  const state = cached?.data as unknown as GameAlertState | null
  const plays = detail ? gamePlayAlerts(detail) : []
  const seen = new Set(state?.seen ?? [])
  const alerts = [
    ...postseasonAlerts(sport, observation).map(a => ({ ...a, audience: 'broad' as const })),
    ...(state ? [...gameStateAlerts(sport, state.observation, observation, detail), ...(state.playsInitialized ? plays : [])] : []),
  ]
  if (!state?.playsInitialized) for (const p of plays) seen.add(p.key)
  let sent = 0
  for (const alert of alerts) {
    if (seen.has(alert.key)) continue
    const eventKey = `${cacheKey}:${alert.key}`
    const { game, broadOnly } = recipientsFor(alert, audience)
    // The sport-wide audience is capped per day; the people with a stake in the game are not.
    const broad = broadOnly.length ? await withinDailyCap(broadOnly, { provider: 'broad_game_alerts', limit: BROAD_GAME_ALERTS_PER_DAY }) : []
    const recipients = [...game, ...broad]
    const tier = tierFor(alert)
    const { push, held } = await splitByGameAlertPushBudget(recipients, tier)
    const base = {
      category: categoryFor(alert), type: alert.type, title: alert.title, body: alert.body,
      actionHref: gameDetailHref({ sport, gameId: observation.gameId, espnDetail: true }, '/core/live') ?? `/core/live?sport=${encodeURIComponent(sport)}`,
      actionLabel: 'Open game',
      severity: alert.severity ?? (alert.type === 'game_close' || alert.type === 'postseason_clinch' ? 'high' : 'medium'),
      dedupePrefix: eventKey,
    } as const
    const meta = {
      sport, gameId: observation.gameId, eventKey, pushTag: eventKey, triggeredAt: new Date().toISOString(),
      pushTier: tier, ...(alert.imageUrl ? { imageUrl: alert.imageUrl } : {}),
      ...(observation.broadcast ? { broadcast: observation.broadcast } : {}),
    }
    const email = EMAIL_TYPES.has(alert.type)
    let failed = 0
    for (const [ids, pushBudget] of [[push, 'pushed'], [held, 'held']] as const) {
      if (!ids.length) continue
      const result = await dispatchNotification({
        ...base, userIds: ids, meta: { ...meta, pushBudget },
        skipChannels: { sms: true, ...(email ? {} : { email: true }), ...(pushBudget === 'held' ? { push: true } : {}) },
      })
      failed += result.failed
      sent += result.delivered
    }
    if (failed > 0) throw new Error(`Game alert dispatch failed: ${eventKey}`)
    seen.add(alert.key)
  }
  const data = { observation, seen: [...seen], playsInitialized: !!detail || /scheduled|^STATUS_PRE$/i.test(observation.status) || state?.playsInitialized === true } as unknown as object
  const expiresAt = new Date(Date.now() + 7 * 86400_000)
  await prisma.sportsDataCache.upsert({ where: { cacheKey }, update: { data, expiresAt }, create: { cacheKey, data, expiresAt } })
  return sent
}

/** Explicit sport interests plus members of leagues in that sport; never broadcast across sports. */
export const sportAlertAudience = listSportsAlertAudience
