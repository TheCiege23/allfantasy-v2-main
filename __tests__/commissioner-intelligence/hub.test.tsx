import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { CommissionerIntelligenceHub } from '@/components/commissioner-intelligence/CommissionerIntelligenceHub'

type Route = { status: number; body?: unknown }
function installFetch(routes: Record<string, Route | ((url: string) => Route)>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.includes(k))
    const entry = key ? routes[key] : { status: 404 }
    const r = typeof entry === 'function' ? entry(url) : entry
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {} } as Response
  }) as unknown as typeof fetch
}

const activityOk = {
  status: 200,
  body: { data: { leagueId: 'L', sport: 'NFL', leagueConcept: 'redraft', totalEvents: 10, firstEventAt: null, lastActivityAt: '2026-06-27T00:00:00.000Z', openTradeProposals: 1, counts: { trade: 1, waiver: 2, lineup: 3, draft: 1, scoring: 2, governance: 0, lifecycle: 1, other: 0 } } },
}
const healthOk = { status: 200, body: { data: { leagueId: 'L', healthScore: 80, status: 'healthy', totalManagers: 12, activeManagers: 11, daysSinceLastActivity: 1, openTradeProposals: 1 } } }
const actionItemsOk = { status: 200, body: { data: [{ kind: 'pending_trades', severity: 'warning', message: '1 trade proposal(s) awaiting resolution.' }] } }
const auditOk = { status: 200, body: { data: [{ eventId: 'e1', type: 'competition.champion.crowned', summary: 'Champion crowned', occurredAt: '2026-06-27T00:00:00.000Z', actorType: 'system' }], meta: { nextCursor: null } } }

