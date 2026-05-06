import { describe, expect, it } from 'vitest'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import {
  filterDraftPlayersByStat,
  flattenDraftPlayerStatBag,
  formatDraftStatDisplay,
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
  sportUsesColumnKeys,
} from '@/lib/draft-room/draftSportStatColumns'
import { resolvePlayerPoolAdpColumns } from '@/lib/draft-room/playerPoolAdpColumns'

function nflSplits(partial: Partial<NflDraftProjectionSplits>): NflDraftProjectionSplits {
  return {
    source: 'mixed',
    projectedPoints: partial.projectedPoints ?? null,
    projectedPointsPerGame: partial.projectedPointsPerGame ?? null,
    rushing: partial.rushing ?? { att: null, yds: null, td: null },
    receiving: partial.receiving ?? { rec: null, tar: null, yds: null, td: null },
    passing: partial.passing ?? { cmp: null, att: null, yds: null, td: null, int: null },
    kicking: partial.kicking,
  }
}

describe('getDraftStatColumnsForSport', () => {
  it('NFL offense columns for QB-style row', () => {
    const cols = getDraftStatColumnsForSport('NFL', { position: 'QB' })
    expect(cols.map((c) => c.key)).toContain('pass_td')
    expect(cols.map((c) => c.key)).not.toContain('idp_tkl')
  })

  it('NFL IDP columns for LB', () => {
    const cols = getDraftStatColumnsForSport('NFL', { position: 'LB' })
    expect(cols.map((c) => c.key)).toContain('idp_tkl')
    expect(cols.map((c) => c.key)).not.toContain('pass_td')
  })

  it('NCAAF offense vs IDP vs PK uses Rolling Insights-friendly aliases', () => {
    expect(getDraftStatColumnsForSport('NCAAF', { position: 'WR' }).some((c) => c.key === 'rec_yds')).toBe(true)
    expect(getDraftStatColumnsForSport('NCAAF', { position: 'DE' }).some((c) => c.key === 'idp_fr')).toBe(true)
    expect(getDraftStatColumnsForSport('NCAAF', { position: 'PK' }).some((c) => c.key === 'fgm')).toBe(true)
  })

  it('NBA / NCAAB share basketball columns', () => {
    const nba = getDraftStatColumnsForSport('NBA')
    const ncaab = getDraftStatColumnsForSport('NCAAB')
    expect(nba.map((c) => c.key)).toEqual(ncaab.map((c) => c.key))
    expect(nba.map((c) => c.key)).toContain('pts')
  })

  it('MLB hitter vs pitcher by position', () => {
    const hit = getDraftStatColumnsForSport('MLB', { position: 'OF' })
    const pit = getDraftStatColumnsForSport('MLB', { position: 'SP' })
    expect(hit.some((c) => c.key === 'hr')).toBe(true)
    expect(pit.some((c) => c.key === 'era')).toBe(true)
  })

  it('NHL skater vs goalie', () => {
    const sk = getDraftStatColumnsForSport('NHL', { position: 'C' })
    const g = getDraftStatColumnsForSport('NHL', { position: 'G' })
    expect(sk.some((c) => c.key === 'sog')).toBe(true)
    expect(g.some((c) => c.key === 'sv_nhl')).toBe(true)
  })

  it('Soccer + extension sports return dedicated keys', () => {
    expect(getDraftStatColumnsForSport('SOCCER').some((c) => c.key === 'soc_proj')).toBe(true)
    expect(getDraftStatColumnsForSport('NASCAR').some((c) => c.key === 'car_ll')).toBe(true)
    expect(getDraftStatColumnsForSport('PGA').some((c) => c.key === 'pga_sg')).toBe(true)
    expect(getDraftStatColumnsForSport('WWE').some((c) => c.key === 'wwe_win')).toBe(true)
    expect(getDraftStatColumnsForSport('CRICKET').some((c) => c.key === 'cr_r')).toBe(true)
  })
})

