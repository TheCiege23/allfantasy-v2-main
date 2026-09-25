// @vitest-environment node
/**
 * A re-import must not overwrite a league's format with "we could not tell".
 *
 * `League.leagueType` is `@default("redraft")` and the normalizer ALSO returns `'redraft'`
 * when every signal comes up empty, so the column cannot distinguish a classification from a
 * shrug. On a first import that is harmless; on an update it destroys whatever the previous
 * run — or a human — established.
 *
 * The case that produced this: "🪓 Elimination Station 2", a guillotine league (18 matchup
 * groups of one, `avg(pointsAgainst) = 0.00`) whose name contains neither "guillotine" nor
 * "survivor", so `heuristicConceptFromSignals` returns null.
 */
import { describe, expect, it } from 'vitest'

import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { leagueTypeForUpdate } from '@/lib/league-import/leagueTypeWrite'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function normalized(league: Record<string, unknown> = {}): NormalizedImportResult {
  return {
    source: { source_provider: 'sleeper', source_league_id: 'abc', imported_at: new Date().toISOString() },
    league: {
      name: 'Test League',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 16,
      scoring: 'half ppr',
      isDynasty: false,
      ...league,
    },
    rosters: [],
    scoring: { scoring_format: 'half ppr', rules: [] },
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: { state: 'full' },
      currentRosters: { state: 'full' },
      historicalRosterSnapshots: { state: 'missing' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'partial' },
      currentStandings: { state: 'full' },
      currentSchedule: { state: 'full' },
      draftHistory: { state: 'missing' },
      tradeHistory: { state: 'missing' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'full' },
    },
  } as never
}

const confidenceOf = (league: Record<string, unknown>) =>
  buildCanonicalImportBundle(normalized(league)).leagueTypeConfident

describe('leagueTypeConfident — does the concept rest on anything?', () => {
  /*
   * 🛑 THE MEASURED CASE. No `league_type` from Sleeper, not dynasty, not best ball, and a
   * name that matches no pattern. `'redraft'` here is the absence of evidence.
   */
  it('is false for a name the heuristic cannot read, with nothing else to go on', () => {
    expect(confidenceOf({ name: '🪓 Elimination Station 2' })).toBe(false)
    expect(confidenceOf({ name: 'Chop or Be Chopped' })).toBe(false)
  })

  it('is true when the source reports a type itself', () => {
    expect(confidenceOf({ name: 'Anything At All', league_type: 'redraft' })).toBe(true)
  })

  it('is true when a name signal matches', () => {
    expect(confidenceOf({ name: 'Gridiron Guillotine' })).toBe(true)
    expect(confidenceOf({ name: 'Survivor Classic' })).toBe(true)
  })

  it('is true when the league is dynasty or best ball, which are read off the data', () => {
    expect(confidenceOf({ name: 'No Signal Here', isDynasty: true })).toBe(true)
    expect(confidenceOf({ name: 'No Signal Here', scoring: 'best ball ppr' })).toBe(true)
  })

  /*
   * ⚠ EASY TO MISS BECAUSE THE SOURCE DID SPEAK. It named a concept we do not model, so the
   * `redraft` that results is our shrug rather than its answer — the normalizer's own warning
   * says "mapped to redraft for import; confirm in League Settings".
   */
  it('is false when the source names a concept we cannot map', () => {
    expect(confidenceOf({ name: 'Weird One', league_type: 'not_a_real_concept_xyz' })).toBe(false)
  })
})

describe('leagueTypeForUpdate — what actually reaches the column', () => {
  it('writes the fallback on a FIRST import, where there is nothing to lose', () => {
    expect(
      leagueTypeForUpdate({ existing: false, leagueTypeColumn: 'redraft', leagueTypeConfident: false }),
    ).toBe('redraft')
  })

  /*
   * 🛑 THE WHOLE POINT. Prisma omits an `undefined` key, so this leaves the stored value
   * alone rather than overwriting it — with the fallback OR with null.
   */
  it('refuses to overwrite an existing league with an unconfident value', () => {
    expect(
      leagueTypeForUpdate({ existing: true, leagueTypeColumn: 'redraft', leagueTypeConfident: false }),
    ).toBeUndefined()
  })

  it('still writes a confident value to an existing league', () => {
    expect(
      leagueTypeForUpdate({ existing: true, leagueTypeColumn: 'guillotine', leagueTypeConfident: true }),
    ).toBe('guillotine')
  })

  /*
   * ⚠ A CALLER THAT HAS NOT BEEN UPDATED MUST NOT KEEP OVERWRITING. Missing confidence reads
   * as unconfident, because that is the safe direction — and it costs nothing on a first
   * import, where the value is written regardless.
   */
  it('treats missing confidence as unconfident, but only for an existing league', () => {
    expect(
      leagueTypeForUpdate({ existing: true, leagueTypeColumn: 'redraft', leagueTypeConfident: undefined }),
    ).toBeUndefined()
    expect(
      leagueTypeForUpdate({ existing: false, leagueTypeColumn: 'redraft', leagueTypeConfident: undefined }),
    ).toBe('redraft')
  })

  /*
   * 🛑 A PERSON'S ANSWER OUTRANKS A CONFIDENT IMPORT (2026-09-25). Sleeper's `type: 2` is always
   * confident, so a re-sync rewrote a league someone had confirmed as `zombie` back to `dynasty`.
   */
  it('never overwrites a league whose type a person confirmed — confident or not', () => {
    const confirmed = { leagueTypeConfirmation: { type: 'zombie', confirmedByUserId: 'u1' } }
    expect(
      leagueTypeForUpdate({ existing: true, leagueTypeColumn: 'dynasty', leagueTypeConfident: true, existingSettings: confirmed }),
    ).toBeUndefined()
    // [control] the same confident write goes through when nobody confirmed anything.
    expect(
      leagueTypeForUpdate({ existing: true, leagueTypeColumn: 'dynasty', leagueTypeConfident: true, existingSettings: {} }),
    ).toBe('dynasty')
    // A confirmation that is not a known concept is not a confirmation.
    expect(
      leagueTypeForUpdate({
        existing: true,
        leagueTypeColumn: 'dynasty',
        leagueTypeConfident: true,
        existingSettings: { leagueTypeConfirmation: { type: 'nonsense' } },
      }),
    ).toBe('dynasty')
  })

  it('writes nothing when there is no column value at all', () => {
    expect(
      leagueTypeForUpdate({ existing: false, leagueTypeColumn: null, leagueTypeConfident: true }),
    ).toBeUndefined()
    expect(
      leagueTypeForUpdate({ existing: false, leagueTypeColumn: '  ', leagueTypeConfident: true }),
    ).toBeUndefined()
  })
})

describe('end to end — the Elimination Station case', () => {
  it('a re-sync of that league leaves its corrected leagueType alone', () => {
    const bundle = buildCanonicalImportBundle(normalized({ name: '🪓 Elimination Station 2' }))

    // The normalizer still proposes the fallback — that part is unchanged and expected.
    expect(bundle.leagueTypeColumn).toBe('redraft')
    expect(bundle.leagueTypeConfident).toBe(false)

    // …and the write is refused, so a stored 'guillotine' survives the sync.
    expect(
      leagueTypeForUpdate({
        existing: true,
        leagueTypeColumn: bundle.leagueTypeColumn,
        leagueTypeConfident: bundle.leagueTypeConfident,
      }),
    ).toBeUndefined()
  })
})
