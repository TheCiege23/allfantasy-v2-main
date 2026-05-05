import { describe, expect, it } from 'vitest'

import { applyPoolSort, sortValueForKey, type PoolSortPlayer } from '@/components/app/draft-room/SleeperPoolSort'
import {
  buildSleeperPoolTableLayout,
  sleeperPoolStatOptionsFromPositionFilter,
} from '@/lib/draft-room/sleeperPoolTableLayout'
import {
  formatDraftStatDisplay,
  getStatValueForDraftPlayer,
  sportUsesColumnKeys,
} from '@/lib/draft-room/draftSportStatColumns'
import type { DraftStatPlayerSource } from '@/lib/draft-room/draftSportStatColumns'

/**
 * Sport-aware **`SleeperPoolTable`** wiring: layout builder + column keys + sort readout.
 * (Component render is covered by static tests under `__tests__/draft/d2-*.ts`.)
 */

function layoutKeys(sport: string, positionFilter = 'All') {
  const opts = sleeperPoolStatOptionsFromPositionFilter(sport, positionFilter)
  return buildSleeperPoolTableLayout(sport, opts).columns.map((c) => c.key)
}

describe('sleeper pool table layout — headers by sport', () => {
  it('NFL keeps legacy Sleeper offense stat keys (PTS through PA INT)', () => {
    const keys = layoutKeys('NFL')
    expect(keys).toEqual(
      expect.arrayContaining([
        'rk',
        'player',
        'adp',
        'aiAdp',
        'bye',
        'pts',
        'avg',
        'ru_att',
        'ru_yds',
        'ru_td',
        'rec',
        'rec_yds',
        'rec_td',
        'pa_att',
        'pa_yds',
        'pa_td',
        'pa_int',
        'actions',
      ]),
    )
  })

  it('NFL + LB filter switches to IDP defensive stat headers', () => {
    const keys = layoutKeys('NFL', 'LB')
    expect(keys).toEqual(expect.arrayContaining(['idp_tkl', 'idp_sack', 'idp_int', 'idp_proj']))
    expect(keys).not.toContain('pa_yds')
  })

  it('NBA exposes points / rebounds / assists / steals / blocks / threes', () => {
    const statCols = buildSleeperPoolTableLayout('NBA').statDefs.map((d) => d.key)
    expect(statCols).toEqual(['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'nba_proj'])
  })

  it('MLB hitter vs pitcher columns from position hint', () => {
    const hitter = buildSleeperPoolTableLayout('MLB', {}).statDefs.map((d) => d.key)
    expect(hitter).toContain('hr')
    expect(hitter).not.toContain('era')
    const pitcher = buildSleeperPoolTableLayout('MLB', { position: 'SP' }).statDefs.map((d) => d.key)
    expect(pitcher).toContain('era')
    expect(pitcher).not.toContain('hr')
  })

  it('NHL skater vs goalie', () => {
    const sk = buildSleeperPoolTableLayout('NHL').statDefs.map((d) => d.key)
    expect(sk).toContain('sog')
    expect(sk).not.toContain('gaa')
    const g = buildSleeperPoolTableLayout('NHL', { position: 'G' }).statDefs.map((d) => d.key)
    expect(g).toContain('sv_nhl')
    expect(g).toContain('gaa')
  })

  it('Soccer + extension sports expose expected keys', () => {
    expect(buildSleeperPoolTableLayout('SOCCER').statDefs.map((d) => d.key)).toContain('soc_g')
    expect(buildSleeperPoolTableLayout('NASCAR').statDefs.map((d) => d.key)).toContain('car_af')
    expect(buildSleeperPoolTableLayout('PGA').statDefs.map((d) => d.key)).toContain('pga_sg')
    expect(buildSleeperPoolTableLayout('WWE').statDefs.map((d) => d.key)).toContain('wwe_win')
    expect(buildSleeperPoolTableLayout('CRICKET').statDefs.map((d) => d.key)).toContain('cr_r')
  })

  it('non-NFL omits BYE column', () => {
    const keys = layoutKeys('NBA')
    expect(keys).not.toContain('bye')
  })
})

describe('cells — missing stats render em dash, not zero', () => {
  const empty: DraftStatPlayerSource = {
    name: 'X',
    display: { stats: {} },
  }

  it('formatDraftStatDisplay returns — for null', () => {
    const layout = buildSleeperPoolTableLayout('NBA')
    const ptsDef = layout.statDefs.find((d) => d.key === 'pts')!
    expect(formatDraftStatDisplay(null, ptsDef)).toBe('—')
    expect(formatDraftStatDisplay(getStatValueForDraftPlayer(empty, ptsDef), ptsDef)).toBe('—')
  })
})

describe('ADP vs AI ADP remain distinct columns in layout', () => {
  it('both adp and aiAdp precede stat section', () => {
    const keys = layoutKeys('NFL')
    const iAdp = keys.indexOf('adp')
    const iAi = keys.indexOf('aiAdp')
    const iPts = keys.indexOf('pts')
    expect(iAdp).toBeGreaterThan(-1)
    expect(iAi).toBeGreaterThan(-1)
    expect(iPts).toBeGreaterThan(iAi)
  })
})

describe('sorting by sport stat columns', () => {
  const nbaA: PoolSortPlayer = {
    name: 'A',
    adp: 10,
    display: { stats: { points: 20 } },
  }
  const nbaB: PoolSortPlayer = {
    name: 'B',
    adp: 11,
    display: { stats: { points: 30 } },
  }

  it('sortValueForKey reads NBA points', () => {
    expect(sortValueForKey(nbaB, 'pts', 'NBA')).toBe(30)
    expect(sortValueForKey(nbaA, 'pts', 'NBA')).toBe(20)
  })

  it('applyPoolSort orders by pts desc', () => {
    const out = applyPoolSort([nbaA, nbaB], { key: 'pts', direction: 'desc' }, 'NBA')
    expect(out.map((p) => p.name)).toEqual(['B', 'A'])
  })
})

describe('wrong sport columns do not overlap keys', () => {
  it('NBA vs NFL stat key sets are disjoint for core stats', () => {
    const nba = sportUsesColumnKeys('NBA')
    const nfl = sportUsesColumnKeys('NFL')
    expect(nba.has('reb')).toBe(true)
    expect(nfl.has('reb')).toBe(false)
    expect(nfl.has('pass_yds')).toBe(true)
    expect(nba.has('pass_yds')).toBe(false)
  })
})
