/**
 * Provider duplication in SportsGame, and the standings feed that could not answer.
 *
 * BOTH GUARD MEASURED PRODUCTION FACTS, not hypotheticals.
 *
 *   DUPLICATION — NFL season 2026 week 1 held 64 rows for 16 real games. Houston Texans vs
 *   Buffalo Bills existed three times: espn `401872660`, rolling_insights `20260913-1-25`,
 *   thesportsdb `2475383`, all with startTime 2026-09-13T21:00:00Z. `SportsGame` is unique on
 *   (sport, externalId, source), so that is by design — the bug is that 44 of the 45 modules
 *   reading the table never collapsed them.
 *
 *   STANDINGS — every `*:standings:*` row in SportsDataCache was 2025-season, written
 *   2026-04-25, expired 2026-07-24. The job ran every four hours and reported ok:true each time,
 *   because API-Sports' Free plan answers current-season requests with
 *   "Free plans do not have access to this season".
 */
import { describe, expect, it } from 'vitest'

import { dedupeGamesByFixture, gameSourceRank } from '@/lib/sports/dedupeGames'

const KICKOFF = new Date('2026-09-13T21:00:00.000Z')

/** The real row set, as it exists in production. */
function texansBills() {
  return [
    { homeTeam: 'Houston Texans', awayTeam: 'Buffalo Bills', startTime: KICKOFF, week: 1, season: 2026, source: 'espn' },
    { homeTeam: 'Houston Texans', awayTeam: 'Buffalo Bills', startTime: KICKOFF, week: 1, season: 2026, source: 'rolling_insights' },
    { homeTeam: 'Houston Texans', awayTeam: 'Buffalo Bills', startTime: KICKOFF, week: 1, season: 2026, source: 'thesportsdb' },
  ]
}

describe('dedupeGamesByFixture', () => {
  it('collapses the three real provider rows for one fixture into one', () => {
    const r = dedupeGamesByFixture(texansBills())
    expect(r.games).toHaveLength(1)
    expect(r.collapsed).toBe(2)
    expect(r.unkeyed).toBe(0)
  })

  /*
   * ⚠ EVERY PRIORITY CASE IS ASSERTED IN BOTH ORDERS, AND THAT IS NOT PEDANTRY.
   *
   * The first draft of these tests put the expected winner LAST in every array. A positive
   * control that replaced the whole comparison with "last row wins" therefore passed all three —
   * the assertions agreed with a completely broken implementation by coincidence. Testing one
   * order proves the winner is the winner OR that it happened to be last, and cannot distinguish
   * them. Both orders can only be satisfied by real ranking.
   */
  function winnerFor(a: string, b: string): [string, string] {
    const rows = [
      { ...texansBills()[0]!, source: a },
      { ...texansBills()[0]!, source: b },
    ]
    const forward = dedupeGamesByFixture(rows).games[0]!.source
    const reversed = dedupeGamesByFixture([rows[1]!, rows[0]!]).games[0]!.source
    return [forward, reversed]
  }

  it('keeps the highest-priority source whichever order it arrives in', () => {
    expect(winnerFor('espn', 'thesportsdb')).toEqual(['espn', 'espn'])
    expect(winnerFor('espn', 'rolling_insights')).toEqual(['espn', 'espn'])
    expect(winnerFor('rolling_insights', 'thesportsdb')).toEqual(['rolling_insights', 'rolling_insights'])
  })

  it('prefers a live feed over a schedule feed when they disagree', () => {
    // The reason priority exists: the source polling the game beats one that published in July.
    expect(winnerFor('espn_live', 'rolling_insights')).toEqual(['espn_live', 'espn_live'])
    expect(winnerFor('espn_live', 'espn')).toEqual(['espn_live', 'espn_live'])
  })

  it('sorts an unknown source LAST rather than letting it win by accident', () => {
    // A provider added upstream must not silently outrank the ones whose behaviour is understood.
    expect(gameSourceRank('some_new_vendor')).toBeGreaterThan(gameSourceRank('thesportsdb'))
    expect(winnerFor('some_new_vendor', 'thesportsdb')).toEqual(['thesportsdb', 'thesportsdb'])
    expect(winnerFor('some_new_vendor', 'espn_live')).toEqual(['espn_live', 'espn_live'])
  })

  it('keeps the winner out of all three real providers in every arrival order', () => {
    const [a, b, c] = texansBills() as [any, any, any]
    for (const order of [[a, b, c], [c, b, a], [b, c, a], [b, a, c], [c, a, b], [a, c, b]]) {
      expect(dedupeGamesByFixture(order).games[0]!.source).toBe('espn')
    }
  })

  it('does not collapse two genuinely different fixtures', () => {
    const rows = [
      ...texansBills(),
      { homeTeam: 'Detroit Lions', awayTeam: 'New Orleans Saints', startTime: KICKOFF, week: 1, season: 2026, source: 'espn' },
    ]
    expect(dedupeGamesByFixture(rows).games).toHaveLength(2)
  })

  it('collapses rows whose kickoff differs by minutes', () => {
    // Sources disagree on kickoff by minutes; the key is the calendar day for exactly this reason.
    const rows = [
      { ...texansBills()[0]!, startTime: new Date('2026-09-13T21:00:00.000Z') },
      { ...texansBills()[1]!, startTime: new Date('2026-09-13T21:05:00.000Z') },
    ]
    expect(dedupeGamesByFixture(rows).games).toHaveLength(1)
  })

  it('PASSES THROUGH rows it cannot key instead of dropping them', () => {
    /*
     * The single most important case. `nflFixtureKey` resolves NFL teams only, so a college slate
     * keys to nothing. Dropping those would delete an entire NCAAF schedule silently — far worse
     * than the duplication being fixed. They come back untouched and are COUNTED, so a caller can
     * tell "nothing to collapse" from "I could not read these".
     */
    const college = [
      { homeTeam: 'Rice Owls', awayTeam: 'Texas Longhorns', startTime: KICKOFF, week: 1, season: 2026, source: 'espn' },
      { homeTeam: 'Florida Gators', awayTeam: 'Miami Hurricanes', startTime: KICKOFF, week: 1, season: 2026, source: 'espn' },
    ]
    const r = dedupeGamesByFixture(college)
    expect(r.games).toHaveLength(2)
    expect(r.unkeyed).toBe(2)
    expect(r.collapsed).toBe(0)
  })

  it('handles a mixed NFL + college slate without losing either', () => {
    const rows = [
      ...texansBills(),
      { homeTeam: 'Rice Owls', awayTeam: 'Texas Longhorns', startTime: KICKOFF, week: 1, season: 2026, source: 'espn' },
    ]
    const r = dedupeGamesByFixture(rows)
    expect(r.games).toHaveLength(2) // 1 collapsed NFL + 1 passed-through college
    expect(r.unkeyed).toBe(1)
  })

  it('is a no-op on an empty slate', () => {
    const r = dedupeGamesByFixture([])
    expect(r).toEqual({ games: [], collapsed: 0, unkeyed: 0 })
  })
})

describe('espn standings module contract', () => {
  it('advertises the two football codes and refuses the rest', async () => {
    // Imported lazily: the module is `server-only`, so a top-level import breaks the whole file.
    const { espnHasStandings } = await import('@/lib/standings/espnStandings')
    expect(espnHasStandings('NFL')).toBe(true)
    expect(espnHasStandings('ncaaf')).toBe(true)
    expect(espnHasStandings('NBA')).toBe(false)
    expect(espnHasStandings('')).toBe(false)
  })
})
