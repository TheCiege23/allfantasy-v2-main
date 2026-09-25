import 'server-only'

/**
 * Unified Notification Engine
 *
 * Normalizes events from any source (injuries, news, live scores, weather, trades, waivers, storylines)
 * into a standard shape, applies rules (urgency, dedup, cooldown), and dispatches through the existing
 * NotificationDispatcher pipeline.
 *
 * Architecture:
 *   event source → NotificationEngine.ingest() → rules → dispatchNotification()
 */

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { prisma } from '@/lib/prisma'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'

// ── Event Types ──

export type NotificationEventType =
  | 'injury_update'
  | 'breaking_news'
  | 'live_score_swing'
  | 'weather_alert'
  | 'trade_proposed'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'trade_countered'
  | 'trade_reversed'
  | 'waiver_processed'
  | 'waiver_claim'
  | 'storyline_generated'
  | 'draft_pick'
  | 'draft_starting'
  | 'lineup_lock'
  | 'commissioner_action'
  | 'player_trending'

export type NotificationSeverity = 'low' | 'medium' | 'high'

export type NotificationEvent = {
  type: NotificationEventType
  title: string
  body?: string
  /** Target user IDs. If omitted, uses leagueId to resolve members. */
  userIds?: string[]
  /** League context for league-scoped events. */
  leagueId?: string
  /** Link destination when notification is clicked. */
  actionHref?: string
  actionLabel?: string
  /** Arbitrary metadata (playerName, team, score delta, etc.). */
  meta?: Record<string, unknown>
  /** Override severity. If omitted, inferred from event type. */
  severity?: NotificationSeverity
  /** Source system that generated the event. */
  source?: string
  /** Opt out of transport channels for this event (forwarded to the dispatcher). */
  skipChannels?: { email?: boolean; sms?: boolean; push?: boolean }
}

// ── Event → Category Mapping ──

const EVENT_CATEGORY_MAP: Record<NotificationEventType, NotificationCategoryId> = {
  injury_update: 'injury_alerts',
  breaking_news: 'ai_alerts',
  live_score_swing: 'matchup_results',
  weather_alert: 'ai_alerts',
  trade_proposed: 'trade_proposals',
  trade_accepted: 'trade_accept_reject',
  trade_rejected: 'trade_accept_reject',
  /*
   * Deliberately NOT a new category. `trade_accept_reject` is the toggle a user
   * flips to hear what became of an offer they sent, and a counter is exactly
   * that. A fresh category would need a default for every existing settings row,
   * and whichever default were chosen would be wrong for someone — silently off
   * is the failure this notification exists to fix.
   */
  trade_countered: 'trade_accept_reject',
  /*
   * A commissioner undid your trade: what became of it, under the same toggle and for the
   * same reason trade_countered is not a new category.
   */
  trade_reversed: 'trade_accept_reject',
  waiver_processed: 'waiver_processing',
  waiver_claim: 'waiver_processing',
  storyline_generated: 'league_announcements',
  draft_pick: 'draft_alerts',
  draft_starting: 'draft_alerts',
  lineup_lock: 'lineup_reminders',
  commissioner_action: 'commissioner_alerts',
  player_trending: 'performance_alerts',
}

// ── Default Severity ──

const DEFAULT_SEVERITY: Record<NotificationEventType, NotificationSeverity> = {
  injury_update: 'medium',
  breaking_news: 'medium',
  live_score_swing: 'low',
  weather_alert: 'low',
  trade_proposed: 'medium',
  trade_accepted: 'high',
  trade_rejected: 'medium',
  /*
   * HIGH, matching accepted rather than rejected. A rejection is over and needs
   * nothing from you; a counter is a live offer against the 48h default expiry
   * (`expiresInHours ?? 48` in createAfLeagueTrade), so it is the one trade
   * outcome that lapses into a loss if it goes unseen.
   */
  trade_countered: 'high',
  /* HIGH: the recipient's roster changed without them doing anything. */
  trade_reversed: 'high',
  waiver_processed: 'medium',
  waiver_claim: 'low',
  storyline_generated: 'low',
  draft_pick: 'medium',
  draft_starting: 'high',
  lineup_lock: 'high',
  commissioner_action: 'medium',
  player_trending: 'low',
}

// ── Cooldown (prevent duplicate notifications within window) ──

