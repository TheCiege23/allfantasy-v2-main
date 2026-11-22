import React, { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('html2canvas', () => ({ default: async () => ({ toBlob: (cb: (b: Blob | null) => void) => cb(null), toDataURL: () => '' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { ScoringDetailPanel } from '@/components/league-labels'
import { TournamentRulesStep } from '@/components/tournament/divisions/TournamentRulesStep'
import { TournamentJoin } from '@/components/tournament/divisions/TournamentJoin'
import { customLiveRules, customScoringFields, customScoringValues, parseCustomOverrides } from '@/lib/league-labels/customScoring'
import { plainRulesLabel } from '@/lib/league-labels/catalog'
import { defaultFormatSettings, divisionsCalendar } from '@/lib/tournament/divisions/engine'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'
import { scoringChoices, type DivisionsRules } from '@/lib/tournament/divisions/rules'
import type { JoinView } from '@/lib/tournament/divisions/lifecycle'

describe('custom scoring values', () => {
  it('seeds NFL from Half PPR and NBA from Points', () => {
    expect(customScoringValues('NFL')).toEqual({ pass_yd: 0.04, pass_td: 4, int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, two_pt: 2 })
    expect(customScoringValues('NBA')).toEqual({ pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, to: -1, three: 0.5 })
    expect(customScoringFields('NFL').every(f => f.seed >= f.min && f.seed <= f.max)).toBe(true)
  })

  it('keeps only real changes and refuses bad values', () => {
    expect(parseCustomOverrides('NFL', { rec: 1, pass_td: 4 })).toEqual({ ok: true, overrides: { rec: 1 } })
    expect(parseCustomOverrides('NFL', { int: -0 })).toEqual({ ok: true, overrides: { int: 0 } })
    expect(parseCustomOverrides('NFL', { int: 1 })).toMatchObject({ ok: false, issues: ['Interception: use a value from -10 to 0.'] })
    expect(parseCustomOverrides('NFL', { pass_yd: 0.045 })).toMatchObject({ ok: false, issues: ['Passing yard: use at most two decimals.'] })
    expect(parseCustomOverrides('NFL', { reb: 1 })).toMatchObject({ ok: false })
    expect(parseCustomOverrides('NBA', { stl: '4' })).toMatchObject({ ok: false, issues: ['Steal: enter a number.'] })
  })

  it('writes each edited value onto every live key that scores it, over the starting preset', () => {
    const nfl = customLiveRules('NFL', { two_pt: 3, rec: 1 })
    expect(nfl).toMatchObject({ passing_2pt: 3, rushing_2pt: 3, receiving_2pt: 3, reception: 1, passing_yards: 0.04 })
    expect(customLiveRules('NBA', { blk: 4 })).toMatchObject({ block: 4, points_scored: 1 })
  })
})

describe('ScoringDetailPanel', () => {
  it('shows the value table for a points option', () => {
    render(<ScoringDetailPanel sport="NFL" scoringId="ppr" />)
    const table = screen.getByLabelText('Full PPR point values')
    expect(within(table).getByText('Reception')).toBeTruthy()
    expect(within(table).getByText('+1')).toBeTruthy()
    expect(within(table).getAllByText('-2').length).toBe(2)
    expect(screen.getByTestId('scoring-detail-note').textContent).toBe('K and DST use the AF standard tables in every NFL preset.')
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('shows the category chips for a category option', () => {
    render(<ScoringDetailPanel sport="NBA" scoringId="cat8" />)
    const chips = within(screen.getByRole('list', { name: '8-category categories' })).getAllByRole('listitem').map(li => li.textContent)
    expect(chips).toEqual(['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK'])
  })

  it('Custom shows real labelled inputs seeded from Half PPR and reports valid edits only', () => {
    const onOverrides = vi.fn()
    const onValidity = vi.fn()
    render(<ScoringDetailPanel sport="NFL" scoringId="custom" onOverrides={onOverrides} onValidity={onValidity} />)
    const reception = screen.getByLabelText('Reception') as HTMLInputElement
    expect(reception.value).toBe('0.5')
    expect(reception.type).toBe('number')
    expect(screen.getAllByRole('spinbutton')).toHaveLength(10)
    fireEvent.change(reception, { target: { value: '1.25' } })
    expect(onOverrides).toHaveBeenLastCalledWith({ rec: 1.25 })
    expect(onValidity).toHaveBeenLastCalledWith(true)
    fireEvent.change(screen.getByLabelText('Interception'), { target: { value: '5' } })
    expect(onValidity).toHaveBeenLastCalledWith(false)
    expect(onOverrides).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe('Use a value from -10 to 0.')
    expect(screen.getByTestId('scoring-detail-note').textContent).toMatch(/^Starts from Half PPR\. .*reads CUSTOM/)
  })

  it('NBA Custom seeds from Points', () => {
    render(<ScoringDetailPanel sport="NBA" scoringId="custom" />)
    expect((screen.getByLabelText('Rebound') as HTMLInputElement).value).toBe('1.2')
    expect(screen.getByRole('button', { name: 'Start again from Points' })).toBeTruthy()
  })
})

function Harness({ sport = 'NFL' as 'NFL' | 'NBA', onSave = vi.fn() }) {
  const [rules, setRules] = useState<DivisionsRules>({ scoringId: sport === 'NFL' ? 'half' : 'pts', rosterId: sport === 'NFL' ? 'nfl-std' : 'nba-std' })
  return <>
    <TournamentRulesStep sport={sport} rules={rules} onRules={setRules} onBack={() => {}} onSave={onSave} />
    <output data-testid="rules-json">{JSON.stringify(rules)}</output>
  </>
}

describe('planner step 3 with Custom', () => {
  it('Custom is choosable for both sports', () => {
    expect(scoringChoices('NFL').find(c => c.id === 'custom')?.disabled).toBe(false)
    expect(scoringChoices('NBA').find(c => c.id === 'custom')?.disabled).toBe(false)
  })

  it('picking Custom shows the editor, the label reads CUSTOM, and edits land in overrides', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    const custom = screen.getByTestId('rules-label-option-custom') as HTMLButtonElement
    expect(custom.disabled).toBe(false)
    fireEvent.click(custom)
    expect(screen.getByTestId('rules-plain-label').textContent).toBe('Custom · Standard roster')
    fireEvent.change(screen.getByLabelText('Passing TD'), { target: { value: '6' } })
    expect(JSON.parse(screen.getByTestId('rules-json').textContent!)).toEqual({ scoringId: 'custom', rosterId: 'nfl-std', overrides: { pass_td: 6 } })
    fireEvent.change(screen.getByLabelText('Passing TD'), { target: { value: '' } })
    const save = screen.getByRole('button', { name: 'Save and continue' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Passing TD'), { target: { value: '5' } })
    expect(save.disabled).toBe(false)
    // Leaving Custom drops the overrides.
    fireEvent.click(screen.getByTestId('rules-label-option-ppr'))
    expect(JSON.parse(screen.getByTestId('rules-json').textContent!)).toEqual({ scoringId: 'ppr', rosterId: 'nfl-std' })
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('invite page shows the CUSTOM pill and plain label', () => {
    const { identity } = sampleDivisionsField()
    const settings = defaultFormatSettings('NFL')
    const view: JoinView = {
      tournamentId: 't', name: 'House Rules Cup', phase: 'registering', sport: 'NFL', settings, calendar: divisionsCalendar(settings), identity,
      registration: { closesAt: '2026-09-01T16:00:00.000Z', allowPreference: true, allowGrouping: false, entry: 'Free' },
      capacity: 240, registered: 10, waitlist: 0, me: null, myLeague: null, commissioner: { name: 'C', leaguesRun: 1 }, invitedBy: null,
      rules: { scoringId: 'custom', rosterId: 'nfl-sf', overrides: { rec: 1 } },
    }
    render(<TournamentJoin view={view} refName={null} />)
    expect(screen.getByTestId('scoring-pill-custom').textContent).toBe('CUSTOM')
    expect(plainRulesLabel('custom', 'nfl-sf')).toBe('Custom · Superflex roster')
  })
})
