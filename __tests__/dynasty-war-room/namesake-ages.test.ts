/**
 * @vitest-environment node
 *
 * 🛑 THE WAR ROOM BOUND AGES BY NAME AND KEPT THE FIRST ROW.
 *
 * `SportsPlayer` holds namesakes with different ages — measured 2026-10-11: "Justin Jefferson" is
 * 27 (WR, MIN, sleeperId 6794) and 23 (LB, CLE, sleeperId 13524). The first-row map handed the
 * receiver whichever age the database returned first, and with it his whole age trajectory.
 *
 * Drives the real `buildDynastyWarRoomContext`; only the database and unrelated readers are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { name: string; age: number; position: string; sleeperId: string | null }
const db = vi.hoisted(() => ({
  league: null as unknown,
  rosters: [] as unknown[],
  ageRows: [] as Array<{ name: string; age: number; position: string; sleeperId: string | null }>,
}))

type Where = {
  name?: { in: string[] }
  OR?: Array<{ name?: { in: string[] }; sleeperId?: { in: string[] } }>
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    // Filters like the real query would, so a name nobody asked for never comes back.
    sportsPlayer: {
      findMany: vi.fn(async (args: { where: Where }) => {
        const clauses = args.where.OR ?? [{ name: args.where.name }]
        return db.ageRows.filter((r) =>
          clauses.some(
            (c) =>
              (c.name && c.name.in.includes(r.name)) ||
              (c.sleeperId && !!r.sleeperId && c.sleeperId.in.includes(r.sleeperId)),
          ),
        )
      }),
    },
    rookieDraftWindow: { findMany: vi.fn(async () => []) },
    futureDraftPick: { findMany: vi.fn(async () => []) },
    draftFact: { groupBy: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })),
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })),
}))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))
vi.mock('@/lib/dynasty-war-room/dynastyFreeAgentPool', () => ({
  fetchDynastyValueByKey: vi.fn(async () => new Map()),
  fetchDynastyFreeAgentPool: vi.fn(async () => []),
  fetchDynastyNhlProspectFreeAgents: vi.fn(async () => null),
  dynastyRosteredKeys: () => new Set(),
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => null),
}))

import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'

/** Production rows (2026-10-11), with the linebacker FIRST — the order the old map rewarded. */
const LB_FIRST: Row[] = [
  { name: 'Justin Jefferson', age: 23, position: 'LB', sleeperId: '13524' },
  { name: 'Justin Jefferson', age: 23, position: 'LB', sleeperId: null },
  { name: 'Justin Jefferson', age: 27, position: 'WR', sleeperId: null },
  { name: 'Justin Jefferson', age: 27, position: 'WR', sleeperId: '6794' },
]

function rosterWith(item: Record<string, unknown>) {
  return [
    {
      id: 'r1',
      platformUserId: 'af-user',
      playerData: { lineup_sections: { starters: [item] } },
      faabRemaining: null,
    },
  ]
}

async function jeffersonAge(): Promise<number | null> {
  const res = await buildDynastyWarRoomContext({ leagueId: 'L1', userId: 'af-user' })
  if (!res.ok) throw new Error(`build failed: ${res.status} ${res.error}`)
  const p = res.context.teams.flatMap((t) => t.players).find((x) => x.playerName === 'Justin Jefferson')
  if (!p) throw new Error('Justin Jefferson missing from the context')
  return p.age
}

beforeEach(() => {
  db.league = {
    sport: 'NFL', season: 2026, isDynasty: true, leagueVariant: null, platform: 'sleeper',
    settings: { status: 'in_season' },
  }
  db.rosters = rosterWith({ id: '6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN' })
  db.ageRows = LB_FIRST
})

describe('🛑 Dynasty War Room ages bind to one player', () => {
  it('the receiver gets HIS age (27), not the linebacker’s (23), when the LB row comes first', async () => {
    expect(await jeffersonAge()).toBe(27)
  })

  it('a non-Sleeper league binds by position — an id equal to the LB’s Sleeper id must not bind him', async () => {
    db.league = { ...(db.league as object), platform: 'espn' }
    db.rosters = rosterWith({ id: '13524', name: 'Justin Jefferson', position: 'WR' })
    expect(await jeffersonAge()).toBe(27)
  })

  it('a namesake with no position and no usable id is refused, not guessed', async () => {
    db.league = { ...(db.league as object), platform: 'espn' }
    db.rosters = rosterWith({ id: 'x1', name: 'Justin Jefferson' })
    expect(await jeffersonAge()).toBeNull()
  })
})
