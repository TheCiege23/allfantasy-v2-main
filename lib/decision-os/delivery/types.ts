/**
 * Fantasy OS Suite — Phase OS-B5: Multi-Channel Delivery Adapter Foundation.
 *
 * "Where should already-composed notifications be delivered?" — a separate question from the
 * Notification Engine's own "which already-known items should be surfaced, when, and in what form?"
 * (OS-B4). This module is the boundary between the two: `DeliveryAdapter` is a provider-agnostic
 * contract every delivery surface implements identically, so the Notification Engine (and anything
 * upstream of it — Attention Signals, Daily Brief) never needs to know anything about email, push, or
 * mobile delivery mechanics. No adapter contains business logic; adapters receive notifications, they
 * never create them.
 */
import type { AttentionSignalSeverity } from '../attentionSignals'
import type { DecisionOsNotification, NotificationType } from '../notifications'

export type DeliverySurface = 'in_app' | 'email' | 'push' | 'mobile'

export interface DeliveryResult {
  surface: DeliverySurface
  notificationId: string
  delivered: boolean
  /** Non-null exactly when `delivered` is false — an honest reason (e.g. `stub_adapter_no_real_delivery`
   * for a not-yet-real adapter), never a fabricated success. */
  reason: string | null
}

export interface DeliveryAdapter {
  readonly surface: DeliverySurface
  /** What this adapter is CAPABLE of handling — a self-declared capability, independent of whether
   * today's routing policy (`deliveryResolver.ts`) ever actually targets it for a given severity. */
  readonly supportedSeverities: readonly AttentionSignalSeverity[]
  readonly supportedNotificationTypes: readonly NotificationType[] | 'all'
  /** A pure capability check — never performs I/O, never decides routing policy (that's the
   * resolver's job). Returns whether this adapter is ABLE to handle this notification at all. */
  canDeliver(notification: DecisionOsNotification): boolean
  /** Attempts delivery for this one notification. Real for `in_app`; every other surface in this
   * phase is an honest stub that never claims a delivery it didn't actually perform. */
  deliver(notification: DecisionOsNotification): DeliveryResult
}

export interface DeliveryPlanEntry {
  notification: DecisionOsNotification
  /** Surfaces this notification was routed to by the deterministic severity policy
   * (`deliveryResolver.ts`'s own `SEVERITY_SURFACES`) — independent of whether each adapter actually
   * accepted/delivered it (see `results` for that). */
  targetSurfaces: DeliverySurface[]
  results: DeliveryResult[]
}

export interface DeliveryPlan {
  generatedAt: string
  entries: DeliveryPlanEntry[]
  /** Convenience: notifications the `in_app` surface actually delivered, in the same order the caller
   * supplied them (expected to already be `sortNotifications`-ordered) — this is what
   * `NotificationCenter` should render, not the raw, unrouted notification feed. */
  inApp: DecisionOsNotification[]
}
