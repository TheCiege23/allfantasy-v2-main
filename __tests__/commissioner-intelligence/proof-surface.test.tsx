/**
 * Commissioner Intelligence Platform — Phase 1 proof-pass additions.
 *
 * The existing hub.test.tsx already covers data / empty / forbidden / upgrade /
 * pagination / stories / no-PII. These add the two proof-surface guarantees that
 * weren't yet asserted, without duplicating that coverage:
 *   1. the hub renders OBSERVATIONAL alerts, never prescriptive recommendations;
 *   2. the hub calls ONLY the documented read-only intelligence/story routes —
 *      never an AI/recommendation endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CommissionerIntelligenceHub } from '@/components/commissioner-intelligence/CommissionerIntelligenceHub'

type Route = { status: number; body?: unknown }
const calledUrls: string[] = []
function installFetch(routes: Record<string, Route | ((url: string) => Route)>) {
  calledUrls.length = 0
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calledUrls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    const entry = key ? routes[key] : { status: 404 }
    const r = typeof entry === 'function' ? entry(url) : entry
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {} } as Response
  }) as unknown as typeof fetch
}

// Realistic, snapshot-shaped commissioner payloads (a mid-season redraft league).
const REALISTIC: Record<string, Route | ((url: string) => Route)> = {
  '/activity': {
    status: 200,
    body: { data: { leagueId: 'L', sport: 'NFL', leagueConcept: 'redraft', totalEvents: 42, firstEventAt: null, lastActivityAt: '2026-11-01T00:00:00.000Z', openTradeProposals: 2, counts: { trade: 6, waiver: 9, lineup: 14, draft: 1, scoring: 8, governance: 1, lifecycle: 2, other: 1 } } },
  },
  '/health': { status: 200, body: { data: { leagueId: 'L', healthScore: 78, status: 'cooling', totalManagers: 12, activeManagers: 9, daysSinceLastActivity: 3, openTradeProposals: 2 } } },
  '/action-items': {
    status: 200,
    body: { data: [
      { kind: 'pending_trades', severity: 'warning', message: '2 trade proposal(s) awaiting resolution.' },
      { kind: 'inactive_managers', severity: 'action', message: '3 manager(s) inactive for over 14 days.' },
    ] },
  },
  '/audit-feed': { status: 200, body: { data: [{ eventId: 'e1', type: 'transaction.trade.accepted', summary: 'Trade accepted', occurredAt: '2026-11-01T00:00:00.000Z', actorType: 'user' }], meta: { nextCursor: null } } },
  '/preview': (url: string) => {
    const type = new URL('http://x' + url.slice(url.indexOf('/api'))).searchParams.get('type') ?? ''
    if (type === 'commissioner_summary' || type === 'health_narrative') return { status: 403 }
    return { status: 200, body: { data: { type, title: 'Title ' + type, summary: 'League activity summary line.', sections: [{ heading: 'Activity', body: '• Two trades were completed.\n• Nine waiver moves were processed.' }], safetyNote: 'Observations, not accusations.', status: 'ok', empty: false, generatedAt: '2026-11-02T00:00:00.000Z', sourceFreshness: '2026-11-01T00:00:00.000Z' } } }
  },
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('CommissionerIntelligenceHub — proof surface (Phase 1 audit)', () => {
  it('renders OBSERVATIONAL alerts, not prescriptive recommendations', async () => {
    installFetch(REALISTIC)
    const { container } = render(<CommissionerIntelligenceHub leagueId="L" />)
    await screen.findByTestId('activity-content')
    await screen.findByTestId('action-items-content')
    await screen.findByTestId('story-content-weekly_recap')
    const text = (container.textContent ?? '').toLowerCase()
    // Prescriptive/imperative advice phrasing — none of it should appear. (We scan
    // phrases, not category nouns like "trade"/"waiver" which are legit event labels.)
    for (const phrase of ['you should', 'we recommend', 'i recommend', 'i suggest', 'you must', 'you ought', 'trade for', 'pick up ', 'should start', 'should sit', 'should add', 'should drop', 'must start', 'we advise']) {
      expect(text).not.toContain(phrase)
    }
  })

  it('calls ONLY documented read-only intelligence/story routes (no AI/recommendation endpoints)', async () => {
    installFetch(REALISTIC)
    render(<CommissionerIntelligenceHub leagueId="L" />)
    await screen.findByTestId('audit-feed-content')
    await screen.findByTestId('story-card-weekly_recap')
    expect(calledUrls.length).toBeGreaterThan(0)
    const allowed = /\/api\/v1\/(intelligence\/leagues\/[^/]+\/(activity|health|action-items|audit-feed)|stories\/leagues\/[^/]+\/preview)/
    for (const url of calledUrls) {
      expect(url).toMatch(allowed)
      expect(url).not.toMatch(/\/api\/(ai|ai-tools)|waiver-recs|trade-finder|recommend|analyzer|matchup-prep/i)
    }
  })
})

describe('CommissionerIntelligenceHub — demo readiness (Phase 2)', () => {
  it('renders ALL FIVE modules with live-like data plus a back-to-league CTA', async () => {
    installFetch(REALISTIC)
    render(<CommissionerIntelligenceHub leagueId="L" />)
    expect(await screen.findByTestId('activity-content')).toBeTruthy()
    expect(await screen.findByTestId('health-content')).toBeTruthy()
    expect(await screen.findByTestId('action-items-content')).toBeTruthy()
    expect(await screen.findByTestId('audit-feed-content')).toBeTruthy()
    expect(await screen.findByTestId('story-content-weekly_recap')).toBeTruthy()
    const cta = screen.getByTestId('commissioner-hub-back-cta')
    expect(cta.getAttribute('href')).toBe('/league/L')
  })

  it('leaks no raw manager/provider IDs and shows no placeholder copy on the demo surface', async () => {
    installFetch(REALISTIC)
    const { container } = render(<CommissionerIntelligenceHub leagueId="L" />)
    await screen.findByTestId('audit-feed-content')
    await screen.findByTestId('action-items-content')
    const text = container.textContent ?? ''
    expect(/\d{10,}/.test(text)).toBe(false) // no long numeric provider/Sleeper IDs
    expect(text).not.toMatch(/managerKeys|platformUserId|payload/i)
    expect(text).not.toMatch(/coming soon|expanding soon|placeholder/i)
  })

  it('keeps upgrade + commissioner-only states honest alongside populated modules', async () => {
    installFetch({ ...REALISTIC, '/health': { status: 402 } })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    // Activity still renders while Health honestly shows the upgrade state.
    expect(await screen.findByTestId('activity-content')).toBeTruthy()
    const health = await screen.findByTestId('module-health')
    expect(within(health).getByTestId('state-upgrade')).toBeInTheDocument()
    expect(within(health).queryByTestId('health-content')).toBeNull()
  })
})
