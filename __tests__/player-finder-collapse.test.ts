import { describe, expect, it } from 'vitest'

import { asHeadshotUrl } from '@/lib/core-app/playerIdentityCompose'
import { normalizePosition } from '@/lib/core-app/positionNormalization'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/*
 * The duplicate collapse behind /core/players.
 *
 * `searchPlayers` is one prisma query and an in-memory fold; the fold is what
 * these tests pin, replicated here against the SAME helpers the module uses so
 * a change to either shows up. What is asserted is the two properties the fix
 * added, both of which were measured on production before being written.
 *
 * ⚠ THE MEASUREMENT ONLY WORKS WITH THE MODULE'S OWN NORMALISERS, and that is
 * worth recording because it nearly ended the investigation. Grouping by a
 * plain upper-cased position and team reports 407 multi-row NFL groups and ZERO
 * recoverable headshots — "leave it alone". Grouping by `normalizePosition` and
 * the module's `teamKey`, as the real code does, reports 1,821 and 126. The
 * folding is what puts a player's vendor rows in the same group at all.
 */

/** `teamKey`, copied from playerFinder.ts — it is not exported. */
function teamKey(raw: string | null): string {
  if (!raw) return ''
  const t = raw.trim().toUpperCase()
  if (t.length <= 4) return t
  const folded = normalizeTeamAbbrev(t)
  if (folded && folded.length <= 4) return folded
  return t.split(/\s+/).slice(-1)[0] ?? t
}

type Row = {
  externalId: string
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
}

/** The fold, as `searchPlayers` performs it. */
function collapse(rows: Row[]): Array<{ row: Row; imageUrl: string | null }> {
  const seen = new Map<string, { row: Row; imageUrl: string | null }>()
  for (const r of rows) {
    const key = `${r.name.trim().toLowerCase()}|${normalizePosition(r.position)}|${teamKey(r.team)}`
    const image = asHeadshotUrl(r.imageUrl)
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, { row: r, imageUrl: image })
      continue
    }
    existing.imageUrl ??= image
    const better =
      (r.sleeperId ? 2 : 0) + (image ? 1 : 0) >
      (existing.row.sleeperId ? 2 : 0) + (asHeadshotUrl(existing.row.imageUrl) ? 1 : 0)
    if (better) existing.row = r
  }
  return [...seen.values()]
}

/*
 * Aaron Rodgers as production actually holds him: the row carrying the Sleeper
 * id stores a BARE FILENAME, and the row with a real CDN URL has no id. Under
 * the old score the first wins on identity and takes its unusable image with
 * it, discarding the second's.
 */
const RODGERS_WITH_ID: Row = {
  externalId: 'ri-3416',
  sleeperId: '96',
  name: 'Aaron Rodgers',
  position: 'QB',
  team: 'Pittsburgh Steelers',
  imageUrl: '2c42f60e-0138-5f33-93b0-b70da5f3d9a6.png',
}
const RODGERS_WITH_FACE: Row = {
  externalId: 'tsdb-1',
  sleeperId: null,
  name: 'Aaron Rodgers',
  position: 'Quarterback',
  team: 'PIT',
  imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/qyxkqi.png',
}

describe('player finder collapse', () => {
  /* The normalisers are what make these one player rather than two results. */
  it('folds a long position and a long club into one entry', () => {
    expect(collapse([RODGERS_WITH_ID, RODGERS_WITH_FACE])).toHaveLength(1)
  })

  /*
   * ⚠ THE RECOVERY. 126 of 22,239 NFL groups are exactly this shape.
   * The identity comes from the row with the Sleeper id; the face comes from
   * the row that has one. They no longer have to be the same row.
   */
  it('keeps the identity from one row and the headshot from another', () => {
    for (const rows of [
      [RODGERS_WITH_ID, RODGERS_WITH_FACE],
      [RODGERS_WITH_FACE, RODGERS_WITH_ID],
    ]) {
      const [got] = collapse(rows)
      expect(got.row.sleeperId, 'identity').toBe('96')
      expect(got.imageUrl, 'face').toBe(
        'https://r2.thesportsdb.com/images/media/player/cutout/qyxkqi.png',
      )
    }
  })

  /*
   * A bare filename is not a headshot. It resolves against the current route
   * and 404s — the component recovers with `onError`, but the user still sees a
   * faceless player and pays for a failed request.
   */
  it('reports no headshot at all when every row holds a bare filename', () => {
    const [got] = collapse([RODGERS_WITH_ID])
    expect(got.imageUrl).toBeNull()
    expect(got.row.sleeperId).toBe('96')
  })

  /*
   * ⚠ THE SCORE STILL PREFERS AN IDENTIFIED ROW, which is the property the
   * original weighting existed for — a row with a Sleeper id is the one that
   * can be cross-referenced to a roster, a projection or a value. Composing the
   * face must not quietly change which row wins.
   */
  it('still prefers the row carrying a sleeper id', () => {
    const [got] = collapse([RODGERS_WITH_FACE, RODGERS_WITH_ID])
    expect(got.row.externalId).toBe('ri-3416')
  })

  it('leaves a single-row player exactly as it found them', () => {
    const [got] = collapse([RODGERS_WITH_FACE])
    expect(got.row.externalId).toBe('tsdb-1')
    expect(got.imageUrl).toBe(RODGERS_WITH_FACE.imageUrl)
  })

  /*
   * ⚠ THE CLUB HALF OF THE KEY DID NOT FOLD, AND THAT IS THE BIGGER OF THE TWO
   * BUGS. `normalizePosition` folds "Quarterback" to "QB"; the club rule took
   * the LAST WORD, so "PIT" keyed as PIT and "Pittsburgh Steelers" keyed as
   * STEELERS and the same player came back as two rows in the search list.
   * Measured: 2,170 NFL players split that way on production.
   */
  it('folds an abbreviation against the full club name', () => {
    expect(teamKey('Pittsburgh Steelers')).toBe('PIT')
    expect(teamKey('PIT')).toBe('PIT')
    expect(teamKey('Washington Commanders')).toBe('WAS')
  })

  /*
   * ⚠ AND IT MUST NOT REGRESS A SPORT THE NFL TABLE DOES NOT KNOW.
   * `normalizeTeamAbbrev` passes an unknown club through UPPER-CASED, so
   * folding unconditionally would key "Hawks" as HAWKS and "Atlanta Hawks" as
   * ATLANTA HAWKS — splitting a pair the last-word rule merges today.
   * `searchPlayers` is not scoped to a sport, so both reach this function.
   */
  it('falls back to the last word when the NFL fold does not resolve', () => {
    expect(teamKey('Atlanta Hawks')).toBe('HAWKS')
    expect(teamKey('Hawks')).toBe('HAWKS')
  })

  /* Two genuinely different players must not fold together. */
  it('does not merge different players who share a name', () => {
    const qb: Row = { externalId: 'a', sleeperId: '1', name: 'Josh Allen', position: 'QB', team: 'BUF', imageUrl: null }
    const lb: Row = { externalId: 'b', sleeperId: '2', name: 'Josh Allen', position: 'LB', team: 'JAX', imageUrl: null }
    expect(collapse([qb, lb])).toHaveLength(2)
  })
})
