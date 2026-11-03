/**
 * One "Taxi squad" section on the commissioner Roster tab, saving every taxi value to the field and
 * route it was saved to before the consolidation:
 *   League columns  → debouncedSave (PATCH /api/league/settings), same keys as the old advanced block
 *   dynasty rules   → PUT /api/leagues/[id]/dynasty-settings, same keys as DynastySettingsPanel sent
 * Plus the pre-draft NBA/NHL/MLB dynasty format preset control and the create-wizard picker.
 */
import React, { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: lang.language }),
  // The dynasty-only "What this changes" panel and nav labels read the dictionaries through this.
  useOptionalLanguage: () => ({ t: (key: string) => key, tInterpolate: (key: string) => key, language: lang.language }),
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L1' }) }))

import { RosterComplianceSettingsPanel } from '@/app/league/[leagueId]/components/settings/RosterComplianceSettingsPanel'
import { DynastyFormatPresetSection } from '@/app/league/[leagueId]/components/settings/DynastyFormatPresetSection'
import { DraftStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, getDefaultDynastySetup, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'

const base: CommissionerSettingsFormData = {
  taxiSlots: 3, taxiAllowNonRookies: false, taxiYearsLimit: 2, taxiDeadlineWeek: 4, irSlots: 1, isDynasty: false,
}

function dynastyFetch(effective: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'PUT') return { ok: true, json: async () => ({ ok: true }) } as Response
    return {
      ok: true,
      json: async () => ({
        effective,
        constants: { taxiLockBehaviorOptions: [
          { value: 'once_promoted_no_return', label: 'Once promoted cannot return' },
          { value: 'free_move', label: 'Can move freely' },
        ] },
        presets: { sportFormats: [] },
        ...extra,
      }),
    } as Response
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  lang.language = 'en'
})

