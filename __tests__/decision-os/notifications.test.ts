/**
 * Fantasy OS Suite — Phase OS-B4: Notification Engine Foundation.
 *
 * `composeNotificationFeed`/`notificationFromSignal`/`notificationFromDailyBrief`/`sortNotifications`
 * are pure and zero-I/O — no Prisma or Decision OS resolver mocking needed. Covers signal-to-
 * notification transformation, daily-brief-to-notification transformation (including its "only when
 * there's real content" gate), deterministic ordering, deduplication, and delivery-policy mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  composeNotificationFeed,
  notificationFromDailyBrief,
  notificationFromSignal,
  sortNotifications,
} from '@/lib/decision-os/notifications'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { composeDailyBrief, type DailyBriefInput } from '@/lib/decision-os/dailyBrief'

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

function briefInput(o: Partial<DailyBriefInput> = {}): DailyBriefInput {
  return { leaguesMonitored: 0, healthyLeagueCount: 0, draftsApproachingCount: 0, signals: [], leagueTrends: [], ...o }
}

describe('notificationFromSignal', () => {
  it('reuses the signal\'s own fields verbatim — never recomputes severity, title, or explanation', () => {
    const s = signal({
      id: 'low_league_health:L1',
      leagueId: 'L1',
      severity: 'high',
      type: 'low_league_health',
      title: 'League health needs attention',
      explanation: 'Overall status is at_risk.',
      recommendedAction: 'Review League Health.',
    })
    const n = notificationFromSignal(s)
    expect(n).toMatchObject({
      id: 'notification:low_league_health:L1',
      severity: 'high',
      leagueId: 'L1',
      title: 'League health needs attention',
      body: 'Overall status is at_risk.',
      recommendedAction: 'Review League Health.',
      createdAt: NOW.toISOString(),
      source: 'low_league_health:L1',
      expiresAt: null,
    })
  })

  it.each([
    ['league_context_incomplete', 'league_context_incomplete'],
    ['draft_approaching', 'draft_approaching'],
    ['low_league_health', 'low_league_health'],
    ['high_league_health', 'high_league_health'],
  ] as const)('maps the named signal type %s directly to notification type %s', (signalType, notificationType) => {
    const n = notificationFromSignal(signal({ id: 'x', leagueId: 'L1', severity: 'medium', type: signalType }))
    expect(n.type).toBe(notificationType)
  })

  it('maps league_requires_review to the generic attention_signal type (no dedicated name given)', () => {
    const n = notificationFromSignal(signal({ id: 'x', leagueId: 'L1', severity: 'high', type: 'league_requires_review' }))
    expect(n.type).toBe('attention_signal')
  })

  it.each([
    ['critical', 'immediate'],
    ['high', 'prominent'],
    ['medium', 'center'],
    ['low', 'inbox'],
    ['informational', 'inbox'],
  ] as const)('maps severity %s to the deterministic delivery policy %s', (severity, policy) => {
    const n = notificationFromSignal(signal({ id: 'x', leagueId: 'L1', severity, type: 'low_league_health' }))
    expect(n.surfacePolicy).toBe(policy)
  })
})

describe('notificationFromDailyBrief', () => {
  it('produces no notification for a fully empty/healthy brief — never tells you "you have nothing to be told"', () => {
    const brief = composeDailyBrief(briefInput(), NOW)
    expect(notificationFromDailyBrief(brief)).toBeNull()
  })

  it('produces a notification when the brief has a real priority item, using its severity', () => {
    const brief = composeDailyBrief(
      briefInput({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'critical', type: 'low_league_health' })] }),
      NOW,
    )
    const n = notificationFromDailyBrief(brief)
    expect(n?.severity).toBe('critical')
    expect(n?.type).toBe('daily_brief')
    expect(n?.leagueId).toBeNull()
    expect(n?.body).toBe(brief.summary)
  })

  it('falls back to informational severity when the brief has content but no severity above informational', () => {
    const brief = composeDailyBrief(
      briefInput({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'informational', type: 'high_league_health' })] }),
      NOW,
    )
    const n = notificationFromDailyBrief(brief)
    expect(n?.severity).toBe('informational')
  })

  it('produces a notification for real league highlights even with no priority items', () => {
    const brief = composeDailyBrief(
      briefInput({ leagueTrends: [{ leagueId: 'L1', direction: 'increasing', eventCountDelta: 5 }] }),
      NOW,
    )
    expect(notificationFromDailyBrief(brief)).not.toBeNull()
  })

  it('never invents a recommendedAction beyond the brief\'s own first recommended action', () => {
    const brief = composeDailyBrief(
      briefInput({
        signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health', recommendedAction: 'Review League Health.' })],
      }),
      NOW,
    )
    const n = notificationFromDailyBrief(brief)
    expect(n?.recommendedAction).toBe('Review League Health.')
  })

  it('has a deterministic id keyed on the brief\'s own generatedAt', () => {
    const brief = composeDailyBrief(
      briefInput({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' })] }),
      NOW,
    )
    expect(notificationFromDailyBrief(brief)?.id).toBe(`notification:daily_brief:${NOW.toISOString()}`)
  })
})

describe('sortNotifications', () => {
  it('orders strictly by severity: critical > high > medium > low > informational', () => {
    const mk = (id: string, severity: DecisionOsAttentionSignal['severity']) =>
      notificationFromSignal(signal({ id, leagueId: 'L1', severity, type: 'low_league_health' }))
    const sorted = sortNotifications([mk('a', 'low'), mk('b', 'critical'), mk('c', 'informational'), mk('d', 'medium'), mk('e', 'high')])
    expect(sorted.map((n) => n.id)).toEqual([
      'notification:b', 'notification:e', 'notification:d', 'notification:a', 'notification:c',
    ])
  })

  it('orders newest createdAt first within the same severity', () => {
    const older = notificationFromSignal(signal({ id: 'older', leagueId: 'L1', severity: 'high', type: 'low_league_health', timestamp: NOW.toISOString() }))
    const newer = notificationFromSignal(
      signal({ id: 'newer', leagueId: 'L1', severity: 'high', type: 'low_league_health', timestamp: new Date(NOW.getTime() + 1000).toISOString() }),
    )
    expect(sortNotifications([older, newer]).map((n) => n.id)).toEqual(['notification:newer', 'notification:older'])
  })

  it('does not mutate the input array', () => {
    const notifications = [notificationFromSignal(signal({ id: 'a', leagueId: 'L1', severity: 'low', type: 'low_league_health' }))]
    const original = [...notifications]
    sortNotifications(notifications)
    expect(notifications).toEqual(original)
  })
})

describe('composeNotificationFeed', () => {
  it('produces one notification per real signal plus one for the brief, priority-sorted', () => {
    const feed = composeNotificationFeed({
      signals: [
        signal({ id: 'a', leagueId: 'L1', severity: 'medium', type: 'draft_approaching' }),
        signal({ id: 'b', leagueId: 'L2', severity: 'critical', type: 'low_league_health' }),
      ],
      brief: composeDailyBrief(briefInput({ signals: [signal({ id: 'c', leagueId: 'L3', severity: 'high', type: 'low_league_health' })] }), NOW),
    })
    expect(feed.map((n) => n.type)).toEqual(['low_league_health', 'daily_brief', 'draft_approaching'])
  })

  it('omits the brief notification entirely when no brief is provided', () => {
    const feed = composeNotificationFeed({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' })] })
    expect(feed).toHaveLength(1)
    expect(feed[0].type).toBe('low_league_health')
  })

  it('deduplicates by deterministic id — a repeated signal produces exactly one notification', () => {
    const s = signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' })
    const feed = composeNotificationFeed({ signals: [s, s] })
    expect(feed).toHaveLength(1)
  })

  it('returns an empty feed for zero signals and no brief', () => {
    expect(composeNotificationFeed({ signals: [] })).toEqual([])
  })
})
