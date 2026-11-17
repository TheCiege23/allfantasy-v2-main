/**
 * Room v2: specialty leagues created over a base column read as themselves, a Zombie league's
 * universe and level beside its chip, and a stage 2/3 season tournament's seeds on the board.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  zombieRow: null as unknown,
  seasonContext: null as unknown,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => h.zombieRow) },
    tournamentLeague: { findUnique: vi.fn(async () => null) },
    league: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: vi.fn(async () => null) }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({
  loadSeasonDraftContext: vi.fn(async () => {
    if (h.seasonContext instanceof Error) throw h.seasonContext
    return h.seasonContext
  }),
}))

import { draftRoomLeagueConceptRaw, normalizeLeagueConcept } from '@/lib/draft-room/leagueAccent'
import { isLeagueConceptType } from '@/lib/league/leagueConceptOptions'
import { listSpecialtySpecs } from '@/lib/specialty-league/registry'
import { loadDraftRoomLeagueFacts } from '@/lib/draft-room/loadDraftRoomLeagueFacts'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { LanguageFallbackBoundary } from '@/components/i18n/LanguageProviderClient'
import { leagueAccentFor } from '@/lib/draft-room/leagueAccent'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'

beforeEach(() => {
  h.zombieRow = null
  h.seasonContext = null
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const concept = (league: Parameters<typeof draftRoomLeagueConceptRaw>[0]) => normalizeLeagueConcept(draftRoomLeagueConceptRaw(league))

describe('a specialty created over a base column reads as itself', () => {
  it('a season tournament league is a Tournament, though it is stored as redraft', () => {
    // lib/domain/seasonTournamentLeague.ts creates it with leagueType 'redraft'.
    expect(concept({ leagueType: 'redraft', leagueVariant: 'season_tournament' })).toBe('tournament')
  })

  it('every whole-league specialty in the registry is read from its variant', () => {
    const specs = listSpecialtySpecs()
    expect(specs.length).toBeGreaterThanOrEqual(6)
    let checked = 0
    for (const spec of specs) {
      if (!isLeagueConceptType(spec.wizardLeagueTypeId)) continue // idp is not a league type
      const expected = spec.id === 'guillotine' ? 'redraft' : spec.wizardLeagueTypeId
      expect([spec.id, concept({ leagueType: 'redraft', leagueVariant: spec.leagueVariant })]).toEqual([spec.id, expected])
      checked++
    }
    // Guillotine stays the column's: it is also a modifier on a redraft league.
    expect(checked).toBeGreaterThanOrEqual(6)
  })
})

describe('Zombie: the universe and level beside the chip', () => {
  const base = { leagueId: 'L', draftType: 'snake', rounds: 3, teamCount: 10 }

  it('reads the league universe and its level, preferring the tier label', async () => {
    h.zombieRow = { universe: { name: 'Deadlands' }, level: { name: 'Level 2', tierLabel: 'Gold' } }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'zombie' })).note).toEqual({ kind: 'zombie', universe: 'Deadlands', level: 'Gold' })
    h.zombieRow = { universe: null, level: { name: 'Level 2', tierLabel: null } }
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'zombie' })).note).toEqual({ kind: 'zombie', universe: null, level: 'Level 2' })
    h.zombieRow = null
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'zombie' })).note).toBeNull()
  })

  it('prints the names as they are', () => {
    render(
      <LanguageFallbackBoundary>
        <DraftTopBar
          leagueName="Sunday League" sport="NFL" draftType="snake" teamCount={12} rounds={15} currentManagerOnClock="X"
          pickLabel="1.01" overallPickNumber={1} timerStatus="running" timerRemainingSeconds={40} isCommissioner={false}
          draftStatus="in_progress" leagueAccent={leagueAccentFor('zombie')} leagueNote={{ kind: 'zombie', universe: 'Deadlands', level: 'Gold' }}
        />
      </LanguageFallbackBoundary>,
    )
    expect(screen.getByTestId('draft-topbar-league-note').textContent).toBe('Deadlands · Gold')
  })
})

describe('Tournament stage 2/3: seeds on the board', () => {
  const base = { leagueId: 'L', draftType: 'snake', rounds: 3, teamCount: 3, concept: 'tournament' as const }
  const context = (stage: number, seeds: Array<number | undefined>) => ({
    stage,
    pool: { members: seeds.map((previousSeed, i) => ({ id: `m${i}`, previousSeed })) },
    rosterIds: seeds.map((_, i) => `roster-${i + 1}`),
  })

  it('maps each frozen member, in seat order, to its roster', async () => {
    h.seasonContext = context(2, [4, 9, 1])
    expect((await loadDraftRoomLeagueFacts(base)).seedByRosterId).toEqual({ 'roster-1': 4, 'roster-2': 9, 'roster-3': 1 })
  })

  it('stage 1 has no seeds; a manifest that fails its checks gives none; other types never read it', async () => {
    // Seeds present on purpose: only the stage check can keep them off a stage 1 board.
    h.seasonContext = context(1, [4, 9, 1])
    expect((await loadDraftRoomLeagueFacts(base)).seedByRosterId ?? null).toBeNull()
    h.seasonContext = new Error('The tournament draft checksum does not match.')
    expect((await loadDraftRoomLeagueFacts(base)).seedByRosterId ?? null).toBeNull()
    h.seasonContext = context(2, [4, 9, 1])
    expect((await loadDraftRoomLeagueFacts({ ...base, concept: 'redraft' })).seedByRosterId ?? null).toBeNull()
  })

  it('each column header carries its seed, spelled out for screen readers', () => {
    render(
      <DraftBoard
        picks={[]}
        slotOrder={[1, 2, 3].map((slot) => ({ slot, rosterId: `roster-${slot}`, displayName: `Team ${slot}` }))}
        teamCount={3}
        rounds={1}
        draftType="snake"
        thirdRoundReversal={false}
        seedByRosterId={{ 'roster-1': 4, 'roster-3': 1 }}
      />,
    )
    const seed = screen.getByTestId('draft-board-team-header-seed-1')
    expect(seed.textContent).toBe('#4')
    expect(seed.getAttribute('aria-label')).toBe('Seed 4 from the last stage')
    expect(screen.getByTestId('draft-board-team-header-seed-3').textContent).toBe('#1')
    expect(screen.queryByTestId('draft-board-team-header-seed-2')).toBeNull()
  })

  it('Spanish says it too', () => {
    expect(draftRoomHeaderMessages.es.seed(4)).toBe('Cabeza de serie 4 de la etapa anterior')
  })
})
