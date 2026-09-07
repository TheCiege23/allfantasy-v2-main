import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RecommendationsView } from '@/components/commissioner-os/recommendations/RecommendationsView'
import type { CommissionerRecommendationContract } from '@/lib/commissioner-ui/contracts'

/**
 * Recommendations Center after it stopped discarding its own answer.
 *
 * The client used to fetch real recommendations and throw them away because the contract demanded
 * four fields nothing computes. These tests pin the mapping AND the two places where making those
 * fields optional could silently re-empty the module.
 *
 * ⚠ The wire fixtures below are the shape of `LeagueRecommendationV1` as the ROUTE returns it —
 * verified by calling `leagueIntelligenceHandler` against production and reading the keys, not by
 * reading what the derivation layer computes. Those differ: the pipeline emits a `signal` field
 * and the route strips it, so a title keyed on `signal` passes a pipeline probe and is `undefined`
 * for every real request.
 */

vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({
  resolveActiveLeagueId: vi.fn(async () => 'league-1'),
}))
const callDecisionOS = vi.fn()
vi.mock('@/lib/commissioner-ui/adapter/transport', () => ({ callDecisionOS: (...a: unknown[]) => callDecisionOS(...a) }))

const WIRE = {
  data: {
    recommendations: [
      {
        recommendationId: 'rec_follow_up_critical_risk',
        priority: 'critical',
        category: 'retention',
        message: '4 manager(s) are at critical risk of abandoning the league. Direct outreach is recommended immediately.',
      },
      {
        recommendationId: 'rec_spark_trade_activity',
        priority: 'medium',
        category: 'activity',
        message: 'No trades have been proposed. Consider posting a trade block.',
      },
      {
        recommendationId: 'rec_brand_new_signal',
        priority: 'high',
        category: 'moderation',
        message: 'Something new the backend started emitting.',
      },
    ],
  },
  meta: { derivedAt: '2026-09-07T22:57:10.013Z' },
}

async function getQueue() {
  const { liveRecommendationsClient } = await import(
    '@/lib/commissioner-ui/recommendations/decision-os-client/live'
  )
  return liveRecommendationsClient.getQueue()
}

describe('recommendations — live mapping', () => {
  beforeEach(() => {
    callDecisionOS.mockReset()
    callDecisionOS.mockResolvedValue({ data: WIRE, error: null })
  })

  it('returns the real recommendations instead of discarding them', async () => {
    const res = await getQueue()
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(3)
    expect(res.data![0].rationale).toContain('critical risk of abandoning')
  })

  it('maps priority onto the severity vocabulary without collapsing it', async () => {
    /*
     * The regression guard for routing this through `normalizeSeverity`, which validates against
     * SeverityTier and falls back to 'standard' — that would put critical/high/medium/low all on
     * 'standard' except critical, silently downgrading every high-priority recommendation.
     */
    const res = await getQueue()
    const bySeverity = Object.fromEntries(res.data!.map((r) => [r.id, r.severity]))
    expect(bySeverity['rec_follow_up_critical_risk']).toBe('critical')
    expect(bySeverity['rec_brand_new_signal']).toBe('elevated') // high, NOT standard
    expect(bySeverity['rec_spark_trade_activity']).toBe('standard')
  })

  it('keeps retention distinct from engagement', async () => {
    const res = await getQueue()
    const byCategory = Object.fromEntries(res.data!.map((r) => [r.id, r.category]))
    expect(byCategory['rec_follow_up_critical_risk']).toBe('health_and_risk')
    expect(byCategory['rec_spark_trade_activity']).toBe('engagement')
    expect(byCategory['rec_brand_new_signal']).toBe('competitive_integrity')
  })

  it('titles a known id, and renders an unknown one as itself rather than a generic label', async () => {
    const res = await getQueue()
    const byId = Object.fromEntries(res.data!.map((r) => [r.id, r.title]))
    expect(byId['rec_follow_up_critical_risk']).toBe('Managers at risk of leaving')
    // A new backend id must be visibly new, not indistinguishable from a mapped one.
    expect(byId['rec_brand_new_signal']).toBe('Brand new signal')
  })

  it('omits the four unsourced fields rather than defaulting them', async () => {
    const res = await getQueue()
    for (const rec of res.data!) {
      expect(rec.confidence).toBeUndefined()
      expect(rec.expectedImpact).toBeUndefined()
      expect(rec.primaryActionLabel).toBeUndefined()
      expect(rec.status).toBeUndefined()
    }
  })

  it('takes createdAt from meta, where the route actually puts it', async () => {
    const res = await getQueue()
    expect(res.data![0].createdAt).toBe('2026-09-07T22:57:10.013Z')
  })
})

describe('recommendations — the modules that compose over it', () => {
  beforeEach(() => {
    callDecisionOS.mockReset()
    callDecisionOS.mockResolvedValue({ data: WIRE, error: null })
  })

  /*
   * Activity Stream and Notification Center are pure composition layers over this client — they
   * were permanently empty for exactly one reason: every source returned null. Asserting they
   * populate is the difference between "this should light them up" and knowing it does.
   */
  it('Activity Stream now produces events', async () => {
    const { liveActivityClient } = await import('@/lib/commissioner-ui/activity/decision-os-client/live')
    const res = await liveActivityClient.getEvents()
    const fromRecs = (res.data ?? []).filter((e) => e.sourceModuleId === 'recommendations')
    expect(fromRecs.length).toBe(3)
    expect(fromRecs[0].summary).toBeTruthy()
    expect(fromRecs[0].timestamp).toBe('2026-09-07T22:57:10.013Z')
  })

  it('Notification Center now produces notifications', async () => {
    const { liveNotificationsClient } = await import(
      '@/lib/commissioner-ui/notifications/decision-os-client/live'
    )
    const res = await liveNotificationsClient.getNotifications()
    const fromRecs = (res.data ?? []).filter((n) => n.sourceModuleId === 'recommendations')
    expect(fromRecs.length).toBe(3)
    expect(fromRecs.map((n) => n.message)).toContain('Managers at risk of leaving')
  })
})

describe('recommendations — a statusless recommendation must still be visible', () => {
  const statusless: CommissionerRecommendationContract[] = [
    {
      id: 'r1',
      title: 'Inactive managers need outreach',
      rationale: '7 managers have not been active recently.',
      severity: 'critical',
      category: 'health_and_risk',
      sourceModuleId: 'recommendations',
      createdAt: new Date().toISOString(),
    },
  ]

  it('shows it in the queue', () => {
    /*
     * 🛑 THE SILENT-EMPTY TRAP. The view filtered on `statuses.includes(rec.status)`, which is
     * false for `undefined` — so once `status` became optional, every real recommendation would
     * have been filtered out. The module would fetch, map and render perfectly, and show nothing.
     */
    render(<RecommendationsView recommendations={statusless} dataMode="live" />)
    expect(screen.getByText('Inactive managers need outreach')).toBeInTheDocument()
  })

  it('does not show it under History', () => {
    // The control: statusless means "not yet triaged", which is the opposite of archived. Without
    // this, "always return true" would satisfy the queue assertion above and be wrong.
    render(<RecommendationsView recommendations={statusless} dataMode="live" />)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.queryByText('Inactive managers need outreach')).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing archived recently/)).toBeInTheDocument()
  })

  it('renders no metadata line and no action footer when those fields are absent', () => {
    render(<RecommendationsView recommendations={statusless} dataMode="live" />)
    // A defaulted confidence would print a level nothing scored; an empty button would do nothing.
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
  })
})
