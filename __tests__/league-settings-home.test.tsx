/**
 * The Sleeper-style League Settings page (2026-10-18): one list of sections with current values,
 * rows that open focused sub-pages, a guillotine section only for guillotine leagues, and a
 * read-only list for members.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  buildLeagueSettingsHome,
  formatDraftDateTime,
  formatRosterSummary,
  type BuildSettingsHomeInput,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { LeagueSettingsHome } from '@/components/league-settings/home/LeagueSettingsHome'

const teams = Array.from({ length: 16 }, (_, i) => ({
  claimedByUserId: i < 2 ? `u${i}` : null,
  isCoCommissioner: false,
  ownerName: `Owner ${i}`,
}))

function input(overrides: Partial<BuildSettingsHomeInput> = {}, league: Partial<BuildSettingsHomeInput['league']> = {}): BuildSettingsHomeInput {
  return {
    league: {
      id: 'lg1',
      name: 'The Ciege NBA Guilly',
      sport: 'NBA',
      leagueSize: 16,
      leagueVariant: 'guillotine',
      guillotineMode: true,
      guillotineEndgame: 'last_team_standing',
      waiverType: 'faab',
      waiverBudget: 1000,
      tradeDeadlineWeek: null,
      settings: { scoring_mode: 'points', trade_review_mode: 'commissioner' },
      ...league,
    },
    teams,
    canEdit: true,
    formatLabel: 'Guilly',
    scoringLabel: null,
    rosterSlots: { UTIL: 4, SUPER_UTIL: 1, BN: 4, IL: 1 },
    draft: { dateIso: '2026-10-20T00:00:00.000Z', type: 'snake', rounds: 9, timerSeconds: 90, autostart: true },
    guillotine: { firstChopWeek: 10, endWeek: 24, locked: false },
    inviteUrl: 'https://allfantasy.ai/join?code=ABC123',
    viewerTimeZone: 'America/New_York',
    ...overrides,
  }
}

const rowValue = (id: string) => within(screen.getByTestId(`lsh-row-${id}`)).getByTitle(/.*/).textContent

function renderHome(i: BuildSettingsHomeInput, renderSubPage = vi.fn((id: string) => ({ title: `Edit ${id}`, content: <p>editor for {id}</p> }))) {
  const sections = buildLeagueSettingsHome(i)
  const view = render(<LeagueSettingsHome leagueName={i.league.name} sections={sections} canEdit={i.canEdit} renderSubPage={renderSubPage as never} />)
  return { renderSubPage, ...view }
}

describe('formatters', () => {
  it('summarises roster slots the Sleeper way', () => {
    expect(formatRosterSummary({ UTIL: 4, SUPER_UTIL: 1, BN: 4, IL: 1 })).toBe('UTIL ×4, SUPER_UTIL, 4 BN, 1 IL')
    expect(formatRosterSummary(null)).toBe('…')
  })
  it('shows the draft in the viewer’s zone', () => {
    expect(formatDraftDateTime('2026-10-20T00:00:00.000Z', 'America/New_York')).toBe('Mon Oct 19, 8:00 PM ET')
    expect(formatDraftDateTime(null)).toBe('Not scheduled')
  })
})

