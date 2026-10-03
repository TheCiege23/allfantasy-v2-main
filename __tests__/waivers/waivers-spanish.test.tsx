import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/*
 * The Waivers "Worth adding" board and Waiver Intelligence in Spanish (2026-10-03 language audit).
 * Neither component read the language at all, and most of what they show is written by a LOADER —
 * notes, state reasons, reasoning lines, formula notes — which arrive in English whatever the reader
 * chose. The payloads here carry those sentences exactly as the loaders write them.
 */

const lang = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }))

const intel = vi.hoisted(() => ({
  data: {
    supported: true,
    intel: {
      budget: 1000,
      myRemaining: 1000,
      history: { claims: 48, medianBid: 75, p75Bid: 156, topBid: 900, recent: [{ season: '2026', week: 4, bid: 55, playerName: 'Jakobi Meyers', position: 'WR' }] },
      targets: [
        {
          playerId: 'h',
          name: 'Tank Bigsby',
          position: 'RB',
          team: 'PHI',
          marketValue: 80,
          fillsSlots: [],
          suggestedBid: 374,
          reasoning: [
            'market value 80 (redraft chart)',
            'suggested = min(60% of $1000, $1000 × value/anchor)',
            "this league's winning bids: median $75, p75 $156 — calibrate against the room",
          ],
        },
        {
          playerId: 'm',
          name: 'Jordan Mason',
          position: 'RB',
          team: 'MIN',
          marketValue: 574,
          fillsSlots: [],
          suggestedBid: 600,
          unavailable: { kind: 'ruled_out', status: 'IR' },
          reasoning: ['IR — he cannot play this week, so any bid is a stash', 'market value 574 (redraft chart)'],
        },
      ],
      formulaNotes: [
        "How a bid is suggested: our own rule, not market data — a full FAAB budget is treated as worth about the 150th-best player, and a player's bid is his share of that.",
        'No suggestion is more than 60% of the budget.',
        "The room's history counts every winning claim since this league began. The platform doesn't share losing bids.",
      ],
      missing: [],
    },
  } as unknown,
}))
vi.mock('@/components/decide/useWaiverIntel', () => ({ useWaiverIntel: () => ({ data: intel.data, loading: false }) }))

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import { WaiverIntel } from '@/components/decide/WaiverIntel'

const BOARD = {
  state: 'ok',
  season: '2026',
  week: 4,
  currentLineupPoints: 83.64,
  candidates: [
    {
      sleeperId: '1',
      name: 'Ryan Miller',
      position: 'WR',
      team: 'MIA',
      projectedPoints: 8.46,
      gain: 1.83,
      displaces: { sleeperId: '2', name: 'Oronde Gadsden', projectedPoints: 6.63 },
      basis: 'form',
      formGames: 3,
    },
  ],
  needs: { week: 4, emptySlots: [], noBackup: [{ position: 'TE', rostered: 1, starting: 1 }], byes: [] },
  notes: [
    'Ranked by how much each adds to your best starting lineup, not by raw projection — a big name who would not crack your lineup is worth nothing this week.',
    'Games already kicked off are locked in: 1 bench player can no longer come in and 14 free agents whose game has started are not shown.',
    '74 free agents are ruled out, on injured reserve or on a bye this week and not shown.',
    '229 of 422 startable free agents could not be projected under this league’s scoring and are not shown.',
    '1620 other active players were skipped because no slot in this league can hold them.',
  ],
}

const mockFetch = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })) as never)

afterEach(() => {
  vi.unstubAllGlobals()
  lang.value = 'es'
})

/** English that must not survive into Spanish — each a phrase only the English rendering carries. */
const ENGLISH = [
  'Worth adding',
  'your best lineup',
  'Ranked by how much',
  'Games already kicked off',
  'ruled out, on injured reserve',
  'could not be projected',
  'were skipped because',
  'form · ',
  'over Oronde',
  'No TE backup',
  'rostered for',
  'Your priority',
  'A claim sends you',
]

async function boardText(body: unknown, props: Record<string, unknown> = {}) {
  mockFetch(body)
  const view = render(<WaiverLineupBoard leagueId="lg1" {...props} />)
  await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
  const text = screen.getByTestId('waiver-lineup-board').textContent ?? ''
  view.unmount()
  return text
}

describe('"Worth adding" in Spanish', () => {
  it('translates the header, the rows, the needs strip, the priority line — and every loader note', async () => {
    const text = await boardText(BOARD, { rollingPriority: { priority: 3, leagueRosters: 18 } })
    for (const english of ENGLISH) expect(text, english).not.toContain(english)
    expect(text).toContain('Vale la pena sumar')
    expect(text).toContain('tu mejor alineación 83.64 · sem 4')
    expect(text).toContain('en lugar de Oronde Gadsden')
    expect(text).toContain('forma · 3 p')
    expect(text).toContain('Sin suplente de TE')
    expect(text).toContain('Tu prioridad: #3 de 18.')
    expect(text).toContain('Los partidos que ya empezaron quedan fijos: 1 jugador de la banca ya no puede entrar y no se muestran 14 agentes libres cuyo partido ya empezó.')
    expect(text).toContain('No se muestran 74 agentes libres')
    expect(text).toContain('No se pudo proyectar a 229 de 422 agentes libres')
  })

  it('CONTROL: the same board in English still carries every one of those phrases', async () => {
    lang.value = 'en'
    const text = await boardText(BOARD, { rollingPriority: { priority: 3, leagueRosters: 18 } })
    for (const english of ENGLISH) expect(text, english).toContain(english)
  })

  it('translates a state reason and the empty finding', async () => {
    expect(await boardText({ ...BOARD, state: 'no_slots', candidates: [], notes: [] })).toContain(
      'esta liga no publica sus puestos titulares, así que no hay alineación que mejorar',
    )
    expect(await boardText({ ...BOARD, candidates: [], notes: [] })).toContain('ningún agente libre mejoraría tu alineación titular esta semana')
  })
})

describe('Waiver Intelligence in Spanish', () => {
  const intelText = () => {
    const view = render(<WaiverIntel leagueId="lg1" surface="core" />)
    const text = screen.getByTestId('waiver-intel').textContent ?? ''
    view.unmount()
    return text
  }
  const ENGLISH_INTEL = [
    'Waiver intelligence',
    'Top available',
    'market value',
    'calibrate against the room',
    "can't play this week",
    'he cannot play this week',
    'How this room bids',
    'Median winning bid',
    'Recent winners',
    'How a bid is suggested',
    'No suggestion is more than',
    "The room's history",
    'bid ~$',
  ]

  it('translates the panel, the badge, every reasoning line and every formula note', () => {
    const text = intelText()
    for (const english of ENGLISH_INTEL) expect(text, english).not.toContain(english)
    expect(text).toContain('IR · no juega esta semana')
    expect(text).toContain('IR: no puede jugar esta semana, así que cualquier oferta es para guardarlo')
    expect(text).toContain('valor de mercado 80 (tabla redraft)')
    expect(text).toContain('ofertas ganadoras en esta liga: mediana $75, p75 $156')
    expect(text).toContain('al jugador número 150')
    expect(text).toContain('oferta ~$374')
  })

  it('CONTROL: in English the same panel carries every one of those phrases', () => {
    lang.value = 'en'
    const text = intelText()
    for (const english of ENGLISH_INTEL) expect(text, english).toContain(english)
  })
})
