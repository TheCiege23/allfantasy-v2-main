/**
 * The Commissioner Settings legacy Devy / C2C tabs are editors now: a commissioner edits and saves
 * through PATCH /api/devy or PATCH /api/c2c/settings; everyone else reads the same values.
 *
 * Every panel is rendered in English AND Spanish. The language mock returns the raw KEY for a
 * missing string — and, for Spanish, never falls back to English — so a key missing from either
 * dictionary shows up on screen as `legacy…` and fails here.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const { tInterpolate } = await import('@/lib/i18n/tInterpolate')
  return {
    useOptionalLanguage: () => {
      const t = (k: string) => translations[lang.language]?.[k] ?? k
      return { language: lang.language, setLanguage: () => {}, t, tInterpolate: (k: string, v = {}) => tInterpolate(t, k, v) }
    },
  }
})

import { DevyFormatPanel } from '@/app/devy/components/settings/DevyFormatPanel'
import { DevyRosterPanel } from '@/app/devy/components/settings/DevyRosterPanel'
import { DevyRulesPanel } from '@/app/devy/components/settings/DevyRulesPanel'
import { DevyTaxiPanel } from '@/app/devy/components/settings/DevyTaxiPanel'
import { DevyDraftsPanel } from '@/app/devy/components/settings/DevyDraftsPanel'
import { C2CFormatPanel } from '@/app/c2c/components/settings/C2CFormatPanel'
import { C2CRostersPanel } from '@/app/c2c/components/settings/C2CRostersPanel'
import { C2CScoringPanel } from '@/app/c2c/components/settings/C2CScoringPanel'
import { C2CTaxiPanel } from '@/app/c2c/components/settings/C2CTaxiPanel'
import { C2CDevyPanel } from '@/app/c2c/components/settings/C2CDevyPanel'
import { C2CDraftsPanel } from '@/app/c2c/components/settings/C2CDraftsPanel'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

const DEVY: Record<string, unknown> = {
  leagueId: 'L1',
  startupDraftFormat: 'combined',
  futureDraftFormat: 'combined',
  activeRosterSize: 20,
  benchSlots: 6,
  irSlots: 2,
  taxiSlots: 5,
  devySlots: 10,
  maxDevyPerTeam: 10,
  taxiRookieOnly: true,
  taxiAllowNonRookies: false,
  taxiMaxExperienceYears: 1,
  taxiLockDeadline: null,
  taxiCanReturnAfterPromo: false,
  taxiDevyToRookieEligible: true,
  taxiPointsVisibleDisplay: true,
  taxiPoachaingEnabled: false,
  devyFreshmenEligible: false,
  devyAutoPromoteToRookie: true,
  devyDeclarationVisibility: true,
  rookiePickTradingEnabled: true,
  devyPickTradingEnabled: true,
  devyGradBehavior: 'move_to_taxi',
  season: 2026,
}

const C2C = (over: Partial<C2CConfigClient> = {}): C2CConfigClient => ({
  sportPair: 'NFL_CFB',
  scoringMode: 'combined_total',
  campusScoreWeight: 0.4,
  cantonScoreWeight: 0.6,
  devyScoringEnabled: false,
  startupDraftFormat: 'split_campus_canton',
  futureDraftFormat: 'combined',
  campusStarterSlots: 8,
  cantonStarterSlots: 8,
  benchSlots: 8,
  taxiSlots: 4,
  devySlots: 6,
  irSlots: 2,
  taxiRookieOnly: true,
  taxiMaxExperienceYears: 1,
  taxiLockDeadline: null,
  taxiPointsVisible: true,
  basketballLineupFreq: 'weekly',
  footballCampusLockDay: 'saturday_kickoff',
  footballCantonLockDay: 'sunday_kickoff_per_player',
  taxiLockMode: 'no_limit',
  ...over,
})

type AnyPanel = (p: { config: never; leagueId?: string; canEdit?: boolean; onSaved?: (c: never) => void }) => React.ReactElement | null

const PANELS: Array<[string, AnyPanel, () => unknown]> = [
  ['devy-format-panel', DevyFormatPanel as AnyPanel, () => DEVY],
  ['devy-roster-panel', DevyRosterPanel as AnyPanel, () => DEVY],
  ['devy-rules-panel', DevyRulesPanel as AnyPanel, () => DEVY],
  ['devy-taxi-panel', DevyTaxiPanel as AnyPanel, () => DEVY],
  ['devy-drafts-panel', DevyDraftsPanel as AnyPanel, () => DEVY],
  ['c2c-format-panel', C2CFormatPanel as AnyPanel, () => C2C({ scoringMode: 'weighted_combined' })],
  ['c2c-rosters-panel', C2CRostersPanel as AnyPanel, () => C2C()],
  ['c2c-scoring-panel (football)', C2CScoringPanel as AnyPanel, () => C2C()],
  ['c2c-scoring-panel (basketball)', C2CScoringPanel as AnyPanel, () => C2C({ sportPair: 'NBA_CBB' })],
  ['c2c-taxi-panel', C2CTaxiPanel as AnyPanel, () => C2C()],
  ['c2c-devy-panel', C2CDevyPanel as AnyPanel, () => C2C()],
  ['c2c-drafts-panel', C2CDraftsPanel as AnyPanel, () => C2C()],
]

const fetchMock = vi.fn()
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })
const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string)

beforeEach(() => {
  lang.language = 'en'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The words the old panels used to promise edits that never came. */
