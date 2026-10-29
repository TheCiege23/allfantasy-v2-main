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
import { GuillotineFirstChopEditor } from '@/components/league-settings/home/GuillotineFirstChopEditor'

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
  render(<LeagueSettingsHome leagueName={i.league.name} sections={sections} canEdit={i.canEdit} renderSubPage={renderSubPage as never} />)
  return { renderSubPage }
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
    for (const id of ['general', 'roster-scoring', 'draft', 'waivers-trades', 'guillotine', 'members', 'commissioner']) {
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
    expect(rowValue('first-chop')).toBe('Week 10')
    expect(rowValue('chop-schedule')).toContain('Waivers Thursday 7:00 AM ET')
    expect(rowValue('endgame')).toBe('Last team standing')
    expect(rowValue('managers')).toBe('2 / 16 joined')
    expect(screen.getByTestId('lsh-copy-invite')).toBeTruthy()
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

  it('🛑 members see the same values read-only: no editors, no commissioner tools', () => {
    renderHome(input({ canEdit: false }))
    expect(screen.getByTestId('lsh-readonly-note')).toBeTruthy()
    expect(rowValue('waivers')).toBe('FAAB · $1,000')
    expect(screen.queryByTestId('lsh-section-commissioner')).toBeNull()
    for (const id of ['name', 'roster', 'draft-date', 'waivers', 'trades', 'first-chop', 'managers']) {
      const row = screen.getByTestId(`lsh-row-${id}`)
      expect(row.tagName).toBe('DIV')
      expect(row.getAttribute('data-readonly')).toBe('true')
    }
    expect(screen.queryAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['lsh-copy-invite'])
  })

  it('a locked first chop week is display-only even for the commissioner', () => {
    renderHome(input({ guillotine: { firstChopWeek: 10, endWeek: 24, locked: true } }))
    expect(rowValue('first-chop')).toBe('Week 10 · locked')
    expect(screen.getByTestId('lsh-row-first-chop').tagName).toBe('DIV')
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

describe('GuillotineFirstChopEditor', () => {
  it('saves the chosen week through the given save and reports it', async () => {
    const save = vi.fn(async (week: number) => ({ ok: true as const, week }))
    const onSaved = vi.fn()
    render(<GuillotineFirstChopEditor initialWeek={10} endWeek={24} locked={false} save={save} onSaved={onSaved} />)
    const saveBtn = screen.getByTestId('lsh-save') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true) // nothing changed yet
    fireEvent.click(screen.getByRole('button', { name: 'Later week' }))
    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)
    expect(save).toHaveBeenCalledWith(11)
    expect(await screen.findByText('Saved — the first chop is week 11.')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledWith(11)
  })

  it('shows the server refusal', async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: 'The first chop has already happened' }))
    render(<GuillotineFirstChopEditor initialWeek={10} endWeek={24} locked={false} save={save} />)
    fireEvent.change(screen.getByTestId('lsh-first-chop-input'), { target: { value: '12' } })
    fireEvent.click(screen.getByTestId('lsh-save'))
    expect((await screen.findByRole('alert')).textContent).toContain('already happened')
  })

  it('refuses an out-of-range week before calling save', () => {
    const save = vi.fn()
    render(<GuillotineFirstChopEditor initialWeek={10} endWeek={24} locked={false} save={save as never} />)
    fireEvent.change(screen.getByTestId('lsh-first-chop-input'), { target: { value: '30' } })
    expect((screen.getByTestId('lsh-save') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Pick a week from 1 to 24.')).toBeTruthy()
  })

  it('locked: no input, no save', () => {
    render(<GuillotineFirstChopEditor initialWeek={10} endWeek={24} locked save={vi.fn() as never} />)
    expect((screen.getByTestId('lsh-first-chop-input') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByTestId('lsh-save')).toBeNull()
  })
})
