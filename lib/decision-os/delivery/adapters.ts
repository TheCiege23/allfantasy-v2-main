/**
 * Fantasy OS Suite — Phase OS-B5: Multi-Channel Delivery Adapter Foundation.
 *
 * Four adapters, one shared capability-check factory (`createAdapter`) so `canDeliver`'s logic exists
 * exactly once rather than copy-pasted four times — a "rule of three (or more)" call made up front here
 * since the duplication was obvious at design time, not discovered after the fact like earlier phases'
 * consolidations.
 *
 * Only `in_app` is a real implementation — it always succeeds because "delivering to in-app" IS the
 * existing, already-real Notification Center rendering whatever the delivery plan routes to it; there
 * is no separate send step to fail. `email`/`push`/`mobile` are honest stubs: they never claim
 * `delivered: true` for a send that never happened (no SMTP, no Resend, no APNs/FCM — explicitly out of
 * scope this phase). Each stub's own `supportedSeverities`/`supportedNotificationTypes` still declare
 * full capability — capability is independent of whether today's routing policy
 * (`deliveryResolver.ts`) ever actually targets them; a stub is "not yet wired to a real send," not
 * "incapable of handling most notifications."
 */
import type { AttentionSignalSeverity } from '../attentionSignals'
import type { NotificationType } from '../notifications'
import type { DeliveryAdapter, DeliveryResult, DeliverySurface } from './types'

const ALL_SEVERITIES: readonly AttentionSignalSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
]

const STUB_REASON = 'stub_adapter_no_real_delivery'

interface AdapterConfig {
  surface: DeliverySurface
  supportedSeverities: readonly AttentionSignalSeverity[]
  supportedNotificationTypes: readonly NotificationType[] | 'all'
  deliver: DeliveryAdapter['deliver']
}

/**
 * Exported (not just used internally) so a future real adapter — and this phase's own tests, which
 * need a way to build a differently-configured adapter without falling into the exact
 * "spread-and-override doesn't rebind a closure" trap OS-B4.5 already found once — can reuse this same
 * capability-check factory instead of reimplementing it.
 */
export function createAdapter(config: AdapterConfig): DeliveryAdapter {
  return {
    surface: config.surface,
    supportedSeverities: config.supportedSeverities,
    supportedNotificationTypes: config.supportedNotificationTypes,
    canDeliver(notification) {
      const severityOk = config.supportedSeverities.includes(notification.severity)
      const typeOk =
        config.supportedNotificationTypes === 'all' ||
        config.supportedNotificationTypes.includes(notification.type)
      return severityOk && typeOk
    },
    deliver: config.deliver,
  }
}

function stubResult(surface: DeliverySurface): DeliveryAdapter['deliver'] {
  return (notification) => ({ surface, notificationId: notification.id, delivered: false, reason: STUB_REASON })
}

export const inAppDeliveryAdapter: DeliveryAdapter = createAdapter({
  surface: 'in_app',
  supportedSeverities: ALL_SEVERITIES,
  supportedNotificationTypes: 'all',
  deliver: (notification): DeliveryResult => ({
    surface: 'in_app',
    notificationId: notification.id,
    delivered: true,
    reason: null,
  }),
})

export const emailDeliveryAdapter: DeliveryAdapter = createAdapter({
  surface: 'email',
  supportedSeverities: ALL_SEVERITIES,
  supportedNotificationTypes: 'all',
  deliver: stubResult('email'),
})

export const pushDeliveryAdapter: DeliveryAdapter = createAdapter({
  surface: 'push',
  supportedSeverities: ALL_SEVERITIES,
  supportedNotificationTypes: 'all',
  deliver: stubResult('push'),
})

export const mobileDeliveryAdapter: DeliveryAdapter = createAdapter({
  surface: 'mobile',
  supportedSeverities: ALL_SEVERITIES,
  supportedNotificationTypes: 'all',
  deliver: stubResult('mobile'),
})

export const defaultDeliveryAdapters: readonly DeliveryAdapter[] = [
  inAppDeliveryAdapter,
  emailDeliveryAdapter,
  pushDeliveryAdapter,
  mobileDeliveryAdapter,
]
