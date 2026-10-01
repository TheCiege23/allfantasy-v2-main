import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { advanceWeek, buildStandingsBoard, type StandingsRules } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import DraftHq from '@/components/core-app/screens/DraftHq'

afterEach(cleanup)

describe('Draft HQ Spanish view', () => {
  it('translates the draft summary, traded pick warning, and unavailable sections', () => {
    const unavailable = { available: false as const, reason: 'no completed draft has been imported for this league' }
    const data = {
      league: { id: 'lg-1', name: 'Liga', platform: 'sleeper', format: 'dynasty' },
      session: { available: true, data: { status: 'pre_draft', draftType: 'snake', rounds: 3, teamCount: 3, yourSlot: 2 } },
      pickSlots: {
        available: true,
        data: {
          held: [{ round: 1, pickInRound: 2, overall: 2, label: '1.02', acquiredFrom: 'Dre' }],
          tradedAway: [],
          note: 'pick trades made on Sleeper are not synced into this draft, so a pick shown here may have changed hands there',
        },
      },
      madePicks: unavailable,
      board: unavailable,
      grades: unavailable,
      lottery: unavailable,
      queue: unavailable,
      keepers: unavailable,
    } as DraftHqData

    render(<DraftHq data={data} />)

    expect(screen.getByRole('heading', { name: 'Centro del draft' })).toBeTruthy()
    expect(document.body.textContent).toContain('Tus selecciones')
    expect(document.body.textContent).toContain('no se sincronizan')
    expect(document.body.textContent).toContain('No se ha importado ningún draft completado')
    expect(document.body.textContent).not.toContain('What you drafted')
  })
})

describe('Standings Spanish view', () => {
  it('translates table controls while preserving both ranking modes', () => {
    const rules: StandingsRules = {
      playoffTeams: 1,
      playoffTeamsSource: 'league',
      byes: 0,
      regularSeasonEnd: null,
      tiebreakers: ['points_for'],
      tiebreakerSource: 'platform',
      rankIsOfficial: false,
      platformLabel: 'Sleeper',
    }
    const snapshot = advanceWeek(null, 2026, 1, [
      { week: 1, rosterId: 'a', matchupId: 1, pointsFor: 120, pointsAgainst: 90 },
      { week: 1, rosterId: 'b', matchupId: 1, pointsFor: 90, pointsAgainst: 120 },
    ], ['a', 'b'], 's1')
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: [snapshot],
      unplayed: [],
      teams: [
        { rosterId: 'a', name: 'A', avatarUrl: null, isYou: true, division: null, reported: null },
        { rosterId: 'b', name: 'B', avatarUrl: null, isYou: false, division: null, reported: null },
      ],
      rules,
    })

    render(<StandingsBoardView board={board} initial={DEFAULT_STANDINGS_VIEW} />)

    expect(screen.getByRole('radio', { name: 'Tabla de la liga' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Rendimiento AF' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Tarjetas' })).toBeTruthy()
    expect(document.body.textContent).toContain('El récord determina el orden')
  })
})