// G15.14 — story preview responses keyed by ?type=
const storyPreview = (type: string, over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { data: { type, title: 'Title ' + type, summary: 'A summary line', sections: [{ heading: 'Activity', body: '• thing one\n• thing two' }], safetyNote: 'Observations, not accusations.', status: 'ok', empty: false, generatedAt: '2026-06-28T00:00:00.000Z', sourceFreshness: '2026-06-27T00:00:00.000Z', ...over } },
})
const storyRoute = (url: string) => {
  const type = new URL('http://x' + url.slice(url.indexOf('/api'))).searchParams.get('type') ?? ''
  if (type === 'commissioner_summary' || type === 'health_narrative') return { status: 403 } // commissioner-only
  return storyPreview(type)
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('CommissionerIntelligenceHub', () => {
  it('renders all four modules with data', async () => {
    installFetch({ '/activity': activityOk, '/health': healthOk, '/action-items': actionItemsOk, '/audit-feed': auditOk })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    expect((await screen.findByTestId('activity-content')).textContent).toContain('10')
    expect((await screen.findByTestId('health-content')).textContent).toContain('healthy')
    expect(await screen.findByText(/awaiting resolution/)).toBeInTheDocument()
    expect(await screen.findByText('Champion crowned')).toBeInTheDocument()
  })

  it('shows empty states when models have no data', async () => {
    installFetch({
      '/activity': { status: 200, body: { data: { leagueId: 'L', totalEvents: 0, openTradeProposals: 0, lastActivityAt: null, counts: { trade: 0, waiver: 0, lineup: 0, draft: 0, scoring: 0, governance: 0, lifecycle: 0, other: 0 } } } },
      '/health': { status: 200, body: { data: { leagueId: 'L', healthScore: 0, status: 'unknown', totalManagers: 0, activeManagers: 0, daysSinceLastActivity: null, openTradeProposals: 0 } } },
      '/action-items': { status: 200, body: { data: [] } },
      '/audit-feed': { status: 200, body: { data: [], meta: { nextCursor: null } } },
    })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    expect(await screen.findByTestId('activity-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('health-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('action-items-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('audit-feed-empty')).toBeInTheDocument()
  })

  it('shows commissioner-only state for forbidden modules without leaking data', async () => {
    installFetch({ '/activity': activityOk, '/health': { status: 403 }, '/action-items': { status: 403 }, '/audit-feed': auditOk })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    // member modules still render
    expect(await screen.findByTestId('activity-content')).toBeInTheDocument()
    // commissioner-only modules show restricted state, not data
    const health = await screen.findByTestId('module-health')
    expect(within(health).getByTestId('state-restricted').textContent).toContain('Commissioner only')
    expect(within(health).queryByTestId('health-content')).toBeNull()
    const ai = await screen.findByTestId('module-action-items')
    expect(within(ai).getByTestId('state-restricted')).toBeInTheDocument()
  })

  it('shows upgrade state on 402', async () => {
    installFetch({ '/activity': activityOk, '/health': { status: 402 }, '/action-items': actionItemsOk, '/audit-feed': auditOk })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    const health = await screen.findByTestId('module-health')
    expect(within(health).getByTestId('state-upgrade')).toBeInTheDocument()
  })

  it('paginates the audit feed via Load more', async () => {
    installFetch({
      '/activity': activityOk,
      '/health': healthOk,
      '/action-items': actionItemsOk,
      '/audit-feed': (url: string) =>
        url.includes('cursor=c1')
          ? { status: 200, body: { data: [{ eventId: 'e2', type: 'transaction.trade.accepted', summary: 'Trade accepted', occurredAt: '2026-06-26T00:00:00.000Z', actorType: 'user' }], meta: { nextCursor: null } } }
          : { status: 200, body: { data: [{ eventId: 'e1', type: 'competition.champion.crowned', summary: 'Champion crowned', occurredAt: '2026-06-27T00:00:00.000Z', actorType: 'system' }], meta: { nextCursor: 'c1' } } },
    })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    const loadMore = await screen.findByTestId('audit-feed-load-more')
    fireEvent.click(loadMore)
    expect(await screen.findByText('Trade accepted')).toBeInTheDocument()
    expect(screen.getByText('Champion crowned')).toBeInTheDocument() // first page still present (appended)
  })

  it('renders read-only story cards: member types show content, commissioner-only show restricted', async () => {
    installFetch({ '/activity': activityOk, '/health': healthOk, '/action-items': actionItemsOk, '/audit-feed': auditOk, '/preview': storyRoute })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    const weekly = await screen.findByTestId('story-card-weekly_recap')
    expect(within(weekly).getByTestId('story-content-weekly_recap')).toBeInTheDocument()
    expect(within(weekly).getByTestId('story-safety-weekly_recap').textContent).toMatch(/not accusations/i)
    // commissioner-only story type renders restricted, never its content
    const comm = await screen.findByTestId('story-card-commissioner_summary')
    expect(within(comm).getByTestId('state-restricted').textContent).toContain('Commissioner only')
    expect(within(comm).queryByTestId('story-content-commissioner_summary')).toBeNull()
  })

  it('shows a safe story empty-state when there is not enough activity', async () => {
    installFetch({
      '/activity': activityOk, '/health': healthOk, '/action-items': actionItemsOk, '/audit-feed': auditOk,
      '/preview': (url: string) => {
        const type = new URL('http://x' + url.slice(url.indexOf('/api'))).searchParams.get('type') ?? ''
        return storyPreview(type, { empty: true, status: 'empty', summary: 'Not enough recorded league activity yet to tell this story.', sections: [] })
      },
    })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    expect((await screen.findByTestId('story-empty-weekly_recap')).textContent).toMatch(/not enough recorded league activity/i)
  })

  it('shows upgrade state on a premium-gated story type (402)', async () => {
    installFetch({
      '/activity': activityOk, '/health': healthOk, '/action-items': actionItemsOk, '/audit-feed': auditOk,
      '/preview': (url: string) => (url.includes('weekly_recap') ? { status: 402 } : storyRoute(url)),
    })
    render(<CommissionerIntelligenceHub leagueId="L" />)
    const weekly = await screen.findByTestId('story-card-weekly_recap')
    expect(within(weekly).getByTestId('state-upgrade')).toBeInTheDocument()
  })

  it('does not render raw payload/PII (only contract DTO fields)', async () => {
    installFetch({ '/activity': activityOk, '/health': healthOk, '/action-items': actionItemsOk, '/audit-feed': auditOk })
    const { container } = render(<CommissionerIntelligenceHub leagueId="L" />)
    await screen.findByTestId('audit-feed-content')
    expect(container.textContent).not.toMatch(/payload/i)
    expect(container.textContent).not.toMatch(/passwordHash|token|email@/i)
  })
})
