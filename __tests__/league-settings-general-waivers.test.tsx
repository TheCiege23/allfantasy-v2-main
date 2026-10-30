/**
 * General tab on a native AF league (2026-10-14): no host-platform "read-only snapshot", Waivers
 * lives inside General, the per-day Mon–Sun schedule saves through the waivers section, and FAAB
 * fields show only when FAAB is in use.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }) }
})

const patches = vi.hoisted(() => ({ general: [] as Record<string, unknown>[], waivers: [] as Record<string, unknown>[] }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: (_id: string, section: 'general' | 'waivers') => ({
    queuePatch: (u: Record<string, unknown>) => patches[section].push(u),
    saving: false,
  }),
}))

import { GeneralTab } from '@/components/league-settings/tabs/GeneralTab'
import { SettingsSaveScope } from '@/components/league-settings/home/SettingsSaveScope'
import { clearSavedLeagueOverrides, recordSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { DAILY_WAIVER_SCHEDULE_SETTINGS_KEY, defaultDailyWaiverSchedule } from '@/lib/waivers/dailyWaiverSchedule'

function ctx(league: Record<string, unknown> = {}) {
  return {
    league: {
      id: 'l1', name: 'Test League', timezone: 'America/New_York', logoUrl: null, settings: {}, platform: 'manual',
      waiverType: 'rolling', waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, ...league,
    },
    displayLeague: { id: 'l1', name: 'Test League', teamCount: 12 },
    isCommissioner: true,
  } as never
}

describe('General tab (native league)', () => {
  beforeEach(() => {
    patches.general = []
    patches.waivers = []
    clearSavedLeagueOverrides()
  })
  afterEach(cleanup)

  it('shows no host-platform snapshot copy', () => {
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} />)
    const text = r.container.textContent ?? ''
    expect(text).not.toMatch(/host platform|host app|Read-only snapshot|synced JSON/i)
    expect(r.getByTestId('league-settings-waivers-section')).toBeTruthy()
  })

  it('only advertises auto-save outside the manual Save changes page', () => {
    const legacy = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} showWaivers={false} />)
    expect(legacy.getByText('Auto-save')).toBeTruthy()
    legacy.unmount()
    const manual = render(<SettingsSaveScope><GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} showWaivers={false} /></SettingsSaveScope>)
    expect(manual.queryByText('Auto-save')).toBeNull()
  })

  it('name / timezone / logo queue patches on the general section; a cleared name is not sent', () => {
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} />)
    fireEvent.change(r.getByTestId('league-settings-general-name'), { target: { value: '  New Name ' } })
    fireEvent.change(r.getByTestId('league-settings-general-name'), { target: { value: '   ' } })
    fireEvent.change(r.getByTestId('league-settings-general-timezone'), { target: { value: 'America/Chicago' } })
    fireEvent.change(r.getByTestId('league-settings-general-logo'), { target: { value: ' https://x.test/a.png ' } })
    fireEvent.change(r.getByTestId('league-settings-general-logo'), { target: { value: '' } })
    expect(patches.general).toEqual([{ name: 'New Name' }, { timezone: 'America/Chicago' }, { logoUrl: 'https://x.test/a.png' }, { logoUrl: null }])
  })

  it('a timezone outside the presets is still selected', () => {
    const r = render(<GeneralTab ctx={ctx({ timezone: 'Asia/Tokyo' })} canEdit hasAfCommissionerSub={false} />)
    expect((r.getByTestId('league-settings-general-timezone') as HTMLSelectElement).value).toBe('Asia/Tokyo')
  })

  it('reopening seeds from what was SAVED, not the stale page props', () => {
    recordSavedLeagueOverrides('l1', { name: 'Saved Name', waiverType: 'faab' })
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} />)
    expect((r.getByTestId('league-settings-general-name') as HTMLInputElement).value).toBe('Saved Name')
    expect((r.getByTestId('league-settings-waiver-type') as HTMLSelectElement).value).toBe('faab')
  })

  it('FAAB fields only when FAAB is in use (main type or any day)', () => {
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} />)
    expect(r.queryByTestId('league-settings-faab-fields')).toBeNull()
    fireEvent.change(r.getByTestId('league-settings-waiver-type'), { target: { value: 'faab' } })
    expect(r.getByTestId('league-settings-faab-fields')).toBeTruthy()
    fireEvent.change(r.getByTestId('league-settings-waiver-type'), { target: { value: 'reverse_standings' } })
    expect(r.queryByTestId('league-settings-faab-fields')).toBeNull()
    fireEvent.click(r.getByRole('switch', { name: 'Daily schedule' }))
    fireEvent.change(r.getByTestId('league-settings-daily-waivers-thu'), { target: { value: 'faab' } })
    expect(r.getByTestId('league-settings-faab-fields')).toBeTruthy()
  })

  it('the daily schedule: 7 day rows, each day its own mode, saved via the waivers section', () => {
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} />)
    expect(r.queryByTestId('league-settings-daily-waivers-mon')).toBeNull()
    fireEvent.click(r.getByRole('switch', { name: 'Daily schedule' }))
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) expect(r.getByTestId(`league-settings-daily-waivers-${d}`)).toBeTruthy()
    fireEvent.change(r.getByTestId('league-settings-daily-waivers-mon'), { target: { value: 'reverse_standings' } })
    fireEvent.change(r.getByTestId('league-settings-daily-waivers-tue'), { target: { value: 'rolling' } })
    fireEvent.change(r.getByTestId('league-settings-daily-waivers-hour'), { target: { value: '5' } })
    const last = patches.waivers.at(-1)!.dailyWaiverSchedule as ReturnType<typeof defaultDailyWaiverSchedule>
    expect(last.enabled).toBe(true)
    expect(last.processHour).toBe(5)
    expect(last.days.mon).toBe('reverse_standings')
    expect(last.days.tue).toBe('rolling')
    expect(last.days.wed).toBe('waivers_then_fa')
  })

  it('seeds the schedule from league.settings and re-sends it with a new timezone', () => {
    const stored = { ...defaultDailyWaiverSchedule(), enabled: true, days: { ...defaultDailyWaiverSchedule().days, fri: 'locked' as const } }
    const r = render(<GeneralTab ctx={ctx({ settings: { [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: stored } })} canEdit hasAfCommissionerSub={false} />)
    expect((r.getByTestId('league-settings-daily-waivers-fri') as HTMLSelectElement).value).toBe('locked')
    fireEvent.change(r.getByTestId('league-settings-general-timezone'), { target: { value: 'America/Denver' } })
    expect(patches.waivers).toEqual([{ timezone: 'America/Denver', dailyWaiverSchedule: stored }])
  })

  it('read-only for a non-commissioner', () => {
    const r = render(<GeneralTab ctx={ctx()} canEdit={false} hasAfCommissionerSub={false} />)
    expect((r.getByTestId('league-settings-general-name') as HTMLInputElement).disabled).toBe(true)
    expect((r.getByRole('switch', { name: 'Daily schedule' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
