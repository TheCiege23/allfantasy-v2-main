// @vitest-environment jsdom
/**
 * Before the draft, League Settings opens with "Set up your league in 5 decisions": teams, roster,
 * scoring, draft and waivers, one at a time, each with the league's current answer. "Keep this"
 * moves on, "Change it" opens the same editor the settings row opens.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { buildLeagueSettingsHome, type SettingsHomeSection } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { buildSetupDecisions, nextSetupDecision, readSetupProgress } from '@/lib/league-settings-home/setupDecisions'
import { SetupDecisionsCard } from '@/components/league-settings/home/SetupDecisionsCard'
import { LeagueSettingsHome } from '@/components/league-settings/home/LeagueSettingsHome'

function sections(canEdit = true, over: { rosterSlots?: Record<string, number> | null } = {}): SettingsHomeSection[] {
  return buildLeagueSettingsHome({
    league: {
      id: 'L1',
      name: 'Chop Shop',
      sport: 'NBA',
      leagueSize: 4,
      settings: { scoring_mode: 'points' },
      waiverType: 'faab',
      waiverBudget: 100,
    } as never,
    teams: [],
    canEdit,
    formatLabel: 'Redraft',
    scoringLabel: 'Points',
    rosterSlots: over.rosterSlots === undefined ? { UTIL: 4, SUPER_UTIL: 1, BN: 4, IR: 1 } : over.rosterSlots,
    draft: { dateIso: null, type: 'snake', rounds: 9, timerSeconds: 60, autostart: false },
    guillotine: null,
    inviteUrl: null,
  } as never)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => cleanup())

describe('buildSetupDecisions', () => {
  it('asks the five decisions in order, answered from the settings rows', () => {
    const d = buildSetupDecisions(sections())
    expect(d.map((x) => x.id)).toEqual(['teams', 'roster', 'scoring', 'draft', 'waivers'])
    expect(d[0]).toMatchObject({ value: '4', target: 'general' })
    expect(d.find((x) => x.id === 'draft')!.target).toBe('draft')
    expect(d.find((x) => x.id === 'draft')!.value).toContain('·')
    expect(d.every((x) => !x.pending)).toBe(true)
  })

  it('a roster still loading is pending', () => {
    expect(buildSetupDecisions(sections(true, { rosterSlots: null })).find((x) => x.id === 'roster')!.pending).toBe(true)
  })

  it('asks nothing a viewer cannot change', () => {
    expect(buildSetupDecisions(sections(false))).toEqual([])
  })

  it('next decision skips the kept ones', () => {
    const d = buildSetupDecisions(sections())
    expect(nextSetupDecision(d, ['teams', 'roster'])!.id).toBe('scoring')
    expect(nextSetupDecision(d, ['teams', 'roster', 'scoring', 'draft', 'waivers'])).toBeNull()
  })

  it('reads stored progress defensively', () => {
    window.localStorage.setItem('af:league-setup-decisions:v1:L1', '{not json')
    expect(readSetupProgress('L1')).toEqual({ kept: [], dismissed: false })
    window.localStorage.setItem('af:league-setup-decisions:v1:L1', JSON.stringify({ kept: ['teams', 'bogus', 'teams'], dismissed: 1 }))
    expect(readSetupProgress('L1')).toEqual({ kept: ['teams'], dismissed: false })
  })
})

describe('SetupDecisionsCard', () => {
  const renderCard = (onOpen = vi.fn()) => {
    render(<SetupDecisionsCard leagueId="L1" decisions={buildSetupDecisions(sections())} onOpen={onOpen} />)
    return onOpen
  }

  it('walks the decisions one at a time and remembers them for this league', () => {
    renderCard()
    expect(screen.getByTestId('lsh-setup-count').textContent).toBe('0 of 5 decided')
    expect(screen.getByTestId('lsh-setup-current').getAttribute('data-decision')).toBe('teams')
    expect(screen.getByText('How many teams?')).toBeTruthy()

    fireEvent.click(screen.getByTestId('lsh-setup-keep'))
    expect(screen.getByTestId('lsh-setup-current').getAttribute('data-decision')).toBe('roster')
    expect(screen.getByTestId('lsh-setup-count').textContent).toBe('1 of 5 decided')

    cleanup()
    renderCard()
    expect(screen.getByTestId('lsh-setup-current').getAttribute('data-decision')).toBe('roster')
  })

  it('"Change it" opens that decision\'s editor', () => {
    const onOpen = renderCard()
    fireEvent.click(screen.getByTestId('lsh-setup-step-waivers'))
    fireEvent.click(screen.getByTestId('lsh-setup-change'))
    expect(onOpen).toHaveBeenCalledWith('waivers')
  })

  it('says the league is set up once all five are kept, then can be put away', () => {
    renderCard()
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId('lsh-setup-keep'))
    expect(screen.getByTestId('lsh-setup-done').textContent).toContain('Your league is set up')
    fireEvent.click(screen.getByTestId('lsh-setup-hide'))
    expect(screen.queryByTestId('lsh-setup')).toBeNull()
    cleanup()
    renderCard()
    expect(screen.queryByTestId('lsh-setup')).toBeNull()
  })

  it('cannot keep an answer that is still loading', () => {
    render(<SetupDecisionsCard leagueId="L1" decisions={buildSetupDecisions(sections(true, { rosterSlots: null }))} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByTestId('lsh-setup-keep')) // teams
    expect(screen.getByTestId('lsh-setup-current').getAttribute('data-decision')).toBe('roster')
    expect((screen.getByTestId('lsh-setup-keep') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('on the League Settings list', () => {
  it('"Change it" opens the same sub-page the settings row opens', () => {
    const s = sections()
    render(
      <LeagueSettingsHome
        sections={s}
        canEdit
        renderSubPage={(id) => ({ title: `Editor ${id}`, content: <p>editor body {id}</p> })}
        header={(open) => <SetupDecisionsCard leagueId="L1" decisions={buildSetupDecisions(s)} onOpen={open} />}
      />,
    )
    fireEvent.click(screen.getByTestId('lsh-setup-change'))
    expect(screen.getByTestId('league-settings-subpage').getAttribute('data-subpage')).toBe('general')
  })
})
