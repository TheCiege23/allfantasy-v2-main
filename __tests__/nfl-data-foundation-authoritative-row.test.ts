/**
 * `chooseBestSportsPlayer` ranked `rolling_insights` above `sleeper` and rewarded having a team,
 * so a Sleeper free agent came back on his LAST club (Tyreek Hill → MIA, with Miami's bye and
 * opponent on the redraft roster), and a TheSportsDB namesake stamped with the same Sleeper id
 * could outrank the real row (Byron Murphy, CB MIN, as the Seahawks' DT). Production row shapes,
 * measured 2026-10-12 — including that every NFL Sleeper row spells its club out in full and
 * carries no `teamId`. See lib/player-match/authoritativePlayerRow.ts for the rule.
 *
 * The fake EVALUATES each `where` and honours `take`, so a club filter or a cut window hides rows
 * exactly as production does.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  generateAndPersistCanonicalNflProjections,
  getCanonicalNflPlayerByNameTeam,
  getCanonicalNflPlayerContext,
} from '@/lib/nfl-data-foundation/nflDataFoundationService'

type Row = Record<string, unknown>

const T0 = new Date('2026-10-12T00:00:00.000Z')
const T1 = new Date('2026-10-12T06:00:00.000Z')

function sportsRow(overrides: Row): Row {
  return {
    id: `sp-${String(overrides.source)}-${String(overrides.sleeperId)}`,
    sport: 'NFL',
    externalId: String(overrides.sleeperId),
    name: 'Someone',
    position: null,
    team: null,
    teamId: null,
    number: null,
    imageUrl: null,
    sleeperId: null,
    status: null,
    source: 'sleeper',
    fetchedAt: T0,
    expiresAt: T1,
    updatedAt: T0,
    ...overrides,
  }
}

/** Minimal Prisma `where`: equality, `in`, `equals`/`contains` (insensitive), `OR`/`AND`. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w))
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w))
    const value = row[key]
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Row
      const fold = (v: unknown) => (c.mode === 'insensitive' ? String(v ?? '').toLowerCase() : v)
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false
      if ('equals' in c && fold(value) !== fold(c.equals)) return false
      if ('contains' in c && (value == null || !String(fold(value)).includes(String(fold(c.contains))))) return false
      return true
    }
    return value === cond
  })
}

/** Every other delegate answers empty; `gameSchedule.findFirst` records which club was asked. */
function fakeDb(rows: Row[], identity: Row | null = null) {
  const scheduleClubs: string[] = []
  /** `playerId` of every weekly snapshot the generator writes. */
  const writtenPlayerIds: string[] = []
  const empty = new Proxy(
    {},
    {
      get: (_t, method: string) => async () =>
        String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : null,
    },
  )
  const db = new Proxy(
    {
      sportsPlayer: {
        findMany: async (args: { where?: Row; take?: number } = {}) => {
          const hit = rows.filter((r) => matches(r, args.where))
          return args.take ? hit.slice(0, args.take) : hit
        },
        findFirst: async () => null,
      },
      playerIdentityMap: { findFirst: async () => identity, findMany: async () => [] },
      gameSchedule: {
        count: async () => 0,
        findFirst: async (args: { where: { OR: Array<{ homeTeam?: string }> } }) => {
          scheduleClubs.push(String(args.where.OR[0]?.homeTeam))
          return null
        },
      },
      // A provider projection for anyone, so the generator has something to persist.
      fantasyProjection: { findFirst: async () => ({ projectedPoints: 12, fetchedAt: T0 }), findMany: async () => [] },
      aFProjectionSnapshot: {
        findFirst: async () => null,
        findMany: async () => [],
        upsert: async (args: { create: { playerId: string; week: number | null } }) => {
          if (args.create.week != null) writtenPlayerIds.push(args.create.playerId)
          return {}
        },
      },
    } as Row,
    { get: (t, key: string) => (key in t ? t[key] : empty) },
  ) as never
  return { db, scheduleClubs, writtenPlayerIds }
}

const opts = (rows: Row[], identity: Row | null = null) => ({ season: 2026, week: 6, prismaClient: fakeDb(rows, identity).db })

