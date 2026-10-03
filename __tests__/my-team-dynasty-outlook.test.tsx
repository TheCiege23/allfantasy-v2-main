import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const db = vi.hoisted(() => ({ picks: [] as unknown[], history: [] as unknown[] }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    futureDraftPick: { findMany: vi.fn(async () => db.picks) },
    draftFact: { groupBy: vi.fn(async () => db.history) },
  },
}))

import { AGING_FROM, groupPicks, summariseAges } from '@/lib/core-app/dynastyOutlook'
import { loadImportedFuturePicks, loadTeamFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { MyTeamData } from '@/lib/core-app/myTeam'

const P = (sleeperId: string, position: string, name = sleeperId) => ({ sleeperId, name, position })

describe('summariseAges', () => {
  it('reports the starters’ median age and flags those past their position’s decline age', () => {
    const starters = [P('qb', 'QB', 'Young QB'), P('te', 'TE', 'Juwan Johnson'), P('rb', 'RB', 'Old RB'), P('dl', 'DL', 'Demarcus Lawrence')]
    const ages = new Map([['qb', 26], ['te', 30], ['rb', 28], ['dl', 34]])
    const out = summariseAges(starters, [...starters, P('kid', 'WR')], new Map([...ages, ['kid', 22]]))
    expect(out).toMatchObject({ available: true, medianStarterAge: 29, known: 4, total: 4, youngCore: 1 })
    if (!out.available) throw new Error('unavailable')
    // Oldest first; a defender has no consensus decline age, so he is not flagged.
    expect(out.aging.map((a) => `${a.name}:${a.threshold}`)).toEqual(['Juwan Johnson:30', 'Old RB:27'])
  })

  it('says so when no starter has an age, and reports partial coverage', () => {
    expect(summariseAges([P('a', 'WR')], [], new Map())).toEqual({ available: false, reason: 'no ages on file for your starters' })
    const out = summariseAges([P('a', 'WR'), P('b', 'WR')], [], new Map([['a', 25]]))
    expect(out).toMatchObject({ known: 1, total: 2 })
  })

  it('uses the stated consensus thresholds', () => {
    expect(AGING_FROM).toEqual({ QB: 34, RB: 27, WR: 29, TE: 30 })
  })
})

describe('groupPicks', () => {
  it('groups by draft, rounds in order, keeping where an acquired pick came from', () => {
    expect(
      groupPicks([
        { season: 2028, round: 1, fromTeamName: null },
        { season: 2027, round: 3, fromTeamName: 'Wichita Windigos' },
        { season: 2027, round: 1, fromTeamName: null },
      ]),
    ).toEqual([
      { season: 2027, picks: [{ season: 2027, round: 1, label: '1st', fromTeamName: null }, { season: 2027, round: 3, label: '3rd', fromTeamName: 'Wichita Windigos' }] },
      { season: 2028, picks: [{ season: 2028, round: 1, label: '1st', fromTeamName: null }] },
    ])
  })
})

/*
 * The refactor that made one team's picks readable without every roster: the two loaders share one
 * inventory, so a team's picks from `loadTeamFuturePicks` must equal its roster's list from
 * `loadImportedFuturePicks`.
 */
describe('loadTeamFuturePicks agrees with loadImportedFuturePicks', () => {
  const teams = [
    { id: 't4', externalId: '4', platformUserId: 'u4', claimedByUserId: null, teamName: 'BroVengers' },
    { id: 't9', externalId: '9', platformUserId: 'u9', claimedByUserId: null, teamName: 'Wichita Windigos' },
  ]
  const base = { leagueId: 'L', platform: 'sleeper', isDynasty: true, leagueSeason: 2026, status: 'in_season', teams }
  beforeEach(() => {
    // Wichita's 2027 3rd now belongs to team 4; a 3-round rookie draft on file for two seasons.
    db.picks = [{ pickSeason: 2027, round: 3, originalRosterId: '9', currentOwnerId: '4' }]
    db.history = [
      { season: 2024, _max: { round: 25 }, _count: { _all: 50 } },
      { season: 2025, _max: { round: 3 }, _count: { _all: 6 } },
      { season: 2026, _max: { round: 3 }, _count: { _all: 6 } },
    ]
  })

  it('returns the same picks for one team', async () => {
    const one = await loadTeamFuturePicks({ ...base, teamExternalId: '4' })
    const all = await loadImportedFuturePicks({
      ...base,
      rosters: [
        { id: 'r4', platformUserId: 'u4', playerData: { players: ['a'] } },
        { id: 'r9', platformUserId: 'u9', playerData: { players: ['b'] } },
      ],
    })
    expect(one.coverage).toBe(all.coverage)
    const key = (p: { season: number; round: number; originalTeamId: string }) => `${p.season}-${p.round}-${p.originalTeamId}`
    expect(one.picks.map(key).sort()).toEqual((all.picksByRosterId.get('r4') ?? []).map(key).sort())
    expect(one.picks.find((p) => p.season === 2027 && p.round === 3 && p.originalTeamId === '9')?.fromTeamName).toBe('Wichita Windigos')
  })
})

function data(dynasty: MyTeamData['dynasty']): MyTeamData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
    team: { available: false, reason: 'n/a' },
    starters: { available: false, reason: 'n/a' },
    bench: { available: false, reason: 'n/a' },
    ir: { available: false, reason: 'n/a' },
    taxi: { available: false, reason: 'n/a' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    dynasty,
  } as unknown as MyTeamData
}

describe('the Dynasty outlook card', () => {
  it('lists picks by draft with their origin, and the aging starters with the rule they trip', () => {
    const { container } = render(
      <MyTeam
        data={data({
          picks: { available: true, coverage: 'complete', bySeason: groupPicks([{ season: 2027, round: 1, fromTeamName: null }, { season: 2027, round: 3, fromTeamName: 'Wichita Windigos' }]) },
          ages: { available: true, medianStarterAge: 27.5, known: 14, total: 16, youngCore: 6, aging: [{ sleeperId: '7002', name: 'Juwan Johnson', position: 'TE', age: 30, threshold: 30 }] },
        })}
      />,
    )
    const card = container.querySelector('.af-mt-dynasty')!
    expect(card.textContent).toContain('2027')
    expect(card.textContent).toContain('1st · 3rd (via Wichita Windigos)')
    expect(card.textContent).toContain('27.5')
    expect(card.textContent).toContain('14 of 16 with an age on file')
    expect(card.textContent).toContain('Juwan Johnson')
    expect(card.textContent).toContain('TEs usually decline from 30')
  })

  it('says why either half is missing, without hiding the other', () => {
    const { container } = render(
      <MyTeam
        data={data({
          picks: { available: false, reason: 'future picks are not synced for this platform yet' },
          ages: { available: true, medianStarterAge: 25, known: 2, total: 2, youngCore: 3, aging: [] },
        })}
      />,
    )
    const card = container.querySelector('.af-mt-dynasty')!
    expect(card.textContent).toContain('future picks are not synced for this platform yet')
    expect(card.textContent).toContain('No starter is past the age his position usually declines')
  })

  it('is absent outside a dynasty league', () => {
    const { container } = render(<MyTeam data={data(null)} />)
    expect(container.querySelector('.af-mt-dynasty')).toBeNull()
  })
})
