/**
 * computeHealthScore counts a team as eliminated only from the entry's OWN graded picks.
 *
 * It used to read every entry's picks on a node: one rival getting a game wrong was enough to count this
 * entry's pick there as eliminated, even when this entry had picked the winner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  entry: null as unknown,
  nodes: [] as unknown[],
  entries: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketEntry: {
      findUnique: vi.fn(async () => db.entry),
      findMany: vi.fn(async () => db.entries),
    },
    bracketNode: {
      findMany: vi.fn(async () => db.nodes),
    },
  },
}))

import { computeHealthScore } from '@/lib/brackets/intelligence/data-engine'

type Pick = { nodeId: string; pickedTeamName: string | null; isCorrect: boolean | null; points: number }
const pick = (nodeId: string, team: string, isCorrect: boolean | null, points = 0): Pick => ({ nodeId, pickedTeamName: team, isCorrect, points })

/*
 * A four-team bracket: two semifinals (round 5) and a final (round 6). Each node also carries every entry's
 * graded picks, as the old query loaded them, so the test goes red on the old logic: the first semifinal
 * holds a rival's miss.
 */
const NODES = [
  {
    id: 'sf1', round: 5, homeTeamName: 'Duke', awayTeamName: 'UNC',
    picks: [{ entryId: 'me', isCorrect: true, points: 16 }, { entryId: 'rival', isCorrect: false, points: 0 }],
  },
  { id: 'sf2', round: 5, homeTeamName: 'Kansas', awayTeamName: 'Baylor', picks: [] },
  { id: 'final', round: 6, homeTeamName: 'Duke', awayTeamName: null, picks: [] },
]

beforeEach(() => {
  db.nodes = NODES
  // A rival who got the first semifinal wrong. Under the old logic this alone eliminated our Duke pick.
  db.entries = [
    { id: 'me', picks: [{ points: 16 }] },
    { id: 'rival', picks: [{ points: 0 }] },
  ]
})

describe('computeHealthScore — eliminated teams', () => {
  it('keeps a team the entry picked correctly alive, whatever other entries picked', async () => {
    db.entry = {
      id: 'me',
      picks: [pick('sf1', 'Duke', true, 16), pick('sf2', 'Kansas', null), pick('final', 'Duke', null)],
    }

    const h = await computeHealthScore('me', 't1')

    expect(h.teamsTotal).toBe(2)
    expect(h.teamsAlive).toBe(2)
    expect(h.alivePct).toBe(1)
    expect(h.championAlive).toBe(true)
    expect(h.finalFourAlive).toBe(2)
  })

  it('counts a team out once the entry’s own pick of it is graded wrong', async () => {
    db.entry = {
      id: 'me',
      picks: [pick('sf1', 'UNC', false), pick('sf2', 'Kansas', null), pick('final', 'UNC', null)],
    }

    const h = await computeHealthScore('me', 't1')

    expect(h.teamsTotal).toBe(2)
    expect(h.teamsAlive).toBe(1)
    expect(h.alivePct).toBe(0.5)
    // The champion pick is UNC, which lost its semifinal.
    expect(h.championAlive).toBe(false)
    expect(h.finalFourAlive).toBe(1)
  })
})
