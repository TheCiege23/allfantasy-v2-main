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

const stat = (key: string) => document.querySelector(`.af-dfh-stat[data-stat="${key}"] .af-dfh-stat-v`)?.textContent

describe('Defense Hub header and coverage note', () => {
  it('reads its three header counts straight off the payload', async () => {
    mount()
    await waitFor(() => expect(document.querySelector('.af-dfh-stats')).not.toBeNull())
    expect(stat('rostered')).toBe('3')
    expect(stat('projected')).toBe('2/3')
    expect(stat('priced')).toBe('198')
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('2 of 3 rostered defenders projected from games through 2026 week 8')
    expect(note.getAttribute('data-full')).toBe('false')
    expect(screen.getByRole('heading', { name: 'Your rostered defenders' })).toBeInTheDocument()
  })

  it('draws no header counts until there is a payload to count', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<DefenseHubClient leagueId="L1" embedded />)
    expect(screen.getByText('Defense Hub')).toBeInTheDocument()
    expect(document.querySelector('.af-dfh-stats')).toBeNull()
  })

  it('reads Spanish when the reader does', async () => {
    h.language = 'es'
    mount()
    await waitFor(() => expect(document.querySelector('.af-dfh-stats')).not.toBeNull())
    expect(screen.getByText('Defensa')).toBeInTheDocument()
    expect(screen.getByText('Defensores en plantilla')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tus defensores en plantilla' })).toBeInTheDocument()
    expect(screen.getByRole('note').textContent).toContain('2 de 3 defensores en plantilla proyectados')
    expect(screen.getByText('Jugador')).toBeInTheDocument()
  })
})
