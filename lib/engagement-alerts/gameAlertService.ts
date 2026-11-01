import 'server-only'
import { listSportsAlertAudience } from '@/lib/notifications/sportAudience'
import { postseasonAlerts } from './postseasonEvents'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { splitByGameAlertPushBudget, type LivePushTier } from '@/lib/notifications/liveGamePushBudget'
import { withinDailyCap } from '@/lib/follows/teamFollowAlerts'
import { filterByLiveAlertLevel } from '@/lib/notifications/liveAlertLevelFilter'
import type { LiveAlertKind } from '@/lib/notification-settings/liveAlertLevel'
import { gamePlayAlerts, gameRecap, gameStateAlerts, starterAlerts, type GameAlert, type GameObservation } from './gameEvents'
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
export type GameAudience = {
  game: string[]
  broad: string[]
  startersByAthlete?: Map<string, Set<string>>
  /** Every sport: user → the ESPN athlete ids they start in this game, for the post-game recap. */
  startersByUser?: Map<string, string[]>
}

/** Close-game and overtime alerts per person per day, across every sport. */
export const BROAD_GAME_ALERTS_PER_DAY = 10

function finalScoreMeta(observation: GameObservation) {
  const winnerLogo = observation.homeScore != null && observation.awayScore != null && observation.awayScore > observation.homeScore
    ? observation.awayLogo : observation.homeLogo
  return {
    homeTeam: observation.homeTeam, awayTeam: observation.awayTeam,
    homeScore: observation.homeScore, awayScore: observation.awayScore,
    homeLogo: observation.homeLogo ?? null, awayLogo: observation.awayLogo ?? null,
    ...(winnerLogo ? { iconUrl: winnerLogo } : {}),
  }
}

function categoryFor(alert: GameAlert): NotificationCategoryId {
  if (alert.type === 'postseason_clinch') return 'breaking_news'
  if (alert.type === 'game_close') return 'live_game_alerts'
  if (alert.type === 'game_scoring_play' || alert.type === 'game_big_play') return 'performance_alerts'
  return 'matchup_results'
}

/** Which row of the live-alert-level table (lib/notification-settings/liveAlertLevel.ts) this alert is. */
export function liveKindFor(alert: GameAlert): LiveAlertKind {
  if (alert.type === 'game_close' || alert.type === 'postseason_clinch') return 'close'
  if (alert.type === 'game_scoring_play' || alert.type === 'game_big_play') return 'play'
  if (alert.type === 'game_final') return 'final'
  return 'checkpoint'
}

function tierFor(alert: GameAlert): LivePushTier {
  if (alert.severity === 'high') return 'major'
  return alert.type === 'game_scoring_play' || alert.type === 'game_big_play' ? 'minor' : 'major'
}

/**
 * One device notification per game: a newer alert from the same game replaces the older one on the
 * lock screen (web `tag`, APNs `apns-collapse-id`) and still buzzes (push-service `shouldRenotify`).
 * The bell keeps every one. Dedupe is keyed on `dedupePrefix`, never on this tag.
 */
