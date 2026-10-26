/**
 * The commissioner controls for Sleeper-style free agency and FAAB at rollover, on the web settings
 * hub (WaiversTab) and the in-league commissioner settings (WaiverLeagueSettingsPanel).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

const patches = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language][k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: (p: Record<string, unknown>) => patches.push(p), saving: false }),
}))

import { WaiversSection } from '@/components/league-settings/tabs/WaiversTab'
import { WaiverLeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/WaiverLeagueSettingsPanel'
import { translations } from '@/lib/i18n/translations'
import { HUB_WAIVER_OPTION_KEYS } from '@/lib/waiver-wire/hub-waiver-options'

function ctx(league: Record<string, unknown>) {
  return { league: { id: 'l1', sport: 'NFL', settings: {}, waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, waiverType: 'faab', ...league } } as never
}
const renderHub = (league: Record<string, unknown> = {}) => render(<WaiversSection ctx={ctx(league)} canEdit timezone="America/New_York" />)

afterEach(() => {
  cleanup()
  patches.length = 0
  lang.language = 'en'
  vi.unstubAllGlobals()
})

describe('the settings hub', () => {
  it('free agency: defaults to the league rules and saves the Sleeper-style mode', () => {
    const r = renderHub()
    const sel = r.getByTestId('league-settings-waiver-free-agency-mode') as HTMLSelectElement
    expect(sel.value).toBe('standard')
    expect([...sel.options].map((o) => o.value)).toEqual(['standard', 'after_run'])
    fireEvent.change(sel, { target: { value: 'after_run' } })
    expect(patches).toEqual([{ waiverFreeAgencyMode: 'after_run' }])
    expect(r.container.textContent).toContain('Like Sleeper')
  })

  it('free agency is not offered in an FCFS league, which has no run to clear', () => {
    const r = renderHub({ waiverType: 'fcfs' })
    expect(r.queryByTestId('league-settings-waiver-free-agency-mode')).toBeNull()
  })

  it('FAAB rollover: shows the family default and saves a choice', () => {
    const r = renderHub()
    const sel = r.getByTestId('league-settings-faab-rollover') as HTMLSelectElement
    expect(sel.value).toBe('reset')
    fireEvent.change(sel, { target: { value: 'carry_over' } })
    expect(patches).toEqual([{ waiverFaabRollover: 'carry_over' }])
    cleanup()
    const dyn = renderHub({ leagueVariant: 'dynasty', isDynasty: true })
    expect((dyn.getByTestId('league-settings-faab-rollover') as HTMLSelectElement).value).toBe('carry_over')
  })

  it('a keeper league not flagged isDynasty shows "carry over" — the classifier the renewal uses', () => {
    const r = renderHub({ leagueVariant: 'keeper', isDynasty: false })
    expect((r.getByTestId('league-settings-faab-rollover') as HTMLSelectElement).value).toBe('carry_over')
  })

  it('FAAB rollover is hidden without FAAB', () => {
    const r = renderHub({ waiverType: 'rolling' })
    expect(r.queryByTestId('league-settings-faab-rollover')).toBeNull()
  })

  it('reads the stored values from the effective waiver settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ freeAgencyMode: 'after_run', faabRolloverRule: 'carry_over' }) })))
    const r = renderHub()
    await vi.waitFor(() => expect((r.getByTestId('league-settings-waiver-free-agency-mode') as HTMLSelectElement).value).toBe('after_run'))
    expect((r.getByTestId('league-settings-faab-rollover') as HTMLSelectElement).value).toBe('carry_over')
  })

  it('renders in Spanish with «reclamos», never «waiver»', () => {
    lang.language = 'es'
    const r = renderHub()
    expect(r.getByTestId('league-settings-waiver-free-agency-mode').textContent).toContain('Reclamos hasta cada procesamiento, luego agentes libres')
    expect(r.getByTestId('league-settings-faab-rollover').textContent).toContain('Volver al presupuesto inicial')
  })

  it('every new key exists in English and Spanish; the patch keys name "waiver"', () => {
    const keys = Object.keys(translations.en).filter((k) => k.startsWith('waiverFa.'))
    expect(keys.length).toBe(11)
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
    for (const k of keys) expect(translations.es[k]).not.toMatch(/waiver/i)
    expect(translations.es['waiverFa.lineupWarning']).toContain('{{slots}}')
    for (const k of HUB_WAIVER_OPTION_KEYS) expect(k.toLowerCase()).toContain('waiver')
  })
})

describe('the in-league commissioner settings', () => {
  const panel = (initial: Record<string, unknown>, save = vi.fn()) => ({
    save,
    r: render(<WaiverLeagueSettingsPanel leagueId="l1" initialData={initial as never} canEdit debouncedSave={save} />),
  })

  it('offers both options and saves through the same settings patch keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ freeAgencyMode: 'standard', faabRolloverRule: null }) })))
    const { r, save } = panel({ waiverType: 'faab', isDynasty: false })
    const mode = r.getByTestId('settings-waiver-free-agency-mode') as HTMLSelectElement
    const roll = r.getByTestId('settings-faab-rollover') as HTMLSelectElement
    expect(roll.value).toBe('reset')
    fireEvent.change(mode, { target: { value: 'after_run' } })
    fireEvent.change(roll, { target: { value: 'carry_over' } })
    expect(save).toHaveBeenCalledWith({ waiverFreeAgencyMode: 'after_run' })
    expect(save).toHaveBeenCalledWith({ waiverFaabRollover: 'carry_over' })
  })

  it('a keeper league not flagged isDynasty shows the server\'s "carry over" default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ freeAgencyMode: 'standard', faabRolloverRule: null, faabRolloverDefault: 'carry_over' }) })))
    const { r } = panel({ waiverType: 'faab', isDynasty: false, leagueType: 'keeper' })
    await vi.waitFor(() => expect((r.getByTestId('settings-faab-rollover') as HTMLSelectElement).value).toBe('carry_over'))
  })

  it('reads the stored mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ freeAgencyMode: 'after_run', faabRolloverRule: 'carry_over' }) })))
    const { r } = panel({ waiverType: 'faab', isDynasty: false })
    await vi.waitFor(() => expect((r.getByTestId('settings-waiver-free-agency-mode') as HTMLSelectElement).value).toBe('after_run'))
    expect((r.getByTestId('settings-faab-rollover') as HTMLSelectElement).value).toBe('carry_over')
  })
})