const COOLDOWN_MINUTES: Partial<Record<NotificationEventType, number>> = {
  injury_update: 60,
  breaking_news: 30,
  /*
   * ⚠ THIS WINDOW CHANGED MEANING WHEN `buildSourceKey` STARTED PREFERRING THE STABLE EVENT
   * IDENTITY, AND THE NUMBER STAYING AT 10 HID THAT. It is recorded here rather than left to be
   * rediscovered.
   *
   * BEFORE: the key was type + league + player, so this was a per-PLAYER rate limit — one alert
   * per player per ten minutes. That is what suppressed a touchdown because a 22-yard gain by
   * the same player had already fired.
   *
   * NOW: the key is the play (`pbp:${gameId}:${sequence}:${type}`, or the box-score stat
   * transition). Two different plays can never share it, so this window no longer rate-limits
   * anything. It does exactly one job — suppressing a REPLAY of the same event, which polling
   * plus retries produce routinely — and ten minutes is a sensible width for that.
   *
   * 🛑 SO A NAIVE READING THAT THIS IS NOW DEAD CONFIGURATION IS WRONG, AND SETTING IT TO 0 WAS
   * TRIED AND REVERTED. A replayed event shares its key with its own earlier notification, so
   * `filterUsersInCooldown` matches and suppresses it. Zeroing this removed replay dedupe
   * entirely — two regression tests caught it immediately.
   *
   * ⚠ AND THE LOST RATE LIMIT IS REQUIRED BY THE PRODUCT, NOT A REGRESSION TO REPAIR. The
   * blueprint: notify on every gain of at least 20 yards and every touchdown, and "every
   * distinct later TD still qualifies; no broad player cooldown may suppress it". A WR with two
   * big catches and a score in one drive gets three alerts, deliberately. If that proves too
   * loud the answer is a user-facing volume control, not a hidden timer here.
   */
  live_score_swing: 10,
  weather_alert: 120,
  player_trending: 360,
  storyline_generated: 1440,
}

// ── Source Key Builder (for deduplication) ──

/**
 * 🛑 A STABLE EVENT IDENTITY WINS OVER THE PLAYER/CATEGORY FALLBACK, AND THAT IS THE WHOLE
 * FIX FOR N2.
 *
 * The fallback below keys on type + league + player. For `live_score_swing` — which carries a
 * ten-minute cooldown — that made a 22-yard gain and a touchdown by the same player IN THE SAME
 * GAME one and the same "source". Reproduced: two distinct play ids produced one key, the first
 * play notified, and the touchdown came back `reason: 'cooldown'`. The user is told about the
 * run and never told about the score, which inverts the priority exactly.
 *
 * The producers already carry the right identity and it was simply not read here:
 *
 *   box score  `${gameId}|${playerId}|${stat}|${value}`   (lib/live/eventDetector)
 *   play-by-play `pbp:${gameId}:${sequence}:${type}`      (lib/live/rollingInsightsPlayByPlay)
 *
 * ⚠ NEITHER IS DERIVED FROM NOTIFICATION TEXT OR AN INGESTION TIMESTAMP, which is what makes
 * them safe to dedupe on. Both are functions of provider state, so a re-poll or a retry of the
 * SAME play reproduces the SAME key — replay stays deduped — while a genuinely different play
 * produces a different one and is delivered. `sport` is folded in where the producer supplies
 * it, because a game id is only sport-unique by convention.
 *
 * Anything without such a key keeps the previous behaviour byte for byte: injuries, news,
 * trades and waivers are all identified perfectly well by player or trade id, and changing
 * their keys would reset every cooldown in flight.
 */
function stableEventIdOf(event: NotificationEvent): string | null {
  const stableId = event.meta?.eventKey ?? event.meta?.idempotencyKey
  if (stableId == null) return null
  const trimmed = String(stableId).trim()
  return trimmed !== '' ? trimmed : null
}