describe('getStatValueForDraftPlayer — resolves aliases', () => {
  it('NFL offense: splits + passing TD', () => {
    const splits = nflSplits({
      projectedPoints: 240,
      passing: { cmp: 400, att: 600, yds: 4200, td: 30, int: 10 },
      rushing: { att: 40, yds: 120, td: 2 },
      receiving: { rec: null, tar: null, yds: null, td: null },
    })
    const cols = getDraftStatColumnsForSport('NFL', { position: 'QB' })
    const passTd = cols.find((c) => c.key === 'pass_td')!
    const player = { nflDraftProjectionSplits: splits, display: { stats: {} } }
    expect(getStatValueForDraftPlayer(player, passTd)).toBe(30)
    const proj = cols.find((c) => c.key === 'proj_pts')!
    expect(getStatValueForDraftPlayer(player, proj)).toBe(240)
  })

  it('NFL IDP: tackles from loose stats keys', () => {
    const cols = getDraftStatColumnsForSport('NFL', { position: 'LB' })
    const tkl = cols.find((c) => c.key === 'idp_tkl')!
    const player = {
      position: 'LB',
      display: { stats: { combined_tackles: 142 } },
    }
    expect(getStatValueForDraftPlayer(player, tkl)).toBe(142)
  })

  it('NBA: points/rebounds from display.stats', () => {
    const cols = getDraftStatColumnsForSport('NBA')
    const pts = cols.find((c) => c.key === 'pts')!
    const reb = cols.find((c) => c.key === 'reb')!
    const player = { display: { stats: { points: 27.4, rebounds: 8.1 } } }
    expect(getStatValueForDraftPlayer(player, pts)).toBe(27.4)
    expect(getStatValueForDraftPlayer(player, reb)).toBe(8.1)
  })

  it('MLB hitter AVG / OBP formatting', () => {
    const cols = getDraftStatColumnsForSport('MLB', { position: '1B' })
    const avg = cols.find((c) => c.key === 'avg')!
    const obp = cols.find((c) => c.key === 'obp')!
    expect(formatDraftStatDisplay(0.312, avg)).toBe('0.312')
    expect(formatDraftStatDisplay(0.401, obp)).toBe('0.401')
  })

  it('MLB pitcher', () => {
    const cols = getDraftStatColumnsForSport('MLB', { position: 'SP' })
    const era = cols.find((c) => c.key === 'era')!
    const player = { display: { stats: { era: 3.25 } } }
    expect(getStatValueForDraftPlayer(player, era)).toBe(3.25)
  })

  it('NHL skater + goalie', () => {
    const skCols = getDraftStatColumnsForSport('NHL', { position: 'RW' })
    const gCols = getDraftStatColumnsForSport('NHL', { position: 'G' })
    const goals = skCols.find((c) => c.key === 'g')!
    const sv = gCols.find((c) => c.key === 'sv_nhl')!
    expect(getStatValueForDraftPlayer({ display: { stats: { goals: 42 } } }, goals)).toBe(42)
    expect(getStatValueForDraftPlayer({ display: { stats: { saves: 910 } } }, sv)).toBe(910)
  })

  it('Soccer', () => {
    const cols = getDraftStatColumnsForSport('SOCCER')
    const g = cols.find((c) => c.key === 'soc_g')!
    expect(getStatValueForDraftPlayer({ display: { stats: { goals: 18 } } }, g)).toBe(18)
  })

  it('NASCAR / PGA / WWE / Cricket extended keys', () => {
    expect(
      getStatValueForDraftPlayer(
        { display: { stats: { lapsLed: 320 } } },
        getDraftStatColumnsForSport('NASCAR').find((c) => c.key === 'car_ll')!,
      ),
    ).toBe(320)
    expect(
      getStatValueForDraftPlayer(
        { display: { stats: { strokesGainedTotal: 1.8 } } },
        getDraftStatColumnsForSport('PGA').find((c) => c.key === 'pga_sg')!,
      ),
    ).toBe(1.8)
    expect(
      getStatValueForDraftPlayer(
        { display: { stats: { titleMatches: 4 } } },
        getDraftStatColumnsForSport('WWE').find((c) => c.key === 'wwe_title')!,
      ),
    ).toBe(4)
    expect(
      getStatValueForDraftPlayer(
        { display: { stats: { economy: 7.2 } } },
        getDraftStatColumnsForSport('CRICKET').find((c) => c.key === 'cr_eco')!,
      ),
    ).toBe(7.2)
  })
})

