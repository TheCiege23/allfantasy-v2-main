/**
 * The Survivor Matchup tab (lib/survivor/survivorMatchupModel.ts). It said "Your team has no game in
 * week 6" with an empty opponent, because Survivor has no head-to-head game; the week is the tribe race.
 */
import { describe, expect, it } from 'vitest'
import { buildSurvivorMatchupView, type SurvivorMatchupInput } from '@/lib/survivor/survivorMatchupModel'

const base = (over: Partial<SurvivorMatchupInput> = {}): SurvivorMatchupInput => ({
  currentWeek: 6,
  merged: false,
  myRosterId: 'me',
  myTribeId: 'kaniva',
  tribes: [
    { id: 'kaniva', name: 'Kaniva', members: [{ rosterId: 'me' }, { rosterId: 'k2' }] },
    { id: 'koa', name: 'Koa', members: [{ rosterId: 'o1' }, { rosterId: 'o2' }] },
    { id: 'honoa', name: 'Honoa', members: [{ rosterId: 'h1' }, { rosterId: 'h2' }] },
  ],
  tribeScores: { kaniva: 200, koa: 260, honoa: 150 },
  memberScores: { me: 120, k2: 80, o1: 130, o2: 130, h1: 75, h2: 75 },
  immunityRosterIds: [],
  scoresFinalized: false,
  rosterDisplayNames: { me: 'TheCiege26’s Team', k2: 'Test Team 4' },
  council: null,
  ...over,
})

describe('buildSurvivorMatchupView', () => {
  it('ranks the tribes, puts mine in the middle, and says I am safe if it holds', () => {
    const v = buildSurvivorMatchupView(base())
    expect(v.tribes.map((t) => [t.name, t.rank, t.score])).toEqual([['Koa', 1, 260], ['Kaniva', 2, 200], ['Honoa', 3, 150]])
    expect(v.myScore).toBe(120)
    expect(v.myRank).toEqual({ rank: 2, of: 3 })
    expect(v.status).toBe('Kaniva is 2nd of 3 so far: safe if it holds above last.')
    expect(v.tribes[1]!.members[0]).toMatchObject({ rosterId: 'me', mine: true, name: 'TheCiege26’s Team' })
  })

  it('warns when my tribe is last, and names the council once it is called', () => {
    const last = buildSurvivorMatchupView(base({ tribeScores: { kaniva: 100, koa: 260, honoa: 150 } }))
    expect(last.status).toBe('Kaniva is last so far: headed to Elimination Council unless it climbs.')
    const called = buildSurvivorMatchupView(base({ council: { attendingTribeId: 'kaniva', closedAt: null, isRevealed: false } }))
    expect(called.status).toBe('Kaniva is going to Elimination Council. Vote before the deadline.')
    expect(called.tribes.find((t) => t.id === 'kaniva')!.attending).toBe(true)
  })

  it('after the merge it ranks me against the island and honours immunity', () => {
    const merged = base({ merged: true, myTribeId: 'merged', tribes: [{ id: 'merged', name: 'Merged', members: [{ rosterId: 'me' }, { rosterId: 'o1' }, { rosterId: 'h1' }] }] })
    expect(buildSurvivorMatchupView(merged).myRank).toEqual({ rank: 2, of: 3 })
    expect(buildSurvivorMatchupView({ ...merged, immunityRosterIds: ['me'] }).status).toBe('You hold individual immunity this week. You cannot be voted out.')
  })

  it('[control] before any game a tribe has no score rather than zero, and says scores are coming', () => {
    const v = buildSurvivorMatchupView(base({ tribeScores: {}, memberScores: {} }))
    expect(v.tribes.every((t) => t.score == null)).toBe(true)
    expect(v.myRank).toBeNull()
    expect(v.status).toContain('Scores start once games are played')
  })
})
