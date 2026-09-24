import type { ChimmyAlert, ChimmyAlertContext, ChimmyAlertUserPreferences } from './types'
import type { ChimmyAlertDeliveryHistory } from './ChimmyAlertDeliveryRouter'

// ── Suppression decision types ────────────────────────────────────────────────

export type ChimmyAlertSuppressionReason =
  | 'not_suppressed'
  | 'muted_class'
  | 'muted_type'
  | 'muted_class_pref'
  | 'muted_type_override'
  | 'league_disabled'
  | 'league_muted_class'
  | 'snoozed'
  | 'acted_on'
  | 'resolved'
  | 'signal_stale'
  | 'dismissed_escalated'
  | 'dismissed_permanently'
  | 'reduced_frequency_cooldown'
  | 'commissioner_pref_disabled'
  | 'commissioner_type_gate'

export interface ChimmyAlertSuppressionDecision {
  suppress: boolean
  reason: ChimmyAlertSuppressionReason
  /** When true, severity should be degraded one level before routing. */
  downgrade?: boolean
  /** Effective cooldown multiplier from preferences (1 = default). */
  effectiveCooldownMultiplier: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps alert type to the signalBundle key that causes it to fire.
 * If the key's value is falsy at evaluation time, the alert is stale.
 */
const ALERT_TYPE_TO_SIGNAL: Record<string, keyof NonNullable<ChimmyAlertContext['signalBundle']>> = {
  lineup_incomplete: 'lineupIncomplete',
  start_sit_high_confidence_swing: 'highConfidenceStartSitSwing',
  priority_add_available: 'highConfidenceWaiverAdd',
  new_trade_offer: 'tradeOfferPendingCount',
  on_the_clock: 'onTheClock',
  draft_starting_soon: 'draftStartingSoon',
  waiver_queue_empty: 'queueEmpty',
}

function isSignalStale(alert: ChimmyAlert, context: ChimmyAlertContext): boolean {
  const signalKey = ALERT_TYPE_TO_SIGNAL[alert.type]
  if (!signalKey || !context.signalBundle) return false
  const val = context.signalBundle[signalKey]
  if (val === undefined) return false // signal not available in this context — don't call it stale
  return !val || (typeof val === 'number' && val === 0)
}

/**
 * Resolve effective cooldown multiplier combining frequency settings:
 * global frequency > class frequency > type override.
 * Last one wins (type override is most specific).
 */
export function resolveEffectiveCooldownMultiplier(
  alert: ChimmyAlert,
  prefs: ChimmyAlertUserPreferences,
): number {
  const FREQ_MULTIPLIERS = { normal: 1, reduced: 2, minimal: 4 }

  let multiplier = FREQ_MULTIPLIERS[prefs.frequency ?? 'normal']

  const classPref = prefs.classPrefs?.[alert.class]
  if (classPref?.frequency) {
    multiplier = FREQ_MULTIPLIERS[classPref.frequency]
  }

  const typeOverride = prefs.typeOverrides?.[alert.type]
  if (typeof typeOverride?.cooldownMultiplier === 'number') {
    multiplier = typeOverride.cooldownMultiplier
  }

  return Math.max(0.1, multiplier)
}

/**
 * Calculate escalated cooldown (ms) from dismissal history.
 *
 * Escalation ladder:
 *  0-1 dismissals → 12h baseline
 *  2 dismissals   → 48h
 *  3 dismissals   → 7 days
 *  4+ dismissals  → permanent suppression
 */
function escalatedDismissalCooldownMs(count: number): number | null {
  if (count <= 1) return 12 * 60 * 60 * 1000
  if (count === 2) return 48 * 60 * 60 * 1000
  if (count === 3) return 7 * 24 * 60 * 60 * 1000
  return null // permanent — caller returns 'dismissed_permanently'
}

// ── Main evaluation ───────────────────────────────────────────────────────────

export type ChimmyAlertPreferenceMuteReason = Extract<
  ChimmyAlertSuppressionReason,
  'muted_class' | 'muted_type' | 'muted_class_pref' | 'muted_type_override' | 'league_disabled' | 'league_muted_class'
>

/**
 * Steps 1–5 of `evaluateAlertSuppression`: whether the USER switched this alert off — by class,
 * by type, or for its league — and nothing else. Exported so a sender that does not run the whole
 * engine (the scheduled sweeps in cron/alert-sweep) honours the same switches the Settings panel
 * shows, rather than a copy of them. Null when nothing the user set silences it.
 */
export function preferenceMuteReason(
  alert: Pick<ChimmyAlert, 'class' | 'type'> & { leagueId?: string | null },
  prefs: ChimmyAlertUserPreferences | null | undefined,
): ChimmyAlertPreferenceMuteReason | null {
  if (!prefs) return null

  // 1. Global muted class
  if (prefs.mutedClasses?.includes(alert.class)) return 'muted_class'

  // 2. Global muted type
  if (prefs.mutedTypes?.includes(alert.type)) return 'muted_type'

  // 3. Per-class pref mute
  if (prefs.classPrefs?.[alert.class]?.muted) return 'muted_class_pref'

  // 4. Per-type override mute
  if (prefs.typeOverrides?.[alert.type]?.muted) return 'muted_type_override'

  // 5. Per-league disable / class mute
  if (alert.leagueId) {
    const leaguePref = prefs.leaguePrefs?.find((lp) => lp.leagueId === alert.leagueId)
    if (leaguePref?.disabled) return 'league_disabled'
    if (leaguePref?.mutedClasses?.includes(alert.class)) return 'league_muted_class'
  }
  return null
}

/**
 * Evaluate whether an alert should be suppressed, and why.
 *
 * Call order (first suppression wins):
 *  1. Muted class / type (global lists)
 *  2. Per-class and per-type pref mutes
 *  3. Per-league disable / league-muted class
 *  4. Commissioner gate (type-specific commissioner prefs)
 *  5. Active snooze
 *  6. Already resolved
 *  7. Already acted on (non-repeatable)
 *  8. Signal stale (condition no longer present in signal bundle)
 *  9. Escalated dismissal cooldown
 * 10. Reduced-frequency cooldown
 *
 * Returns `suppress: false` with `effectiveCooldownMultiplier` for use by
 * `suppressDuplicateAlerts` in the engine.
 */
export function evaluateAlertSuppression(
  alert: ChimmyAlert,
  context: ChimmyAlertContext,
  prefs: ChimmyAlertUserPreferences,
  history?: ChimmyAlertDeliveryHistory,
  now = Date.now(),
): ChimmyAlertSuppressionDecision {
  const effectiveCooldownMultiplier = resolveEffectiveCooldownMultiplier(alert, prefs)

  // 1–5. The user's own mute switches.
  const muted = preferenceMuteReason(alert, prefs)
  if (muted) return { suppress: true, reason: muted, effectiveCooldownMultiplier }

  // 6. Commissioner-specific gates
  if (context.role === 'commissioner' && prefs.commissionerPrefs) {
    const cp = prefs.commissionerPrefs
    if (!cp.enabled) {
      return { suppress: true, reason: 'commissioner_pref_disabled', effectiveCooldownMultiplier }
    }
    if (alert.type === 'suspicious_trade_signal' && cp.receiveSuspiciousTradeAlerts === false) {
      return { suppress: true, reason: 'commissioner_type_gate', effectiveCooldownMultiplier }
    }
    if (alert.type === 'inactive_orphan_team' && cp.receiveOrphanTeamAlerts === false) {
      return { suppress: true, reason: 'commissioner_type_gate', effectiveCooldownMultiplier }
    }
    if (alert.type === 'weekly_recap_ready' && cp.receiveWeeklyRecapAlerts === false) {
      return { suppress: true, reason: 'commissioner_type_gate', effectiveCooldownMultiplier }
    }
    if (
      (alert.type === 'collusion_signal' || alert.type === 'tanking_pattern') &&
      cp.receiveIntegrityAlerts === false
    ) {
      return { suppress: true, reason: 'commissioner_type_gate', effectiveCooldownMultiplier }
    }
  }

  // 7. Active snooze
  const snoozeEntry = prefs.snoozedAlerts?.find((s) => s.dedupeKey === alert.dedupeKey)
  if (snoozeEntry && snoozeEntry.snoozeUntil > now) {
    return { suppress: true, reason: 'snoozed', effectiveCooldownMultiplier }
  }
  // Also check snooze from history (set by lifecycle route)
  if (history?.snoozeUntil && history.snoozeUntil > now) {
    return { suppress: true, reason: 'snoozed', effectiveCooldownMultiplier }
  }

  // 8. Already resolved (always suppress)
  if (history?.resolvedAt) {
    return { suppress: true, reason: 'resolved', effectiveCooldownMultiplier }
  }

  // 9. Already acted on (suppress for non-repeatable alerts)
  if (history?.actedOnAt && !alert.repeatable) {
    return { suppress: true, reason: 'acted_on', effectiveCooldownMultiplier }
  }

  // 10. Signal stale — condition generating this alert is no longer active
  //     Only suppress if the alert is not critical (critical alerts persist until resolved)
  if (alert.severity !== 'critical' && isSignalStale(alert, context)) {
    return { suppress: true, reason: 'signal_stale', effectiveCooldownMultiplier }
  }

  // 11. Dismissal escalation — count how many times user has dismissed this exact alert
  if (history?.dismissalCount) {
    const count = history.dismissalCount
    const cooldownMs = escalatedDismissalCooldownMs(count)
    if (cooldownMs === null) {
      return { suppress: true, reason: 'dismissed_permanently', effectiveCooldownMultiplier }
    }
    const lastDismiss = history.lastDismissedAt?.getTime() ?? 0
    if (now - lastDismiss < cooldownMs) {
      return { suppress: true, reason: 'dismissed_escalated', effectiveCooldownMultiplier }
    }
  }

  // 12. Reduced-frequency cooldown gate — check if last delivery was within the scaled cooldown
  if (effectiveCooldownMultiplier > 1 && history?.lastSeenAt) {
    const scaledCooldownMs = alert.repeatCooldownMinutes * effectiveCooldownMultiplier * 60 * 1000
    if (now - history.lastSeenAt.getTime() < scaledCooldownMs) {
      return { suppress: true, reason: 'reduced_frequency_cooldown', effectiveCooldownMultiplier }
    }
  }

  return { suppress: false, reason: 'not_suppressed', effectiveCooldownMultiplier }
}

// ── Post-filter: group low-priority alerts ────────────────────────────────────

/**
 * When a class has 3 or more informational alerts, keep only the highest-urgency
 * one per class to avoid overwhelming the user with low-signal noise.
 *
 * Urgent and critical alerts are never grouped.
 */
export function groupLowPriorityAlerts(alerts: ChimmyAlert[]): ChimmyAlert[] {
  const THRESHOLD = 3
  const infoByClass = new Map<string, ChimmyAlert[]>()

  for (const alert of alerts) {
    if (alert.severity === 'informational') {
      const list = infoByClass.get(alert.class) ?? []
      list.push(alert)
      infoByClass.set(alert.class, list)
    }
  }

  const suppressedIds = new Set<string>()
  for (const [, classAlerts] of infoByClass) {
    if (classAlerts.length < THRESHOLD) continue
    // Sort by urgencyScore desc — keep only top 1
    const sorted = [...classAlerts].sort((a, b) => b.urgencyScore - a.urgencyScore)
    for (const alert of sorted.slice(1)) {
      suppressedIds.add(alert.alertId)
    }
  }

  return alerts.filter((a) => !suppressedIds.has(a.alertId))
}
