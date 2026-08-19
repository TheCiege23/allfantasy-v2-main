/**
 * Fantasy OS Suite — Phase OS-B5: Multi-Channel Delivery Adapter Foundation.
 *
 * `resolveDeliveryPlan` is pure and zero-I/O. Covers routing (severity -> target surfaces), adapter
 * selection (missing/declining adapters honestly skipped), delivery planning shape, deterministic
 * ordering (preserves input order), and unsupported-surface handling.
 */
import { describe, expect, it } from 'vitest'
import { resolveDeliveryPlan } from '@/lib/decision-os/delivery/deliveryResolver'
import { createAdapter, defaultDeliveryAdapters } from '@/lib/decision-os/delivery/adapters'
import type { DeliveryAdapter } from '@/lib/decision-os/delivery/types'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { notificationFromSignal, type DecisionOsNotification } from '@/lib/decision-os/notifications'

const NOW = new Date('2026-07-09T12:00:00Z')

function signal(o: Partial<DecisionOsAttentionSignal> & Pick<DecisionOsAttentionSignal, 'id' | 'leagueId' | 'severity' | 'type'>): DecisionOsAttentionSignal {
  return {
    priorityScore: SEVERITY_RANK[o.severity],
    title: 'Title',
    explanation: 'Explanation',
    recommendedAction: null,
    timestamp: NOW.toISOString(),
    source: 'league_health_engine',
    ...o,
  }
}

function notification(severity: DecisionOsAttentionSignal['severity'], id = 'a'): DecisionOsNotification {
  return notificationFromSignal(signal({ id, leagueId: 'L1', severity, type: 'low_league_health' }))
}

describe('resolveDeliveryPlan — routing', () => {
  it('routes a critical notification to both in_app and email', () => {
    const plan = resolveDeliveryPlan([notification('critical')], defaultDeliveryAdapters, NOW)
    expect(plan.entries[0].targetSurfaces).toEqual(['in_app', 'email'])
  })

  it.each(['high', 'medium', 'low', 'informational'] as const)(
    'routes a %s notification to in_app only',
    (severity) => {
      const plan = resolveDeliveryPlan([notification(severity)], defaultDeliveryAdapters, NOW)
      expect(plan.entries[0].targetSurfaces).toEqual(['in_app'])
    },
  )

  it('an empty notification list produces an empty plan, never an error', () => {
    const plan = resolveDeliveryPlan([], defaultDeliveryAdapters, NOW)
    expect(plan).toEqual({ generatedAt: NOW.toISOString(), entries: [], inApp: [] })
  })
})

describe('resolveDeliveryPlan — adapter selection and honest results', () => {
  it('the real in_app result is delivered:true; the stub email result for a critical notification is delivered:false', () => {
    const plan = resolveDeliveryPlan([notification('critical')], defaultDeliveryAdapters, NOW)
    const results = plan.entries[0].results
    expect(results.find((r) => r.surface === 'in_app')).toMatchObject({ delivered: true, reason: null })
    expect(results.find((r) => r.surface === 'email')).toMatchObject({
      delivered: false,
      reason: 'stub_adapter_no_real_delivery',
    })
  })

  it('a surface with no registered adapter is honestly skipped, never producing a fabricated result', () => {
    const noEmailAdapters = defaultDeliveryAdapters.filter((a) => a.surface !== 'email')
    const plan = resolveDeliveryPlan([notification('critical')], noEmailAdapters, NOW)
    const results = plan.entries[0].results
    expect(results.some((r) => r.surface === 'email')).toBe(false)
    expect(results.find((r) => r.surface === 'in_app')).toMatchObject({ delivered: true })
  })

  it('an adapter that declines via canDeliver is skipped — no result recorded for it', () => {
    const restrictedInApp: DeliveryAdapter = createAdapter({
      surface: 'in_app',
      supportedSeverities: [], // capable of nothing
      supportedNotificationTypes: 'all',
      deliver: (n) => ({ surface: 'in_app', notificationId: n.id, delivered: true, reason: null }),
    })
    const plan = resolveDeliveryPlan([notification('high')], [restrictedInApp], NOW)
    expect(plan.entries[0].results).toEqual([])
    expect(plan.inApp).toEqual([])
  })
})

describe('resolveDeliveryPlan — the inApp convenience array', () => {
  it('includes every notification the in_app adapter actually delivered, in input order', () => {
    const notifications = [notification('critical', 'a'), notification('low', 'b'), notification('high', 'c')]
    const plan = resolveDeliveryPlan(notifications, defaultDeliveryAdapters, NOW)
    // notificationFromSignal prefixes ids with "notification:" — asserting the real, prefixed shape.
    expect(plan.inApp.map((n) => n.id)).toEqual(['notification:a', 'notification:b', 'notification:c'])
  })

  it('preserves deterministic caller-supplied ordering — never re-sorts', () => {
    // Deliberately NOT severity-sorted input — resolveDeliveryPlan trusts the caller already sorted
    // (composeNotificationFeed's own job), it doesn't re-derive ordering itself.
    const notifications = [notification('low', 'low-one'), notification('critical', 'critical-one')]
    const plan = resolveDeliveryPlan(notifications, defaultDeliveryAdapters, NOW)
    expect(plan.inApp.map((n) => n.id)).toEqual(['notification:low-one', 'notification:critical-one'])
  })

  it('excludes a notification the in_app adapter did not deliver', () => {
    const noInAppAdapters = defaultDeliveryAdapters.filter((a) => a.surface !== 'in_app')
    const plan = resolveDeliveryPlan([notification('critical')], noInAppAdapters, NOW)
    expect(plan.inApp).toEqual([])
  })
})

describe('resolveDeliveryPlan — regression against real defaultDeliveryAdapters', () => {
  it('a full, realistic multi-severity feed produces the expected inApp set and email-only-for-critical routing', () => {
    const notifications = [
      notification('critical', 'crit'),
      notification('high', 'high'),
      notification('medium', 'med'),
      notification('informational', 'info'),
    ]
    const plan = resolveDeliveryPlan(notifications, defaultDeliveryAdapters, NOW)

    expect(plan.inApp.map((n) => n.id)).toEqual([
      'notification:crit',
      'notification:high',
      'notification:med',
      'notification:info',
    ])
    const emailedIds = plan.entries
      .filter((e) => e.results.some((r) => r.surface === 'email'))
      .map((e) => e.notification.id)
    expect(emailedIds).toEqual(['notification:crit'])
  })
})
