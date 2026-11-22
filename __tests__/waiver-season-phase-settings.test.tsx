/**
 * The commissioner's offseason and playoff waiver rules in the settings hub
 * (components/league-settings/tabs/WaiversTab.tsx → PATCH /api/leagues/:id/settings → the
 * `waiverEngineConfig` keys `offseason_waiver_rules` / `playoff_waiver_rules`), and the waiver
 * screens' reason when the phase blocks a move.
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
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children}</a>
  ),
}))
vi.mock('@/components/league/PlayerHeadshot', () => ({ PlayerHeadshot: () => null }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: (p: Record<string, unknown>) => patches.push(p), saving: false }),
}))

import { WaiversSection } from '@/components/league-settings/tabs/WaiversTab'
import WaiverPlayerRow from '@/components/waiver-wire/WaiverPlayerRow'
import {
  HUB_WAIVER_OPTION_KEYS,
  hubWaiverEngineConfigPatch,
  parseHubWaiverOptions,
  readOffseasonWaiverRule,
  readPlayoffWaiverRule,
} from '@/lib/waiver-wire/hub-waiver-options'
import { phaseMoveBlockReason } from '@/lib/waiver-wire/immediate-add-policy'
import { PHASE_REASONS } from '@/lib/waiver-wire/season-phase-policy'
import { translations } from '@/lib/i18n/translations'

const NEW_KEYS = /^lsHub\.wv\.(offseason|playoffs)/

describe('validation and storage', () => {
  const parse = (body: Record<string, unknown>) => parseHubWaiverOptions(body, { budget: 100 })

  it('offseason: closed or fcfs; playoffs: all teams, alive only or locked', () => {
    expect(parse({ waiverOffseasonRule: 'fcfs' })).toEqual({ ok: true, options: { offseasonWaiverRule: 'fcfs' } })
    expect(parse({ waiverPlayoffRule: 'alive_only' })).toEqual({ ok: true, options: { playoffWaiverRule: 'alive_only' } })
    expect(parse({ waiverPlayoffRule: 'locked' }).ok).toBe(true)
    expect(parse({ waiverOffseasonRule: 'open' })).toEqual({ ok: false, error: 'Invalid waiverOffseasonRule' })
    expect(parse({ waiverPlayoffRule: true })).toEqual({ ok: false, error: 'Invalid waiverPlayoffRule' })
  })

  it('the new keys name "waiver", so the settings lock files them under waivers', () => {
    expect(HUB_WAIVER_OPTION_KEYS).toEqual(expect.arrayContaining(['waiverOffseasonRule', 'waiverPlayoffRule']))
    for (const k of HUB_WAIVER_OPTION_KEYS) expect(k.toLowerCase()).toContain('waiver')
  })

  it('a save writes only the engine keys it names', () => {
    expect(hubWaiverEngineConfigPatch({ offseasonWaiverRule: 'fcfs', playoffWaiverRule: 'locked' })).toEqual({
      offseason_waiver_rules: 'fcfs',
      playoff_waiver_rules: 'locked',
    })
    expect(hubWaiverEngineConfigPatch({ allowZeroFaabBid: false })).toEqual({ allow_zero_faab_bid: false })
    expect(hubWaiverEngineConfigPatch({ tiebreakRule: 'earliest_claim' })).toEqual({})
  })

  it('defaults: closed offseason, waivers for every team in the playoffs', () => {
    expect(readOffseasonWaiverRule(undefined)).toBe('closed')
    expect(readOffseasonWaiverRule('bogus')).toBe('closed')
    expect(readPlayoffWaiverRule(null)).toBe('all_teams')
    expect(readPlayoffWaiverRule('ALIVE_ONLY')).toBe('alive_only')
  })
})

function ctx(league: Record<string, unknown>) {
  return { league: { id: 'l1', sport: 'NFL', settings: {}, waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, waiverType: 'faab', ...league } } as never
}
const renderHub = () => render(<WaiversSection ctx={ctx({})} canEdit timezone="America/New_York" />)

describe('the hub', () => {
  afterEach(() => {
    cleanup()
    patches.length = 0
    lang.language = 'en'
    vi.unstubAllGlobals()
  })

  it('shows both rules at their defaults and saves a change', () => {
    const r = renderHub()
    const off = r.getByTestId('league-settings-waiver-offseason-rule') as HTMLSelectElement
    const po = r.getByTestId('league-settings-waiver-playoff-rule') as HTMLSelectElement
    expect(off.value).toBe('closed')
    expect(po.value).toBe('all_teams')
    expect([...po.options].map((o) => o.value)).toEqual(['all_teams', 'alive_only', 'locked'])
    fireEvent.change(off, { target: { value: 'fcfs' } })
    fireEvent.change(po, { target: { value: 'locked' } })
    expect(patches).toEqual([{ waiverOffseasonRule: 'fcfs' }, { waiverPlayoffRule: 'locked' }])
  })

  it('reads the stored rules from the effective waiver settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ offseasonWaiverRule: 'fcfs', playoffWaiverRule: 'alive_only' }) })))
    const r = renderHub()
    await vi.waitFor(() => expect((r.getByTestId('league-settings-waiver-playoff-rule') as HTMLSelectElement).value).toBe('alive_only'))
    expect((r.getByTestId('league-settings-waiver-offseason-rule') as HTMLSelectElement).value).toBe('fcfs')
  })

  it('every new label exists in English and Spanish, and the Spanish never says «waiver»', () => {
    const keys = Object.keys(translations.en).filter((k) => NEW_KEYS.test(k))
    expect(keys.length).toBe(9)
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
    for (const k of keys) expect(translations.es[k]).not.toMatch(/waiver/i)
    expect(translations.es['lsHub.wv.offseason.closed']).toContain('Reclamos')
    expect(translations.es['lsHub.wv.playoffs.all_teams']).toContain('reclamos')
  })

  it('renders in Spanish', () => {
    lang.language = 'es'
    const r = renderHub()
    expect(r.getByTestId('league-settings-waiver-playoff-rule').textContent).toContain('Bloquear todas las plantillas')
    expect(r.getByTestId('league-settings-waiver-offseason-rule').textContent).toContain('Agencia libre abierta, por orden de llegada')
  })
})

describe('the waiver screen says why a move is blocked', () => {
  it('names the phase reason, and nothing in the regular season', () => {
    const policy = (code: keyof typeof PHASE_REASONS | null) =>
      ({ phasePolicy: { phase: 'playoffs', claimsAllowed: false, immediateAddsAllowed: false, firstComeAdds: false, code, reason: code ? PHASE_REASONS[code] : null } }) as never
    expect(phaseMoveBlockReason(policy('playoffs_locked'))).toBe(PHASE_REASONS.playoffs_locked)
    expect(phaseMoveBlockReason(policy('playoffs_eliminated'))).toBe(PHASE_REASONS.playoffs_eliminated)
    expect(phaseMoveBlockReason(policy(null))).toBeNull()
    expect(phaseMoveBlockReason(null)).toBeNull()
  })
})

describe('a waiver-wire player card', () => {
  afterEach(cleanup)
  const player = { id: 'p1', name: 'Pat Player', position: 'WR', team: 'KC' }

  it('shows "On waivers until …" for a held player', () => {
    const r = render(<WaiverPlayerRow player={player} onAddClick={() => {}} waiverHoldLabel="On waivers until Wed 6:00 AM" />)
    expect(r.getByTestId('waiver-player-hold-p1').textContent).toBe('On waivers until Wed 6:00 AM')
    expect((r.getByTestId('waiver-claim-open-p1') as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the button with the phase reason when the phase closes every move', () => {
    const r = render(<WaiverPlayerRow player={player} onAddClick={() => {}} addMode movesClosedReason={PHASE_REASONS.playoffs_locked} />)
    const btn = r.getByTestId('waiver-add-p1') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe(PHASE_REASONS.playoffs_locked)
    expect(r.queryByTestId('waiver-player-hold-p1')).toBeNull()
  })
})