const FALSE_COPY = /read-only snapshot|follow-up|not yet exposed|wired separately|solo lectura/i

describe.each(['en', 'es'] as const)('every legacy panel in %s', (language) => {
  it.each(PANELS)('%s: no missing strings, no false copy, and a Save for the commissioner', (_name, Panel, cfg) => {
    lang.language = language
    const { container, unmount } = render(<Panel config={cfg() as never} leagueId="L1" canEdit />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/legacy(Settings|Devy|C2c)\./)
    expect(text).not.toMatch(FALSE_COPY)
    if (language === 'es') expect(text.toLowerCase()).not.toContain('waiver')
    // The football scoring tab has nothing to save; every other tab has a Save button.
    const save = container.querySelector('[data-testid$="-save"]')
    if (_name === 'c2c-scoring-panel (football)') expect(save).toBeNull()
    else expect(save?.textContent).toBe(language === 'es' ? 'Guardar cambios' : 'Save changes')
    unmount()
  })

  it.each(PANELS)('%s: a non-commissioner sees values and no controls', (_name, Panel, cfg) => {
    lang.language = language
    const { container, unmount } = render(<Panel config={cfg() as never} leagueId="L1" canEdit={false} />)
    expect(container.querySelectorAll('input, select, button').length).toBe(0)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/legacy(Settings|Devy|C2c)\./)
    if (_name !== 'c2c-scoring-panel (football)') {
      expect(text).toContain(language === 'es' ? 'Solo el comisionado puede cambiar estos ajustes.' : 'Only the commissioner can change these settings.')
    }
    unmount()
  })
})

