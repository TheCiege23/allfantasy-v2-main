/**
 * 2026-10-12 create-league polish: checkboxes that visibly tick, "?" help bubbles, data saver on
 * video tiles, labelled timezones, Survivor at 16 / 20, and "Intelligence" instead of "AI".
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/create-league-v2/CreateLeagueVideoTile')>()),
  CreateLeagueVideoTile: ({ testId, onSelect, title }: { testId: string; onSelect: () => void; title: string }) => (
    <button data-testid={testId} onClick={onSelect}>{title}</button>
  ),
}))

import { CheckBox, HelpTip } from '@/components/create-league-v2/WizardControls'
import { isDataSaver } from '@/components/create-league-v2/CreateLeagueVideoTile'
import { DraftStep, LeagueBasicsStep, LockedAdvancedSetupPanel, freshCreateLeagueState } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { timezoneLabel } from '@/lib/create-league-v2/device-timezone'
import { CREATE_LEAGUE_TIMEZONES } from '@/lib/create-league-v2/simple-create'
import { getDefaultTeamCount, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { isValidIanaTimeZone } from '@/lib/timezone'
import { translations } from '@/lib/i18n/translations'

const mark = (container: HTMLElement) => container.querySelector('[data-checked]')?.getAttribute('data-checked')

describe('checkboxes show their state', () => {
  it('CheckBox draws a tick only when checked, from state rather than the native box', () => {
    const onChange = vi.fn()
    const view = render(<CheckBox checked={false} onChange={onChange} testId="box" />)
    expect(mark(view.container)).toBe('false')
    expect(view.container.querySelector('svg')).toBeNull()
    fireEvent.click(screen.getByTestId('box'))
    expect(onChange).toHaveBeenCalledWith(true)
    view.rerender(<CheckBox checked onChange={onChange} testId="box" />)
    expect(mark(view.container)).toBe('true')
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('the league median box ticks when the median game is on', () => {
    const state = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const }
    const onChange = vi.fn()
    const view = render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    const row = screen.getByTestId('g30-median-game')
    expect(mark(row)).toBe('false')
    fireEvent.click(row.querySelector('input')!)
    expect(onChange).toHaveBeenCalledWith({ medianGame: true })
    view.rerender(<LeagueBasicsStep state={{ ...state, medianGame: true }} onChange={onChange} fieldErrors={null} />)
    expect(mark(screen.getByTestId('g30-median-game'))).toBe('true')
  })

  it('advanced setup boxes tick when on, and stay disabled without AF Commissioner', () => {
    const state = { ...DEFAULT_V2_STATE, advancedSetup: { aiCommissionerTools: true } }
    const view = render(<LockedAdvancedSetupPanel state={state} onChange={vi.fn()} hasCommissioner entitlementsLoading={false} />)
    expect(mark(screen.getByTestId('g30-advanced-aiCommissionerTools'))).toBe('true')
    expect(screen.getByTestId('g30-advanced-aiCommissionerTools').textContent).toContain('Commissioner Intelligence tools')
    view.rerender(<LockedAdvancedSetupPanel state={DEFAULT_V2_STATE} onChange={vi.fn()} hasCommissioner={false} entitlementsLoading={false} />)
    expect(screen.getByTestId('g30-advanced-aiCommissionerTools').querySelector('input')).toBeDisabled()
  })
})

describe('"?" help bubbles', () => {
  it('opens on tap, shows the explanation, and closes on Escape', () => {
    render(<HelpTip label="Privacy" testId="tip">Private leagues are invite-only.</HelpTip>)
    expect(screen.queryByTestId('tip-note')).toBeNull()
    fireEvent.click(screen.getByTestId('tip'))
    expect(screen.getByTestId('tip-note').textContent).toBe('Private leagues are invite-only.')
    expect(screen.getByTestId('tip').getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('tip-note')).toBeNull()
  })

  it('a help tap inside a label does not toggle that label\'s control', () => {
    const onChange = vi.fn()
    render(
      <label>
        <CheckBox checked={false} onChange={onChange} />
        Median <HelpTip label="Median" testId="tip">Explained.</HelpTip>
      </label>,
    )
    fireEvent.click(screen.getByTestId('tip'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the wizard steps carry help where a choice needs explaining', () => {
    const state = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const, scoringPresetId: 'fb_half_ppr' }
    const basics = render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    for (const id of ['g30-help-formats', 'g30-help-teams', 'g30-help-privacy']) expect(screen.getByTestId(id)).toBeTruthy()
    basics.unmount()
    render(<DraftStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    for (const id of ['g30-help-draft-type', 'g30-help-scoring', 'g30-help-draft-date', 'g30-help-timezone']) expect(screen.getByTestId(id)).toBeTruthy()
  })
})

describe('data saver on video tiles', () => {
  it('phones and slow or metered connections get still images; desktop broadband does not', () => {
    expect(isDataSaver(undefined, true)).toBe(true)
    expect(isDataSaver({ saveData: true }, false)).toBe(true)
    expect(isDataSaver({ type: 'cellular' }, false)).toBe(true)
    expect(isDataSaver({ effectiveType: '3g' }, false)).toBe(true)
    expect(isDataSaver({ effectiveType: '4g', type: 'wifi' }, false)).toBe(false)
    expect(isDataSaver(undefined, false)).toBe(false)
  })
})

describe('timezones are named, and every listed one is valid', () => {
  it('shows a name with its abbreviation, and a city for an unlisted zone', () => {
    expect(timezoneLabel('America/New_York')).toBe('Eastern Time (ET)')
    expect(timezoneLabel('UTC')).toBe('Coordinated Universal Time (UTC)')
    expect(timezoneLabel('Europe/Madrid')).toBe('Madrid (Europe/Madrid)')
  })

  it('every listed zone is a real IANA zone the server accepts', () => {
    expect(CREATE_LEAGUE_TIMEZONES.length).toBeGreaterThan(8)
    for (const zone of CREATE_LEAGUE_TIMEZONES) expect(isValidIanaTimeZone(zone), zone).toBe(true)
  })
})

describe('Survivor starts at 16 and offers 12–24 in equal tribe splits', () => {
  it('NBA Survivor offers the eight cast sizes, starts at 16, and every size passes the server with a valid split', () => {
    expect(getTeamCountOptions('NBA', 'survivor')).toEqual([12, 15, 16, 18, 20, 21, 22, 24])
    expect(getDefaultTeamCount('NBA', 'survivor')).toBe(16)
    const fresh = freshCreateLeagueState({ ...DEFAULT_V2_STATE, sport: 'NBA' })
    expect(fresh.leagueType).toBe('survivor')
    expect(fresh.teamCount).toBe(16)
    expect(fresh.survivorTribeCount).toBe(4)
    const splits: Record<number, number[]> = { 12: [2, 3, 4], 15: [3], 16: [2, 4], 18: [2, 3], 20: [2, 4], 21: [3], 22: [2], 24: [2, 3, 4] }
    for (const [teamCount, tribes] of Object.entries(splits).map(([k, v]) => [Number(k), v] as const)) {
      for (const survivorTribeCount of tribes) {
        const result = validateCreatePayload({ concept: 'survivor', sport: 'NBA', scoringPreset: 'nba_points', teamCount, draftType: 'snake', leagueName: 'Island', conceptSetup: { survivorTribeCount } })
        expect(result.ok, `${teamCount}/${survivorTribeCount}: ${JSON.stringify(result)}`).toBe(true)
      }
      const uneven = [2, 3, 4].find(t => !tribes.includes(t))
      if (uneven) expect(validateCreatePayload({ concept: 'survivor', sport: 'NBA', scoringPreset: 'nba_points', teamCount, draftType: 'snake', leagueName: 'Island', conceptSetup: { survivorTribeCount: uneven } }).ok).toBe(false)
    }
    expect(validateCreatePayload({ concept: 'survivor', sport: 'NBA', scoringPreset: 'nba_points', teamCount: 17, draftType: 'snake', leagueName: 'Island' }).ok).toBe(false)
  })
})

describe('the create-league copy says Intelligence, not AI', () => {
  it('no createLeague.g30 string in English or Spanish contains a bare "AI"', () => {
    const offenders: string[] = []
    for (const [locale, dict] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dict)) {
        if (key.startsWith('createLeague.g30.') && /\bAI\b/.test(value)) offenders.push(`${locale}:${key}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
