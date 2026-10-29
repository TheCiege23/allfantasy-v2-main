/**
 * The one-time rules welcome on a league home: shown once per manager per league, only when its
 * values have loaded and nothing else is on screen, with a way into "Rules explained".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LeagueRulesWelcome, rulesWelcomeStorageKey } from '@/components/league-rules/LeagueRulesWelcome'
import { LeagueRulebook } from '@/components/league-rules/LeagueRulebook'
import { buildLeagueRulebook } from '@/lib/league-rules/buildLeagueRulebook'

const league = {
  id: 'lg1',
  name: 'Ciege NBA Guilly',
  sport: 'NBA',
  leagueVariant: 'guillotine',
  guillotineMode: true,
  guillotineEndgame: 'last_team_standing',
  waiverType: 'faab',
  waiverBudget: 1000,
  settings: { scoring_mode: 'points' },
  teams: [],
  invites: [],
} as never

const responses: Record<string, unknown> = {
  'roster-settings': { config: { slots: { UTIL: 4, BN: 4 } } },
  'draft/settings': { draftDate: null, config: { draft_type: 'snake', rounds: 9, timer_seconds: 60 }, autostartEnabled: false },
  'guillotine/summary': {
    recentChopEvents: [],
    config: { eliminationStartWeek: 2, eliminationEndWeek: 20, teamsPerChop: 1, tiebreakerOrder: ['bench_points'], blindAuction: true },
  },
}

/** The account's saved snapshots, keyed by league — what /api/core/league-preferences stores. */
let server: Record<string, unknown>
let prefsDown = false
let fetchMock: ReturnType<typeof vi.fn>
const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  server = {}
  prefsDown = false
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/core/league-preferences')) {
      if (prefsDown) return { ok: false, json: async () => ({}) }
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        server[body.leagueId] = body.snapshot
        return { ok: true, json: async () => ({ ok: true }) }
      }
      const id = new URL(url, 'http://x').searchParams.get('rulesSeen')!
      return { ok: true, json: async () => ({ rulesSeen: server[id] ?? null }) }
    }
    const key = Object.keys(responses).find((k) => url.includes(k))
    return { ok: Boolean(key), json: async () => (key ? responses[key] : {}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const settle = () => new Promise((r) => setTimeout(r, 30))

describe('LeagueRulesWelcome — first visit', () => {
  it('opens once the rules have loaded, leads with the Guilly rules, and "Got it" saves what was shown to the account', async () => {
    const { unmount } = render(<LeagueRulesWelcome league={league} userId="u1" onSeeAllRules={vi.fn()} />)
    await screen.findByTestId('league-rules-welcome')
    expect(screen.getByText('How Ciege NBA Guilly works')).toBeTruthy()
    expect(screen.getByTestId('league-rules-welcome-how-guilly-works')).toBeTruthy()
    expect(screen.getByTestId('league-rules-welcome-blind-auction')).toBeTruthy()
    fireEvent.click(screen.getByTestId('league-rules-welcome-close'))
    await waitFor(() => expect(screen.queryByTestId('league-rules-welcome')).toBeNull())
    expect(posts()).toHaveLength(1)
    expect(posts()[0]).toMatchObject({ field: 'rulesSeen', leagueId: 'lg1', snapshot: { rules: { waivers: { value: 'FAAB · $1,000' } } } })
    unmount()

    // Next visit, from any device: nothing changed, nothing shown, nothing saved.
    window.sessionStorage.clear()
    fetchMock.mockClear()
    render(<LeagueRulesWelcome league={league} userId="u1" onSeeAllRules={vi.fn()} />)
    await settle()
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
    expect(screen.queryByTestId('league-rules-changed')).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('"See all rules" saves it as seen and opens the rules page', async () => {
    const onSeeAllRules = vi.fn()
    render(<LeagueRulesWelcome league={league} userId="u2" onSeeAllRules={onSeeAllRules} />)
    fireEvent.click(await screen.findByTestId('league-rules-welcome-see-all'))
    expect(onSeeAllRules).toHaveBeenCalledTimes(1)
    expect(posts()).toHaveLength(1)
  })

  it('waits while another sheet or intro is showing, then opens', async () => {
    const { rerender } = render(<LeagueRulesWelcome league={league} userId="u3" blocked onSeeAllRules={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await settle()
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
    rerender(<LeagueRulesWelcome league={league} userId="u3" blocked={false} onSeeAllRules={vi.fn()} />)
    await screen.findByTestId('league-rules-welcome')
  })

  it('someone who saw the part-1 welcome in this browser is not welcomed again; their snapshot is saved quietly', async () => {
    window.localStorage.setItem(rulesWelcomeStorageKey('lg1', 'u4'), '1')
    render(<LeagueRulesWelcome league={league} userId="u4" onSeeAllRules={vi.fn()} />)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
  })

  it('when the account cannot be read, nothing is shown', async () => {
    prefsDown = true
    render(<LeagueRulesWelcome league={league} userId="u5" onSeeAllRules={vi.fn()} />)
    await settle()
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
    // And no rules are fetched for a sheet that will not open.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('LeagueRulesWelcome — the rules changed (2026-10-29)', () => {
  it('switching back to the league home within a few minutes does not check again', async () => {
    const r = render(<LeagueRulesWelcome league={league} userId="u9" onSeeAllRules={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('league-rules-welcome-close'))
    r.unmount()
    fetchMock.mockClear()
    render(<LeagueRulesWelcome league={league} userId="u9" onSeeAllRules={vi.fn()} />)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  async function seeOnce(userId: string) {
    const r = render(<LeagueRulesWelcome league={league} userId={userId} onSeeAllRules={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('league-rules-welcome-close'))
    await waitFor(() => expect(server.lg1).toBeTruthy())
    r.unmount()
    // A later visit from another tab or device (this tab would skip the check for a few minutes).
    window.sessionStorage.clear()
    fetchMock.mockClear()
  }

  it('shows only what changed — before, after, what it means now — and "Got it" makes it the new baseline', async () => {
    await seeOnce('u6')
    const changed = { ...league as object, waiverBudget: 500 } as never
    const { unmount } = render(<LeagueRulesWelcome league={changed} userId="u6" onSeeAllRules={vi.fn()} />)
    await screen.findByTestId('league-rules-changed')
    expect(screen.getByText('Rules changed in Ciege NBA Guilly')).toBeTruthy()
    expect(screen.getByText('Your commissioner changed a rule since you last looked.')).toBeTruthy()
    const row = screen.getByTestId('league-rules-changed-waivers')
    expect(row.textContent).toContain('FAAB · $1,000')
    expect(row.textContent).toContain('FAAB · $500')
    expect(row.textContent).toContain('Each team has $500 for the season')
    // Only the change, not the whole rulebook.
    expect(screen.queryByTestId('league-rules-changed-how-guilly-works')).toBeNull()
    fireEvent.click(screen.getByTestId('league-rules-welcome-close'))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].snapshot.rules.waivers.value).toBe('FAAB · $500')
    unmount()

    window.sessionStorage.clear()
    fetchMock.mockClear()
    render(<LeagueRulesWelcome league={changed} userId="u6" onSeeAllRules={vi.fn()} />)
    await settle()
    expect(screen.queryByTestId('league-rules-changed')).toBeNull()
  })

  it('the draft time is saved and compared in one zone, so another device\'s clock is not a "change"', async () => {
    responses['draft/settings'] = { draftDate: '2026-11-01T00:00:00.000Z', config: { draft_type: 'snake', rounds: 9, timer_seconds: 60 }, autostartEnabled: true }
    try {
      await seeOnce('u8')
      expect((server.lg1 as { rules: Record<string, { value: string }> }).rules['draft-date']!.value).toBe('Sat Oct 31, 8:00 PM ET')
    } finally {
      responses['draft/settings'] = { draftDate: null, config: { draft_type: 'snake', rounds: 9, timer_seconds: 60 }, autostartEnabled: false }
    }
  })

  it('the commissioner is not shown their own changes; their baseline moves quietly', async () => {
    await seeOnce('u7')
    const changed = { ...league as object, waiverBudget: 500 } as never
    render(<LeagueRulesWelcome league={changed} userId="u7" isCommissioner onSeeAllRules={vi.fn()} />)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].snapshot.rules.waivers.value).toBe('FAAB · $500')
    expect(screen.queryByTestId('league-rules-changed')).toBeNull()
  })
})

describe('LeagueRulebook', () => {
  it('shows each rule with its value and meaning', () => {
    const sections = buildLeagueRulebook({
      league: { id: 'lg1', sport: 'NFL', waiverType: 'rolling', settings: {} },
      formatLabel: 'Redraft',
      scoringLabel: null,
      rosterSlots: { QB: 1, BN: 5 },
      draft: null,
      guillotine: null,
    })
    render(<LeagueRulebook sections={sections} />)
    const waivers = screen.getByTestId('rulebook-entry-waivers')
    expect(waivers.textContent).toContain('Rolling')
    expect(waivers.textContent).toContain('A successful claim sends you to the back of the waiver line.')
    expect(screen.getByTestId('rulebook-section-playoffs')).toBeTruthy()
  })
})

describe('League Settings → Rules explained', () => {
  it('a member (who cannot open any editor) can open the rules page', async () => {
    const { LeagueSettingsHomeContainer } = await import('@/components/league-settings/home/LeagueSettingsHomeContainer')
    render(
      <LeagueSettingsHomeContainer
        ctx={{
          league,
          displayLeague: { lifecycleState: 'in_season' },
          userId: 'u9',
          userTeam: null,
          sleeperLeagueId: null,
          platformLeagueId: '',
          isCommissioner: false,
          isHeadCommissioner: false,
          sleeperMemberMap: {},
          onGoToDraftTab: vi.fn(),
        } as never}
      />,
    )
    fireEvent.click(await screen.findByTestId('lsh-open-rulebook'))
    await screen.findByTestId('league-rulebook')
    await screen.findByTestId('rulebook-entry-blind-auction')
  })
})
