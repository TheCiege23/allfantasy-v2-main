/**
 * Fantasy OS Suite — Phase OS-B4: Notification Engine Foundation.
 *
 * `resolveNotificationFeed` is the standalone resolver — proves its own fetch/aggregate contract at
 * the `resolveAttentionQueueSnapshot` / `resolveDailyBrief` boundary, not `composeNotificationFeed`'s
 * own correctness (already covered by `notifications.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveNotificationFeed } from '@/lib/decision-os/notificationResolver'
import * as attentionQueue from '@/lib/decision-os/attentionQueue'
import * as dailyBriefResolver from '@/lib/decision-os/dailyBriefResolver'
import type { AttentionQueueSnapshot } from '@/lib/decision-os/attentionQueue'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { composeDailyBrief, type DailyBriefInput } from '@/lib/decision-os/dailyBrief'

vi.mock('@/lib/decision-os/attentionQueue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/attentionQueue')>(
    '@/lib/decision-os/attentionQueue',
  )
  return { ...actual, resolveAttentionQueueSnapshot: vi.fn() }
})

vi.mock('@/lib/decision-os/dailyBriefResolver', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/dailyBriefResolver')>(
    '@/lib/decision-os/dailyBriefResolver',
  )
  return { ...actual, resolveDailyBrief: vi.fn() }
})

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

function emptyAttentionSnapshot(signals: DecisionOsAttentionSignal[] = []): AttentionQueueSnapshot {
  return { generatedAt: NOW.toISOString(), signals, warnings: [] }
}

const mockAttentionQueue = () => vi.mocked(attentionQueue.resolveAttentionQueueSnapshot)
const mockDailyBrief = () => vi.mocked(dailyBriefResolver.resolveDailyBrief)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveNotificationFeed', () => {
  it('composes a feed from the real attention snapshot and daily brief, priority-sorted', async () => {
    const sig = signal({ id: 'a', leagueId: 'L1', severity: 'critical', type: 'low_league_health' })
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot([sig]))
    mockDailyBrief().mockResolvedValue(composeDailyBrief(briefInput(), NOW))

    const feed = await resolveNotificationFeed(['L1'], NOW)
    expect(feed).toHaveLength(1)
    expect(feed[0].source).toBe('a')
  })

  it('includes a real brief notification when the resolved brief has content', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockDailyBrief().mockResolvedValue(
      composeDailyBrief(briefInput({ signals: [signal({ id: 'a', leagueId: 'L1', severity: 'high', type: 'low_league_health' })] }), NOW),
    )

    const feed = await resolveNotificationFeed(['L1'], NOW)
    expect(feed.some((n) => n.type === 'daily_brief')).toBe(true)
  })

  it('passes the exact leagueIds and now through to both dependencies', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockDailyBrief().mockResolvedValue(composeDailyBrief(briefInput(), NOW))

    await resolveNotificationFeed(['L1', 'L2'], NOW)
    expect(mockAttentionQueue()).toHaveBeenCalledWith(['L1', 'L2'], NOW)
    expect(mockDailyBrief()).toHaveBeenCalledWith(['L1', 'L2'], NOW)
  })

  it('returns an empty feed when neither dependency has anything real to report', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockDailyBrief().mockResolvedValue(composeDailyBrief(briefInput(), NOW))

    expect(await resolveNotificationFeed([], NOW)).toEqual([])
  })
})
