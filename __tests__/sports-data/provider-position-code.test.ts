import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isLongFormPosition,
  POSITION_CODE_TABLES_FOR_TEST,
  providerPositionCode,
} from '@/lib/sports-data/providerPositionCode'
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

  it('folds the HYPHENATED fullback, which the first pass missed', () => {
    /*
     * `Full-back` survived the 2026-09-06 backfill because the table held only `FULLBACK`.
     * 7 production rows, all NFL, all genuine football fullbacks — Kyle Juszczyk, Patrick
     * Ricard, Reggie Gilliam, Robbie Ouzts, Ben VanSumeren, Lucas Scott, Nikola Kalinic.
     *
     * ⚠ CHECKED BEFORE MAPPING: `Full-back` is also the standard SOCCER term for a defender,
     * so this is the MLB `Center` trap in a new costume. It appears in no other sport in the
     * column, which is why folding it cannot mislabel anyone.
     */
    expect(providerPositionCode('Full-back', 'NFL')).toBe('FB')
    expect(providerPositionCode('FULL-BACK', 'NFL')).toBe('FB')
    expect(providerPositionCode('  full-back ', 'NFL')).toBe('FB')
    // The unhyphenated spelling keeps working — this ADDS a variant, it does not move one.
    expect(providerPositionCode('Fullback', 'NFL')).toBe('FB')
  })

  it('[control] an UNMAPPED hyphenated value still passes through untouched', () => {
    /*
     * Pins the shape of the fix. `Co-Driver` is the one other hyphenated value football
     * stores — a motorsport row — and it must keep coming back verbatim. A future
     * "simplification" that folds on hyphen structure rather than on a named key has to
     * keep this true.
     */
    expect(providerPositionCode('Co-Driver', 'NFL')).toBe('Co-Driver')
    expect(providerPositionCode('Half-back', 'NFL')).toBe('Half-back')
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
    /*
     * ⚠ PER SPORT, AND CHECKED AGAINST THE REAL MAPPING RATHER THAN THE SOURCE TEXT. This used
     * to regex-scrape the file for `: 'XX',` and compare every hit against the NFL code set.
     * That worked while there was one table; the moment NBA/NHL/MLB tables existed it began
     * checking `1B` and `LW` against football codes and failed for the wrong reason.
     *
     * Each list below was counted on production for THAT sport.
     */
    const STORED: Record<string, Set<string>> = {
      NFL: new Set([
        'WR', 'LB', 'DB', 'RB', 'CB', 'TE', 'DE', 'DT', 'OT', 'DL', 'QB', 'OL', 'G', 'C',
        'OG', 'K', 'OLB', 'P', 'T', 'S', 'LS', 'SS', 'FB', 'FS', 'ILB', 'NT',
      ]),
      // NBA: SG 400 · PG 383 · PF 380 · SF 294 · C 292 · G 61 · F 20 · FC 2
      NBA: new Set(['SG', 'PG', 'PF', 'SF', 'C', 'G', 'F', 'FC']),
      // NHL: D 1334 · C 991 · LW 685 · RW 634 · G 471
      NHL: new Set(['D', 'C', 'LW', 'RW', 'G']),
      // MLB: P 3375 · C 627 · SS 593 · 2B 444 · CF 400 · OF 395 · 3B 384 · 1B 372 · LF 323 ·
      //      RF 304 · DH 52 · IF 47
      MLB: new Set(['P', 'C', 'SS', '2B', 'CF', 'OF', '3B', '1B', 'LF', 'RF', 'DH', 'IF']),
    }
    STORED.NCAAF = STORED.NFL!

    let checked = 0
    for (const [sport, table] of Object.entries(POSITION_CODE_TABLES_FOR_TEST)) {
      const stored = STORED[sport]
      expect(stored, `no measured code set for ${sport}`).toBeTruthy()
      const invented = [...new Set(Object.values(table))].filter((t) => !stored!.has(t))
      expect(invented, `${sport} folds to codes nothing else stores`).toEqual([])
      checked += Object.keys(table).length
    }
    // Control: the loop must have actually examined mappings, not iterated an empty object.
    expect(checked).toBeGreaterThan(60)
  })
})

