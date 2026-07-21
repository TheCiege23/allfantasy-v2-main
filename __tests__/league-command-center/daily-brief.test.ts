/**
 * Covers the Commissioner Daily Brief rules.
 *
 * The brief is a pure projection of an already-resolved `MissionControlSnapshot`,
 * so these tests pin the properties that make it safe to ship:
 *  - every line is backed by a real snapshot number (no invented events);
 *  - a flattering default score is NEVER stated for a league whose signal is not
 *    trustworthy (imported, no synced activity);
 *  - the honest "operating normally" all-clear only appears when health was
 *    actually measured, nothing is a concern (by the engine's own `overallStatus`,
 *    not a raw score band), and the queue is genuinely empty.
 */
import { describe, expect, it } from 'vitest'
import { buildCommandCenterDailyBrief } from '@/lib/league-command-center/dailyBrief'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueActivityTrendSummary } from '@/lib/decision-os/dashboard-intelligence'

function snapshotWith(args: {
  score?: number
  status?: string
  inactive?: number
  atRisk?: number
  trend?: LeagueActivityTrendSummary
  urgent?: number
  standard?: number
  healthAvailable?: boolean
  activityEventCount?: number
}): MissionControlSnapshot {
  const risk = Array.from({ length: args.atRisk ?? 0 }, (_, i) => ({
    managerId: `m${i}`,
    retentionRisk: 'elevated',
    retentionRiskReasons: ['inactive'],
    isInactive: true,
  }))
  const recommendedActions = [
    ...Array.from({ length: args.urgent ?? 0 }, (_, i) => ({
      priority: 'urgent' as const,
      message: `urgent ${i}`,
    })),
    ...Array.from({ length: args.standard ?? 0 }, (_, i) => ({
      priority: 'standard' as const,
      message: `standard ${i}`,
    })),
  ]

  return {
    leagueId: 'league-1',
    generatedAt: '2026-07-20T09:00:00.000Z',
    leagueHealth:
      args.healthAvailable === false
        ? { available: false, reason: 'league_health_unavailable' }
        : {
            available: true,
            result: {
              engine: {
                overallStatus: args.status ?? 'healthy',
                leagueHealthScore: args.score ?? 82,
              },
              decisionOs: { activityEventCount: args.activityEventCount ?? 25 },
            },
          },
    trend: args.trend ?? { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: args.inactive ?? 0 },
    activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
    managersAtRetentionRisk: risk,
    recommendedActions,
    fieldProvenance: null,
  } as unknown as MissionControlSnapshot
}

const MORNING = new Date(2026, 6, 20, 9, 0, 0)

type BriefArgs = Parameters<typeof buildCommandCenterDailyBrief>[0]

/** Sensible defaults (native league, head commissioner, morning) — override per test. */
function brief(overrides: Partial<BriefArgs> & Pick<BriefArgs, 'snapshot'>) {
  return buildCommandCenterDailyBrief({
    sourceIsNative: true,
    commissionerName: 'Blake',
    viewerIsHeadCommissioner: true,
    nextDeadline: null,
    now: MORNING,
    ...overrides,
  })
}

