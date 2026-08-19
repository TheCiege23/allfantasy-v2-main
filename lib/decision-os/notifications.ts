/**
 * Fantasy OS Suite — Phase OS-B4: Notification Engine Foundation.
 *
 * "Decision OS owns intelligence. Daily Brief owns digest composition. Notification Engine owns
 * delivery-ready notification objects. Commissioner OS only displays them." This module is the last of
 * those three — it transforms already-produced Decision OS outputs (`DecisionOsAttentionSignal[]`,
 * `DailyBrief`) into a uniform, deterministic `DecisionOsNotification` shape and a delivery-surface
 * policy, and does nothing else: no new intelligence, no recomputed severities, no scheduling.
 *
 * Pure and zero-I/O, exactly like `attentionSignals.ts`/`dailyBrief.ts` — every function here takes
 * already-resolved inputs and returns a plain value. Safe to import into a client component (the
 * Commissioner Hub's Notification Center composes its feed with zero additional fetch, the same
 * discipline OS-B3 established for the Daily Brief) and equally safe for a future server-only resolver.
 *
 * Deliberately stateless: `DecisionOsNotification` carries NO `read`/`dismissed` fields. Those are
 * inherently per-viewer, per-session state, not something Decision OS (a deterministic, provider-
 * agnostic engine) can decide — the same notification object is correct for every viewer; whether THEY
 * have read or dismissed it is UI-layer, session-local state (`NotificationCenter.tsx`, this phase),
 * matching this phase's own "session-local: mark read, dismiss... do not add database persistence"
 * instruction. This is the same category of deliberate field-list deviation as OS-B1/OS-B2 dropping
 * "league name" from the Attention Signal model — see `docs/os/NOTIFICATION_ENGINE.md` §2.
 */
import {
  SEVERITY_RANK,
  type AttentionSignalSeverity,
  type AttentionSignalType,
  type DecisionOsAttentionSignal,
} from './attentionSignals'
import type { DailyBrief } from './dailyBrief'

/**
 * Four Attention Signal types get their own dedicated notification type (a direct, literal reuse of
 * `DecisionOsAttentionSignal['type']` — no translation logic needed). `league_requires_review` — the
 * one Attention Signal type without a dedicated name in this phase's own instructions — maps to the
 * generic `attention_signal` bucket below.
 */
export type NotificationType =
  | 'attention_signal'
  | 'daily_brief'
  | 'league_context_incomplete'
  | 'draft_approaching'
  | 'low_league_health'
  | 'high_league_health'

/** Deterministic delivery-surface policy, per this phase's own explicit rule: critical surfaces
 * immediately, high prominently, medium in the notification center, low/informational inbox-only. */
export type NotificationSurfacePolicy = 'immediate' | 'prominent' | 'center' | 'inbox'

export interface DecisionOsNotification {
  id: string
  type: NotificationType
  severity: AttentionSignalSeverity
  surfacePolicy: NotificationSurfacePolicy
  /** A deterministic reference to the exact signal/brief this notification was derived from — the
   * dedup key's own origin, and useful for a future consumer that wants to trace a notification back
   * to its source without re-deriving anything. */
  source: string
  /** `null` for a `daily_brief` notification, which summarizes across every monitored league rather
   * than belonging to one. */
  leagueId: string | null
  title: string
  body: string
  recommendedAction: string | null
  createdAt: string
  /** Always `null` in this phase — no expiry rule exists anywhere in this codebase yet; leaving it
   * honestly unset rather than fabricating a TTL. */
  expiresAt: string | null
}

const NAMED_SIGNAL_TYPES: ReadonlySet<AttentionSignalType> = new Set([
  'league_context_incomplete',
  'draft_approaching',
  'low_league_health',
  'high_league_health',
])

const SURFACE_POLICY: Record<AttentionSignalSeverity, NotificationSurfacePolicy> = {
  critical: 'immediate',
  high: 'prominent',
  medium: 'center',
  low: 'inbox',
  informational: 'inbox',
}

function notificationTypeForSignal(type: AttentionSignalType): NotificationType {
  return NAMED_SIGNAL_TYPES.has(type) ? (type as NotificationType) : 'attention_signal'
}

/** Transforms one real Attention Signal into a notification. Never recomputes severity, title, or
 * explanation — reuses the signal's own fields verbatim. */
export function notificationFromSignal(signal: DecisionOsAttentionSignal): DecisionOsNotification {
  return {
    id: `notification:${signal.id}`,
    type: notificationTypeForSignal(signal.type),
    severity: signal.severity,
    surfacePolicy: SURFACE_POLICY[signal.severity],
    source: signal.id,
    leagueId: signal.leagueId,
    title: signal.title,
    body: signal.explanation,
    recommendedAction: signal.recommendedAction,
    createdAt: signal.timestamp,
    expiresAt: null,
  }
}

/**
 * Transforms a Daily Brief into a single summary notification — only when the brief actually has real
 * content to summarize (at least one priority item, positive highlight, or league highlight). A boring,
 * fully-healthy brief with nothing in it produces no notification; nobody needs to be told "you have
 * nothing to be told." Severity is the highest severity already present among the brief's own
 * `topPriorityItems` (real data, never invented) — falling back to `informational` only when the brief
 * has content but none of it came with a severity above informational (e.g. positive highlights only).
 */
export function notificationFromDailyBrief(brief: DailyBrief): DecisionOsNotification | null {
  const hasContent =
    brief.topPriorityItems.length > 0 || brief.positiveHighlights.length > 0 || brief.leagueHighlights.length > 0
  if (!hasContent) return null

  const severity: AttentionSignalSeverity = brief.topPriorityItems[0]?.severity ?? 'informational'
  return {
    id: `notification:daily_brief:${brief.generatedAt}`,
    type: 'daily_brief',
    severity,
    surfacePolicy: SURFACE_POLICY[severity],
    source: `daily_brief:${brief.generatedAt}`,
    leagueId: null,
    title: "Today's Brief is ready",
    body: brief.summary,
    recommendedAction: brief.recommendedActions[0] ?? null,
    createdAt: brief.generatedAt,
    expiresAt: null,
  }
}

/**
 * Deterministic ordering: highest severity first, then newest `createdAt` — the identical rule
 * `sortAttentionSignals` already applies, reimplemented here (not imported) only because the element
 * type differs; the comparator logic itself is unchanged.
 */
export function sortNotifications(notifications: readonly DecisionOsNotification[]): DecisionOsNotification[] {
  return [...notifications].sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (rankDiff !== 0) return rankDiff
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export interface NotificationFeedInput {
  signals: readonly DecisionOsAttentionSignal[]
  brief?: DailyBrief | null
}

/**
 * Composes the full, deduplicated, priority-sorted notification feed from already-produced Decision OS
 * outputs. Deduplication is by deterministic `id` only (a direct source reference) — no fuzzy matching,
 * no heuristics, per this phase's own explicit rule. First occurrence wins on an id collision.
 */
export function composeNotificationFeed(input: NotificationFeedInput): DecisionOsNotification[] {
  const byId = new Map<string, DecisionOsNotification>()

  for (const signal of input.signals) {
    const notification = notificationFromSignal(signal)
    if (!byId.has(notification.id)) byId.set(notification.id, notification)
  }

  if (input.brief) {
    const notification = notificationFromDailyBrief(input.brief)
    if (notification && !byId.has(notification.id)) byId.set(notification.id, notification)
  }

  return sortNotifications([...byId.values()])
}
