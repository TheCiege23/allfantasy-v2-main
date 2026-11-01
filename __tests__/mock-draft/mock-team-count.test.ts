/**
 * Mock drafts accept every team count a league of that sport and type accepts — the league create
 * catalog `POST /api/leagues` validates against — instead of a hard-coded 8–16. Covers the shared list
 * (lib/mock-draft/mockTeamCount.ts), the server normalizers that used to clamp to 8–16 (create route,
 * session, settings, runtime), and a full CPU draft at 4 and 20 teams, snake and linear.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, any>
const db = vi.hoisted(() => ({ rows: new Map<string, Row>(), created: [] as Row[] }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => {
  const apply = (id: string, data: Row) => {
    const row = { ...db.rows.get(id)!, ...data }
    db.rows.set(id, row)
    return row
  }
  return {
    prisma: {
      mockDraft: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          const row = { id: `d${db.created.length + 1}`, inviteToken: null, shareId: null, slotConfig: null, createdAt: new Date(), updatedAt: new Date(), ...data }
          db.created.push(row)
          db.rows.set(row.id, row)
          return row
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.rows.get(where.id) ?? null),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => db.rows.get(where.id) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => apply(where.id, data)),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          apply(where.id, data)
          return { count: 1 }
        }),
      },
    },
  }
})
const POS = ['QB', 'RB', 'WR', 'TE']
vi.mock('@/lib/adp-data', () => ({
  getLiveADP: vi.fn(async (_t: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, position: POS[i % 4], team: 'KC', adp: i + 1, value: 1000 - i, ffcPlayerId: i + 1 })),
  ),
}))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({ loadSportAwareDraftPlayerPool: vi.fn(async () => []) }))
vi.mock('@/lib/mock-draft-simulator/DraftAIManager', () => ({
  makeAIPick: vi.fn(async (args: { availablePlayers: unknown[] }) => args.availablePlayers[0]),
}))

import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { getAllowedTeamCountsFromCatalog } from '@/lib/league-creation/options-catalog'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import {
  getMockDraftTeamCountOptions,
  mockRoundOrder,
  mockTeamPickOveralls,
  normalizeMockDraftTeamCount,
  resolveLeagueMockTeamCount,
} from '@/lib/mock-draft/mockTeamCount'
import { getSlotForOverall, getMockDraftRuntimeSnapshot, startMockDraftRuntime } from '@/lib/mock-draft-engine/MockDraftRuntimeService'
import { createMockDraftSession } from '@/lib/mock-draft-engine/MockDraftSessionService'
import { getMockDraftSettings, updateMockDraftSettings } from '@/lib/mock-draft-engine/MockSettingsService'
import { POST as createRoute } from '@/app/api/mock-draft/create/route'

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
const OLD_PICKER = [8, 10, 12, 14, 16]

beforeEach(() => {
  db.rows.clear()
  db.created.length = 0
})

describe('the mock picker list is the league list', () => {
  it.each(SPORTS)('%s redraft and dynasty match what a league accepts', (sport) => {
    for (const type of ['redraft', 'dynasty'] as const) {
      expect(getMockDraftTeamCountOptions(sport, type)).toEqual(getTeamCountOptions(sport, type))
      expect(getMockDraftTeamCountOptions(sport, type)).toEqual(getAllowedTeamCountsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, type, sport))
    }
  })

  it.each(SPORTS)('%s redraft offers 4 through 20, odd sizes included', (sport) => {
    const opts = getMockDraftTeamCountOptions(sport, 'redraft')
    for (let n = 4; n <= 20; n++) expect(opts).toContain(n)
    // Positive control: the old picker had none of the edges.
    for (const n of [4, 5, 7, 18, 19, 20]) expect(OLD_PICKER).not.toContain(n)
  })

  it('dynasty offers only the even sizes a dynasty league takes, from 4', () => {
    const opts = getMockDraftTeamCountOptions('NFL', 'dynasty')
    expect(opts).toContain(4)
    expect(opts.every((n) => n % 2 === 0)).toBe(true)
  })

  it('an unknown league type reads as redraft', () => {
    expect(getMockDraftTeamCountOptions('NFL', 'league')).toEqual(getMockDraftTeamCountOptions('NFL', 'redraft'))
  })
})

describe('normalizeMockDraftTeamCount', () => {
  it('keeps every allowed size, edges and odd ones included', () => {
    for (const n of [4, 5, 7, 13, 19, 20]) expect(normalizeMockDraftTeamCount(n, 'NBA', 'redraft')).toBe(n)
    expect(normalizeMockDraftTeamCount('20', 'NFL', 'redraft')).toBe(20)
  })

  it('reads a saved 8-16 mock exactly as it was saved', () => {
    for (const n of OLD_PICKER) {
      expect(normalizeMockDraftTeamCount(n, 'NFL', 'redraft')).toBe(n)
      expect(normalizeMockDraftTeamCount(n, 'NFL', 'dynasty')).toBe(n)
    }
  })

  it('moves a size the type does not take to the nearest one it does', () => {
    expect(normalizeMockDraftTeamCount(7, 'NFL', 'dynasty')).toBe(6)
    expect(normalizeMockDraftTeamCount(40, 'NFL', 'dynasty')).toBe(16)
    expect(normalizeMockDraftTeamCount(999, 'NFL', 'redraft')).toBe(Math.max(...getTeamCountOptions('NFL', 'redraft')))
  })

  it('missing or unreadable is 12', () => {
    for (const raw of [undefined, null, '', 'abc', Number.NaN]) expect(normalizeMockDraftTeamCount(raw, 'NFL', 'redraft')).toBe(12)
  })

  it('league tools: real size, then team rows, then 12 — never a floor of 12', () => {
    expect(resolveLeagueMockTeamCount(4, 0)).toBe(4)
    expect(resolveLeagueMockTeamCount(null, 6)).toBe(6)
    expect(resolveLeagueMockTeamCount(null, 0)).toBe(12)
    // Positive control: the old formula made a 4-team league a 12-team draft.
    expect(Math.max(4, 0, 12)).toBe(12)
  })
})

describe('pick order at 4 and 20 teams', () => {
  const slotsOf = (teams: number, rounds: number, type: string) =>
    Array.from({ length: teams * rounds }, (_, i) => getSlotForOverall(i + 1, teams, type))

  it.each([4, 20])('snake, %i teams: each round reverses and every team picks once per round', (teams) => {
    const seq = slotsOf(teams, 3, 'snake')
    const up = Array.from({ length: teams }, (_, i) => i + 1)
    expect(seq).toEqual([...up, ...[...up].reverse(), ...up])
    expect(seq.map((s, i) => s - 1 === mockRoundOrder(teams, Math.floor(i / teams) + 1, 'snake')[i % teams])).not.toContain(false)
  })

  it.each([4, 20])('linear, %i teams: the same order every round', (teams) => {
    const up = Array.from({ length: teams }, (_, i) => i + 1)
    expect(slotsOf(teams, 3, 'linear')).toEqual([...up, ...up, ...up])
    expect(mockRoundOrder(teams, 2, 'linear')).toEqual(up.map((n) => n - 1))
  })

  it('a team’s own picks: slot 1 of 4 and slot 20 of 20', () => {
    expect(mockTeamPickOveralls(4, 0, 4, 'snake')).toEqual([1, 8, 9, 16])
    expect(mockTeamPickOveralls(20, 19, 3, 'snake')).toEqual([20, 21, 60])
    expect(mockTeamPickOveralls(4, 0, 3, 'linear')).toEqual([1, 5, 9])
  })
})

describe('server: create, session, settings', () => {
  const post = (body: Record<string, unknown>) =>
    createRoute(new NextRequest('http://localhost/api/mock-draft/create', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

  it.each([4, 7, 20])('the create route keeps a %i-team request (it clamped to 8-16)', async (numTeams) => {
    const res = await post({ sport: 'NFL', leagueType: 'redraft', numTeams })
    const json = (await res.json()) as { config: { numTeams: number } }
    expect(json.config.numTeams).toBe(numTeams)
    expect(db.created.at(-1)!.metadata.numTeams).toBe(numTeams)
  })

  it.each([4, 20])('a %i-team session gets one slot per team, and reads back the same', async (numTeams) => {
    const res = await post({ sport: 'NBA', leagueType: 'redraft', numTeams, useSession: true, roomMode: 'cpu_only' })
    const json = (await res.json()) as { config: { numTeams: number }; slotConfig: unknown[] }
    expect(json.config.numTeams).toBe(numTeams)
    expect(json.slotConfig).toHaveLength(numTeams)
  })

  it('a dynasty create snaps an odd size to the nearest dynasty size', async () => {
    const json = (await (await post({ sport: 'NFL', leagueType: 'dynasty', numTeams: 5 })).json()) as { config: { numTeams: number } }
    expect(json.config.numTeams).toBe(4)
  })

  it('settings read and write keep 4 and 20', async () => {
    const snap = await createMockDraftSession('u1', { settings: { sport: 'NFL', leagueType: 'redraft', numTeams: 4 } })
    expect(snap.settings.numTeams).toBe(4)
    expect((await getMockDraftSettings(snap.id, 'u1'))!.numTeams).toBe(4)
    expect(await updateMockDraftSettings(snap.id, 'u1', { numTeams: 20 })).toBe(true)
    expect(db.rows.get(snap.id)!.metadata.numTeams).toBe(20)
    expect((await getMockDraftSettings(snap.id, 'u1'))!.numTeams).toBe(20)
  })
})

describe('a full CPU draft at 4 and 20 teams (AI drafters)', () => {
  it.each([
    [4, 'snake'],
    [4, 'linear'],
    [20, 'snake'],
    [20, 'linear'],
  ] as const)('%i teams, %s: every pick made, in order, no player twice', async (numTeams, draftType) => {
    const rounds = 3
    const snap = await createMockDraftSession('u1', {
      settings: { sport: 'NFL', leagueType: 'redraft', draftType, numTeams, rounds, roomMode: 'cpu_only', timerSeconds: 0 },
      slotConfig: Array.from({ length: numTeams }, (_, i) => ({ slot: i + 1, type: 'cpu' as const, userId: null, displayName: `CPU ${i + 1}` })),
    })
    await startMockDraftRuntime(snap.id, 'u1')
    const done = await getMockDraftRuntimeSnapshot(snap.id, 'u1')
    expect(done!.settings.numTeams).toBe(numTeams)
    expect(done!.status).toBe('completed')
    const picks = done!.results as Array<{ overall: number; slot: number; round: number; pick: number; playerName: string }>
    expect(picks).toHaveLength(numTeams * rounds)
    expect(picks.map((p) => p.slot)).toEqual(Array.from({ length: numTeams * rounds }, (_, i) => getSlotForOverall(i + 1, numTeams, draftType)))
    expect(new Set(picks.map((p) => p.playerName)).size).toBe(picks.length)
    expect(picks.at(-1)).toMatchObject({ round: rounds, pick: numTeams })
  })
})
