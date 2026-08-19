/**
 * Fantasy OS Suite — Phase OS-B5: Multi-Channel Delivery Adapter Foundation.
 *
 * Each of the 4 default adapters is pure and zero-I/O. Covers interface conformance, capability
 * matching (`canDeliver`), and honest delivery outcomes (`deliver` — real for in-app, stubbed
 * elsewhere, never a fabricated success).
 */
import { describe, expect, it } from 'vitest'
import {
  createAdapter,
  defaultDeliveryAdapters,
  emailDeliveryAdapter,
  inAppDeliveryAdapter,
  mobileDeliveryAdapter,
  pushDeliveryAdapter,
} from '@/lib/decision-os/delivery/adapters'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { notificationFromSignal } from '@/lib/decision-os/notifications'

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

const CRITICAL_NOTIFICATION = notificationFromSignal(
  signal({ id: 'a', leagueId: 'L1', severity: 'critical', type: 'low_league_health' }),
)

describe('interface conformance', () => {
  it.each([
    ['in_app', inAppDeliveryAdapter],
    ['email', emailDeliveryAdapter],
    ['push', pushDeliveryAdapter],
    ['mobile', mobileDeliveryAdapter],
  ] as const)('%s adapter exposes the full DeliveryAdapter contract', (surface, adapter) => {
    expect(adapter.surface).toBe(surface)
    expect(Array.isArray(adapter.supportedSeverities)).toBe(true)
    expect(adapter.supportedSeverities.length).toBeGreaterThan(0)
    expect(typeof adapter.canDeliver).toBe('function')
    expect(typeof adapter.deliver).toBe('function')
  })

  it('defaultDeliveryAdapters registers exactly the 4 built adapters, one per surface, no duplicates', () => {
    const surfaces = defaultDeliveryAdapters.map((a) => a.surface)
    expect(surfaces).toEqual(['in_app', 'email', 'push', 'mobile'])
    expect(new Set(surfaces).size).toBe(4)
  })
})

describe('inAppDeliveryAdapter', () => {
  it('canDeliver is true for every real notification (full declared capability)', () => {
    expect(inAppDeliveryAdapter.canDeliver(CRITICAL_NOTIFICATION)).toBe(true)
  })

  it('deliver is a REAL implementation — always claims a genuine delivered:true', () => {
    const result = inAppDeliveryAdapter.deliver(CRITICAL_NOTIFICATION)
    expect(result).toEqual({
      surface: 'in_app',
      notificationId: CRITICAL_NOTIFICATION.id,
      delivered: true,
      reason: null,
    })
  })
})

describe.each([
  ['email', emailDeliveryAdapter],
  ['push', pushDeliveryAdapter],
  ['mobile', mobileDeliveryAdapter],
] as const)('%s adapter (stub)', (surface, adapter) => {
  it('canDeliver is true for a notification within its declared capability', () => {
    expect(adapter.canDeliver(CRITICAL_NOTIFICATION)).toBe(true)
  })

  it('deliver NEVER claims delivered:true — no SMTP/APNs/FCM integration exists yet', () => {
    const result = adapter.deliver(CRITICAL_NOTIFICATION)
    expect(result.delivered).toBe(false)
    expect(result.reason).toBe('stub_adapter_no_real_delivery')
    expect(result.surface).toBe(surface)
    expect(result.notificationId).toBe(CRITICAL_NOTIFICATION.id)
  })
})

describe('canDeliver capability matching', () => {
  it('returns false when the notification severity is outside supportedSeverities', () => {
    const restricted = createAdapter({
      surface: 'in_app',
      supportedSeverities: ['critical'],
      supportedNotificationTypes: 'all',
      deliver: (n) => ({ surface: 'in_app', notificationId: n.id, delivered: true, reason: null }),
    })
    expect(restricted.canDeliver(CRITICAL_NOTIFICATION)).toBe(true)
    const lowSeverityNotification = notificationFromSignal(
      signal({ id: 'b', leagueId: 'L1', severity: 'low', type: 'league_context_incomplete' }),
    )
    expect(restricted.canDeliver(lowSeverityNotification)).toBe(false)
  })

  it('returns false when the notification type is outside supportedNotificationTypes', () => {
    const restricted = createAdapter({
      surface: 'in_app',
      supportedSeverities: ['critical', 'high', 'medium', 'low', 'informational'],
      supportedNotificationTypes: ['draft_approaching'],
      deliver: (n) => ({ surface: 'in_app', notificationId: n.id, delivered: true, reason: null }),
    })
    expect(restricted.canDeliver(CRITICAL_NOTIFICATION)).toBe(false) // CRITICAL_NOTIFICATION is low_league_health
  })
})
