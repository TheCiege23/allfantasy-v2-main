import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { providerPositionCode, isLongFormPosition } from '@/lib/sports-data/providerPositionCode'
import { foldLongPosition } from '@/lib/core-app/positionLabels'

/**
 * 🛑 `SportsPlayer.position` CARRIED TWO VOCABULARIES AT ONCE, BOTH BEING WRITTEN DAILY.
 * Measured on production 2026-09-06:
 *
 *     thesportsdb        143 short   2,081 long    newest 2026-09-04
 *     sleeper         11,718 short     242 long    newest 2026-09-04
 *     rolling_insights 9,521 short      40 long    newest 2026-09-04
 *
 * TheSportsDB emits display names ("Wide Receiver"), the others emit codes. So
 * `position in ('QB','RB','WR','TE')` — an entirely ordinary filter — silently dropped ~40%
 * of NFL players, and 265 of the long-form rows carry a value snapshot, putting them inside
 * the trade-grading population.
 */
describe('provider positions fold to the code the rest of the table already uses', () => {
  it('folds the display names TheSportsDB actually sends', () => {
    // The four highest-volume long forms measured in production.
    expect(providerPositionCode('Wide Receiver', 'NFL')).toBe('WR')   // 414 rows
    expect(providerPositionCode('Offensive Tackle', 'NFL')).toBe('OT') // 273
    expect(providerPositionCode('Running Back', 'NFL')).toBe('RB')     // 216
    expect(providerPositionCode('Tight End', 'NFL')).toBe('TE')        // 215
  })

  it('is case- and whitespace-insensitive, because a provider string is not curated', () => {
    expect(providerPositionCode('  wide receiver ', 'NFL')).toBe('WR')
    expect(providerPositionCode('QUARTERBACK', 'NFL')).toBe('QB')
  })

  it('🛑 leaves an already-short code untouched — safe to apply to any source', () => {
    /*
     * The fold runs on every ingested row, including sources that already emit codes.
     * Rewriting those would be the same defect pointed the other way.
     */
    for (const code of ['WR', 'CB', 'DE', 'OT', 'LS', 'FB']) {
      expect(providerPositionCode(code, 'NFL')).toBe(code)
    }
  })

  it('⚠ returns an UNRECOGNISED value unchanged rather than dropping or guessing it', () => {
    /*
     * A player stored with an odd position is findable. A player stored with null is
     * invisible to every position query, which is strictly worse than being odd.
     */
    expect(providerPositionCode('Wingback', 'NFL')).toBe('Wingback')
    expect(providerPositionCode('', 'NFL')).toBeNull()
    expect(providerPositionCode(null, 'NFL')).toBeNull()
    expect(providerPositionCode(undefined, 'NFL')).toBeNull()
  })

  it('🛑 KEEPS IDP SPECIFICITY — this is the whole reason it is not foldLongPosition', () => {
    /*
     * lib/core-app/positionLabels.foldLongPosition answers a DIFFERENT question — what to
     * label a lineup SLOT — and folds toward groupings. Using it here would swap one split
     * for another: Sleeper stores CB (1,525), S (255) and DE (1,051) as distinct codes, so
     * folding TheSportsDB's "Cornerback" to "DB" would destroy specificity the other
     * providers preserve. The IDP curve is about ORDERING within a position.
     */
    expect(providerPositionCode('Cornerback', 'NFL')).toBe('CB')
    expect(foldLongPosition('Cornerback')).toBe('DB')

    expect(providerPositionCode('Safety', 'NFL')).toBe('S')
    expect(foldLongPosition('Safety')).toBe('DB')

    expect(providerPositionCode('Defensive End', 'NFL')).toBe('DE')
    expect(foldLongPosition('Defensive End')).toBe('DL')
  })

  it('[control] the two modules genuinely disagree — this suite is not comparing a thing to itself', () => {
    /*
     * Without this, the assertions above would still pass if someone made
     * providerPositionCode delegate to foldLongPosition, which is exactly the "collapse the
     * duplicate" refactor that looks tidy and reintroduces the bug.
     */
    const differ = ['Cornerback', 'Safety', 'Defensive End', 'Defensive Tackle', 'Guard', 'Center']
      .filter((p) => providerPositionCode(p, 'NFL') !== foldLongPosition(p))
    expect(differ).toHaveLength(6)
  })

  it('isLongFormPosition identifies exactly what the table can fold', () => {
    expect(isLongFormPosition('Wide Receiver', 'NFL')).toBe(true)
    expect(isLongFormPosition('WR', 'NFL')).toBe(false)
    expect(isLongFormPosition(null, 'NFL')).toBe(false)
  })

  it('🛑 every target code is one another provider ALREADY stores — no third vocabulary', () => {
    /*
     * The point of the fold is to join the existing population. A mapping to a code nobody
     * else writes would leave the column split three ways instead of two. This list was
     * counted on production across sleeper + rolling_insights for NFL.
     */
    const STORED = new Set([
      'WR', 'LB', 'DB', 'RB', 'CB', 'TE', 'DE', 'DT', 'OT', 'DL', 'QB', 'OL', 'G', 'C',
      'OG', 'K', 'OLB', 'P', 'T', 'S', 'LS', 'SS', 'FB', 'FS', 'ILB', 'NT',
    ])
    const src = readFileSync(resolve(process.cwd(), 'lib/sports-data/providerPositionCode.ts'), 'utf8')
    const targets = [...src.matchAll(/:\s*'([A-Z]{1,3})',/g)].map((m) => m[1]!)
    expect(targets.length).toBeGreaterThan(20)
    expect(targets.filter((t) => !STORED.has(t))).toEqual([])
  })
})