describe('LeagueSettingsHome — list', () => {
  it('renders every section with the current values', () => {
    renderHome(input())
    for (const id of ['general', 'roster-scoring', 'draft', 'trades', 'guillotine', 'members', 'commissioner']) {
      expect(screen.getByTestId(`lsh-section-${id}`)).toBeTruthy()
    }
    expect(rowValue('name')).toBe('The Ciege NBA Guilly')
    expect(rowValue('teams')).toBe('16')
    expect(rowValue('format')).toBe('Guilly · Points')
    expect(rowValue('roster')).toBe('UTIL ×4, SUPER_UTIL, 4 BN, 1 IL')
    expect(rowValue('draft-date')).toBe('Mon Oct 19, 8:00 PM ET')
    expect(rowValue('draft-shape')).toBe('Snake · 9 rounds · 90s')
    expect(rowValue('draft-autostart')).toBe('On')
    expect(rowValue('waivers')).toBe('FAAB · $1,000')
    expect(rowValue('trades')).toBe('Commissioner review · no deadline')
    // One row for the one Guilly rules page (2026-11-25): it was five rows opening three pages.
    expect(rowValue('guilly-rules')).toBe('First chop week 10 · One chop a week · Last team standing')
    expect(rowValue('chop-schedule')).toContain('Waivers Thursday 7:00 AM ET')
    for (const gone of ['first-chop', 'chop-rules', 'league-rules', 'endgame']) expect(screen.queryByTestId(`lsh-row-${gone}`), gone).toBeNull()
    expect(rowValue('managers')).toBe('2 / 16 joined')
    expect(screen.getByTestId('lsh-copy-invite')).toBeTruthy()
  })

  it('lists Waivers in General beside Format, and Dues & payouts as its own commissioner row', () => {
    renderHome(input())
    const general = screen.getByTestId('lsh-section-general')
    expect([...general.querySelectorAll('[data-testid^="lsh-row-"]')].map((r) => r.getAttribute('data-testid'))).toEqual([
      'lsh-row-name',
      'lsh-row-teams',
      'lsh-row-format',
      'lsh-row-waivers',
      // An NBA league can be a copy league since 2026-11-19 (lib/league/copyLeagueTeamTables.ts).
      'lsh-row-af-options',
    ])
    expect(rowValue('af-options')).toBe('Copy league')
    expect(screen.getByTestId('lsh-section-trades').querySelector('[data-testid="lsh-row-waivers"]')).toBeNull()
    expect(screen.getByTestId('lsh-section-commissioner').querySelector('[data-testid="lsh-row-dues"]')).toBeTruthy()
  })

  it('🛑 guillotine section only for Guilly leagues; playoffs hidden for guillotine', () => {
    renderHome(input())
    expect(screen.queryByTestId('lsh-section-guillotine')).toBeTruthy()
    expect(screen.queryByTestId('lsh-section-playoffs')).toBeNull()
  })

  it('a redraft league gets playoffs and no guillotine section', () => {
    renderHome(input({ formatLabel: 'Redraft', guillotine: null }, { leagueVariant: null, guillotineMode: false, playoffTeams: 6, playoffStartWeek: 15 }))
    expect(screen.queryByTestId('lsh-section-guillotine')).toBeNull()
    expect(screen.getByTestId('lsh-section-playoffs')).toBeTruthy()
    expect(rowValue('playoffs')).toBe('6 teams · starts Wk 15')
  })

  it('puts Pirate rules in commissioner settings and keeps them visible to members', () => {
    const pirate = input(
      { formatLabel: 'Pirate League', guillotine: null },
      { leagueType: 'pirate', leagueVariant: 'pirate', guillotineMode: false,
        settings: { conceptRules: { extensions: { pirate: { protectionLimit: 3, selectionHours: 24, claimHours: 24, overflowGraceHours: 24, playoffClaims: true } } } } },
    )
    const view = renderHome(pirate)
    expect(screen.getByTestId('lsh-section-pirate')).toBeTruthy()
    expect(rowValue('pirate-rules')).toBe('3 protected · 24h to choose · 24h to respond')
    expect(rowValue('pirate-playoffs')).toBe('On')
    fireEvent.click(screen.getByTestId('lsh-row-pirate-rules'))
    expect(view.renderSubPage).toHaveBeenCalledWith('pirate-rules')
    view.unmount()
    renderHome({ ...pirate, canEdit: false })
    expect(screen.getByTestId('lsh-section-pirate')).toBeTruthy()
    expect(screen.getByTestId('lsh-row-pirate-rules').getAttribute('data-readonly')).toBe('true')
  })

  it('🛑 members see the same values read-only: no editors, no commissioner tools', () => {
    renderHome(input({ canEdit: false }))
    expect(screen.getByTestId('lsh-readonly-note')).toBeTruthy()
    expect(rowValue('waivers')).toBe('FAAB · $1,000')
    expect(screen.queryByTestId('lsh-section-commissioner')).toBeNull()
    for (const id of ['name', 'roster', 'draft-date', 'waivers', 'trades', 'guilly-rules', 'managers']) {
      const row = screen.getByTestId(`lsh-row-${id}`)
      expect(row.tagName).toBe('DIV')
      expect(row.getAttribute('data-readonly')).toBe('true')
    }
    expect(screen.queryAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['lsh-row-previous-leagues', 'lsh-copy-invite'])
    fireEvent.click(screen.getByTestId('lsh-row-previous-leagues'))
    expect(screen.getByTestId('league-settings-subpage').getAttribute('data-subpage')).toBe('previous-leagues')
  })

  it('offers team settings and lets the commissioner enable divisions when currently off', () => {
    renderHome(input())
    expect(screen.getByTestId('lsh-row-team-settings').tagName).toBe('BUTTON')
    expect(rowValue('divisions')).toBe('Off')
    fireEvent.click(screen.getByTestId('lsh-row-divisions'))
    expect(screen.getByTestId('league-settings-subpage').getAttribute('data-subpage')).toBe('divisions')
  })

  it('the Guilly rules row opens the one page, and still does once the first chop week is locked', () => {
    // The page holds every rule; a locked first chop week is one disabled field on it, not a dead row.
    const { renderSubPage } = renderHome(input({ guillotine: { firstChopWeek: 10, endWeek: 24, locked: true, scheduleLines: ['From week 10: 2 teams a week.'] } }))
    expect(rowValue('guilly-rules')).toBe('First chop week 10 · 2 teams a week · Last team standing')
    const row = screen.getByTestId('lsh-row-guilly-rules')
    expect(row.tagName).toBe('BUTTON')
    fireEvent.click(row)
    expect(renderSubPage).toHaveBeenLastCalledWith('guillotine-rules')
  })
})

