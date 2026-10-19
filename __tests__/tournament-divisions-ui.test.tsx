import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { DivisionsHub } from '@/components/tournament/divisions/DivisionsHub'
import { TournamentPlanFlow } from '@/components/tournament/divisions/TournamentPlanFlow'
import { buildDivisionsBlueprint, DivisionsBlueprintError } from '@/lib/tournament/divisions/blueprint'
import { computeDivision, defaultFormatSettings } from '@/lib/tournament/divisions/engine'
import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { presetIdentity } from '@/lib/tournament/divisions/identity'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'

function sampleView() {
  const { teams, identity } = sampleDivisionsField()
  const settings = defaultFormatSettings('NFL')
  const ranked = computeDivision(teams.filter(t => t.divisionIndex === 0), settings).ranked
  const me = ranked[57]!
  return { view: buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'live', season: 2026 }, settings, identity, teams, meTeamId: me.id, sample: true }), me }
}

describe('hub view (server-computed)', () => {
  it('marks you, ranks you #58 and carries pool status', () => {
    const { view, me } = sampleView()
    expect(view.me?.teamId).toBe(me.id)
    const row = view.divisions[0].rows.find(r => r.isMe)!
    expect(row.rank).toBe(58)
    expect(view.divisions[0].pool.rows).toHaveLength(24)
    expect(view.divisions[0].conferences).toHaveLength(10)
    expect(view.divisions[0].conferences[5]!.leagueName).toBe('Smoke Angelic')
    expect(Object.keys(view.divisions[0].regions)).toEqual(['North', 'East', 'South', 'West'])
    expect(view.championship).not.toBeNull()
    expect(view.calendar.lastWeek).toBe(17)
  })
})