export function gamePushTag(sport: string, gameId: string): string {
  return `game:${sport.toUpperCase()}:${gameId}`
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

/** "Your starter" — only to managers starting that athlete, under their live alert level. */
async function sendStarterAlert(sport: string, observation: GameObservation, alert: GameAlert, eventKey: string, audience: GameAudience): Promise<number> {
  const starters = [...(audience.startersByAthlete?.get(alert.starterAthleteId!) ?? [])]
  const ids = await filterByLiveAlertLevel(starters, 'starter_play', () => true)
  if (!ids.length) return 0
  const { push, held } = sport.toUpperCase() === 'NHL'
    ? { push: ids, held: [] as string[] }
    : await splitByGameAlertPushBudget(ids, 'major')
  let delivered = 0, failed = 0
  for (const [userIds, pushBudget] of [[push, 'pushed'], [held, 'held']] as const) {
    if (!userIds.length) continue
    const result = await dispatchNotification({
      userIds, category: 'performance_alerts', type: alert.type, title: alert.title, body: alert.body,
      actionHref: gameDetailHref({ sport, gameId: observation.gameId, espnDetail: true }, '/core/live') ?? `/core/live?sport=${encodeURIComponent(sport)}`,
      actionLabel: 'Open game', severity: 'high', dedupePrefix: eventKey,
      skipChannels: { sms: true, email: true, ...(pushBudget === 'held' ? { push: true } : {}) },
      meta: { sport, gameId: observation.gameId, eventKey, pushTag: gamePushTag(sport, observation.gameId), pushTier: 'major', pushBudget,
        ...(alert.imageUrl ? { imageUrl: alert.imageUrl } : {}) },
    })
    delivered += result.delivered
    failed += result.failed
  }
  if (failed > 0) throw new Error(`Starter alert dispatch failed: ${eventKey}`)
  return delivered
}

/** One source per game, persisted independently of an open browser or server process. */
export async function observeGameAlerts(sport: string, observation: GameObservation, detail: LiveGameDetail | null, audienceInput: string[] | GameAudience): Promise<number> {
  const audience: GameAudience = Array.isArray(audienceInput) ? { game: audienceInput, broad: audienceInput } : audienceInput
  const cacheKey = `engagement:game:v1:${sport}:${observation.gameId}`
  // A read failure must not look like first-run bootstrap and consume unseen events.
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })
  const state = cached?.data as unknown as GameAlertState | null
  // Personal starter alerts ride with the plays, so a first poll baselines them exactly like plays.
  const plays = detail ? [...gamePlayAlerts(detail), ...starterAlerts(detail)] : []
  const seen = new Set(state?.seen ?? [])
  const alerts = [
    ...postseasonAlerts(sport, observation).map(a => ({ ...a, audience: 'broad' as const })),
    ...(state ? [...gameStateAlerts(sport, state.observation, observation, detail), ...(state.playsInitialized ? plays : [])] : []),
  ]
  if (!state?.playsInitialized) for (const p of plays) seen.add(p.key)
  let sent = 0
  for (const alert of alerts) {
    if (seen.has(alert.key)) continue
    if (alert.silent) { seen.add(alert.key); continue }
    const eventKey = `${cacheKey}:${alert.key}`
    if (alert.starterAthleteId) {
      sent += await sendStarterAlert(sport, observation, alert, eventKey, audience)
      seen.add(alert.key)
      continue
    }
    const { game, broadOnly } = recipientsFor(alert, audience)
    // The sport-wide audience is capped per day; the people with a stake in the game are not.
    // Each person's live alert level first, so a person who chose less never spends daily cap.
    const inGame = new Set(audience.game)
    const kind = liveKindFor(alert)
    const [gameOk, broadOk] = await Promise.all([filterByLiveAlertLevel(game, kind, inGame), filterByLiveAlertLevel(broadOnly, kind, inGame)])
    const broad = broadOk.length ? await withinDailyCap(broadOk, { provider: 'broad_game_alerts', limit: BROAD_GAME_ALERTS_PER_DAY }) : []
    let recipients = [...gameOk, ...broad]
    // The final becomes ONE personal recap for anyone starting a player in the game.
    if (alert.type === 'game_final' && detail && audience.startersByUser?.size) {
      const recapped = new Set<string>()
      for (const userId of recipients) {
        const ids = audience.startersByUser.get(userId)
        const recap = ids?.length ? gameRecap(sport, observation, detail, ids) : null
        if (!recap) continue
        const result = await dispatchNotification({
          userIds: [userId], category: 'matchup_results', type: recap.type, title: recap.title, body: recap.body,
          actionHref: gameDetailHref({ sport, gameId: observation.gameId, espnDetail: true }, '/core/live') ?? `/core/live?sport=${encodeURIComponent(sport)}`,
          actionLabel: 'Open game', severity: 'medium', dedupePrefix: `${cacheKey}:recap`, skipChannels: { sms: true, email: true },
          meta: { sport, gameId: observation.gameId, eventKey: `${cacheKey}:recap`, pushTag: gamePushTag(sport, observation.gameId), pushTier: 'major', pushBudget: 'pushed', ...finalScoreMeta(observation) },
        })
        if (result.failed > 0) throw new Error(`Game recap dispatch failed: ${cacheKey}`)
        sent += result.delivered
        recapped.add(userId)
      }
      recipients = recipients.filter(id => !recapped.has(id))
    }
    const tier = tierFor(alert)
    // These are the owner's selected game moments: every eligible recipient gets both channels.
    const { push, held } = alert.type === 'postseason_clinch'
      ? await splitByGameAlertPushBudget(recipients, tier)
      : { push: recipients, held: [] as string[] }
    const base = {
      category: categoryFor(alert), type: alert.type, title: alert.title, body: alert.body,
      actionHref: gameDetailHref({ sport, gameId: observation.gameId, espnDetail: true }, '/core/live') ?? `/core/live?sport=${encodeURIComponent(sport)}`,
      actionLabel: 'Open game',
      severity: alert.severity ?? (alert.type === 'game_close' || alert.type === 'postseason_clinch' ? 'high' : 'medium'),
      dedupePrefix: eventKey,
    } as const
    const meta = {
      sport, gameId: observation.gameId, eventKey, pushTag: gamePushTag(sport, observation.gameId), triggeredAt: new Date().toISOString(),
      pushTier: tier, ...(alert.imageUrl ? { imageUrl: alert.imageUrl } : {}),
      ...(alert.type === 'game_final' ? finalScoreMeta(observation) : {}),
      ...(observation.broadcast ? { broadcast: observation.broadcast } : {}),
    }
    let failed = 0
    for (const [ids, pushBudget] of [[push, 'pushed'], [held, 'held']] as const) {
      if (!ids.length) continue
      const result = await dispatchNotification({
        ...base, userIds: ids, meta: { ...meta, pushBudget },
        skipChannels: { sms: true, email: true, ...(pushBudget === 'held' ? { push: true } : {}) },
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
