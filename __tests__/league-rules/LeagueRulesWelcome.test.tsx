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

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.clear()
  fetchMock = vi.fn(async (url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k))
    return { ok: Boolean(key), json: async () => (key ? responses[key] : {}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('LeagueRulesWelcome', () => {
  it('opens once the rules have loaded, leads with the Guilly rules, and is not shown again after "Got it"', async () => {
    const { unmount } = render(<LeagueRulesWelcome league={league} userId="u1" onSeeAllRules={vi.fn()} />)
    await screen.findByTestId('league-rules-welcome')
    expect(screen.getByText('How Ciege NBA Guilly works')).toBeTruthy()
    expect(screen.getByTestId('league-rules-welcome-how-guilly-works')).toBeTruthy()
    expect(screen.getByTestId('league-rules-welcome-blind-auction')).toBeTruthy()
    fireEvent.click(screen.getByTestId('league-rules-welcome-close'))
    await waitFor(() => expect(screen.queryByTestId('league-rules-welcome')).toBeNull())
    expect(window.localStorage.getItem(rulesWelcomeStorageKey('lg1', 'u1'))).toBe('1')
    unmount()

    fetchMock.mockClear()
    render(<LeagueRulesWelcome league={league} userId="u1" onSeeAllRules={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
    // A manager who has seen it costs no requests.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('"See all rules" marks it seen and opens the rules page', async () => {
    const onSeeAllRules = vi.fn()
    render(<LeagueRulesWelcome league={league} userId="u2" onSeeAllRules={onSeeAllRules} />)
    fireEvent.click(await screen.findByTestId('league-rules-welcome-see-all'))
    expect(onSeeAllRules).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(rulesWelcomeStorageKey('lg1', 'u2'))).toBe('1')
  })

  it('waits while another sheet or intro is showing, then opens', async () => {
    const { rerender } = render(<LeagueRulesWelcome league={league} userId="u3" blocked onSeeAllRules={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('league-rules-welcome')).toBeNull()
    rerender(<LeagueRulesWelcome league={league} userId="u3" blocked={false} onSeeAllRules={vi.fn()} />)
    await screen.findByTestId('league-rules-welcome')
  })

  it('each manager sees it once per league', () => {
    expect(rulesWelcomeStorageKey('lg1', 'u1')).not.toBe(rulesWelcomeStorageKey('lg1', 'u2'))
    expect(rulesWelcomeStorageKey('lg1', 'u1')).not.toBe(rulesWelcomeStorageKey('lg2', 'u1'))
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