describe('DivisionsHub', () => {
  it('renders the standings around the lines with both line markers and your row', () => {
    const { view } = sampleView()
    render(<DivisionsHub view={view} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Angelic vs Demonic' })).toBeTruthy()
    expect(screen.getByText(/Preview with invented sample data/)).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Angelic division standings' })
    expect(within(list).getByRole('separator', { name: 'AUTOMATIC BIDS · TOP 52' })).toBeTruthy()
    expect(within(list).getByRole('separator', { name: 'WILDCARD BUBBLE ENDS · 64' })).toBeTruthy()
    expect(within(list).getAllByText(/^You · /).length).toBeGreaterThan(0)
    expect(screen.getByText('Week 10')).toBeTruthy()
    const chip = screen.getByTestId('hub-rules-chip')
    expect(within(chip).getByTestId('scoring-pill-half').textContent).toBe('HALF')
    expect(within(chip).getByText('Half PPR')).toBeTruthy()
    expect(within(chip).getByTestId('roster-label-nfl-std').textContent).toMatch(/^Standard roster · 9 start/)
  })

  it('switches to the conferences grid, the wildcard pool, the bracket and the championship', () => {
    const { view } = sampleView()
    render(<DivisionsHub view={view} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Conferences' }))
    expect(screen.getAllByText('Smoke Angelic').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Wildcard' }))
    expect(screen.getByRole('heading', { name: 'Wildcard bubble · Angelic division' })).toBeTruthy()
    expect(screen.getByRole('separator', { name: /WILDCARD LINE · TOP 12 GET SEEDS 14–16/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Bracket' }))
    expect(screen.getByRole('heading', { name: /Angelic bracket · (North|East|South|West) region/ })).toBeTruthy()
    expect(screen.getAllByText(/Round of 64 · wk 11/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Championship' }))
    expect(screen.getByText(/Week 17 · Championship/)).toBeTruthy()
  })

  it('shows the saved scoring and roster in the header chip', () => {
    const view = buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'live', season: null }, settings: defaultFormatSettings('NFL'), rules: { scoringId: 'std', rosterId: 'nfl-idp' }, identity: presetIdentity('black-gold', 10), teams: [] })
    render(<DivisionsHub view={view} />)
    const chip = screen.getByTestId('hub-rules-chip')
    expect(within(chip).getByTestId('scoring-pill-std').textContent).toBe('STD')
    expect(within(chip).getByTestId('roster-label-nfl-idp')).toBeTruthy()
  })

  it('shows an honest empty state for a tournament with no placed teams', () => {
    const view = buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'blueprint', season: null }, settings: defaultFormatSettings('NFL'), identity: presetIdentity('black-gold', 10), teams: [] })
    render(<DivisionsHub view={view} />)
    expect(screen.getByText(/No teams in this division yet/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Black vs Gold' })).toBeTruthy()
  })
})

describe('TournamentPlanFlow', () => {
  it('defaults to divisions, warns on an invalid bracket size and blocks Continue', () => {
    render(<TournamentPlanFlow />)
    expect(screen.getByText(/240 entrants · 20 leagues/)).toBeTruthy()
    const autoBids = screen.getByRole('radiogroup', { name: 'Automatic bids per division' })
    fireEvent.click(within(autoBids).getByRole('radio', { name: '56' }))
    expect(screen.getByRole('alert').textContent).toMatch(/32, 64 or 128.*68/)
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('continues to the identity step with a preset and live preview', () => {
    render(<TournamentPlanFlow />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Name your divisions and conferences' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Angelic \/ Demonic/ }))
    expect(screen.getAllByText('Angelic vs Demonic').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Clear for custom names' }))
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('step 3 shows the real scoring and roster pickers on the NFL defaults, and they can be changed', () => {
    render(<TournamentPlanFlow />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Scoring and roster' })).toBeTruthy()
    const scoring = screen.getByRole('radiogroup', { name: 'Scoring' })
    const scoringRadios = within(scoring).getAllByRole('radio')
    expect(scoringRadios).toHaveLength(8) // 7 NFL options + Custom
    const checked = scoringRadios.filter(r => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(within(checked[0]!).getByRole('img', { name: /^Half PPR scoring/ })).toBeTruthy()
    // Backed options are choosable; labels with no live preset (and Custom) are not.
    expect((screen.getByTestId('rules-label-option-ppr') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('rules-label-option-six') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('rules-label-option-custom') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('rules-label-option-nfl-std').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('rules-plain-label').textContent).toBe('Half PPR · Standard roster')
    fireEvent.click(screen.getByTestId('rules-label-option-ppr'))
    fireEvent.click(screen.getByTestId('rules-label-option-nfl-sf'))
    expect(screen.getByTestId('rules-label-option-ppr').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('rules-label-option-half').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('rules-plain-label').textContent).toBe('Full PPR · Superflex roster')
  })

  it('saving from step 3 sends the chosen scoring and roster, then locks the pickers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tournamentId: 'abc' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<TournamentPlanFlow />)
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(fetchMock).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('rules-label-option-te'))
      fireEvent.click(screen.getByTestId('rules-label-option-nfl-idp'))
      fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = JSON.parse(((fetchMock.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string)
      expect(body.action).toBe('save')
      expect(body.plan.rules).toEqual({ scoringId: 'te', rosterId: 'nfl-idp' })
      await vi.waitFor(() => expect(screen.getAllByText(/Saved\. Rules lock when registration opens/, { selector: 'legend span' })).toHaveLength(2))
      expect((screen.getByTestId('rules-label-option-ppr') as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByTestId('rules-label-picker-scoring') as HTMLFieldSetElement).disabled).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('switching to NBA resets the choice to Points + Standard', () => {
    render(<TournamentPlanFlow />)
    fireEvent.click(within(screen.getAllByRole('radiogroup', { name: 'Sport' })[0]!).getByRole('radio', { name: 'NBA' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByTestId('rules-plain-label').textContent).toBe('Points · Standard roster')
    expect(screen.getByTestId('rules-label-option-pts').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('rules-label-option-cat9'))
    expect(screen.getByTestId('rules-plain-label').textContent).toBe('9-category · Standard roster')
  })


  it('points race hands off to the existing planner', () => {
    render(<TournamentPlanFlow />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/One field. Three drafts. One champion./)).toBeTruthy()
  })
})

describe('divisions blueprint', () => {
  const ok = { name: 'Black vs Gold 2026', settings: defaultFormatSettings('NFL'), identity: presetIdentity('black-gold', 10) }

  it('accepts a valid plan and derives the calendar', () => {
    const plan = buildDivisionsBlueprint(ok)
    expect(plan.calendar.lastWeek).toBe(17)
    expect(plan.report.totalTeams).toBe(240)
  })

  it('rejects mismatched conference counts and bad bracket sizes', () => {
    expect(() => buildDivisionsBlueprint({ ...ok, identity: presetIdentity('black-gold', 8) })).toThrow(DivisionsBlueprintError)
    expect(() => buildDivisionsBlueprint({ ...ok, settings: { ...ok.settings, wildcardSpots: 16 } })).toThrow(/32, 64 or 128/)
    expect(() => buildDivisionsBlueprint({ ...ok, name: 'x' })).toThrow(/name/)
  })
})
