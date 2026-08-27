import { describe, expect, it } from 'vitest'

import { parseFantraxFiles, parseFantraxRoster } from '@/lib/fantrax-parser'

/**
 * ⚠ THE TRAP THIS PINS. `parseFantraxFiles` returned
 * `success: errors.length === 0 || hasData` — an OR — so a CSV whose format we
 * did not recognise reported SUCCESS with an empty roster and empty standings.
 * Nothing throws in that case; the file simply matches no filename branch.
 *
 * The upload route (`server/api-route-modules/legacy/fantrax/route.ts`) rejects
 * only when `!result.success && result.errors.length > 0`, so that hollow result
 * sailed straight through and upserted a `FantraxLeague` row with no players in
 * it. A franchise link would then attach to an empty league and grade trades
 * against a roster that does not exist.
 *
 * Verified 2026-08-26: `FantraxUser` and `FantraxLeague` both hold ZERO rows, so
 * nobody has hit this yet — it is latent, not live.
 */

/** The real Fantrax roster export: an "ID" header and 24+ columns per row. */
function rosterCsv(rows: string[][]): string {
  const header = ['ID', 'Position', 'Player', 'Team', 'Eligible', 'PrimaryPos', 'Status', 'Year']
  while (header.length < 26) header.push(`Col${header.length}`)
  const quote = (cells: string[]) => cells.map((c) => `"${c}"`).join(',')
  const padded = rows.map((r) => {
    const copy = [...r]
    while (copy.length < 26) copy.push('')
    return copy
  })
  return [quote(header), ...padded.map(quote)].join('\n')
}

const VALID_ROSTER = rosterCsv([
  ['*04abc', 'WR', 'Jeremiah Smith', 'OSU', 'WR', 'WR', 'Active', 'SO'],
  ['*07xyz', 'QB', 'Arch Manning', 'TEX', 'QB', 'QB', 'Active', 'JR'],
])

describe('the roster parser reads a real Fantrax export', () => {
  it('parses players from an ID-headed 24-column file', () => {
    const players = parseFantraxRoster(VALID_ROSTER)
    expect(players.length).toBe(2)
    expect(players.map((p) => p.name)).toEqual(['Jeremiah Smith', 'Arch Manning'])
  })

  it('strips the leading asterisk Fantrax puts on ids', () => {
    const players = parseFantraxRoster(VALID_ROSTER)
    expect(players[0].fantraxId).toBe('04abc')
  })
})

describe('an upload that parsed nothing is not a success', () => {
  it('a recognised file with real rows succeeds', () => {
    const res = parseFantraxFiles(
      [{ name: 'roster_2026.csv', content: VALID_ROSTER }],
      'Dynasty Warriors',
      { leagueName: 'My C2C League', isDevy: true, sport: 'cfb' },
    )

    expect(res.success).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.roster.length).toBe(2)
  })

  /**
   * ⚠ THE REGRESSION GUARD. Before the fix this returned success:true with an
   * empty roster and NO errors, which the upload route accepts.
   */
  it('a file we cannot recognise fails, and says why', () => {
    const res = parseFantraxFiles(
      [{ name: 'roster_2026.csv', content: '"Player","Position"\n"Someone","WR"\n' }],
      'Dynasty Warriors',
      { leagueName: 'My C2C League', isDevy: true, sport: 'cfb' },
    )

    expect(res.success).toBe(false)
    expect(res.roster.length).toBe(0)
    // Non-empty errors is what makes the upload route return 400 rather than
    // upserting a hollow league.
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors.join(' ')).toMatch(/No recognisable Fantrax data/)
  })

  it('the error tells the uploader which filenames the parser selects on', () => {
    const res = parseFantraxFiles(
      [{ name: 'something-else.csv', content: 'a,b\n1,2\n' }],
      'Dynasty Warriors',
      {},
    )
    expect(res.success).toBe(false)
    expect(res.errors.join(' ')).toMatch(/roster/)
    expect(res.errors.join(' ')).toMatch(/standings/)
  })

  it('no files at all fails rather than producing an empty league', () => {
    const res = parseFantraxFiles([], 'Dynasty Warriors', {})
    expect(res.success).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
  })
})