function buildSourceKey(event: NotificationEvent): string {
  /* Provider event ids are exact. Using them prevents retry duplicates without
     suppressing a second legitimate 20+ yard play by the same player.
     Shape: `${type}:${stableId}`, or `${type}:${sport}:${stableId}` when the producer
     names its sport — absent sport is "unknown", never defaulted to NFL. */
  const stableId = stableEventIdOf(event)
  if (stableId) {
    const parts: string[] = [event.type]
    if (event.meta?.sport) parts.push(String(event.meta.sport))
    parts.push(stableId)
    return parts.join(':').slice(0, 200)
  }
  const parts: string[] = [event.type]
  if (event.leagueId) parts.push(event.leagueId)
  if (event.meta?.playerId) parts.push(String(event.meta.playerId))
  if (event.meta?.playerName) parts.push(String(event.meta.playerName))
  if (event.meta?.tradeId) parts.push(String(event.meta.tradeId))
  /*
   * A live play is its own event. Without its key, a player's second touchdown
   * inside `live_score_swing`'s 10-minute cooldown shares the first one's source
   * key and is silently dropped for every manager who got the first. The key
   * still dedupes the SAME play re-sent by an overlapping tick. Only the live-play
   * notifier sets `meta.idempotencyKey` on this path.
   */
  if (event.meta?.idempotencyKey) parts.push(String(event.meta.idempotencyKey))
  return parts.join(':').slice(0, 200)
}

// ── Cooldown Check ──

/**
 * Per-user cooldown: users who already received a notification for this
 * sourceKey inside the window are filtered out; everyone else still gets
 * theirs. Matches on `meta.sourceKey` of the stored in-app row (written by
 * `ingest` below) — NOT the unique `sourceKey` column, which is reserved for
 * idempotent fan-out and would never match the bare key anyway.
 */
async function filterUsersInCooldown(
  sourceKey: string,
  userIds: string[],
  cooldownMinutes: number,
): Promise<string[]> {
  if (cooldownMinutes <= 0 || userIds.length === 0) return userIds
  try {
    const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000)
    const recent = await prisma.platformNotification.findMany({
      where: {
        userId: { in: userIds },
        createdAt: { gte: cutoff },
        meta: { path: ['sourceKey'], equals: sourceKey },
      },
      select: { userId: true },
    })
    const cooling = new Set(recent.map((row) => row.userId))
    return userIds.filter((id) => !cooling.has(id))
  } catch {
    return userIds
  }
}

// ── Resolve League Members ──

async function resolveLeagueUserIds(leagueId: string): Promise<string[]> {
  try {
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { claimedByUserId: true },
    })
    return teams
      .map((t) => t.claimedByUserId)
      .filter((id): id is string => !!id)
  } catch {
    return []
  }
}

// ── Public API ──

export type IngestResult = {
  dispatched: boolean
  reason?: string
  sourceKey: string
}

/**
 * Ingest a notification event. Applies rules (category mapping, severity, dedup, cooldown)
 * and dispatches through the existing NotificationDispatcher.
 */
export async function ingest(event: NotificationEvent): Promise<IngestResult> {
  const category = EVENT_CATEGORY_MAP[event.type]
  if (!category) {
    return { dispatched: false, reason: 'unknown_event_type', sourceKey: '' }
  }

  const sourceKey = buildSourceKey(event)

  // Resolve target users
  let userIds = event.userIds ?? []
  if (userIds.length === 0 && event.leagueId) {
    userIds = await resolveLeagueUserIds(event.leagueId)
  }
  if (userIds.length === 0) {
    return { dispatched: false, reason: 'no_target_users', sourceKey }
  }

  // Cooldown check — per user, so one manager's recent alert never suppresses
  // delivery to a manager who has not been notified yet.
  const cooldown = COOLDOWN_MINUTES[event.type] ?? 0
  if (cooldown > 0) {
    userIds = await filterUsersInCooldown(sourceKey, userIds, cooldown)
    if (userIds.length === 0) {
      return { dispatched: false, reason: 'cooldown', sourceKey }
    }
  }

  const severity = event.severity ?? DEFAULT_SEVERITY[event.type] ?? 'low'

  try {
    await dispatchNotification({
      userIds,
      category,
      type: event.type,
      title: event.title,
      body: event.body,
      actionHref: event.actionHref,
      actionLabel: event.actionLabel,
      skipChannels: event.skipChannels,
      meta: {
        ...event.meta,
        source: event.source ?? 'notification-engine',
        sourceKey,
      },
      severity,
      productType: 'app',
      dedupePrefix: stableEventIdOf(event) ? sourceKey : undefined,
    })

    return { dispatched: true, sourceKey }
  } catch (e) {
    console.error('[notification-engine] dispatch failed:', e)
    return { dispatched: false, reason: 'dispatch_error', sourceKey }
  }
}

