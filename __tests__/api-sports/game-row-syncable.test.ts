// @vitest-environment node
/**
 * lib/api-sports.ts — syncAPISportsGamesToDb row guard.
 *
 * Measured in production 2026-09-10: API-Sports returned NCAAF fixtures whose away team carried
 * an `id` ("902") but no `name`. `awayTeam` is a non-null column, so every one of those rows
 * failed its upsert, and the handler passed the whole Prisma error to `console.error` — which
 * embeds the ENTIRE invocation (`where` + `update` + `create`) per game.
 *
 * 🛑 THE FLOOD WAS THE DAMAGE, NOT THE FAILED ROWS. It saturated Railway's 500 logs/sec replica
 * limit and dropped 6,008 messages in a burst, taking every other diagnostic on that replica with
 * it — three unrelated verifications could not be cleared while it ran.
 *
 * `isSyncableGameRow` skips rows that cannot be written. Same shape and reason as the neighbouring
 * `isSyncableStandingRow`, which fixed the identical class of bug on the standings sync.
 */
import { describe, it, expect } from 'vitest'
import { isSyncableGameRow } from '@/lib/api-sports'

type Row = Parameters<typeof isSyncableGameRow>[0]

const valid = {
  game: { id: 23413 },
  teams: {
    home: { id: 896, name: 'Chicago State' },
    away: { id: 902, name: 'Kansas City Chiefs' },
  },
} as unknown as Row

describe('isSyncableGameRow', () => {
  it('accepts a well-formed fixture', () => {
    expect(isSyncableGameRow(valid)).toBe(true)
  })

  it('rejects the exact production shape: away team with an id and no name', () => {
    const row = {
      game: { id: 23413 },
      teams: { home: { id: 896, name: 'Chicago State' }, away: { id: 902 } },
    } as unknown as Row
    expect(isSyncableGameRow(row)).toBe(false)
  })

  it('rejects every unwritable shape, without throwing', () => {
    // Collect-all-then-assert. Throwing here would be the same defect in a new place: the guard
    // runs before the try block, so an exception from it aborts the whole loop.
    const cases: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['empty object', {}],
      ['missing teams', { game: { id: 1 } }],
      ['missing away', { game: { id: 1 }, teams: { home: { name: 'A' } } }],
      ['missing home', { game: { id: 1 }, teams: { away: { name: 'B' } } }],
      ['away name null', { game: { id: 1 }, teams: { home: { name: 'A' }, away: { name: null } } }],
      ['home name empty', { game: { id: 1 }, teams: { home: { name: '' }, away: { name: 'B' } } }],
      ['both names empty', { game: { id: 1 }, teams: { home: { name: '' }, away: { name: '' } } }],
    ]
    const offenders: string[] = []
    for (const [label, row] of cases) {
      let result: boolean
      try {
        result = isSyncableGameRow(row as never)
      } catch (e) {
        offenders.push(`${label}: THREW ${(e as Error).message}`)
        continue
      }
      if (result !== false) offenders.push(`${label}: expected false, got ${result}`)
    }
    expect(offenders).toEqual([])
    expect(cases.length).toBeGreaterThan(0) // floor: an empty case list must not read as a pass
  })

  it('accepts a name the abbreviation map does not know, because the raw name is stored', () => {
    // The upsert writes `teamNameToAbbrev(name) || name`, so an unmapped school still produces a
    // writable value. Rejecting it would silently drop most of the NCAAF slate.
    const row = {
      game: { id: 2 },
      teams: { home: { name: 'Chicago State' }, away: { name: 'Some Unmapped College' } },
    } as unknown as Row
    expect(isSyncableGameRow(row)).toBe(true)
  })
})