describe('LeagueSettingsHome — sub-pages', () => {
  it('tapping a row opens its sub-page; back returns to the list', () => {
    const { renderSubPage } = renderHome(input())
    fireEvent.click(screen.getByTestId('lsh-row-roster'))
    expect(renderSubPage).toHaveBeenCalledWith('roster')
    const sub = screen.getByTestId('league-settings-subpage')
    expect(sub.getAttribute('data-subpage')).toBe('roster')
    expect(screen.getByRole('heading', { name: 'Edit roster' })).toBeTruthy()
    expect(screen.getByText('editor for roster')).toBeTruthy()
    expect(screen.queryByTestId('league-settings-home')).toBeNull()

    fireEvent.click(screen.getByTestId('lsh-back'))
    expect(screen.getByTestId('league-settings-home')).toBeTruthy()
    expect(screen.queryByTestId('league-settings-subpage')).toBeNull()
  })

  it('all three draft rows open the one draft editor', () => {
    const { renderSubPage } = renderHome(input())
    fireEvent.click(screen.getByTestId('lsh-row-draft-autostart'))
    expect(renderSubPage).toHaveBeenLastCalledWith('draft')
  })
})

describe('Delete league has its own row (2026-11-24)', () => {
  const rowIds = (i: BuildSettingsHomeInput) => buildLeagueSettingsHome(i).flatMap((s) => s.rows.map((r) => r.id))

  it('the head commissioner gets a Delete league row that opens its own sub-page', () => {
    const row = buildLeagueSettingsHome(input({ canDelete: true })).flatMap((s) => s.rows).find((r) => r.id === 'delete-league')
    expect(row).toMatchObject({ label: 'Delete league', target: 'delete-league' })
  })

  it('a co-commissioner (canEdit, not canDelete) and a member get no Delete league row', () => {
    expect(rowIds(input())).not.toContain('delete-league')
    expect(rowIds(input({ canEdit: false, canDelete: false }))).not.toContain('delete-league')
  })
})
