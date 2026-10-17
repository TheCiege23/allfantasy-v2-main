// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { canFillSlot, isStartableIn } from '@/lib/core-app/slotEligibility'
import { canFillSlotForSport, isStartableInSport, positionsForSport } from '@/lib/core-app/sportSlotEligibility'
import {
  leagueIdColumn,
  leagueIdOf,
  loadIdentityForKeys,
  loadSeasonRatePool,
  priceSeasonRate,
  resolveRosterIdsToKeys,
} from '@/lib/waivers/seasonRatePool'
import { isPerGameBasis, waiverBasisSentence, waiverSportPlan } from '@/lib/waivers/waiverSportBasis'

/**
 * The rules under the season-rate waiver boards: which sports have a producer, which slot seats
 * whom in which sport, and which id column a league's rosters are read through.
 */

describe('waiverSportPlan — a producer, or the reason there is none', () => {
  it('keeps the NFL on its weekly feed and a missing sport as the NFL', () => {
    expect(waiverSportPlan('NFL')).toMatchObject({ kind: 'weekly' })
    expect(waiverSportPlan(null)).toMatchObject({ sport: 'NFL', kind: 'weekly' })
  })

  it('prices college football under the league scoring, and the category sports on the AF default', () => {
    expect(waiverSportPlan('ncaaf')).toMatchObject({ kind: 'per_game', basis: 'season_per_game_league' })
    for (const s of ['NBA', 'NCAAB', 'NHL', 'MLB']) {
      expect(waiverSportPlan(s)).toMatchObject({ kind: 'per_game', basis: 'season_per_game_af_default' })
    }
  })

  it('gives Soccer, and any sport it does not know, a stated reason instead of a blank', () => {
    const soccer = waiverSportPlan('SOCCER')
    expect(soccer.kind).toBe('none')
    expect(soccer.kind === 'none' && soccer.reason).toMatch(/serves no soccer player season stats/)
    const other = waiverSportPlan('CRICKET')
    expect(other.kind === 'none' && other.reason).toMatch(/No projection engine produces CRICKET player values/)
  })

  it('never calls a season rate a weekly number', () => {
    for (const b of ['season_per_game_league', 'season_per_game_af_default'] as const) {
      expect(isPerGameBasis(b)).toBe(true)
      expect(waiverBasisSentence(b, 'NHL')).toMatch(/not a projection for this week/)
    }
    expect(isPerGameBasis('weekly_projection')).toBe(false)
  })
})

describe('sport slot eligibility — the same slot name seats different people', () => {
  it('delegates football to the football table unchanged', () => {
    const slots = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX', 'C', 'UTIL']
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DE', 'LB', 'CB', 'OT', 'C', 'Tight End', null]
    for (const sport of ['NFL', 'NCAAF']) {
      for (const slot of slots) for (const pos of positions) expect(canFillSlotForSport(sport, slot, pos)).toBe(canFillSlot(slot, pos))
      for (const pos of positions) {
        expect(isStartableInSport(sport, null, pos)).toBe(isStartableIn(null, pos))
        expect(isStartableInSport(sport, ['QB', 'WR'], pos)).toBe(isStartableIn(['QB', 'WR'], pos))
      }
    }
  })

  it('reads C as a centre in basketball and hockey and a catcher in baseball', () => {
    expect(canFillSlotForSport('NBA', 'C', 'C')).toBe(true)
    expect(canFillSlotForSport('NHL', 'C', 'Center')).toBe(true)
    expect(canFillSlotForSport('MLB', 'C', 'Catcher')).toBe(true)
    // A catcher is a hitter; a centre is not a first baseman.
    expect(canFillSlotForSport('MLB', 'UTIL', 'C')).toBe(true)
    expect(canFillSlotForSport('MLB', '1B', 'C')).toBe(false)
  })

  it('reads G as a guard in basketball and a goalie in hockey', () => {
    expect(canFillSlotForSport('NBA', 'PG', 'G')).toBe(true)
    expect(canFillSlotForSport('NHL', 'G', 'Goalie')).toBe(true)
    // A goalie is not a skater, so he never takes a hockey UTIL.
    expect(canFillSlotForSport('NHL', 'UTIL', 'G')).toBe(false)
  })

  it('splits dual eligibility and reads each part in its own sport', () => {
    expect(positionsForSport('NBA', 'G-F')).toEqual(['G', 'F'])
    expect(canFillSlotForSport('NBA', 'SF', 'G-F')).toBe(true)
    expect(canFillSlotForSport('NBA', 'C', 'G-F')).toBe(false)
    expect(canFillSlotForSport('MLB', 'MI', 'SS,2B')).toBe(true)
    expect(canFillSlotForSport('MLB', 'SP', 'P')).toBe(true)
    expect(canFillSlotForSport('MLB', 'SP', 'RP')).toBe(false)
  })

  it('seats nobody in a slot it does not know, and nobody in a sport it does not know', () => {
    expect(canFillSlotForSport('NBA', 'WR', 'SG')).toBe(false)
    expect(canFillSlotForSport('SOCCER', 'FW', 'FW')).toBe(false)
    expect(isStartableInSport('NBA', null, 'QB')).toBe(false)
    expect(isStartableInSport('NHL', null, 'D')).toBe(true)
  })
})