describe('🛑 the table is FOOTBALL-ONLY, because the same word means different positions', () => {
  /*
   * Caught on production BEFORE shipping, by asking what each sport already stores rather
   * than assuming English words transfer. The first version of this module took one argument
   * and would have run on every sport.
   */

  it('🛑 ONE WORD, THREE ANSWERS — this is why the tables are per-sport', () => {
    /*
     * The assertion that would have caught the original hazard, now stated positively. These
     * three cannot be served by one shared table, and any future "simplification" that merges
     * them reintroduces the exact corruption this module was written to prevent:
     *
     *     MLB  "Center"  is a centre FIELDER  -> CF   (C is the catcher, 627 rows)
     *     NBA  "Center"                       -> C
     *     NHL  "Center"                       -> C
     *     NFL  "Center"  is an offensive lineman -> C
     *
     * ⚠ THIS TEST PREVIOUSLY ASSERTED THAT MLB "Center" WAS NOT FOLDED AT ALL. That was the
     * right call while there was only a football table — the available target was `C`, and
     * folding to it would have relabelled outfielders as catchers. With an MLB table the
     * correct target exists, so the SAFETY PROPERTY is unchanged and only the mechanism moved:
     * MLB "Center" still never becomes `C`.
     */
    expect(providerPositionCode('Center', 'MLB')).toBe('CF')
    expect(providerPositionCode('Center', 'MLB')).not.toBe('C')
    expect(providerPositionCode('Center', 'NBA')).toBe('C')
    expect(providerPositionCode('Center', 'NHL')).toBe('C')
    expect(providerPositionCode('Center', 'NFL')).toBe('C')
  })

  it('🛑 NBA "Guard" folds to G — RE-MEASURED, because the old premise expired', () => {
    /*
     * This test used to assert `Guard` was NOT folded, on the stated grounds that "NBA has no
     * plain G, it stores PG and SG". That was true when measured and is no longer: production
     * 2026-09-06 carries NBA `G` (61 rows) and `F` (20), both from rolling_insights. So the
     * target exists and no third vocabulary is created.
     *
     * ⚠ Recorded rather than quietly flipped, because "the reason a rule existed has expired"
     * is a different justification from "the rule was wrong", and only the first one licenses
     * changing it.
     */
    expect(providerPositionCode('Guard', 'NBA')).toBe('G')
    expect(providerPositionCode('Forward', 'NBA')).toBe('F')
    expect(providerPositionCode('Guard', 'NFL')).toBe('G')
  })

  it('🛑 NHL wingers and forwards are STILL not folded — the target is unknowable', () => {
    /*
     * `Winger` and `Wing` do not say WHICH side, so folding to LW or RW would invent the
     * information. And NHL stores no `F` at all, so `Forward` (105 rows) has nowhere to land —
     * folding it would create the third vocabulary this module exists to prevent.
     *
     * These are the cases that separate "unify a spelling" from "guess a value".
     */
    expect(providerPositionCode('Winger', 'NHL')).toBe('Winger')
    expect(providerPositionCode('Wing', 'NHL')).toBe('Wing')
    expect(providerPositionCode('Forward', 'NHL')).toBe('Forward')
    // The ones that DO say which side are folded.
    expect(providerPositionCode('Left Wing', 'NHL')).toBe('LW')
    expect(providerPositionCode('Right Winger', 'NHL')).toBe('RW')
  })

  it('🛑 MLB starting/relief pitchers are NOT folded — P would destroy the role', () => {
    /*
     * MLB stores no SP or RP, so the only available target is `P`. That unifies the query and
     * DISCARDS the distinction on 111 rows. Losing information is not the same as unifying a
     * spelling, and this module only does the latter.
     */
    expect(providerPositionCode('Starting Pitcher', 'MLB')).toBe('Starting Pitcher')
    expect(providerPositionCode('Relief Pitcher', 'MLB')).toBe('Relief Pitcher')
    expect(providerPositionCode('Pitcher', 'MLB')).toBe('P')
  })

  it('⚠ a sport with NO table folds nothing — the gate is structural', () => {
    // SOCCER carries three vocabularies and granular roles; folding Centre-Back to DEF would
    // DESTROY information rather than unify it. NCAAB needs nothing: 6 long-form rows.
    expect(providerPositionCode('Centre-Back', 'SOCCER')).toBe('Centre-Back')
    expect(providerPositionCode('Central Midfield', 'SOCCER')).toBe('Central Midfield')
    expect(providerPositionCode('Point Guard', 'NCAAB')).toBe('Point Guard')
  })

  it('⚠ non-players are never folded, in any sport', () => {
    for (const sport of ['NBA', 'NHL', 'MLB', 'NFL']) {
      expect(providerPositionCode('Assistant Coach', sport)).toBe('Assistant Coach')
    }
    expect(providerPositionCode('General Manager', 'NBA')).toBe('General Manager')
    expect(providerPositionCode('Owner', 'NBA')).toBe('Owner')
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