describe('editing and saving', () => {
  it('Devy roster: sends only the changed field, then shows Saved and hands back the record', async () => {
    const onSaved = vi.fn()
    fetchMock.mockResolvedValue(ok({ ok: true, config: { ...DEVY, taxiSlots: 6 } }))
    render(<DevyRosterPanel config={DEVY} leagueId="L1" canEdit onSaved={onSaved} />)
    const save = screen.getByTestId('devy-roster-panel-save') as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing changed yet
    fireEvent.change(screen.getByTestId('devy-roster-panel-taxiSlots'), { target: { value: '6' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByTestId('devy-roster-panel-saved').textContent).toBe('Saved.'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/devy')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(sentBody()).toEqual({ leagueId: 'L1', taxiSlots: 6 })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ taxiSlots: 6 }))
  })

  it('out of range: refused before sending, with the route’s own bounds', () => {
    render(<DevyRosterPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('devy-roster-panel-taxiSlots'), { target: { value: '99' } })
    fireEvent.click(screen.getByTestId('devy-roster-panel-save'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('devy-roster-panel-error').textContent).toBe('Taxi slots must be a whole number from 0 to 20.')
  })

  it.each([
    ['en', 'Taxi slots can’t go below 3: a team holds 3 there now.'.replace('’', "'")],
    ['es', 'Plazas de taxi no puede bajar de 3: un equipo tiene 3 ahí ahora.'],
  ] as const)('a slot lock from the server reads in %s', async (language, message) => {
    lang.language = language
    fetchMock.mockResolvedValue(fail(409, { code: 'SLOT_BELOW_HELD', conflicts: [{ field: 'taxiSlots', held: 3, requested: 2 }] }))
    render(<DevyRosterPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('devy-roster-panel-taxiSlots'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('devy-roster-panel-save'))
    await waitFor(() => expect(screen.getByTestId('devy-roster-panel-error').textContent).toBe(message))
    expect(screen.queryByTestId('devy-roster-panel-saved')).toBeNull()
  })

  it('the combined active-capacity lock names all three fields', async () => {
    fetchMock.mockResolvedValue(fail(409, { code: 'SLOT_BELOW_HELD', conflicts: [{ field: 'activeCapacity', held: 27, requested: 26 }] }))
    render(<DevyRosterPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('devy-roster-panel-benchSlots'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('devy-roster-panel-save'))
    await waitFor(() =>
      expect(screen.getByTestId('devy-roster-panel-error').textContent).toBe(
        "Active roster, bench and IR together can't go below 27: a team holds 27 there now.",
      ),
    )
  })

  it('Devy format: a started draft reads in Spanish', async () => {
    lang.language = 'es'
    fetchMock.mockResolvedValue(fail(409, { code: 'DRAFT_STARTED', field: 'startupDraftFormat' }))
    render(<DevyFormatPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('devy-format-panel-startupDraftFormat'), { target: { value: 'split_devy_first' } })
    fireEvent.click(screen.getByTestId('devy-format-panel-save'))
    await waitFor(() =>
      expect(screen.getByTestId('devy-format-panel-error').textContent).toBe('El draft inicial ya empezó, así que su formato ya no puede cambiar.'),
    )
    expect(sentBody()).toEqual({ leagueId: 'L1', startupDraftFormat: 'split_devy_first' })
  })

  it('a network failure shows the generic error and keeps the edit', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<DevyRulesPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.click(screen.getByTestId('devy-rules-panel-devyFreshmenEligible'))
    fireEvent.click(screen.getByTestId('devy-rules-panel-save'))
    await waitFor(() => expect(screen.getByTestId('devy-rules-panel-error').textContent).toBe('Could not save. Try again.'))
    expect((screen.getByTestId('devy-rules-panel-devyFreshmenEligible') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('devy-rules-panel-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('Devy taxi: a deadline is sent as an ISO instant, and Clear sends null', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, config: DEVY }))
    render(<DevyTaxiPanel config={DEVY} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('devy-taxi-panel-taxiLockDeadline'), { target: { value: '2026-09-01T12:00' } })
    fireEvent.click(screen.getByTestId('devy-taxi-panel-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody().taxiLockDeadline).toBe(new Date('2026-09-01T12:00').toISOString())
    cleanup()
    fetchMock.mockClear()
    render(<DevyTaxiPanel config={{ ...DEVY, taxiLockDeadline: '2026-09-01T16:00:00.000Z' }} leagueId="L1" canEdit />)
    fireEvent.click(screen.getByText('Clear'))
    fireEvent.click(screen.getByTestId('devy-taxi-panel-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody()).toEqual({ leagueId: 'L1', taxiLockDeadline: null })
  })

  it('C2C format: the weight shows only for Weighted, and is sent as a fraction', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, c2c: C2C({ scoringMode: 'weighted_combined', campusScoreWeight: 0.55, cantonScoreWeight: 0.45 }) }))
    const onSaved = vi.fn()
    render(<C2CFormatPanel config={C2C()} leagueId="L1" canEdit onSaved={onSaved} />)
    expect(screen.queryByTestId('c2c-format-panel-campusScoreWeight')).toBeNull()
    fireEvent.change(screen.getByTestId('c2c-format-panel-scoringMode'), { target: { value: 'weighted_combined' } })
    fireEvent.change(screen.getByTestId('c2c-format-panel-campusScoreWeight'), { target: { value: '55' } })
    expect(screen.getByText('Canton gets the rest: 45%.')).toBeTruthy()
    fireEvent.click(screen.getByTestId('c2c-format-panel-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/c2c/settings')
    expect(sentBody()).toEqual({ leagueId: 'L1', scoringMode: 'weighted_combined', campusScoreWeight: 0.55 })
    expect(onSaved.mock.calls[0][0]).toMatchObject({ campusScoreWeight: 0.55 })
  })

  it('C2C taxi: the lock mode and the rookie rule save together', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, c2c: C2C({ taxiLockMode: 'preseason', taxiRookieOnly: false }) }))
    render(<C2CTaxiPanel config={C2C()} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('c2c-taxi-panel-taxiLockMode'), { target: { value: 'preseason' } })
    fireEvent.click(screen.getByTestId('c2c-taxi-panel-taxiRookieOnly'))
    fireEvent.click(screen.getByTestId('c2c-taxi-panel-save'))
    await waitFor(() => expect(screen.getByTestId('c2c-taxi-panel-saved')).toBeTruthy())
    expect(sentBody()).toEqual({ leagueId: 'L1', taxiLockMode: 'preseason', taxiRookieOnly: false })
  })

  it('C2C rosters in Spanish: a 403 reads as commissioner-only', async () => {
    lang.language = 'es'
    fetchMock.mockResolvedValue(fail(403, { error: 'Forbidden' }))
    render(<C2CRostersPanel config={C2C()} leagueId="L1" canEdit />)
    fireEvent.change(screen.getByTestId('c2c-rosters-panel-benchSlots'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('c2c-rosters-panel-save'))
    await waitFor(() => expect(screen.getByTestId('c2c-rosters-panel-error').textContent).toBe('Solo el comisionado puede guardar estos ajustes.'))
    expect(sentBody()).toEqual({ leagueId: 'L1', benchSlots: 9 })
  })
})

describe('read-only values', () => {
  it('Devy taxi shows the stored values in Spanish', () => {
    lang.language = 'es'
    render(<DevyTaxiPanel config={{ ...DEVY, taxiSlots: 5 }} leagueId="L1" canEdit={false} />)
    expect(screen.getByTestId('devy-taxi-panel-taxiRookieOnly-value').textContent).toBe('Activado')
    expect(screen.getByTestId('devy-taxi-panel-taxiAllowNonRookies-value').textContent).toBe('Desactivado')
    expect(screen.getByTestId('devy-taxi-panel-taxiLockDeadline-value').textContent).toBe('Sin fecha')
  })

  it('C2C drafts shows option labels, not stored codes', () => {
    render(<C2CDraftsPanel config={C2C()} leagueId="L1" canEdit={false} />)
    expect(screen.getByTestId('c2c-drafts-panel-startupDraftFormat-value').textContent).toBe('Split: campus and canton drafts')
    expect(screen.getByTestId('c2c-drafts-panel-futureDraftFormat-value').textContent).toBe('Combined board')
  })
})
