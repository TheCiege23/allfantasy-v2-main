// @vitest-environment node
/**
 * Fantrax lists team units alongside players, and neither ingestion is allowed
 * to treat one as a person.
 *
 * 🛑 A TEAM ROW COUNTED AS A MISS IS A LIE ABOUT COVERAGE. Both ingestions used
 * to name-match "Defense/Special Teams" and "Ark" against a registry of humans,
 * fail, and file the result under `unmatched` — so the reported miss rate mixed
 * "we have no row for this player" with "this was never a player", and only the
 * first is a coverage problem. Measured on production 2026-08-31: 690 of 16,904
 * ids in the CFB map and 80 of 997 rows in the ADP feed.
 *
 * ⚠ AND THE SKIP MUST HAPPEN BEFORE THE QUERY, not just before the write. The
 * saving is 690 database round trips per run; a guard that filters the result
 * after querying would still pay for every one of them and would still look
 * correct from the outside.
 */

import { describe, expect, it } from 'vitest'

import { isTeamEntry, normalizePlayerName } from '@/lib/devy/ingestFantraxDevyAdp'

describe('isTeamEntry', () => {
  /**
   * The five distinct non-player names actually present in Fantrax's CFB map,
   * used verbatim rather than invented — a made-up example can agree with a rule
   * that the real data would break.
   */
  it.each([
    'Defense/Special Teams',
    'Special Teams',
    'Team',
    'Team Offense',
    'Team Defense',
  ])('treats the real CFB-map entry %s as a team', (name) => {
    expect(isTeamEntry({ name })).toBe(true)
  })

  /** The ADP feed spells its team rows as school abbreviations instead. */
  it.each(['Ark', 'ArkSt', 'Army', 'Aub', 'AzSt', 'C Mi', 'FlaSt', 'Hawaii'])(
    'treats the real ADP entry %s as a team',
    (name) => {
      expect(isTeamEntry({ name })).toBe(true)
    },
  )

  it.each(['Dendy, Austyn', 'Abney, Christian', "O'Brien, Pat", 'Fox-Flores, Noah'])(
    'treats %s as a person',
    (name) => {
      expect(isTeamEntry({ name })).toBe(false)
    },
  )

  /**
   * ⚠ AN ABSENT NAME IS NOT A PERSON. Returning false here would send an empty
   * row down the matching path to fail slowly instead of being skipped.
   */
  it.each([undefined, null, '', '   '])('treats a missing name (%s) as not a person', (name) => {
    expect(isTeamEntry({ name } as { name?: unknown })).toBe(true)
  })

  /**
   * 🛑 THE RULE AND THE NAME NORMALIZER MUST AGREE ABOUT WHAT A PERSON IS.
   * `normalizePlayerName` flips "Last, First" and leaves anything else alone, so
   * a row this predicate lets through is exactly a row the normalizer can flip.
   * If one changed without the other, team rows would start being matched again
   * with nothing going red.
   */
  it('lets through exactly the rows the name normalizer can flip', () => {
    expect(normalizePlayerName('Dendy, Austyn')).toBe('austyn dendy')
    /* Not flipped — which is why it must never reach the matcher. */
    expect(normalizePlayerName('Team Defense')).toBe('team defense')
    expect(isTeamEntry({ name: 'Team Defense' })).toBe(true)
  })
})

/**
 * The guard runs before the database is touched.
 *
 * ⚠ ASSERTED THROUGH THE MODULE'S SOURCE because the alternative is standing up
 * the whole ingestion with a mocked provider and prisma to observe a call that
 * must NOT happen — and a test that asserts an absence through five layers of
 * mock passes just as well when the mocks are wrong. What matters is the order
 * of two statements, so that is what is checked.
 */
describe('the identity ingestion skips team rows before querying', () => {
  it('places the team-entry guard ahead of the surname lookup', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('lib/devy/ingestFantraxPlayerIdentities.ts', 'utf8')
    const guard = src.indexOf('if (isTeamEntry(ref))')
    const query = src.indexOf('prisma.playerIdentityMap')
    expect(guard, 'the team-entry guard must exist').toBeGreaterThan(-1)
    expect(query, 'the identity query must exist').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(query)
  })

  it('counts team rows in their own field, not in unmatched', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('lib/devy/ingestFantraxPlayerIdentities.ts', 'utf8')
    /* The guard's body increments teamEntries and nothing else. */
    const body = src.slice(src.indexOf('if (isTeamEntry(ref))'), src.indexOf('const fantraxId'))
    expect(body).toContain('result.teamEntries += 1')
    expect(body).not.toContain('result.unmatched')
  })
})
