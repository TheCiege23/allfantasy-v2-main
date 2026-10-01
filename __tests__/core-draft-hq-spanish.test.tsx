import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { advanceWeek, buildStandingsBoard, type StandingsRules } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'
import { draftHqUiCopy } from '@/lib/core-app/draftHqUiCopy'
import { DraftCompetitiveEdge } from '@/components/core-app/screens/DraftCompetitiveEdge'
import { buildDraftEdge } from '@/lib/competitive-edge/draftEdge'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import DraftHq from '@/components/core-app/screens/DraftHq'

afterEach(cleanup)

describe('Draft HQ Spanish view', () => {
  it('translates rival draft counts without hiding coverage gaps', () => {
    const edge = buildDraftEdge({
      picks: [
        { ownerSleeperId: 't', season: 2024, round: 1, position: 'RB' },
        { ownerSleeperId: 't', season: 2025, round: 1, position: 'RB' },
      ],
      managers: [{ ownerSleeperId: 't', name: 'Tasha', teamExternalId: '2' }],
      viewerOwnerSleeperId: null,
      unattributedSeasons: [2023],
    })
    render(<DraftCompetitiveEdge access={null} edge={{ available: true, data: edge }} />)
    expect(document.body.textContent).toContain('Tasha participó en 2 de los 2 drafts registrados')
    expect(document.body.textContent).toContain('Su primera selección fue de RB')
    expect(document.body.textContent).toContain('Las selecciones de 2023 aún no se pueden asignar')
  })

  it('keeps dynamic scoring and keeper caveats in Spanish', () => {
    expect(draftHqUiCopy('the 2025 season has not produced scoring yet, so there is nothing to grade a pick against', 'es')).toContain('temporada 2025')
    expect(draftHqUiCopy('Sleeper flagged none of your 2025 draft picks as keepers', 'es')).toContain('draft 2025')
    expect(draftHqUiCopy("Graded on standard PPR scoring rather than this league's exact rules — ESPN records its scoring as numeric stat ids with no names attached, and only 2 core rules could be translated without guessing.", 'es')).toContain('solo se pudieron interpretar 2')
  })

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
    expect(document.body.textContent).toContain('Las proyecciones comienzan cuando terminan 3 semanas')
    expect(document.body.textContent).toContain('¿Por qué un equipo está delante de otro?')
    expect(document.body.textContent).toContain('Puntos a favor y en contra')
    expect(screen.getAllByText('Ver datos del gráfico')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Ver datos del gráfico')[0])
    expect(screen.getByRole('region', { name: 'Puntos a favor y en contra' }).textContent).toContain('120.0')
    fireEvent.click(screen.getByRole('radio', { name: 'Rendimiento AF' }))
    expect(document.body.textContent).toContain('Rendimiento AF es nuestro análisis')
    fireEvent.click(screen.getByRole('radio', { name: 'Tarjetas' }))
    expect(document.body.textContent).toContain('Puntuación de rendimiento')
  })
})
