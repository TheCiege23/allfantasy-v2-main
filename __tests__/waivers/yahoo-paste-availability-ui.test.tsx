import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * A PASTED Yahoo league on the screens that list free agents (lib/core-app/declaredAvailability.ts).
 *
 *   - Below the coverage bar: one plain sentence with the count — never a list of false free agents.
 *   - Above it: the list stands, and a line says how many rostered players could not be matched.
 *
 * English and Spanish on the Waivers board (it translates every loader sentence); English on the AI
 * panel, which has no Spanish anywhere.
 */

const lang = vi.hoisted(() => ({ value: 'en' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }))
vi.mock('@/components/decide/useWaiverIntel', () => ({ useWaiverIntel: () => ({ data: null, loading: false }) }))
vi.mock('@/components/core-app/useAdviceRecord', () => ({ useAdviceRecord: () => null }))

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { infoReasonText } from '@/lib/core-app/finderPlayerInfoCopy'
import { outlookText } from '@/lib/core-app/outlookSpanish'
import { availabilityUnverifiedSentence, leagueUnverifiedClause, unmatchedRosteredNote } from '@/lib/core-app/foreignIdSpaceCopy'

const mockFetch = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })) as never)

afterEach(() => {
  vi.unstubAllGlobals()
  lang.value = 'en'
})

const UNVERIFIED = {
  state: 'availability_unverified',
  season: null,
  week: null,
  currentLineupPoints: null,
  candidates: [],
  notes: [availabilityUnverifiedSentence(4)],
  unmatchedRostered: 4,
}
const VERIFIED = {
  state: 'ok',
  season: '2026',
  week: 12,
  currentLineupPoints: 90,
  candidates: [
    { sleeperId: '1', name: 'Real Free Agent', position: 'WR', team: 'NYJ', projectedPoints: 12, gain: 3, displaces: null, basis: 'projection' },
  ],
  notes: [],
  unmatchedRostered: 2,
}

async function boardText(body: unknown) {
  mockFetch(body)
  const view = render(<WaiverLineupBoard leagueId="lg1" />)
  await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
  const text = screen.getByTestId('waiver-lineup-board').textContent ?? ''
  view.unmount()
  return text
}

describe('"Worth adding" — a pasted Yahoo league', () => {
  it('below the bar: one plain sentence with the count, and no list', async () => {
    const text = await boardText(UNVERIFIED)
    expect(text).toContain("We can't verify who's available in this league: 4 players on its rosters couldn't be matched to ours.")
    // Said once, not again behind the "why some players" toggle.
    expect(text.split("We can't verify").length - 1).toBe(1)
    expect(screen.queryByText('Real Free Agent')).toBeNull()
  })

  it('above the bar: the list stands, with how many rostered players could not be matched', async () => {
    const text = await boardText(VERIFIED)
    expect(text).toContain('Real Free Agent')
    expect(text).toContain("2 players on rosters in this league couldn't be matched to ours.")
  })

  it('in Spanish, both sentences', async () => {
    lang.value = 'es'
    expect(await boardText(UNVERIFIED)).toContain(
      'No podemos confirmar quién está disponible en esta liga: no pudimos emparejar 4 jugadores de sus plantillas con los nuestros.',
    )
    expect(await boardText(VERIFIED)).toContain('No pudimos emparejar 2 jugadores de las plantillas de esta liga con los nuestros.')
  })
})

describe("Chimmy's waiver panel — a pasted Yahoo league", () => {
  const load = async (body: unknown) => {
    mockFetch(body)
    render(<AIWaiverRecommendationsPanel leagueId="lg1" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
  }

  it('below the bar: says it cannot verify, with the count, and lists nobody', async () => {
    await load({ ok: true, recommendations: [], availability: { verified: false, unmatchedRostered: 3 } })
    await waitFor(() => expect(screen.getByTestId('ai-waiver-recommendations-unverified')).toBeTruthy())
    expect(screen.getByTestId('ai-waiver-recommendations-unverified').textContent).toBe(
      "We can't verify who's available in this league: 3 players on its rosters couldn't be matched to ours.",
    )
    expect(screen.queryByTestId('ai-waiver-recommendations-results')).toBeNull()
  })

  it('above the bar: the list carries how many could not be matched', async () => {
    await load({
      ok: true,
      recommendations: [
        { addPlayerId: '1', addPlayerName: 'Real Free Agent', dropPlayerId: null, dropPlayerName: null, priority: 1, suggestedFaabBid: null, confidence: 'high', risk: 'low', reasoning: 'fills WR2', tags: [] },
      ],
      availability: { verified: true, unmatchedRostered: 1 },
    })
    await waitFor(() => expect(screen.getByTestId('ai-waiver-recommendations-unmatched')).toBeTruthy())
    expect(screen.getByTestId('ai-waiver-recommendations-unmatched').textContent).toBe("1 player on rosters in this league couldn't be matched to ours.")
  })
})

describe('the shared sentences, and their Spanish', () => {
  it('singular and plural', () => {
    expect(unmatchedRosteredNote(1)).toBe("1 player on rosters in this league couldn't be matched to ours.")
    expect(availabilityUnverifiedSentence(1)).toContain('1 player on its rosters')
    expect(leagueUnverifiedClause(5)).toBe("5 players on its rosters couldn't be matched to ours")
  })

  it('every surface that translates loader text has them', () => {
    expect(coreUiCopy(availabilityUnverifiedSentence(1), 'es')).toBe(
      'No podemos confirmar quién está disponible en esta liga: no pudimos emparejar 1 jugador de sus plantillas con los nuestros.',
    )
    expect(coreUiCopy(leagueUnverifiedClause(3), 'es')).toBe('no pudimos emparejar 3 jugadores de sus plantillas con los nuestros')
    expect(outlookText(`Roster changes cannot be priced here: ${leagueUnverifiedClause(3)}.`, 'es')).toBe(
      'Aquí no se pueden valorar cambios de plantilla: no pudimos emparejar 3 jugadores de sus plantillas con los nuestros.',
    )
    expect(outlookText(unmatchedRosteredNote(2), 'es')).toBe('No pudimos emparejar 2 jugadores de las plantillas de esta liga con los nuestros.')
    expect(infoReasonText(`${leagueUnverifiedClause(2)}, so we can’t compare its teams yet`, 'es')).toBe(
      'no pudimos emparejar 2 jugadores de sus plantillas con los nuestros, así que todavía no podemos comparar sus equipos',
    )
  })
})
