/**
 * Room v2 in a league mock draft: the league's real type (accent + chip), its rule note, and a snake
 * salary-cap board's slot salaries — read through the live room's own readers. Tribes, seeds and
 * keeper years stay out: they are facts about real rosters, and a mock's seats are simulated.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ league: null as unknown, facts: null as unknown, factsArgs: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => {
        if (h.league instanceof Error) throw h.league
        return h.league
      }),
    },
  },
}))
vi.mock('@/lib/draft-room/loadDraftRoomLeagueFacts', () => ({
  loadDraftRoomLeagueFacts: vi.fn(async (args: unknown) => {
    h.factsArgs.push(args)
    return h.facts
  }),
}))

import { leagueMockRoomFacts } from '@/lib/mock-draft/leagueMockRoomFacts'
import { DraftBoardPreview } from '@/components/app/draft-room/DraftBoardPreview'

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const draft = { draftType: 'snake', rounds: 15, teamCount: 10 }

beforeEach(() => {
  h.league = null
  h.facts = { note: null, slotSalaryByOverall: null, seedByRosterId: null, keeperYearsByPlayer: null }
  h.factsArgs = []
})
afterEach(cleanup)

describe('what a league mock is told about its league', () => {
  it('the real type, through the live room reader: a pirate league stored as dynasty is Pirate', async () => {
    h.league = { leagueType: 'dynasty', leagueVariant: 'pirate', settings: {}, isDynasty: true }
    h.facts = { note: { kind: 'pirate', protect: 3 }, slotSalaryByOverall: null, seedByRosterId: null, keeperYearsByPlayer: null }
    const out = await leagueMockRoomFacts('L', draft)
    expect(out.leagueConcept).toBe('pirate')
    expect(out.leagueFacts).toEqual({ note: { kind: 'pirate', protect: 3 }, slotSalaryByOverall: null })
    expect(h.factsArgs[0]).toEqual({ leagueId: 'L', concept: 'pirate', draftType: 'snake', rounds: 15, teamCount: 10 })
  })

  it('never carries tribes, seeds or keeper years: a mock seat is not a real roster', async () => {
    h.league = { leagueType: 'tournament', leagueVariant: null, settings: {}, isDynasty: false }
    h.facts = { note: { kind: 'tournament', conference: 'East', round: 'Stage 2' }, slotSalaryByOverall: null, seedByRosterId: { r1: 4 }, keeperYearsByPlayer: { p1: 2 } }
    const out = await leagueMockRoomFacts('L', draft)
    expect(Object.keys(out.leagueFacts ?? {}).sort()).toEqual(['note', 'slotSalaryByOverall'])
  })

  it('no league, a missing league, nothing to show, or a failed read: a plain room', async () => {
    expect(await leagueMockRoomFacts(null, draft)).toEqual({ leagueConcept: null, leagueFacts: null })
    expect(await leagueMockRoomFacts('L', draft)).toEqual({ leagueConcept: null, leagueFacts: null })
    h.league = { leagueType: 'redraft', leagueVariant: null, settings: {}, isDynasty: false }
    expect(await leagueMockRoomFacts('L', draft)).toEqual({ leagueConcept: 'redraft', leagueFacts: null })
    h.league = new Error('db down')
    expect(await leagueMockRoomFacts('L', draft)).toEqual({ leagueConcept: null, leagueFacts: null })
  })

  it('both league-mock paths (native and imported) attach it', () => {
    const route = src('app/api/mock-draft/route.ts')
    expect(route).toContain('Object.assign(nativeLeague, await leagueMockRoomFacts(nativeLeague.leagueId, nativeLeague))')
    expect(route).toContain('const roomFacts = await leagueMockRoomFacts(league?.id, { draftType, rounds, teamCount })')
    expect(route).toContain('...roomFacts,')
  })
})

describe('the mock room', () => {
  it('takes the league type, note and slot salaries from the payload (never salaries in an auction)', () => {
    const room = src('components/mock-draft/MockDraftSleeperRoomClient.tsx')
    expect(room).toContain('leagueAccentFor(leaguePayload.leagueConcept ?? null, { isDynasty: leaguePayload.isDynasty })')
    expect(room).toContain('leagueNote={leaguePayload?.leagueFacts?.note ?? null}')
    expect(room).toContain("slotSalaryByOverall={draftState.settings.draftType === 'auction' ? null : leaguePayload?.leagueFacts?.slotSalaryByOverall ?? null}")
  })

  it('the mock board prices its slots like the live board', () => {
    render(
      <DraftBoardPreview
        teams={[1, 2, 3].map((slot) => ({ id: String(slot), slot, name: `Team ${slot}` }))}
        picks={[{ overall: 1, round: 1, slot: 1, rosterId: '1', playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' }]}
        teamCount={3}
        rounds={1}
        sport="NFL"
        slotSalaryByOverall={{ 1: { salary: 45, years: 4 }, 2: { salary: 41, years: 4 } }}
      />,
    )
    expect(screen.getByTestId('draft-board-cell-salary-1').textContent).toBe('$45')
    expect(screen.getByTestId('draft-board-cell-slot-salary-2').textContent).toBe('$41')
  })
})