describe('Taxi squad section — League columns round-trip', () => {
  it('there is exactly one place to edit each taxi value', () => {
    render(<RosterComplianceSettingsPanel initialData={base} canEdit debouncedSave={vi.fn()} />)
    expect(screen.getAllByTestId('taxi-squad-settings-section')).toHaveLength(1)
    expect(screen.getAllByText('Taxi squad slots')).toHaveLength(1)
    expect(screen.getAllByText('Allow non-rookies on taxi')).toHaveLength(1)
    expect(screen.getAllByText('Taxi years experience limit')).toHaveLength(1)
    // The inert League-column deadline is gone; the enforced lock week lives in TaxiRulesPanel.
    expect(screen.queryByText('Taxi deadline (week)')).toBeNull()
    expect(screen.queryByTestId('taxi-deadline-week')).toBeNull()
    // …and the advanced reserve block no longer carries any of them.
    expect(within(screen.getByTestId('roster-advanced-reserve-settings')).queryByText(/taxi/i)).toBeNull()
  })

  it('reads the stored League values and saves each one under its old key', () => {
    const save = vi.fn()
    render(<RosterComplianceSettingsPanel initialData={base} canEdit debouncedSave={save} />)
    const section = screen.getByTestId('taxi-squad-settings-section')
    expect((screen.getByTestId('taxi-slots') as HTMLSelectElement).value).toBe('3')
    expect((screen.getByTestId('taxi-years-limit') as HTMLSelectElement).value).toBe('2')

    fireEvent.change(screen.getByTestId('taxi-slots'), { target: { value: '5' } })
    fireEvent.click(within(section).getAllByRole('switch')[0]!)
    fireEvent.change(screen.getByTestId('taxi-years-limit'), { target: { value: '0' } })
    expect(save.mock.calls.map((c) => c[0])).toEqual([
      { taxiSlots: 5 },
      { taxiAllowNonRookies: true },
      { taxiYearsLimit: 0 },
    ])
  })

  it('a non-dynasty league makes no dynasty-settings request and shows no dynasty rules', () => {
    const calls = dynastyFetch({})
    render(<RosterComplianceSettingsPanel initialData={base} canEdit debouncedSave={vi.fn()} />)
    expect(calls).toEqual([])
    expect(screen.queryByTestId('taxi-dynasty-rules')).toBeNull()
  })

  it('read-only for a non-commissioner', () => {
    const save = vi.fn()
    render(<RosterComplianceSettingsPanel initialData={base} canEdit={false} debouncedSave={save} />)
    expect((screen.getByTestId('taxi-slots') as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('Taxi squad section — NHL / MLB (no prospect pool)', () => {
  it('a league with taxi can keep or lower it, never raise it, and sees the note', () => {
    const save = vi.fn()
    render(<RosterComplianceSettingsPanel initialData={{ ...base, sport: 'NHL', taxiSlots: 3 }} canEdit debouncedSave={save} />)
    expect(screen.getByTestId('taxi-unavailable-for-sport').textContent).toMatch(/aren.t available for NHL\/MLB leagues/)
    const options = Array.from((screen.getByTestId('taxi-slots') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['0', '1', '2', '3'])
    fireEvent.change(screen.getByTestId('taxi-slots'), { target: { value: '1' } })
    expect(save).toHaveBeenCalledWith({ taxiSlots: 1 })
  })

  it('a league with no taxi sees only the note, no controls', () => {
    render(<RosterComplianceSettingsPanel initialData={{ ...base, sport: 'MLB', taxiSlots: 0 }} canEdit debouncedSave={vi.fn()} />)
    expect(screen.getByTestId('taxi-unavailable-for-sport')).toBeTruthy()
    expect(screen.queryByTestId('taxi-slots')).toBeNull()
    expect(screen.queryByTestId('taxi-years-limit')).toBeNull()
  })

  it('NFL and NBA keep the full 0–6 choice and no note', () => {
    for (const sport of ['NFL', 'NBA'] as const) {
      const { unmount } = render(<RosterComplianceSettingsPanel initialData={{ ...base, sport, taxiSlots: 0 }} canEdit debouncedSave={vi.fn()} />)
      expect((screen.getByTestId('taxi-slots') as HTMLSelectElement).options).toHaveLength(7)
      expect(screen.queryByTestId('taxi-unavailable-for-sport')).toBeNull()
      unmount()
    }
  })
})

describe('Taxi squad section — dynasty lock & promotion rules', () => {
  it('reads the dynasty config and PUTs each rule with the key DynastySettingsPanel used', async () => {
    const calls = dynastyFetch({ taxiLockBehavior: 'once_promoted_no_return', taxiInSeasonMoves: true, taxiPostseasonMoves: false, taxiScoringOn: false, taxiPromotionDeadlineWeek: null })
    render(<RosterComplianceSettingsPanel initialData={{ ...base, isDynasty: true }} canEdit debouncedSave={vi.fn()} />)
    const rules = await screen.findByTestId('taxi-dynasty-rules')
    // The dynasty config, plus the taxi counts the over-the-limit warning reads (TaxiRulesExplainer).
    expect(calls.filter((c) => c.method === 'GET').map((c) => c.url).sort()).toEqual(['/api/leagues/L1/dynasty-settings', '/api/leagues/L1/taxi-steals'])

    await act(async () => { fireEvent.change(screen.getByTestId('taxi-lock-behavior'), { target: { value: 'free_move' } }) })
    const toggles = within(rules).getAllByRole('switch')
    await act(async () => { fireEvent.click(toggles[0]!) })
    await act(async () => { fireEvent.click(toggles[1]!) })
    await act(async () => { fireEvent.click(toggles[2]!) })
    await act(async () => { fireEvent.change(screen.getByTestId('taxi-promotion-deadline-week'), { target: { value: '12' } }) })

    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body])).toEqual([
      ['/api/leagues/L1/dynasty-settings', { taxiLockBehavior: 'free_move' }],
      ['/api/leagues/L1/dynasty-settings', { taxiInSeasonMoves: false }],
      ['/api/leagues/L1/dynasty-settings', { taxiPostseasonMoves: true }],
      ['/api/leagues/L1/dynasty-settings', { taxiScoringOn: true }],
      ['/api/leagues/L1/dynasty-settings', { taxiPromotionDeadlineWeek: 12 }],
    ])
  })

  it('Spanish copy', async () => {
    lang.language = 'es'
    dynastyFetch({ taxiLockBehavior: 'free_move' })
    render(<RosterComplianceSettingsPanel initialData={{ ...base, isDynasty: true }} canEdit debouncedSave={vi.fn()} />)
    expect(screen.getByText('Escuadrón taxi')).toBeTruthy()
    expect(await screen.findByText('Puede moverse libremente')).toBeTruthy()
  })
})

describe('Pre-draft dynasty format preset (Roster tab)', () => {
  const formats = { sportFormats: [{ id: 'nba_dynasty_points_taxi', sport: 'NBA' }, { id: 'nba_dynasty_points_deep', sport: 'NBA' }] }

  it('keeps a choice made as settings arrive, before passive effects run', async () => {
    const saveDynasty = vi.fn(async () => ({ ok: true }))
    function LoadingPreset({ loaded }: { loaded: boolean }) {
      useLayoutEffect(() => {
        if (loaded) {
          const select = screen.getByTestId('dynasty-format-preset-select') as HTMLSelectElement
          select.value = 'nba_dynasty_points_deep'
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }, [loaded])
      return <DynastyFormatPresetSection canEdit saveDynasty={saveDynasty} dynasty={loaded ? {
        presets: formats, sportFormatPreset: { current: 'nba_dynasty_points_taxi', editable: true },
      } : null} />
    }
    const { rerender } = render(<LoadingPreset loaded={false} />)
    rerender(<LoadingPreset loaded />)
    expect((screen.getByTestId('dynasty-format-preset-select') as HTMLSelectElement).value).toBe('nba_dynasty_points_deep')
    await act(async () => { fireEvent.click(screen.getByTestId('dynasty-format-preset-apply')) })
    expect(saveDynasty).toHaveBeenCalledWith({ sportPresetId: 'nba_dynasty_points_deep' })
  })

  it('adopts a newly published current preset without retaining a stale choice', () => {
    const saveDynasty = vi.fn(async () => ({ ok: true }))
    const { rerender } = render(<DynastyFormatPresetSection canEdit saveDynasty={saveDynasty} dynasty={{
      presets: formats, sportFormatPreset: { current: 'nba_dynasty_points_taxi', editable: true },
    }} />)
    fireEvent.change(screen.getByTestId('dynasty-format-preset-select'), { target: { value: 'nba_dynasty_points_deep' } })
    rerender(<DynastyFormatPresetSection canEdit saveDynasty={saveDynasty} dynasty={{
      presets: formats, sportFormatPreset: { current: null, editable: true },
    }} />)
    expect((screen.getByTestId('dynasty-format-preset-select') as HTMLSelectElement).value).toBe('nba_dynasty_points_taxi')
  })

  it('applies the chosen preset through PUT { sportPresetId }', async () => {
    const calls = dynastyFetch({}, { presets: formats, sportFormatPreset: { current: 'nba_dynasty_points_taxi', editable: true } })
    render(<RosterComplianceSettingsPanel initialData={{ ...base, isDynasty: true }} canEdit debouncedSave={vi.fn()} />)
    const select = (await screen.findByTestId('dynasty-format-preset-select')) as HTMLSelectElement
    expect(select.value).toBe('nba_dynasty_points_taxi')
    fireEvent.change(select, { target: { value: 'nba_dynasty_points_deep' } })
    await act(async () => { fireEvent.click(screen.getByTestId('dynasty-format-preset-apply')) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ sportPresetId: 'nba_dynasty_points_deep' })
    await waitFor(() => expect(screen.getByText('Preset applied')).toBeTruthy())
  })

  it('disabled after the draft has started', async () => {
    dynastyFetch({}, { presets: formats, sportFormatPreset: { current: null, editable: false } })
    render(<RosterComplianceSettingsPanel initialData={{ ...base, isDynasty: true }} canEdit debouncedSave={vi.fn()} />)
    expect(((await screen.findByTestId('dynasty-format-preset-apply')) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Presets can only be applied before the draft.')).toBeTruthy()
  })
})

describe('Create wizard — dynasty format picker', () => {
  function state(sport: 'NBA' | 'NFL'): CreateLeagueV2State {
    return { ...DEFAULT_V2_STATE, leagueType: 'dynasty', sport, scoringPresetId: sport === 'NBA' ? 'nba_points' : 'fb_half_ppr', dynasty: getDefaultDynastySetup(sport, 'snake') }
  }

  it('NBA dynasty: starts on the default preset; choosing another writes scoring + roster depth', () => {
    const onChange = vi.fn()
    const s = state('NBA')
    render(<DraftStep state={s} onChange={onChange} />)
    const select = screen.getByTestId('g30-dynasty-sport-preset') as HTMLSelectElement
    expect(select.value).toBe('nba_dynasty_points_taxi')
    fireEvent.change(select, { target: { value: 'nba_dynasty_points_deep' } })
    expect(onChange).toHaveBeenCalledWith({
      scoringPresetId: 'nba_points',
      dynasty: { ...s.dynasty, benchCount: 12, irCount: 4, taxiSlotCount: 6, taxiEligibilityYears: 3, startupRosterDepth: 28 },
    })
  })

  it('NFL dynasty shows no picker', () => {
    render(<DraftStep state={state('NFL')} onChange={vi.fn()} />)
    expect(screen.queryByTestId('g30-dynasty-sport-preset')).toBeNull()
  })
})
