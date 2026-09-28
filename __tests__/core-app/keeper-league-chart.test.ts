// @vitest-environment node
/**
 * Which chart a keeper league prices on (Guap, 2026-09-28: "by keeper share, everywhere").
 *
 * Every keeper league used to price on the dynasty chart. On production that day 17 of 19 keeper
 * league rows kept 1–3 players of a 15–20 man roster, where the dynasty chart valued TreVeyon
 * Henderson near Derrick Henry and this season's (redraft) chart has Henry at more than three
 * times Henderson. Half the roster or more carrying over is a dynasty league; less is redraft.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  KEEPER_DYNASTY_SHARE,
  keeperShareFromSettings,
  leagueVariantFor,
  pricesOnDynastyChart,
  valueBookFor,
} from '@/lib/core-app/valueBook'
import { marketContextFor } from '@/lib/trade-intel/marketContext'

/** A Sleeper-style roster: 9 starters, 7 bench, 1 IR (16 roster spots a keeper competes for). */
const ROSTER = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR']

describe('keeperShareFromSettings', () => {
  it('divides the keeper count by the roster, leaving IR out', () => {
    expect(keeperShareFromSettings({ max_keepers: 2, roster_positions: ROSTER })).toBe(2 / 16)
  })

  it('reads a native league’s spellings too', () => {
    expect(keeperShareFromSettings({ keeper_max_keepers: 4, roster_positions: ROSTER })).toBe(0.25)
    expect(keeperShareFromSettings({ keeperMaxKeepers: 8, roster_positions: ROSTER })).toBe(0.5)
    expect(keeperShareFromSettings({ keeperCount: 3, roster_positions: ROSTER })).toBe(3 / 16)
  })

  it('is unknown without a count or a roster — never guessed', () => {
    expect(keeperShareFromSettings({ roster_positions: ROSTER })).toBeNull()
    expect(keeperShareFromSettings({ max_keepers: 2 })).toBeNull()
    expect(keeperShareFromSettings(null)).toBeNull()
  })

  it('caps at the whole roster', () => {
    expect(keeperShareFromSettings({ max_keepers: 40, roster_positions: ROSTER })).toBe(1)
  })
})

describe('pricesOnDynastyChart', () => {
  it.each([
    [{ dynasty: true, keeper: false }, true],
    [{ dynasty: false, keeper: false }, false],
    [{ dynasty: false, keeper: true, keeperShare: 2 / 16 }, false],
    [{ dynasty: false, keeper: true, keeperShare: KEEPER_DYNASTY_SHARE }, true],
    [{ dynasty: false, keeper: true, keeperShare: 0.76 }, true],
    // An unknown share keeps today's chart: only a league we can measure moves.
    [{ dynasty: false, keeper: true, keeperShare: null }, true],
    [{ dynasty: false, keeper: true }, true],
  ])('%j → dynasty chart: %s', (variant, want) => {
    expect(pricesOnDynastyChart(variant)).toBe(want)
  })
})

describe('the value book — the card, the grade and the evaluator all read it', () => {
  it('prices a light keeper league (2 of 16) on the REDRAFT chart', () => {
    expect(valueBookFor({ max_keepers: 2, roster_positions: ROSTER }, 'keeper').format).toBe('REDRAFT')
  })

  it('prices a keeper league carrying most of its roster (19 of 25) on the DYNASTY chart', () => {
    const roster25 = [...ROSTER.filter((p) => p !== 'IR'), ...Array(9).fill('BN')]
    expect(valueBookFor({ max_keepers: 19, roster_positions: roster25 }, 'keeper').format).toBe('DYNASTY')
  })

  it('keeps a keeper league with no count on the dynasty chart, as before', () => {
    expect(valueBookFor({ roster_positions: ROSTER }, 'keeper').format).toBe('DYNASTY')
  })

  it('leaves dynasty and redraft leagues where they were', () => {
    expect(valueBookFor({ max_keepers: 2, roster_positions: ROSTER }, 'dynasty').format).toBe('DYNASTY')
    expect(valueBookFor({ roster_positions: ROSTER }, 'redraft').format).toBe('REDRAFT')
  })

  it('still calls a light keeper league a KEEPER league — the chart moves, the fact does not', () => {
    expect(leagueVariantFor({ max_keepers: 2, roster_positions: ROSTER }, 'keeper')).toMatchObject({ keeper: true, dynasty: false, keeperShare: 2 / 16 })
  })

  it('carries the share into the market context the one grade prices from', () => {
    const ctx = marketContextFor({ max_keepers: 2, roster_positions: ROSTER }, 'keeper', 12)
    expect(ctx.variant.keeperShare).toBe(2 / 16)
    expect(pricesOnDynastyChart(ctx.variant)).toBe(false)
  })
})

describe('🛑 every chart decision asks pricesOnDynastyChart', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
  const CHART_DECISIONS = [
    'lib/core-app/valueBook.ts',
    'lib/trade-intel/marketValueService.ts',
    'lib/trade-value-console/leagueTradePricing.ts',
    'lib/dashboard-intel/commandCenterService.ts',
    'app/api/league/live-roster/route.ts',
    'app/api/leagues/[leagueId]/trades/rosters/route.ts',
  ]

  it.each(CHART_DECISIONS)('%s never picks a chart with `dynasty || keeper` by hand', (rel) => {
    const src = read(rel)
    expect(src).not.toMatch(/variant\.dynasty\s*\|\|\s*[\w.]*variant\.keeper/)
    expect(src).not.toMatch(/v\.dynasty\s*\|\|\s*v\.keeper/)
    expect(src).toMatch(/pricesOnDynastyChart\(/)
  })

  it('the live Sleeper context carries the share, and a cached envelope rebuilds it', () => {
    const src = read('lib/league-context/leagueContextService.ts')
    expect(src).toMatch(/keeperShare: type === 1 \? keeperShareFromSettings\(/)
    expect(src.match(/max_keepers: cachedPayload\.variant\.maxKeepers \?\? undefined,/g)).toHaveLength(2)
  })
})
