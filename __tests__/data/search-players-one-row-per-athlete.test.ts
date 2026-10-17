// @vitest-environment node
/**
 * `searchPlayers` hands the AI context one row per athlete, each saying who it is.
 *
 * Measured in production 2026-10-11 (22:09Z NFL import): searching "Josh Allen" returned FOUR rows and the
 * sports-context enricher put all four into the model's `players` —
 *
 *   NFL:4984             QB  BUF  manual  2026-10-11 22:09  ADP 1.68   ← the importer's row
 *   NFL:sleeper:2212     G   FA   cache   2026-09-25        ADP 12.6   ← a guard with a QB's stat line
 *   NFL:sleeper:4984     QB  BUF  cache   2026-09-18        ADP 31.1
 *   NFL:josh-allen:BUF   QB  BUF  cached  2026-09-07        ADP 24.4
 *
 * PlayerIdentityMap holds two NFL Josh Allens (QB 4984 / RI 3348, DL 5840 / RI 2135). The rows below are
 * those, with their production timestamps relative to the import.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePlayerName } from '@/lib/team-abbrev'

type Row = {
  id: string
  sport: string
  name: string
  team: string
  position: string
  adp: number | null
  stats: Record<string, unknown>
  projections: Record<string, unknown>
  lastUpdated: Date
}
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  people: [] as Array<{ sport: string; normalizedName: string; sleeperId: string | null; rollingInsightsId: string | null }>,
  identityFails: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: {
      findMany: vi.fn(async ({ where }: { where: { sport: string; OR: Array<{ name?: { contains: string } }> } }) => {
        const q = where.OR.find((o) => o.name)?.name?.contains.toLowerCase() ?? ''
        return db.rows
          .filter((r) => r.sport === where.sport && r.name.toLowerCase().includes(q))
          .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
      }),
    },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { sport: string; normalizedName: { in: string[] } } }) => {
        if (db.identityFails) throw new Error('db down')
        return db.people.filter((p) => p.sport === where.sport && where.normalizedName.in.includes(p.normalizedName))
      }),
    },
  },
}))
vi.mock('@/lib/workers/sports-data-importer', () => ({ runSportsDataImporter: vi.fn() }))
vi.mock('@/lib/workers/sports-data-import-coordinator', () => ({ requestPlayerImportRefresh: vi.fn() }))
vi.mock('@/lib/workers/news-importer', () => ({ runNewsImporter: vi.fn() }))
vi.mock('@/lib/data/shared', () => ({
  DATA_TTLS: { players: 6 * 3_600_000, news: 3_600_000 },
  isFreshDate: () => true,
  triggerBackgroundRefresh: vi.fn(),
}))
// The enricher's other sources, so its `players` block is what is under test.
vi.mock('@/lib/sports-router', () => ({ getSportsData: vi.fn(async () => ({ data: [], source: 'none' })) }))
vi.mock('@/lib/data/adp', () => ({ getADP: vi.fn(async () => []), getADPTrends: vi.fn(async () => []) }))
vi.mock('@/lib/data/news', () => ({ getLatestNews: vi.fn(async () => []), getHighImpactNews: vi.fn(async () => []) }))
vi.mock('@/lib/data/schedules', () => ({ getUpcomingGames: vi.fn(async () => []) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: vi.fn(async () => ({ facts: [], feedStale: true })),
}))

import { searchPlayers } from '@/lib/data/players'
import { fetchSportsContextForEnvelope } from '@/lib/ai-orchestration/sports-context-enricher'

const IMPORT = new Date('2026-10-11T22:09:07Z')
const hoursBefore = (h: number) => new Date(IMPORT.getTime() - h * 3_600_000)
const daysBefore = (d: number) => hoursBefore(d * 24)

function row(r: Partial<Row> & Pick<Row, 'id' | 'name' | 'team' | 'position' | 'lastUpdated'>): Row {
  const full: Row = { sport: 'NFL', adp: null, stats: {}, projections: {}, ...r }
  db.rows.push(full)
  return full
}
function person(sport: string, name: string, sleeperId: string | null, rollingInsightsId: string | null) {
  db.people.push({ sport, normalizedName: normalizePlayerName(name), sleeperId, rollingInsightsId })
}

function joshAllen() {
  row({ id: 'NFL:4984', name: 'Josh Allen', team: 'BUF', position: 'QB', adp: 1.68, stats: { completions: 79 }, lastUpdated: IMPORT })
  row({ id: 'NFL:sleeper:2212', name: 'Josh Allen', team: 'FA', position: 'G', adp: 12.6, stats: { completions: 40 }, lastUpdated: new Date('2026-09-25T00:19:58Z') })
  row({ id: 'NFL:sleeper:4984', name: 'Josh Allen', team: 'BUF', position: 'QB', adp: 31.1, stats: { completions: 20 }, lastUpdated: new Date('2026-09-18T18:23:47Z') })
  row({ id: 'NFL:josh-allen:BUF', name: 'Josh Allen', team: 'BUF', position: 'QB', adp: 24.4, stats: { completions: 319 }, lastUpdated: new Date('2026-09-07T16:51:57Z') })
  person('NFL', 'Josh Allen', '4984', '3348')
  person('NFL', 'Josh Allen', '5840', '2135')
}

beforeEach(() => {
  db.rows = []
  db.people = []
  db.identityFails = false
})

describe('searchPlayers — one row per athlete', () => {
  it('"Josh Allen" returns the importer’s row only, labelled — no stale copy, no guard with QB stats', async () => {
    joshAllen()
    const rows = await searchPlayers('Josh Allen', 'NFL')
    expect(rows.map((r) => r.id)).toEqual(['NFL:4984'])
    expect(rows[0]).toMatchObject({ label: 'Josh Allen (QB, BUF)', adp: 1.68 })
    expect(rows[0]).not.toHaveProperty('namesake')
  })

  it('Taiwan Jones: the LB the importer writes, not the RB copies it stopped writing', async () => {
    row({ id: 'NFL:2575', name: 'Taiwan Jones', team: 'NYJ', position: 'LB', lastUpdated: new Date('2026-10-11T22:08:42Z') })
    row({ id: 'NFL:sleeper:886', name: 'Taiwan Jones', team: 'FA', position: 'RB', lastUpdated: new Date('2026-10-01T19:04:31Z') })
    row({ id: 'NFL:taiwan-jones:NYG', name: 'Taiwan Jones', team: 'NYG', position: 'RB', lastUpdated: new Date('2026-09-07T16:51:57Z') })
    person('NFL', 'Taiwan Jones', '2575', '1442')
    person('NFL', 'Taiwan Jones', '886', '2071')
    expect((await searchPlayers('Taiwan Jones', 'NFL')).map((r) => r.id)).toEqual(['NFL:2575'])
  })

  it('two current athletes sharing a name stay distinct, each labelled with position and team', async () => {
    row({ id: 'MLB:2728', sport: 'MLB', name: 'Will Smith', team: 'LAD', position: 'C', lastUpdated: IMPORT })
    row({ id: 'MLB:215', sport: 'MLB', name: 'Will Smith', team: 'KC', position: 'P', lastUpdated: hoursBefore(1) })
    person('MLB', 'Will Smith', null, '2728')
    person('MLB', 'Will Smith', null, '215')
    const rows = await searchPlayers('Will Smith', 'MLB')
    expect(rows.map((r) => [r.id, r.label, r.namesake])).toEqual([
      ['MLB:2728', 'Will Smith (C, LAD)', true],
      ['MLB:215', 'Will Smith (P, KC)', true],
    ])
  })

  it('an athlete’s own-id row is never dropped for age, even when a stray write makes an orphan newer', async () => {
    row({ id: 'NFL:sleeper:2212', name: 'Josh Allen', team: 'FA', position: 'G', lastUpdated: IMPORT })
    row({ id: 'NFL:4984', name: 'Josh Allen', team: 'BUF', position: 'QB', lastUpdated: hoursBefore(30) })
    person('NFL', 'Josh Allen', '4984', '3348')
    person('NFL', 'Josh Allen', '5840', '2135')
    expect((await searchPlayers('Josh Allen', 'NFL')).map((r) => r.id)).toContain('NFL:4984')
  })

  it('in the NFL the kept copy is his SLEEPER-id row, never a legacy `NFL:<rollingInsightsId>` one', async () => {
    // Before 2026-09-28 the importer wrote RI ids as bare NFL ids (Burrow at `NFL:5427`, his RI id); a bare
    // NFL id is a Sleeper id to every reader now, so his own row is `NFL:6770` even when the legacy one is newer.
    row({ id: 'NFL:5427', name: 'Joe Burrow', team: 'CIN', position: 'QB', lastUpdated: IMPORT })
    row({ id: 'NFL:6770', name: 'Joe Burrow', team: 'CIN', position: 'QB', lastUpdated: hoursBefore(1) })
    person('NFL', 'Joe Burrow', '6770', '5427')
    expect((await searchPlayers('Joe Burrow', 'NFL')).map((r) => r.id)).toEqual(['NFL:6770'])
  })

  it('a lone row is kept however old — age only decides between copies of one name', async () => {
    row({ id: 'NFL:7601', name: 'Rondale Moore', team: 'MIN', position: 'WR', lastUpdated: daysBefore(5) })
    expect((await searchPlayers('Rondale Moore', 'NFL')).map((r) => r.id)).toEqual(['NFL:7601'])
  })

  it('paged college sports keep older rows: the rotation has not reached their page, they are not orphans', async () => {
    row({ id: 'NCAAF:1', sport: 'NCAAF', name: 'Michael Smith', team: 'UGA', position: 'WR', lastUpdated: IMPORT })
    row({ id: 'NCAAF:2', sport: 'NCAAF', name: 'Michael Smith', team: 'TEX', position: 'LB', lastUpdated: daysBefore(4) })
    expect((await searchPlayers('Michael Smith', 'NCAAF')).map((r) => r.id)).toEqual(['NCAAF:1', 'NCAAF:2'])
  })

  it('an unreadable identity map leaves the rows as they were, still labelled', async () => {
    joshAllen()
    db.identityFails = true
    const rows = await searchPlayers('Josh Allen', 'NFL')
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => typeof r.label === 'string')).toBe(true)
  })
})

describe('the AI sports context', () => {
  it('carries one Josh Allen — the QB — and none of the stale copies’ ADPs', async () => {
    joshAllen()
    const res = await fetchSportsContextForEnvelope('NFL', { dataTypes: ['players'], playerSearchTerms: ['Josh Allen'] })
    const players = (res.sportsData?.players ?? []) as Array<Record<string, unknown>>
    expect(players.map((p) => p.id)).toEqual(['NFL:4984'])
    expect(players[0]).toMatchObject({ label: 'Josh Allen (QB, BUF)', position: 'QB', adp: 1.68 })
    expect(JSON.stringify(players)).not.toMatch(/12\.6|31\.1|24\.4|"G"/)
  })
})
