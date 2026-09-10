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

/**
 * 🛑 ACTIVITY AND NOTIFICATIONS FAN OUT OVER FIVE LIVE CLIENTS, THREE OF WHICH READ THE DATABASE —
 * AND `prisma` IS `null` BY DESIGN IN THIS FILE.
 *
 * `lib/prisma.ts` returns null when `typeof window !== "undefined"`, and this is a `.tsx` suite, so
 * it runs under jsdom. Both `liveActivityClient.getEvents()` and `composeNotifications()` await:
 *
 *     league-health · recommendations · automations · reports · workspace (activity only)
 *
 * league-health and recommendations go through `callDecisionOS`, already mocked above. The other
 * three each read a store module, so the two tests below died on
 * `Cannot read properties of null (reading 'automationRun')`.
 *
 * ⚠ THAT IS NOT A MISSING DELEGATE ON AN EXISTING MOCK — THIS SUITE NEVER MOCKED PRISMA AT ALL. It
 * did not need to until the composition path grew database reads underneath it.
 *
 * ⚠ AND THE STORES ARE STUBBED RATHER THAN `@/lib/prisma`, DELIBERATELY. A blanket prisma stub would
 * make every future database read anywhere under this composition silently return a fake instead of
 * failing loudly — which is how a suite stops testing what its name says. These tests assert what
 * RECOMMENDATIONS contribute (they filter on `sourceModuleId === 'recommendations'`), so the
 * neighbours are emptied at their own seams and stay visible.
 *
 * ⚠ EVERY EXPORT THE CALLERS IMPORT IS STUBBED, not just the one that threw first — fixing them one
 * at a time is how this failed twice. A partial mock is the failure mode where a suite keeps passing
 * against a stand-in that no longer matches its module.
 */
vi.mock('@/lib/commissioner-automations/automationLedgerReads', () => ({
  readAutomationAggregates: vi.fn(async () => []),
  readAutomationRuns: vi.fn(async () => []),
}))
vi.mock('@/lib/commissioner-reports/reportStore', () => ({
  readReportHistory: vi.fn(async () => []),
  /* A Map, not an array — `catalogEntries` calls `.get()` on it. */
  readLastRunByTemplate: vi.fn(async () => new Map<string, Date>()),
}))
vi.mock('@/lib/commissioner-workspace/taskStore', () => ({
  readLeagueTasks: vi.fn(async () => []),
  hasEverBeenScanned: vi.fn(async () => true),
}))

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
    /*
     * 🛑 THIS BLOCK NEEDS A TRANSPORT THAT ANSWERS PER MODULE, NOT ONE PAYLOAD FOR EVERYONE.
     *
     * The other describes here exercise the recommendations client alone, so a blanket
     * `mockResolvedValue(WIRE)` is right for them. These two go through Activity and Notification
     * composition, which also awaits `liveLeagueHealthClient.getRisks()` over the SAME transport —
     * and handing league-health a recommendations payload made it destructure
     * `intel.participationDistribution` off a shape that has no such field.
     *
     * ⚠ `callDecisionOS(moduleId, path, ...)` takes the caller's id first, so the double can be
     * honest about who is asking instead of pretending every module returns the same thing.
     * Neighbours get the transport's real "not configured" answer, which each live client already
     * handles by contributing nothing — leaving these assertions measuring recommendations only,
     * which is what they filter on.
     */
    callDecisionOS.mockImplementation(async (moduleId: unknown) => {
      if (moduleId === 'recommendations') return { data: WIRE, error: null }
      return {
        data: null,
        error: {
          category: 'upstream_unavailable' as const,
          message: 'Not configured in this test.',
          moduleId,
          retryable: false,
          timestamp: '2026-09-07T22:57:10.013Z',
        },
      }
    })
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
