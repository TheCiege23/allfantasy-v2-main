// @vitest-environment node
/**
 * 🛑 The NFL pool (waiver wire, draft pools, AI waiver tools) listed players twice and handed out ids
 * that named someone else. Measured on production 2026-10-12:
 *   - Sleeper's `team` is a display name ("Arizona Cardinals"), the club map is keyed on codes, so
 *     no Sleeper DEF row ever matched and a synthetic `nfl:def:ARI` was added beside every real one;
 *     `team_id` was null for every Sleeper row.
 *   - Vendor rows with a stale club survived the (name, position, team) de-dup: A.J. Brown PHI
 *     (backfill) beside NE (Sleeper); Kaytron Allen three times.
 *   - `external_source_id` was `sleeperId ?? externalId`, so an unstamped Rolling Insights row put
 *     its RI number (4876) where consumers compare Sleeper ids (4876 is Bradley Northnagel).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ players: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    sportsPlayer: { findMany: vi.fn(async () => h.players) },
    allFantasyAdpSnapshot: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))

let n = 0
function row(over: Record<string, unknown>) {
  n += 1
  return {
    id: `row-${n}`,
    name: 'Someone',
    position: 'WR',
    team: null,
    teamId: null,
    status: null,
    sleeperId: null,
    externalId: `ext-${n}`,
    age: null,
    imageUrl: null,
    source: 'rolling_insights',
    ...over,
  }
}

async function nflPool(options: { limit?: number; position?: string } = {}) {
  const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
  return getPlayerPoolForSport('NFL', { limit: 500, ...options })
}

beforeEach(() => {
  vi.resetModules() // the pool is memoised in-process; each case builds its own
  h.players = []
})

describe('NFL pool — team defenses and club codes', () => {
  it('🛑 the Sleeper "Arizona Cardinals" DEF is the only ARI defense; clubs without one still get a synthetic', async () => {
    h.players = [
      row({ id: 'def-ari', name: 'Arizona Cardinals', position: 'DEF', team: 'Arizona Cardinals', sleeperId: 'ARI', externalId: 'sleeper:ARI', source: 'sleeper' }),
    ]
    const defs = (await nflPool()).filter((p) => p.position === 'DEF')
    const ari = defs.filter((p) => p.team_abbreviation === 'ARI')
    expect(ari).toHaveLength(1)
    expect(ari[0]).toMatchObject({ player_id: 'def-ari', external_source_id: 'ARI', team_id: 'ARI' })
    expect(defs.some((p) => p.player_id === 'nfl:def:ARI')).toBe(false)
    expect(defs.some((p) => p.player_id === 'nfl:def:KC')).toBe(true)
    expect(defs).toHaveLength(32)
  })

  it('🛑 a display-name club gives the code in team_abbreviation and team_id; `team` keeps the stored name', async () => {
    h.players = [row({ id: 's-hurts', name: 'Jalen Hurts', position: 'QB', team: 'Philadelphia Eagles', sleeperId: '6904', source: 'sleeper' })]
    const hurts = (await nflPool({ position: 'QB' })).find((p) => p.full_name === 'Jalen Hurts')
    expect(hurts).toMatchObject({ team_abbreviation: 'PHI', team_id: 'PHI', team: 'Philadelphia Eagles' })
  })
})

describe('NFL pool — one row per Sleeper player, and it is the Sleeper row', () => {
  it('🛑 A.J. Brown: the stale PHI backfill, the stamped RI row and the TheSportsDB row collapse onto Sleeper 5859', async () => {
    h.players = [
      row({ id: 'bf-ajb', name: 'A.J. Brown', team: 'Philadelphia Eagles', externalId: '4876', source: 'backfill' }),
      row({ id: 'ri-ajb', name: 'A.J. Brown', team: 'New England Patriots', sleeperId: '5859', externalId: '4876', source: 'rolling_insights' }),
      row({ id: 's-ajb', name: 'A.J. Brown', team: 'New England Patriots', sleeperId: '5859', externalId: 'sleeper:5859', source: 'sleeper', status: 'Active' }),
      row({ id: 'ts-ajb', name: 'A.J. Brown', team: 'New England Patriots', externalId: 'tsdb_34201494', imageUrl: 'https://img.example/ajb.png', source: 'thesportsdb', status: 'out' }),
    ]
    const brown = (await nflPool({ position: 'WR' })).filter((p) => p.full_name === 'A.J. Brown')
    expect(brown).toHaveLength(1)
    expect(brown[0]).toMatchObject({
      player_id: 's-ajb',
      team_abbreviation: 'NE',
      external_source_id: '5859',
      sleeper_id: '5859',
      status: 'Active',
      image_url: 'https://img.example/ajb.png', // the photo is carried, not lost with its row
    })
  })

  it('🛑 Kaytron Allen on three clubs is one player, on Sleeper’s club', async () => {
    h.players = [
      row({ id: 'ri-ka', name: 'Kaytron Allen', position: 'RB', team: 'Minnesota Vikings', externalId: '10148' }),
      row({ id: 's-ka', name: 'Kaytron Allen', position: 'RB', team: 'Miami Dolphins', sleeperId: '13405', source: 'sleeper' }),
      row({ id: 'ts-ka', name: 'Kaytron Allen', position: 'RB', team: 'Washington Commanders', externalId: 'tsdb_34437973', source: 'thesportsdb' }),
    ]
    const allen = (await nflPool({ position: 'RB' })).filter((p) => p.full_name === 'Kaytron Allen')
    expect(allen.map((p) => [p.player_id, p.team_abbreviation])).toEqual([['s-ka', 'MIA']])
  })

  it('🛑 a stamp the Sleeper row contradicts is void: TheSportsDB’s Seattle DT carrying 5864 lands on 11668', async () => {
    h.players = [
      row({ id: 's-bm-cb', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings', sleeperId: '5864', source: 'sleeper' }),
      row({ id: 's-bm-dl', name: 'Byron Murphy', position: 'DL', team: 'Seattle Seahawks', sleeperId: '11668', source: 'sleeper' }),
      row({ id: 'ts-bm', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', sleeperId: '5864', externalId: 'tsdb_34249738', source: 'thesportsdb' }),
    ]
    const murphy = (await nflPool()).filter((p) => p.full_name === 'Byron Murphy')
    expect(murphy.map((p) => [p.player_id, p.sleeper_id, p.team_abbreviation]).sort()).toEqual([
      ['s-bm-cb', '5864', 'MIN'],
      ['s-bm-dl', '11668', 'SEA'],
    ])
  })

  it('a namesake that no club disambiguates is left alone, not merged into either man', async () => {
    h.players = [
      row({ id: 's-cj-kc', name: 'Chris Jones', position: 'DT', team: 'Kansas City Chiefs', sleeperId: '3321', source: 'sleeper' }),
      row({ id: 's-cj-x', name: 'Chris Jones', position: 'DT', team: null, sleeperId: '2000', source: 'sleeper' }),
      row({ id: 'ri-cj', name: 'Chris Jones', position: 'DT', team: 'Dallas Cowboys', externalId: '777' }),
    ]
    const jones = (await nflPool()).filter((p) => p.full_name === 'Chris Jones')
    expect(jones.map((p) => p.player_id).sort()).toEqual(['ri-cj', 's-cj-kc', 's-cj-x'])
  })

  it('🛑 a stamped vendor row that cannot be collapsed never outranks the Sleeper row on its key', async () => {
    // The stamp names a Sleeper id outside this query, so it is left as it was; it shares
    // name, position and club with a Sleeper row and carries a photo — which used to win.
    h.players = [
      row({ id: 's-ss', name: 'Sam Smith', team: 'Dallas Cowboys', sleeperId: '100', source: 'sleeper' }),
      row({ id: 'ts-ss', name: 'Sam Smith', team: 'Dallas Cowboys', sleeperId: '999', externalId: 'tsdb_1', imageUrl: 'https://img.example/ss.png', source: 'thesportsdb' }),
    ]
    const smith = (await nflPool({ position: 'WR' })).filter((p) => p.full_name === 'Sam Smith')
    expect(smith).toHaveLength(1)
    expect(smith[0]).toMatchObject({ player_id: 's-ss', sleeper_id: '100', image_url: 'https://img.example/ss.png' })
  })
})

describe('NFL pool — external_source_id never carries a bare vendor number', () => {
  it('🛑 an unstamped RI row keeps its place but not its RI number; a prefixed provider id is kept', async () => {
    h.players = [
      row({ id: 'ri-only', name: 'Vendor Only', externalId: '4876' }),
      row({ id: 'ts-only', name: 'Photo Only', externalId: 'tsdb_42', source: 'thesportsdb' }),
    ]
    const pool = await nflPool({ position: 'WR' })
    expect(pool.find((p) => p.player_id === 'ri-only')).toMatchObject({ external_source_id: null, sleeper_id: null })
    expect(pool.find((p) => p.player_id === 'ts-only')).toMatchObject({ external_source_id: 'tsdb_42' })
  })

  it('outside NFL the coalesce is unchanged (daily sports are scored through the RI number)', async () => {
    h.players = [row({ id: 'nba-1', name: 'Some Guard', position: 'G', team: 'Boston Celtics', externalId: '3900' })]
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NBA', { limit: 50 })
    expect(pool[0]).toMatchObject({ external_source_id: '3900', team_abbreviation: 'Boston Celtics' })
  })
})