describe('buildCommandCenterDailyBrief', () => {
  it('reports unavailable (not empty) when no snapshot resolved', () => {
    const result = brief({ snapshot: null })
    expect(result.available).toBe(false)
    expect(result.lines).toHaveLength(0)
    expect(result.allClear).toBe(false)
  })

  it('personalizes the greeting only for the head commissioner', () => {
    expect(brief({ snapshot: snapshotWith({}), viewerIsHeadCommissioner: true }).greeting).toBe(
      'Good morning, Blake.',
    )
    expect(brief({ snapshot: snapshotWith({}), viewerIsHeadCommissioner: false }).greeting).toBe(
      'Good morning.',
    )
  })

  it('emits an honest all-clear when a measured healthy league has nothing flagged', () => {
    const result = brief({ snapshot: snapshotWith({ score: 82, status: 'healthy' }) })
    expect(result.allClear).toBe(true)
    expect(result.lines.some((l) => l.id === 'all-clear')).toBe(true)
    expect(result.lines.every((l) => l.tone !== 'warn' && l.tone !== 'bad')).toBe(true)
  })

  it('never emits an all-clear when the health score itself is poor', () => {
    const result = brief({ snapshot: snapshotWith({ score: 41, status: 'at_risk' }) })
    expect(result.allClear).toBe(false)
    expect(result.lines.some((l) => l.id === 'all-clear')).toBe(false)
    const healthLine = result.lines.find((l) => l.id === 'health')
    expect(healthLine?.tone).toBe('bad')
    expect(healthLine?.text).toContain('41/100')
  })

  it('treats the "watch" band as a concern (by overallStatus, not a score threshold)', () => {
    const result = brief({ snapshot: snapshotWith({ score: 58, status: 'watch' }) })
    const healthLine = result.lines.find((l) => l.id === 'health')
    expect(healthLine?.tone).toBe('warn')
    expect(healthLine?.text).toContain('58/100')
    expect(result.allClear).toBe(false)
  })

  it('WITHHOLDS a numeric score for an untrustworthy imported league (no synced activity)', () => {
    const result = brief({
      snapshot: snapshotWith({ score: 81, status: 'excellent', activityEventCount: 0 }),
      sourceIsNative: false,
    })
    const healthLine = result.lines.find((l) => l.id === 'health')
    expect(healthLine).toBeDefined()
    expect(healthLine?.text).not.toContain('/100')
    expect(healthLine?.text.toLowerCase()).toContain('measurable')
    // Health was not actually measured, so no "operating normally".
    expect(result.allClear).toBe(false)
  })

  it('never emits an all-clear when the snapshot is degraded (health unavailable)', () => {
    const result = brief({ snapshot: snapshotWith({ healthAvailable: false }) })
    const healthLine = result.lines.find((l) => l.id === 'health')
    expect(healthLine?.text.toLowerCase()).toContain("couldn't be assessed")
    expect(result.allClear).toBe(false)
    expect(result.lines.some((l) => l.id === 'all-clear')).toBe(false)
  })

  it('surfaces inactive managers with the real count and blocks the all-clear', () => {
    const result = brief({ snapshot: snapshotWith({ inactive: 2 }) })
    const line = result.lines.find((l) => l.id === 'inactive')
    expect(line?.tone).toBe('warn')
    expect(line?.text).toContain('2 managers have')
    expect(result.allClear).toBe(false)
  })

  it('flags retention risk and urgent items as concerns', () => {
    const result = brief({ snapshot: snapshotWith({ atRisk: 1, urgent: 3, standard: 1 }) })
    expect(result.lines.find((l) => l.id === 'retention')?.tone).toBe('bad')
    expect(result.lines.find((l) => l.id === 'retention')?.text).toContain('1 manager shows')
    expect(result.lines.find((l) => l.id === 'urgent')?.text).toContain('3 urgent')
    expect(result.allClear).toBe(false)
  })

  it('does not declare all-clear while non-urgent items sit in the queue', () => {
    const result = brief({ snapshot: snapshotWith({ standard: 2 }) })
    expect(result.lines.find((l) => l.id === 'actions')?.text).toContain('2 items are')
    expect(result.allClear).toBe(false)
    expect(result.lines.some((l) => l.id === 'all-clear')).toBe(false)
  })

  it('describes activity trend direction without inventing a percentage or a double negative', () => {
    const down = brief({
      snapshot: snapshotWith({
        trend: {
          available: true,
          periodsTracked: 4,
          earliestPeriodKey: 'w1',
          latestPeriodKey: 'w4',
          latestEventCount: 8,
          latestManagerCount: 9,
          eventCountDelta: -6,
          direction: 'decreasing',
        },
      }),
    })
    const line = down.lines.find((l) => l.id === 'trend')
    expect(line?.tone).toBe('warn')
    expect(line?.text).toContain('6 events')
    expect(line?.text).not.toContain('%')
    expect(line?.text).not.toContain('-6')
  })

  it('includes a next-deadline line when one is supplied', () => {
    const result = brief({
      snapshot: snapshotWith({}),
      nextDeadline: { label: 'Waivers', display: 'in 6h 42m' },
    })
    expect(result.lines.find((l) => l.id === 'deadline')?.text).toBe('Waivers in 6h 42m.')
  })

  it('computes a relative freshness label from generatedAt', () => {
    const now = new Date(Date.parse('2026-07-20T09:00:00.000Z') + 3 * 60_000)
    expect(brief({ snapshot: snapshotWith({}), commissionerName: null, now }).freshnessLabel).toBe(
      'Updated 3 minutes ago',
    )
  })
})
