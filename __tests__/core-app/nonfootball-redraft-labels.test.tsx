/**
 * Three findings from the live check of a Fantrax NHL redraft league (2026-11-05):
 * 1. My team named its provider column "SLEEPER" on every hockey player — Sleeper projects no NHL;
 *    those rows are AllFantasy's daily-form outlook. The label now comes from the rows' sources.
 * 2. AF, OWN and START were em dashes on every row — a column no row has a value in now leaves.
 * 3. Standings said "season complete after week 6" while week 7 was being played.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { myTeamFixture } from '@/app/e2e/redraft-core/myteam/fixtures'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'
import { defaultProjectionKind, emptyProjectionColumns, projectionSourceKind } from '@/lib/core-app/projectionSourceLabel'
import { standingsSeasonComplete } from '@/lib/core-app/standingsModel'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('projection source label', () => {
  it('one known source names the column; mixed or an unnamed vendor reads neutral', () => {
    expect(projectionSourceKind(['sleeper', 'sleeper', null], 'af')).toBe('sleeper')
    expect(projectionSourceKind(['allfantasy', undefined], 'sleeper')).toBe('af')
    expect(projectionSourceKind(['sleeper', 'allfantasy'], 'sleeper')).toBe('neutral')
    expect(projectionSourceKind(['some_chain_vendor'], 'sleeper')).toBe('neutral')
    expect(projectionSourceKind([null, undefined], 'af')).toBe('af')
  })
  it('falls back to AF for the sports only AllFantasy prices, Sleeper for the NFL feed', () => {
    expect(defaultProjectionKind('NHL', 'fantrax')).toBe('af')
    expect(defaultProjectionKind('MLB', 'sleeper')).toBe('af')
    expect(defaultProjectionKind('NCAAF', 'fantrax')).toBe('af')
    expect(defaultProjectionKind('NFL', 'sleeper')).toBe('sleeper')
  })
})

describe('empty projection columns', () => {
  it('flags a column only when no row has a value', () => {
    expect(emptyProjectionColumns([{ afEngineProjectedPoints: null, market: null }, null])).toEqual({ engine: true, market: true })
    expect(emptyProjectionColumns([{ afEngineProjectedPoints: null, market: { ownPct: 0.1, startPct: null } }, { afEngineProjectedPoints: 4 }])).toEqual({ engine: false, market: false })
    expect(emptyProjectionColumns([])).toEqual({ engine: false, market: false })
  })
})

/** The NHL fixture as the Fantrax league arrived: AF daily-form rows, no engine, no market. */
function nhlFromAfModel(): MyTeamData {
  const data = myTeamFixture('NHL')
  const strip = (p: LineupPlayer | null) =>
    p ? { ...p, projectionSource: 'allfantasy', afEngineProjectedPoints: null, market: null } : p
  const starters = (data.starters as { available: true; data: LineupSlot[] }).data
  ;(data.starters as { data: LineupSlot[] }).data = starters.map((s) => ({ ...s, player: strip(s.player) }))
  if (data.bench.available) (data.bench as { data: LineupPlayer[] }).data = data.bench.data.map((p) => strip(p)!)
  return data
}

describe('My team on a non-football redraft league', () => {
  it('labels the column AF when AllFantasy priced the rows, not Sleeper', () => {
    const { container } = render(<MyTeam data={nhlFromAfModel()} />)
    const head = container.querySelector('#af-mt-starters .af-mt-projhead--af')
    expect(head?.textContent).toContain('AF')
    expect(head?.textContent).not.toMatch(/Sleeper/i)
  })
  it('drops the engine and market columns when every row is empty', () => {
    const { container } = render(<MyTeam data={nhlFromAfModel()} />)
    const starters = container.querySelector('#af-mt-starters')
    expect(starters?.getAttribute('data-proj-engine')).toBe('off')
    expect(starters?.getAttribute('data-proj-market')).toBe('off')
  })
  it('CONTROL: the NFL fixture keeps Sleeper and all four columns', () => {
    const data = myTeamFixture('NFL')
    for (const s of (data.starters as { data: LineupSlot[] }).data) if (s.player) s.player.projectionSource = 'sleeper'
    const { container } = render(<MyTeam data={data} />)
    expect(container.querySelector('#af-mt-starters .af-mt-projhead--af')?.textContent).toContain('Sleeper')
    const starters = container.querySelector('#af-mt-starters')
    expect(starters?.hasAttribute('data-proj-engine')).toBe(false)
    expect(starters?.hasAttribute('data-proj-market')).toBe(false)
  })
})

describe('standings season complete', () => {
  const weeks = (n: number) => Array.from({ length: n }, (_, i) => ({ week: i + 1, scored: 12, rows: 12 }))
  it('is not complete when only the weeks played so far are on file', () => {
    expect(standingsSeasonComplete(weeks(6), 20)).toBe(false)
    expect(standingsSeasonComplete(weeks(6), null)).toBe(false)
  })
  it('is complete once the last regular-season week is on file and scored', () => {
    expect(standingsSeasonComplete(weeks(14), 14)).toBe(true)
    expect(standingsSeasonComplete([...weeks(13), { week: 14, scored: 6, rows: 12 }], 14)).toBe(false)
  })
})