describe('missing values + wrong sport', () => {
  it('missing stats return null-safe read', () => {
    const cols = getDraftStatColumnsForSport('NBA')
    const pts = cols.find((c) => c.key === 'pts')!
    expect(getStatValueForDraftPlayer({ display: { stats: {} } }, pts)).toBeNull()
    expect(formatDraftStatDisplay(null, pts)).toBe('—')
  })

  it('NBA row does not yield NFL pass yards', () => {
    const nflCols = getDraftStatColumnsForSport('NFL', { position: 'QB' })
    const paYds = nflCols.find((c) => c.key === 'pass_yds')!
    const nbaOnly = {
      display: { stats: { points: 22, rebounds: 10 } },
      nflDraftProjectionSplits: null,
    }
    expect(getStatValueForDraftPlayer(nbaOnly, paYds)).toBeNull()
  })

  it('NFL row does not map to NBA rebounds column', () => {
    const reb = getDraftStatColumnsForSport('NBA').find((c) => c.key === 'reb')!
    const nflOnly = {
      nflDraftProjectionSplits: nflSplits({
        passing: { cmp: 1, att: 1, yds: 4, td: 0, int: 0 },
      }),
    }
    expect(getStatValueForDraftPlayer(nflOnly, reb)).toBeNull()
  })
})

describe('filterDraftPlayersByStat', () => {
  const cols = getDraftStatColumnsForSport('NBA')
  const pts = cols.find((c) => c.key === 'pts')!

  it('gt / lt / between / eq / exists', () => {
    const players = [
      { display: { stats: { points: 10 } } },
      { display: { stats: { points: 25 } } },
      { display: { stats: {} } },
    ]
    expect(filterDraftPlayersByStat(players, pts, { op: 'gt', value: 20 })).toHaveLength(1)
    expect(filterDraftPlayersByStat(players, pts, { op: 'lt', value: 15 })).toHaveLength(1)
    expect(filterDraftPlayersByStat(players, pts, { op: 'between', min: 9, max: 11 })).toHaveLength(1)
    expect(filterDraftPlayersByStat(players, pts, { op: 'eq', value: 25 })).toHaveLength(1)
    expect(filterDraftPlayersByStat(players, pts, { op: 'exists' })).toHaveLength(2)
  })
})

describe('ADP separation unchanged', () => {
  it('resolvePlayerPoolAdpColumns keeps system vs AI separate', () => {
    const r = resolvePlayerPoolAdpColumns({ adp: 5.2, aiAdp: 9.1, aiAdpSampleSize: 99 })
    expect(r.systemAdp).toBe(5.2)
    expect(r.aiAdp).toBe(9.1)
    expect(r.aiAdpSampleSize).toBe(99)
  })
})

describe('sportUsesColumnKeys disjoint across sports', () => {
  it('NFL offense keys do not include NBA pts key', () => {
    const nfl = sportUsesColumnKeys('NFL')
    const nba = sportUsesColumnKeys('NBA')
    expect(nfl.has('pass_td')).toBe(true)
    expect(nba.has('pts')).toBe(true)
    expect(nfl.has('pts')).toBe(false)
    expect(nba.has('pass_td')).toBe(false)
  })
})

describe('flattenDraftPlayerStatBag', () => {
  it('merges splits and display.stats without throwing', () => {
    const bag = flattenDraftPlayerStatBag({
      nflDraftProjectionSplits: nflSplits({
        projectedPoints: 100,
        rushing: { att: 1, yds: 2, td: 3 },
        receiving: { rec: 4, tar: 5, yds: 6, td: 7 },
        passing: { cmp: 8, att: 9, yds: 10, td: 11, int: 12 },
      }),
      display: { stats: { custom_metric: 99 } },
    })
    expect(bag.projectedPoints).toBe(100)
    expect(bag.custom_metric).toBe(99)
  })
})
