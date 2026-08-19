/**
 * Fantasy OS Suite — Phase OS-B5: Multi-Channel Delivery Adapter Foundation.
 *
 * Pure, zero-I/O — same discipline as `notifications.ts`/`dailyBrief.ts`. Takes an already-composed
 * `DecisionOsNotification[]` (from `composeNotificationFeed`, already priority-sorted) and produces a
 * `DeliveryPlan`. The Notification Engine and everything upstream of it remain completely unaware this
 * module exists; this is the one place that knows "which surfaces" — routing policy lives HERE, not on
 * any individual adapter (adapters only self-declare capability, they never decide who gets routed to
 * them).
 *
 * Deliberately synchronous. `DeliveryAdapter.deliver()` could in principle be async (a real future
 * email/push adapter would need to await a network call), but none of the four adapters built this
 * phase do any I/O — keeping this resolver sync keeps its client-side call site
 * (`CommissionerCommandCenterSection.tsx`) a plain `useMemo`, matching the exact same zero-extra-fetch
 * composition pattern already used for `brief`/`notifications`. A real async adapter would need this
 * resolver (and its one client call site) to become async at that point — a deliberate, deferred
 * decision, not an oversight.
 */
import { defaultDeliveryAdapters } from './adapters'
import type { DecisionOsNotification } from '../notifications'
import type { AttentionSignalSeverity } from '../attentionSignals'
import type { DeliveryAdapter, DeliveryPlan, DeliveryPlanEntry, DeliveryResult, DeliverySurface } from './types'

/**
 * Deterministic severity → target-surface policy, per this phase's own explicit rule: critical is the
 * only severity that reaches beyond in-app (email too); every other severity is in-app only. No
 * scheduling, no retries — a notification either gets routed to a surface on this single pass or it
 * doesn't.
 */
const SEVERITY_SURFACES: Record<AttentionSignalSeverity, readonly DeliverySurface[]> = {
  critical: ['in_app', 'email'],
  high: ['in_app'],
  medium: ['in_app'],
  low: ['in_app'],
  informational: ['in_app'],
}

/**
 * Resolves a `DeliveryPlan` for an already-composed, already-sorted notification feed. Never throws —
 * a surface with no registered adapter, or an adapter that declines a notification via `canDeliver`,
 * is honestly skipped (no result fabricated for it), never treated as an error.
 */
export function resolveDeliveryPlan(
  notifications: readonly DecisionOsNotification[],
  adapters: readonly DeliveryAdapter[] = defaultDeliveryAdapters,
  now: Date = new Date(),
): DeliveryPlan {
  const entries: DeliveryPlanEntry[] = notifications.map((notification) => {
    const targetSurfaces = [...SEVERITY_SURFACES[notification.severity]]
    const results: DeliveryResult[] = []

    for (const surface of targetSurfaces) {
      const adapter = adapters.find((a) => a.surface === surface)
      if (!adapter) continue
      if (!adapter.canDeliver(notification)) continue
      results.push(adapter.deliver(notification))
    }

    return { notification, targetSurfaces, results }
  })

  const inApp = entries
    .filter((entry) => entry.results.some((result) => result.surface === 'in_app' && result.delivered))
    .map((entry) => entry.notification)

  return { generatedAt: now.toISOString(), entries, inApp }
}
