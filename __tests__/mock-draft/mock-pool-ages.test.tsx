/**
 * Room v2 in a league mock: the pool carries each player's age (and a college row's class), so the
 * mock board draws the live board's signature chip. NFL ages come from `SportsPlayer.age` (the live
 * room's column) by the Sleeper id the pool resolves; other sports carry their pool's own age.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ages: [] as Array<{ sleeperId: string | null; age: number | null }>,
  agesError: null as Error | null,
  ageQueries: [] as unknown[],
  sportPool: [] as unknown[],
}))

vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn(async () => ({
    '4984': { full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
    '6794': { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
    '9002': { full_name: 'Mike Williams', position: 'WR', team: 'LAC' },
  })),
}))
vi.mock('@/lib/adp-data', () => ({
  getLiveADP: vi.fn(async (type: string) => type === 'devy'
    ? [{ name: 'Mike Williams', position: 'WR', team: 'Tennessee', adp: 140, age: null, source: 'devy', classYearLabel: 'JR' }]
    : [
        { name: 'Josh Allen', position: 'QB', team: 'BUF', adp: 1.2, age: null, source: 'ffc' },
        { name: 'Justin Jefferson', position: 'WR', team: 'MIN', adp: 2.4, age: 27, source: 'analytics' },
      ]),
  fetchFFCADP: vi.fn(async () => ({ players: [], meta: {} })),
  fetchAllFFCFormats: vi.fn(async () => ({})),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ injuryCoverageFor: () => ({ covered: false }), resolveInjuryFacts: vi.fn() }))
vi.mock('@/lib/multi-platform-adp', () => ({ findMultiADP: () => null }))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({ loadSportAwareDraftPlayerPool: vi.fn(async () => h.sportPool) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async (args: unknown) => {
        h.ageQueries.push(args)
        if (h.agesError) throw h.agesError
        return h.ages
      }),
    },
  },
}))

import { getCachedMockDraftPool } from '@/lib/mock-draft/mock-draft-pool-cache'
import { loadNflAgesBySleeperId, plausibleAge } from '@/lib/mock-draft/mockPoolAges'
import { DraftBoardPreview } from '@/components/app/draft-room/DraftBoardPreview'

type Row = { name: string; age: number | null; poolType?: string; classYearLabel?: string | null }
const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

beforeEach(() => {
  h.ages = [{ sleeperId: '4984', age: 30 }, { sleeperId: '6794', age: 99 }, { sleeperId: '9002', age: 33 }]
  h.agesError = null
  h.ageQueries = []
  h.sportPool = []
})
afterEach(cleanup)

describe('the NFL mock pool carries ages', () => {
  it("reads the live room's SportsPlayer age by Sleeper id; an age on the ADP row itself wins", async () => {
    const { payload } = await getCachedMockDraftPool({ sport: 'NFL', type: 'dynasty', pool: 'combined', forceRefresh: true })
    const byName = Object.fromEntries((payload.entries as Row[]).map((r) => [r.name, r]))
    expect(byName['Josh Allen']).toMatchObject({ age: 30, poolType: 'pro', classYearLabel: null })
    // The ADP row says 27; the implausible 99 in SportsPlayer is never read for him.
    expect(byName['Justin Jefferson'].age).toBe(27)
    expect(h.ageQueries[0]).toMatchObject({ where: { sport: 'NFL', age: { not: null } } })
  })

  it("a college row shows its class and never borrows a pro namesake's age", async () => {
    const { payload } = await getCachedMockDraftPool({ sport: 'NFL', type: 'dynasty', pool: 'combined', forceRefresh: true })
    const williams = (payload.entries as Row[]).find((r) => r.name === 'Mike Williams')
    expect(williams).toMatchObject({ age: null, poolType: 'college', classYearLabel: 'JR' })
    const asked = (h.ageQueries[0] as { where: { sleeperId: { in: string[] } } }).where.sleeperId.in
    expect(asked).not.toContain('9002')
  })

  it('a failed age read builds the pool with no ages, never a failed pool', async () => {
    h.agesError = new Error('db down')
    const { payload } = await getCachedMockDraftPool({ sport: 'NFL', type: 'dynasty', pool: 'combined', forceRefresh: true })
    const byName = Object.fromEntries((payload.entries as Row[]).map((r) => [r.name, r]))
    expect(byName['Josh Allen'].age).toBeNull()
    expect(byName['Justin Jefferson'].age).toBe(27)
  })

  it('other sports carry the pool row they already have', async () => {
    h.sportPool = [
      { name: 'Victor Wembanyama', position: 'C', team: 'SAS', adp: 1, playerId: 'nba-1', value: null, age: 22 },
      { name: 'Bad Row', position: 'G', team: 'BOS', adp: 2, playerId: 'nba-2', value: null, age: 4 },
    ]
    const { payload } = await getCachedMockDraftPool({ sport: 'NBA', type: 'dynasty', forceRefresh: true })
    expect((payload.entries as Row[]).map((r) => [r.name, r.age])).toEqual([['Victor Wembanyama', 22], ['Bad Row', null]])
  })
})

describe('the age reader', () => {
  it('keeps playing-career ages only, and the first plausible age per player', async () => {
    expect([plausibleAge(23.7), plausibleAge('24'), plausibleAge(15), plausibleAge(51), plausibleAge(null)]).toEqual([23, 24, null, null, null])
    h.ages = [{ sleeperId: 'a', age: 3 }, { sleeperId: 'a', age: 25 }, { sleeperId: 'a', age: 26 }, { sleeperId: null, age: 30 }]
    expect([...(await loadNflAgesBySleeperId(['a', 'a', null, ' ']))]).toEqual([['a', 25]])
    expect(await loadNflAgesBySleeperId([null, ''])).toEqual(new Map())
    expect(h.ageQueries).toHaveLength(1)
  })
})

describe('the mock room draws the chip', () => {
  it("computes the live board's chips for a league mock from the pool it keeps", () => {
    const room = src('components/mock-draft/MockDraftSleeperRoomClient.tsx')
    expect(room).toContain('age: numberFromUnknown(raw.age),')
    expect(room).toContain('classYearLabel: stringFromUnknown(raw.classYearLabel),')
    expect(room).toContain("const leagueConceptForMock = leaguePayload ? leagueAccentFor(leaguePayload.leagueConcept ?? null, { isDynasty: leaguePayload.isDynasty }).concept : null")
    expect(room).toContain('(draftState?.availablePlayers ?? []).map((player) => ({ ...player, playerId: player.id })),')
    expect(room).toContain('signatureByOverall={signatureByOverall}')
  })

  it('the mock board prints the chip on the tile', () => {
    render(
      <DraftBoardPreview
        teams={[1, 2].map((slot) => ({ id: String(slot), slot, name: `Team ${slot}` }))}
        picks={[{ overall: 1, round: 1, slot: 1, rosterId: '1', playerName: 'Josh Allen', position: 'QB', team: 'BUF' }]}
        teamCount={2}
        rounds={1}
        sport="NFL"
        signatureByOverall={{ 1: { kind: 'age', text: '30y', title: 'Age 30' } }}
      />,
    )
    expect(screen.getByTitle('Age 30').textContent).toBe('30y')
  })
})
