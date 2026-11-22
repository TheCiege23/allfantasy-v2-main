// @vitest-environment jsdom
/**
 * Defense Hub, the 2026-11 redesign (board: DefenseHub).
 *
 * The header now carries three counts. Each must be the payload's own number — a header that drifts
 * from the coverage note under it is the same lie the coverage note exists to prevent. The fixed copy
 * moved into lib/core-app/messages/defenseHub.ts, so Spanish is asserted too.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import type { DefenseHubDefender, DefenseHubPayload } from '@/lib/idp-projections/defenseHub'

const defender = (id: string, over: Partial<DefenseHubDefender> = {}): DefenseHubDefender => ({
  sleeperId: id,
  name: `Defender ${id}`,
  team: 'BAL',
  position: 'LB',
  positionGroup: 'LB',
  projection: 9.4,
  vorp: 2.1,
  positionRank: 12,
  value: 140,
  valueIsFloor: false,
  reason: null,
  lastWeek: null,
  ...over,
})

const payload: DefenseHubPayload = {
  state: 'ok',
  projectedFor: { season: 2026, week: 9 },
  coverage: { defenders: 212, projected: 198, priced: 198 },
  defenders: [defender('1'), defender('2'), defender('3', { projection: null, reason: 'No games on file this season.' })],
  kickers: [],
  kickerValue: null,
  snaps: [],
  roles: [],
  tendencies: [],
  notes: [],
}

const mount = () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))
  return render(<DefenseHubClient leagueId="L1" embedded />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.language = 'en'
})

/*
 * 2026-11-14: the three header counts and the coverage note under them said the same numbers twice.
 * The headline now gives the answer — who leads your defense — off the payload's own first projected
 * defender and count, and one line says what the projections were built from.
 */
describe('Defense Hub header', () => {
  it('the headline is who leads your defense, read straight off the payload; the counts are not repeated', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('defense-hub-headline').textContent).toContain('leads'))
    expect(screen.getByTestId('defense-hub-headline').textContent).toBe('Defender 1 leads your 3 defenders: 9.4 projected for week 9')
    // Built from the games through the week BEFORE the projection's target.
    expect(screen.getByTestId('defense-hub-basis').textContent).toBe('Projected under this league’s scoring from games through 2026 week 8.')
    expect(document.querySelector('.af-dfh-stats')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Your defenders' })).toBeInTheDocument()
  })

  it('says only "Defense Hub" until there is a payload', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<DefenseHubClient leagueId="L1" embedded />)
    expect(screen.getByTestId('defense-hub-headline').textContent).toBe('Defense Hub')
    expect(screen.queryByTestId('defense-hub-basis')).toBeNull()
  })

  it('reads Spanish when the reader does', async () => {
    h.language = 'es'
    mount()
    await waitFor(() => expect(screen.getByTestId('defense-hub-headline').textContent).toContain('lidera'))
    expect(screen.getByText('Defensa')).toBeInTheDocument()
    expect(screen.getByTestId('defense-hub-headline').textContent).toBe('Defender 1 lidera a tus 3 defensores: 9.4 proyectados para la semana 9')
    expect(screen.getByRole('heading', { name: 'Tus defensores' })).toBeInTheDocument()
    expect(screen.getByText('Jugador')).toBeInTheDocument()
  })
})