describe('leagueIdColumn — one column per platform, never a guess', () => {
  it('reads native rosters as Rolling Insights ids and each provider through its own column', () => {
    expect(leagueIdColumn('manual')).toBe('rollingInsightsId')
    expect(leagueIdColumn('allfantasy')).toBe('rollingInsightsId')
    expect(leagueIdColumn(null)).toBe('rollingInsightsId')
    expect(leagueIdColumn('ESPN')).toBe('espnId')
    expect(leagueIdColumn('fantrax')).toBe('fantraxId')
    expect(leagueIdColumn('myfantasyleague')).toBe('mflId')
    expect(leagueIdColumn('fleaflicker')).toBe('fleaflickerId')
    expect(leagueIdColumn('sleeper')).toBe('sleeperId')
  })

  it('has no column for Yahoo or an unknown platform', () => {
    expect(leagueIdColumn('yahoo')).toBeNull()
    expect(leagueIdColumn('cbs')).toBeNull()
  })
})

const row = (key: string, perGame: number, components: Record<string, unknown> | null) => ({
  key,
  name: key,
  position: 'WR',
  perGame,
  components,
})

describe('priceSeasonRate — never two currencies in one ranking', () => {
  it("returns the engine's own per-game figure on the AF default basis", () => {
    expect(priceSeasonRate(row('a', 31.5, null), 'season_per_game_af_default', null)).toBe(31.5)
  })

  it('re-scores from components under the league basis, and refuses rather than fall back', () => {
    expect(priceSeasonRate(row('a', 99, { 'receiving.REC': 6 }), 'season_per_game_league', { rec: 1.5 })).toBe(9)
    // No components, or no rules: null — never the default-scored 99 beside league-scored numbers.
    expect(priceSeasonRate(row('a', 99, null), 'season_per_game_league', { rec: 1 })).toBeNull()
    expect(priceSeasonRate(row('a', 99, { 'receiving.REC': 6 }), 'season_per_game_league', null)).toBeNull()
  })
})

/* ── Reads, against a double that honours `where` ─────────────────────────────────────────────── */

function dbWith(snapshots: Array<Record<string, unknown>>, identity: Array<Record<string, unknown>>) {
  const matches = (r: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, c]) =>
      c && typeof c === 'object' && 'in' in (c as object) ? (c as { in: unknown[] }).in.includes(r[k]) : r[k] === c,
    )
  return {
    aFProjectionSnapshot: {
      findMany: async (a: { where?: Record<string, unknown>; take?: number }) =>
        snapshots.filter((r) => matches(r, a.where)).slice(0, a.take ?? Infinity),
      findFirst: async () => null,
    },
    playerIdentityMap: {
      findMany: async (a: { where?: Record<string, unknown> }) => identity.filter((r) => matches(r, a.where)),
    },
  } as never
}

const id = (over: Record<string, unknown>) => ({
  cfbdId: null,
  currentTeam: null,
  rollingInsightsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  sleeperId: null,
  ...over,
})

describe('seasonRatePool reads', () => {
  it('keeps the FRESHEST baseline row per player', async () => {
    const at = (iso: string) => new Date(iso)
    const db = dbWith(
      [
        { playerId: 'p', playerName: 'P', position: 'C', afProjection: 40, adjustmentFactors: null, computedAt: at('2026-01-01'), sport: 'NHL', season: 2026, week: null },
        { playerId: 'p', playerName: 'P', position: 'C', afProjection: 12, adjustmentFactors: null, computedAt: at('2026-09-01'), sport: 'NHL', season: 2026, week: null },
      ],
      [],
    )
    const pool = await loadSeasonRatePool(db, 'NHL', 2026, 50)
    expect(pool).toHaveLength(1)
    expect(pool[0]?.perGame).toBe(12)
  })

  it('drops a roster id that the identity map ties to two people, and never reads another sport', async () => {
    const db = dbWith(
      [],
      [
        id({ id: 'k1', sport: 'NBA', rollingInsightsId: '7' }),
        id({ id: 'k2', sport: 'NBA', rollingInsightsId: '8' }),
        id({ id: 'k3', sport: 'NBA', rollingInsightsId: '8' }),
        id({ id: 'nfl', sport: 'NFL', rollingInsightsId: '7' }),
      ],
    )
    const map = await resolveRosterIdsToKeys(db, 'NBA', 'rollingInsightsId', ['7', '8', '9'])
    expect([...map]).toEqual([['7', 'k1']])
  })

  it('keys NCAAF by CFBD id, and marks a key whose rows disagree on a column as unusable there', async () => {
    const db = dbWith(
      [],
      [
        id({ id: 'a', sport: 'NCAAF', cfbdId: 'cf1', rollingInsightsId: '11', espnId: 'e1' }),
        id({ id: 'b', sport: 'NCAAF', cfbdId: 'cf1', rollingInsightsId: '12', espnId: null }),
        id({ id: 'c', sport: 'NCAAF', cfbdId: 'cf2', rollingInsightsId: null, espnId: 'e2', currentTeam: 'UGA' }),
      ],
    )
    const ids = await loadIdentityForKeys(db, 'NCAAF', ['cf1', 'cf2'])
    expect(leagueIdOf(ids.get('cf1'), 'rollingInsightsId')).toBeNull()
    expect(leagueIdOf(ids.get('cf1'), 'espnId')).toBe('e1')
    expect(leagueIdOf(ids.get('cf2'), 'rollingInsightsId')).toBeNull()
    expect(leagueIdOf(ids.get('cf2'), 'espnId')).toBe('e2')
    expect(ids.get('cf2')?.team).toBe('UGA')
    expect(await resolveRosterIdsToKeys(db, 'NCAAF', 'espnId', ['e2'])).toEqual(new Map([['e2', 'cf2']]))
  })
})
