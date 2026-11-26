/**
 * The commissioner's "Allow bench drops after kickoff" switch (owner, 2026-11-25), on the web
 * settings hub (WaiversTab) and the in-league commissioner settings (WaiverLeagueSettingsPanel).
 * Off by default: a benched player whose game has started can't be dropped
 * (lib/waiver-wire/transaction-eligibility.ts reads `can_drop_bench_after_lock`).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

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
import { HUB_WAIVER_OPTION_KEYS, hubWaiverEngineConfigPatch, parseHubWaiverOptions } from '@/lib/waiver-wire/hub-waiver-options'

const ctx = { league: { id: 'l1', sport: 'NFL', settings: {}, waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, waiverType: 'faab' } } as never
const effective = (engine: Record<string, unknown> | null) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ freeAgencyMode: 'standard', waiverEngineConfig: engine }) })))

afterEach(() => {
  cleanup()
  patches.length = 0
  lang.language = 'en'
  vi.unstubAllGlobals()
})

describe('the settings hub switch', () => {
  const hubSwitch = (r: ReturnType<typeof render>) => within(r.getByTestId('league-settings-waiver-bench-drops')).getByRole('switch')

  it('is OFF by default and a commissioner can turn it on', async () => {
    effective({})
    const r = render(<WaiversSection ctx={ctx} canEdit timezone="America/New_York" />)
    expect(r.getByText('Allow bench drops after kickoff')).toBeTruthy()
    expect(hubSwitch(r).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(hubSwitch(r))
    expect(patches).toContainEqual({ waiverBenchDropsAfterLock: true })
    expect(hubSwitch(r).getAttribute('aria-checked')).toBe('true')
  })

  it('reads a league that allows it from the stored engine rules', async () => {
    effective({ can_drop_bench_after_lock: true })
    const r = render(<WaiversSection ctx={ctx} canEdit timezone="America/New_York" />)
    await vi.waitFor(() => expect(hubSwitch(r).getAttribute('aria-checked')).toBe('true'))
  })

  it('a member who cannot edit sees it but cannot change it', () => {
    effective({})
    const r = render(<WaiversSection ctx={ctx} canEdit={false} timezone="America/New_York" />)
    expect((hubSwitch(r) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reads in Spanish', () => {
    lang.language = 'es'
    effective({})
    const r = render(<WaiversSection ctx={ctx} canEdit timezone="America/New_York" />)
    expect(r.getByText('Permitir bajas del banco tras el inicio del partido')).toBeTruthy()
    for (const k of ['lsHub.wv.benchDrops', 'lsHub.wv.benchDropsHint']) {
      expect(translations.en[k]).toBeTruthy()
      expect(translations.es[k]).toBeTruthy()
      expect(translations.es[k]).not.toMatch(/waiver/i)
    }
  })
})

describe('the in-league commissioner settings switch', () => {
  const row = (r: ReturnType<typeof render>) =>
    within(r.getByText('Allow bench drops after kickoff').closest('label') as HTMLElement).getByRole('switch')

  it('reads the stored rule and saves through the same settings key', async () => {
    effective({ can_drop_bench_after_lock: true })
    const save = vi.fn()
    const r = render(<WaiverLeagueSettingsPanel leagueId="l1" initialData={{ waiverType: 'faab' } as never} canEdit debouncedSave={save} />)
    await vi.waitFor(() => expect(row(r).getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(row(r))
    expect(save).toHaveBeenCalledWith({ waiverBenchDropsAfterLock: false })
  })
})

describe('the hub save', () => {
  const parse = (body: Record<string, unknown>) => parseHubWaiverOptions(body, { budget: 100 })

  it('writes can_drop_bench_after_lock into waiverEngineConfig, merged by the settings patch', () => {
    const on = parse({ waiverBenchDropsAfterLock: true })
    expect(on).toEqual({ ok: true, options: { benchDropsAfterLock: true } })
    expect(hubWaiverEngineConfigPatch((on as { options: never }).options)).toEqual({ can_drop_bench_after_lock: true })
    const off = parse({ waiverBenchDropsAfterLock: false })
    expect(hubWaiverEngineConfigPatch((off as { options: never }).options)).toEqual({ can_drop_bench_after_lock: false })
  })

  it('refuses anything but true or false', () => {
    expect(parse({ waiverBenchDropsAfterLock: 'yes' })).toEqual({ ok: false, error: 'Invalid waiverBenchDropsAfterLock' })
  })

  it('a save that does not name it leaves it alone', () => {
    const r = parse({ waiverAllowZeroBid: true })
    expect(hubWaiverEngineConfigPatch((r as { options: never }).options)).not.toHaveProperty('can_drop_bench_after_lock')
  })

  it('names "waiver", so the settings lock and co-commissioner scopes file it under waivers', () => {
    expect(HUB_WAIVER_OPTION_KEYS).toContain('waiverBenchDropsAfterLock')
  })
})
