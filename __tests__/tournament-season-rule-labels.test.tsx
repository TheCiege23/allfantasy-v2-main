import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { seasonRuleAsset, seasonRuleLabels, withSeasonRosterPreset } from '@/lib/tournament/seasonRuleLabels'
import { SeasonRuleLabels, SeasonRosterPresetPicker } from '@/components/tournament/SeasonRuleLabels'
import { SeasonTournamentMoments } from '@/components/tournament/SeasonTournamentMoments'
const config = (sport: 'NBA' | 'NFL' = 'NBA') => { const c = defaultSeasonBlueprint(sport); return { ...c, rules: defaultSeasonRules(sport, c.scoring) } }
describe('supplied rule label integration', () => {
  it('never labels existing custom slot counts as supplied Standard', () => {
    const c = config()
    expect(seasonRuleLabels(c)).toMatchObject({ text: 'Points · Custom roster', drafted: 12, ir: 2 })
    render(<SeasonRuleLabels config={c} />)
    expect(screen.getByText('8 starters · 12 drafted slots · 2 additional injured slots')).toBeInTheDocument()
  })
  it('marks changed weights custom and detects mismatched preset settings', () => {
    const c = config('NFL'); c.rules.weights[0]!.points += 1
    expect(seasonRuleLabels(c)?.scoring.id).toBe('custom')
    c.rules.scoringPreset = 'nba_points'
    expect(seasonRuleLabels(c)).toBeNull()
  })
  it('matches exact rosters and normalizes SFLEX without altering other rules', () => {
    const c = config('NFL'), next = withSeasonRosterPreset(c, 'nfl-sf')
    expect(next.rosterSize).toBe(17)
    expect(next.rules!.starters).toContainEqual({ position: 'SUPERFLEX', count: 1 })
    expect(next.rules!.calendar).toEqual(c.rules.calendar)
    expect(next.rules!.weights).toEqual(c.rules.weights)
    expect(seasonRuleLabels(next)?.roster?.id).toBe('nfl-sf')
    expect(c.rosterSize).toBe(15)
    expect(withSeasonRosterPreset(c, 'nba-std')).toBe(c)
    expect(withSeasonRosterPreset(c, 'nfl-idp')).toBe(c)
  })
  it('offers only supported sport layouts and respects the frozen parent fieldset', () => {
    const change = vi.fn()
    const { rerender } = render(<SeasonRosterPresetPicker config={config()} onChange={change} />)
    fireEvent.click(screen.getByRole('button', { name: /Lean · 7 starters/ }))
    expect(change.mock.calls[0]![0].rosterSize).toBe(10)
    expect(screen.queryByRole('button', { name: /Superflex/ })).not.toBeInTheDocument()
    rerender(<fieldset disabled><SeasonRosterPresetPicker config={config()} onChange={change} /></fieldset>)
    expect(screen.getByRole('button', { name: /Lean · 7 starters/ })).toBeDisabled()
  })
  it('allowlists asset paths and labels bench zero accurately', () => {
    expect(seasonRuleAsset('scoring', '../../secret')).toBeNull()
    expect(seasonRuleAsset('scoring', 'pts')).toBe('/artwork/tournaments/rules/scoring/pts.svg')
    const c = config(); c.rules.bench = 0; c.rosterSize = 8
    render(<SeasonRuleLabels config={c} compact />)
    expect(screen.getByText('BN ×0')).toBeInTheDocument()
  })
  it('shows actual draft dates in previews without dispatch or unsupported wildcard claims', () => {
    const c = config(); c.rules.calendar.drafts = [{ stage: 1, startsAt: '2026-10-19T18:00:00Z', completeBy: '2026-10-20T00:00:00Z' }]
    render(<SeasonTournamentMoments config={c} />)
    expect(screen.getByText(/No message is sent/)).toBeInTheDocument()
    expect(screen.getByText(/Oct 19, 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Champion' }))
    expect(screen.getByText('A champion is crowned')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Post|Send|Download/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/wildcard/i)).not.toBeInTheDocument()
  })
})