describe('🛑 the table is FOOTBALL-ONLY, because the same word means different positions', () => {
  /*
   * Caught on production BEFORE shipping, by asking what each sport already stores rather
   * than assuming English words transfer. The first version of this module took one argument
   * and would have run on every sport.
   */

  it('🛑 MLB "Center" is NOT folded — C means CATCHER there', () => {
    /*
     * The one that would have corrupted data. MLB stores C = catcher (627 rows on
     * production) and has 2 players stored as "Center", meaning centre FIELDER. Folding
     * them to C relabels two outfielders as catchers: a wrong value that looks completely
     * valid and would never be questioned.
     */
    expect(providerPositionCode('Center', 'MLB')).toBe('Center')
    expect(providerPositionCode('Center', 'NFL')).toBe('C')
  })

  it('🛑 NBA "Guard" is NOT folded — NBA has no plain G, it stores PG and SG', () => {
    // Folding to `G` would invent a THIRD vocabulary in the column this exists to unify.
    expect(providerPositionCode('Guard', 'NBA')).toBe('Guard')
    expect(providerPositionCode('Guard', 'NFL')).toBe('G')
  })

  it('⚠ NHL "Center" is left alone even though C would happen to be right there', () => {
    /*
     * 269 NHL rows. C IS the NHL code, so folding would be correct — and it is still not
     * done, because "right by coincidence in two sports" is what made the MLB case look
     * safe. One sport's column staying slightly split is cheaper than a confidently wrong
     * value in another.
     */
    expect(providerPositionCode('Center', 'NHL')).toBe('Center')
  })

  it('NCAAF IS folded — it is football and shares the NFL code set', () => {
    expect(providerPositionCode('Quarterback', 'NCAAF')).toBe('QB')
    expect(providerPositionCode('Cornerback', 'NCAAF')).toBe('CB')
  })

  it('a missing or unknown sport folds nothing', () => {
    expect(providerPositionCode('Wide Receiver', null)).toBe('Wide Receiver')
    expect(providerPositionCode('Wide Receiver', 'SOCCER')).toBe('Wide Receiver')
    expect(isLongFormPosition('Wide Receiver', 'MLB')).toBe(false)
  })
})

describe('the ingest applies it at the boundary', () => {
  const INGEST = readFileSync(resolve(process.cwd(), 'lib/sports-data/theSportsDbIngest.ts'), 'utf8')

  it('🛑 folds strPosition rather than storing it verbatim, and passes the SPORT', () => {
    /*
     * The single line this whole fix turns on. `position: str(p.strPosition)` is what put
     * 2,081 players into the second vocabulary. The sport argument is not optional here:
     * this ingest runs for all seven sports, so without it the football table would reach
     * MLB and NBA rows.
     */
    expect(INGEST).toContain('position: providerPositionCode(str(p.strPosition), sport)')
    expect(INGEST).not.toMatch(/position:\s*str\(p\.strPosition\),/)
  })

  it('[control] the scan is reading the right file', () => {
    expect(INGEST).toContain('sportsPlayer.upsert')
    expect(INGEST).toContain('strPosition')
  })
})