/**
 * Batch ingest multiple events. Returns results for each.
 */
export async function ingestBatch(events: NotificationEvent[]): Promise<IngestResult[]> {
  const results: IngestResult[] = []
  for (const event of events) {
    results.push(await ingest(event))
  }
  return results
}

// ── Convenience Helpers ──

export function injuryAlert(opts: {
  userIds?: string[]
  leagueId?: string
  playerName: string
  team: string
  status: string
  sport?: string
}): NotificationEvent {
  return {
    type: 'injury_update',
    title: `${opts.playerName} (${opts.team}) — ${opts.status}`,
    body: `${opts.playerName} has been listed as ${opts.status}.`,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    actionHref: `/player/${encodeURIComponent(opts.playerName.toLowerCase().replace(/\s+/g, '-'))}`,
    actionLabel: 'View Player',
    meta: { playerName: opts.playerName, team: opts.team, status: opts.status, sport: opts.sport },
    severity: ['out', 'ir', 'suspended'].includes(opts.status.toLowerCase()) ? 'high' : 'medium',
    source: 'injury-importer',
  }
}

export function breakingNews(opts: {
  userIds?: string[]
  leagueId?: string
  title: string
  source: string
  team?: string
  playerName?: string
}): NotificationEvent {
  return {
    type: 'breaking_news',
    title: opts.title,
    body: `via ${opts.source}`,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    meta: { newsSource: opts.source, team: opts.team, playerName: opts.playerName },
    source: 'news-importer',
  }
}

export function scoreSwing(opts: {
  userIds?: string[]
  leagueId?: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  description: string
}): NotificationEvent {
  return {
    type: 'live_score_swing',
    title: `${opts.awayTeam} ${opts.awayScore} @ ${opts.homeTeam} ${opts.homeScore}`,
    body: opts.description,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    meta: { homeTeam: opts.homeTeam, awayTeam: opts.awayTeam, homeScore: opts.homeScore, awayScore: opts.awayScore },
    source: 'live-scores',
  }
}

export function tradeEvent(opts: {
  userIds: string[]
  leagueId: string
  type: 'trade_proposed' | 'trade_accepted' | 'trade_rejected' | 'trade_countered' | 'trade_reversed'
  tradeId: string
  title: string
  body?: string
}): NotificationEvent {
  return {
    type: opts.type,
    title: opts.title,
    body: opts.body,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    // Email, push, and in-app notifications all carry the exact saved trade id.
    // The Trades tab can use it to focus the same record shown on Core and in league history.
    actionHref: `/league/${opts.leagueId}?view=trades&tradeId=${encodeURIComponent(opts.tradeId)}`,
    actionLabel: 'View Trade',
    meta: { tradeId: opts.tradeId },
    source: 'trade-engine',
  }
}

export function waiverEvent(opts: {
  userIds: string[]
  leagueId: string
  title: string
  body?: string
}): NotificationEvent {
  return {
    type: 'waiver_processed',
    title: opts.title,
    body: opts.body,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    actionHref: `/league/${opts.leagueId}?tab=team`,
    actionLabel: 'View Roster',
    source: 'waiver-engine',
  }
}

export function weatherAlert(opts: {
  userIds?: string[]
  leagueId?: string
  team: string
  venue: string
  impact: string
}): NotificationEvent {
  return {
    type: 'weather_alert',
    title: `Weather Alert: ${opts.team} at ${opts.venue}`,
    body: opts.impact,
    userIds: opts.userIds,
    leagueId: opts.leagueId,
    meta: { team: opts.team, venue: opts.venue, impact: opts.impact },
    source: 'weather-service',
  }
}

export function storylineGenerated(opts: {
  leagueId: string
  title: string
  storyId: string
}): NotificationEvent {
  return {
    type: 'storyline_generated',
    title: `New Storyline: ${opts.title}`,
    body: 'A new AI-generated league storyline is ready.',
    leagueId: opts.leagueId,
    actionHref: `/league/${opts.leagueId}?tab=league`,
    actionLabel: 'Read Story',
    meta: { storyId: opts.storyId },
    source: 'league-story',
  }
}