/* Tyreek Hill: a free agent on Sleeper; Rolling Insights still says Miami, with Miami's team id. */
const HILL_RI = sportsRow({ source: 'rolling_insights', sleeperId: '3321', externalId: '7781', name: 'Tyreek Hill', position: 'WR', team: 'MIA', teamId: '19', imageUrl: 'https://ri.example/hill.png', fetchedAt: T1 })
const HILL_SLEEPER = sportsRow({ source: 'sleeper', sleeperId: '3321', externalId: 'sleeper:3321', name: 'Tyreek Hill', position: 'WR', team: null, imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/3321.jpg' })

/* Byron Murphy, CB MIN — and a Seahawks DT namesake stamped with his Sleeper id by two vendors. */
const MURPHY = [
  sportsRow({ source: 'thesportsdb', sleeperId: '5864', externalId: 'tsdb_1', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', teamId: '134949', imageUrl: 'https://img.example/tsdb/murphy-dt.png', fetchedAt: T1 }),
  sportsRow({ source: 'rolling_insights', sleeperId: '5864', externalId: '9001', name: 'Byron Murphy', position: 'DT', team: 'SEA', teamId: '28', fetchedAt: T1 }),
  sportsRow({ source: 'sleeper', sleeperId: '5864', externalId: 'sleeper:5864', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/5864.jpg' }),
]

describe('canonical NFL player — the Sleeper row decides who the player is', () => {
  it('a Sleeper free agent stays a free agent — no club, no club id — whatever the vendor row remembers', async () => {
    const player = await getCanonicalNflPlayerContext('3321', opts([HILL_RI, HILL_SLEEPER]))
    expect(player?.team).toBeNull()
    expect(player?.teamId).toBeNull()
    expect(player?.position).toBe('WR')
    // Stats stay keyed on the agreeing Rolling Insights row — that is how season stats are stored.
    expect(player?.providerIds.rollingInsightsId).toBe('7781')
  })

  it('a namesake from another feed neither renames nor repositions him, nor lends its ids', async () => {
    const player = await getCanonicalNflPlayerContext('5864', opts(MURPHY))
    expect(player?.position).toBe('CB')
    expect(player?.headshotUrl).toBe('https://sleepercdn.com/content/nfl/players/thumb/5864.jpg')
    expect(player?.providerIds.rollingInsightsId).toBeNull()
    expect(player?.playerId).toBe('sp-sleeper-5864')
  })

  /*
   * Every NFL Sleeper row spells the club out. Unfolded, the schedule join asks for
   * `homeTeam = 'MINNESOTA VIKINGS'`, finds no game in a week that has games, and calls it a bye.
   */
  it('folds the Sleeper row’s spelled-out club to the code every consumer keys on', async () => {
    const { db, scheduleClubs } = fakeDb(MURPHY)
    const player = await getCanonicalNflPlayerContext('5864', { season: 2026, week: 6, prismaClient: db })
    expect(player?.team).toBe('MIN')
    expect(scheduleClubs).toEqual(['MIN'])
  })

  it('control: with no Sleeper row the vendor ranking still decides', async () => {
    const rows = [sportsRow({ source: 'rolling_insights', sleeperId: '42', externalId: '4242', name: 'Vendor Only', position: 'RB', team: 'KC' })]
    const player = await getCanonicalNflPlayerContext('42', opts(rows))
    expect(player?.team).toBe('KC')
    expect(player?.providerIds.rollingInsightsId).toBe('4242')
  })
})

describe('getCanonicalNflPlayerByNameTeam — the club is checked AFTER the authority rule', () => {
  it('asked for "Tyreek Hill, MIA", finds no Dolphin: Sleeper says free agent', async () => {
    expect(await getCanonicalNflPlayerByNameTeam('Tyreek Hill', 'MIA', opts([HILL_RI, HILL_SLEEPER]))).toBeNull()
  })

  it('asked without a club, finds him — as a free agent', async () => {
    const player = await getCanonicalNflPlayerByNameTeam('Tyreek Hill', null, opts([HILL_RI, HILL_SLEEPER]))
    expect(player?.team).toBeNull()
    expect(player?.providerIds.sleeperId).toBe('3321')
  })

  it('finds the Vikings corner by his real club even though no row stores the code "MIN"', async () => {
    const player = await getCanonicalNflPlayerByNameTeam('Byron Murphy', 'MIN', { ...opts(MURPHY), position: 'CB' })
    expect(player).toMatchObject({ team: 'MIN', position: 'CB' })
  })

  it('a "Byron Murphy, DT, SEA" query gets the real Seahawks tackle, never the corner’s id', async () => {
    const realDt = sportsRow({ source: 'sleeper', sleeperId: '11619', externalId: 'sleeper:11619', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks' })
    const player = await getCanonicalNflPlayerByNameTeam('Byron Murphy', 'SEA', { ...opts([...MURPHY, realDt]), position: 'DT' })
    expect(player?.providerIds.sleeperId).toBe('11619')
    expect(await getCanonicalNflPlayerByNameTeam('Byron Murphy', 'SEA', { ...opts(MURPHY), position: 'DT' })).toBeNull()
  })
})

describe('generateAndPersistCanonicalNflProjections — per Sleeper id before grouping by club', () => {
  it('never builds a free agent on his last club, even when the window holds only the vendor row', async () => {
    for (const limit of [10, 1]) {
      const { db, scheduleClubs } = fakeDb([HILL_RI, HILL_SLEEPER])
      await generateAndPersistCanonicalNflProjections({ season: 2026, week: 6, write: false, limit, prismaClient: db })
      expect(scheduleClubs, `limit ${limit}`).not.toContain('MIA')
    }
  })

  /*
   * 🛑 THE WRITTEN `playerId` MUST NOT MOVE. The snapshot is read back by `playerId IN
   * candidateIds(row)`, keyed on the chosen row's id; a different id orphans what was written
   * before. Main picks the top-scored row of the window — Rolling Insights for a normal player.
   * (Run against main, this writes that id AND the Sleeper row's: Sleeper spells the club out, so
   * its row formed a club group of its own. The reader picks by the same score and never asks for
   * the second, so it is the one id deliberately dropped.)
   */
  it('writes the same playerId main picked for a normal player (Rolling Insights + Sleeper rows)', async () => {
    const ri = sportsRow({ source: 'rolling_insights', sleeperId: '4046', externalId: '5150', name: 'Patrick Mahomes', position: 'QB', team: 'KC', teamId: '16', imageUrl: 'https://ri.example/pm.png', fetchedAt: T1 })
    const sleeper = sportsRow({ source: 'sleeper', sleeperId: '4046', externalId: 'sleeper:4046', name: 'Patrick Mahomes', position: 'QB', team: 'Kansas City Chiefs', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/4046.jpg' })
    const { db, writtenPlayerIds } = fakeDb([ri, sleeper])
    await generateAndPersistCanonicalNflProjections({ season: 2026, week: 6, write: true, prismaClient: db })
    expect(writtenPlayerIds).toEqual(['sp-rolling_insights-4046'])
  })

  /*
   * The case that separates "the window's best row" from "the best row overall": a window holding
   * only an agreeing TheSportsDB row. Main writes that row's id. The Sleeper row, fetched only to
   * judge it, outscores it (115 to 110) — and must still not become the written id.
   */
  it('never writes the id of a Sleeper row it fetched only to judge the window', async () => {
    const tsdb = sportsRow({ source: 'thesportsdb', sleeperId: '6794', externalId: 'tsdb_9', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings', imageUrl: 'https://img.example/tsdb/jj.png' })
    const sleeper = sportsRow({ source: 'sleeper', sleeperId: '6794', externalId: 'sleeper:6794', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/6794.jpg' })
    const { db, writtenPlayerIds, scheduleClubs } = fakeDb([tsdb, sleeper])
    await generateAndPersistCanonicalNflProjections({ season: 2026, week: 6, write: true, limit: 1, prismaClient: db })
    expect(writtenPlayerIds).toEqual(['sp-thesportsdb-6794'])
    expect(scheduleClubs).toEqual(['MIN'])
  })
})
