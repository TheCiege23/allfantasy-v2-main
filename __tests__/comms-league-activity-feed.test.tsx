import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LeagueActivityFeed from '@/components/core-app/comms/LeagueActivityFeed'

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    type: 'trade',
    userId: 'u1',
    userName: 'Rival',
    description: 'Rival traded Brian Thomas Jr. for a 1st',
    timestamp: new Date().toISOString(),
    leagueId: 'lg1',
    leagueName: 'Kings League',
    href: null,
    ...overrides,
  }
}

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ json: async () => body })
}

describe('LeagueActivityFeed', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  /* The cross-league mode of the endpoint: no leagueId is the whole point. */
  it('asks for activity across all leagues, not one', async () => {
    const f = mockFetch({ status: 'ok', items: [] })
    vi.stubGlobal('fetch', f)

    render(<LeagueActivityFeed />)

    await waitFor(() => expect(f).toHaveBeenCalled())
    const url = String(f.mock.calls[0][0])
    expect(url).toContain('/api/shared/activity')
    expect(url).not.toContain('leagueId')
  })

  /*
   * 🛑 THE GRADE ON A FEED TRADE (2026-09-27). A trade read "A gets X · B gets Y" and nothing else,
   * while every other trade surface showed each team's letter.
   */
  it('draws each team’s letter on a graded trade, and says when it was graded', async () => {
    const graded = item({ tradeGrade: { graded: true, basis: 'today', sides: [{ name: 'Hoovi', letter: 'D' }, { name: 'Nicolodeon', letter: 'B' }] } })
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [graded] }))
    const { container } = render(<LeagueActivityFeed />)
    await screen.findByText('Kings League')
    const chips = [...container.querySelectorAll('.af-cm-act-grade-chip')].map((c) => c.textContent)
    expect(chips).toEqual(['Hoovi D', 'Nicolodeon B'])
    expect(screen.getByText('on this league’s values today')).toBeTruthy()
  })

  it('a withheld grade says why with no letter, and an ungraded trade draws nothing', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [
      item({ id: 'w', tradeGrade: { graded: false, reason: 'FAAB in this trade is not priced on the league chart' } }),
      item({ id: 'n' }),
    ] }))
    const { container } = render(<LeagueActivityFeed />)
    expect(await screen.findByText('Not graded: FAAB in this trade is not priced on the league chart')).toBeTruthy()
    expect(container.querySelectorAll('.af-cm-act-grade-chip')).toHaveLength(0)
    expect(container.querySelectorAll('.af-cm-act-grade')).toHaveLength(1)
  })

  it('names the league each item came from', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [item()] }))

    render(<LeagueActivityFeed />)

    expect(await screen.findByText('Kings League')).toBeTruthy()
    expect(screen.getByText(/traded Brian Thomas/)).toBeTruthy()
  })

  /*
   * A nameless row would read as belonging to whichever league the reader last
   * had open — worse than saying we do not know.
   */
  it('says so when an item carries no league', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [item({ leagueName: null, leagueId: null })] }))

    render(<LeagueActivityFeed />)

    expect(await screen.findByText('League not identified')).toBeTruthy()
  })

  it('offers a way through when the item deep-links', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [item({ href: '/league/lg1/trades' })] }))

    render(<LeagueActivityFeed />)

    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/league/lg1/trades')
  })

  it('falls back to opening the league when there is no deep link', async () => {
    const onOpenLeague = vi.fn()
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [item()] }))

    render(<LeagueActivityFeed onOpenLeague={onOpenLeague} />)

    const btn = await screen.findByRole('button')
    btn.click()
    expect(onOpenLeague).toHaveBeenCalledWith('lg1')
  })

  /*
   * 429 means "not right now", not "nothing happened". Conflating them tells a
   * user their leagues went quiet when the server merely throttled.
   */
  it('distinguishes throttling from an empty feed', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'rate_limited', items: [] }))

    render(<LeagueActivityFeed />)

    expect(await screen.findByText(/Activity is catching up/)).toBeTruthy()
    expect(screen.queryByText(/No recent activity/)).toBeNull()
  })

  it('reports a genuinely empty feed as empty', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok', items: [] }))

    render(<LeagueActivityFeed />)

    expect(await screen.findByText(/No recent activity/)).toBeTruthy()
  })

  it('survives a failed request without breaking the panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<LeagueActivityFeed />)

    expect(await screen.findByText(/Could not load league activity/)).toBeTruthy()
  })
})
