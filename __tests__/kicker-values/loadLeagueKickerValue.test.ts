/**
 * Reading a league's kicker rulebook out of the database, whatever shape it is stored in.
 *
 * Two schemas exist in production and they share no keys. Imported (Sleeper) leagues carry an
 * ARRAY of position strings; AF-native leagues carry a SLOT MAP with counts. Measured
 * 2026-08-29 across 115 production leagues: 73 array, 24 native slot map, 18 seed rows with
 * null settings. Reading only the array shape left 14 real leagues that start a kicker showing
 * no kicker value at all — silently, because "no value" and "no kicker here" render the same.
 */
import { describe, expect, it } from 'vitest'

import { loadLeagueKickerValue } from '@/lib/kicker-values/loadLeagueKickerValue'

/** Minimal prisma stand-in: one league row and a roster count. */
function fakePrisma(league: Record<string, unknown> | null, rosterCount = 12) {
  return {
    league: {
      findUnique: async () => league,
      findFirst: async () => league,
    },
    roster: { count: async () => rosterCount },
  } as never
}

const NATIVE = (slots: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  id: 'l1',
  leagueType: 'redraft',
  isDynasty: false,
  leagueSize: 12,
  settings: { roster: { config: { sections: [{ key: 'primary', slots }] } }, ...extra },
})

describe('loadLeagueKickerValue — the AF-native slot map', () => {
  it('prices a native league that the array spellings could not see', async () => {
    /*
     * The exact shape `TheCiege24's 12-Team NFL Redraft League` carries in production. It says
     * "K":1 outright and returned null before this.
     */
    const res = await loadLeagueKickerValue({
      prisma: fakePrisma(NATIVE({ K: 1, QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, BN: 6, IR: 1 })),
      leagueId: 'l1',
    })
    expect(res).not.toBeNull()
    expect(res!.value).not.toBeNull()
    expect(res!.replacementRank).toBe(13) // 1 slot x 12 teams + 1
  })

  it('expands slot COUNTS rather than listing keys once', async () => {
    /*
     * `{ K: 2 }` is a two-kicker league. Flattening it to a single K would put replacement at
     * K13 instead of K25 and price the position as if kickers were half as scarce.
     */
    const res = await loadLeagueKickerValue({
      prisma: fakePrisma(NATIVE({ K: 2, QB: 1, BN: 5 })),
      leagueId: 'l1',
    })
    expect(res!.replacementRank).toBe(25)
  })

  it('reads every section, not just the first', async () => {
    const league = {
      ...NATIVE({ QB: 1, RB: 2 }),
      settings: {
        roster: {
          config: {
            sections: [
              { key: 'primary', slots: { QB: 1, RB: 2 } },
              { key: 'special', slots: { K: 1 } },
            ],
          },
        },
      },
    }
    const res = await loadLeagueKickerValue({ prisma: fakePrisma(league), leagueId: 'l1' })
    expect(res!.value).not.toBeNull()
    expect(res!.replacementRank).toBe(13)
  })

  it('does not mistake bench or IR slots for kicker slots', async () => {
    const res = await loadLeagueKickerValue({
      prisma: fakePrisma(NATIVE({ QB: 1, RB: 2, BN: 6, IR: 2 })),
      leagueId: 'l1',
    })
    // Parsed fine, but starts no kicker — a meaningful answer, not an absence.
    expect(res).not.toBeNull()
    expect(res!.value).toBeNull()
  })

  it('leaves the array spellings exactly as they were', async () => {
    for (const key of ['roster_positions', 'rosterPositions']) {
      const res = await loadLeagueKickerValue({
        prisma: fakePrisma({
          id: 'l1',
          leagueType: 'dynasty',
          isDynasty: true,
          leagueSize: 12,
          settings: { [key]: ['QB', 'RB', 'WR', 'K', 'BN'] },
        }),
        leagueId: 'l1',
      })
      expect(res!.replacementRank).toBe(13)
    }
  })
})

describe('loadLeagueKickerValue — team count', () => {
  it('prefers the declared size over the roster-row count', async () => {
    /*
     * ⚠ THIS ASSERTION IS THE REVERSE OF WHAT IT ORIGINALLY SAID, AND THE REVERSAL IS THE POINT.
     * Counting rows made this module quote a different price from `league-rankings-v2` for the
     * same league: `$20 12 man tree keeper` read 301 (K14) on My Team and 287 (K13) on Power
     * Rankings, because the rankings engine counts Sleeper's own rosters — 12, as its own header
     * says — while this counted 13 `Roster` rows.
     *
     * Measured across all 33 production kicker leagues: 26 agree, and in every one of the 6
     * disagreements the row count is HIGHER (13v12, 14v12, 15v14). The table over-counts; it
     * never under-counts. So the declared size wins and 14 stale rows do not move replacement.
     */
    const res = await loadLeagueKickerValue({
      prisma: fakePrisma(NATIVE({ K: 1 }), 14),
      leagueId: 'l1',
    })
    expect(res!.replacementRank).toBe(13) // declared 12, not the 14 rows
  })

  it('falls back to roster rows when nothing declares a size', async () => {
    /* The rare path — exactly one of the 33 production kicker leagues lands here. */
    const league = { ...NATIVE({ K: 1 }), leagueSize: null }
    const res = await loadLeagueKickerValue({ prisma: fakePrisma(league, 10), leagueId: 'l1' })
    expect(res!.replacementRank).toBe(11)
  })

  it('falls back to the declared size when roster rows are missing', async () => {
    /*
     * ⚠ THE PRODUCTION BUG. Ten native leagues have zero roster rows and two have exactly one.
     * Taking the count literally made a 12-team league price at replacement K2 — a count of 0
     * or 1 is a missing answer, not a one-team league.
     */
    for (const rows of [0, 1]) {
      const res = await loadLeagueKickerValue({
        prisma: fakePrisma(NATIVE({ K: 1 }), rows),
        leagueId: 'l1',
      })
      expect(res!.replacementRank).toBe(13)
    }
  })

  it('uses default_team_count when the column is null', async () => {
    const league = { ...NATIVE({ K: 1 }), leagueSize: null, settings: { ...NATIVE({ K: 1 }).settings, default_team_count: 8 } }
    const res = await loadLeagueKickerValue({ prisma: fakePrisma(league, 0), leagueId: 'l1' })
    expect(res!.replacementRank).toBe(9)
  })

  it('returns null rather than guessing when nothing declares a size', async () => {
    /*
     * Defaulting to 12 would state a specific price for a league nothing measures. The panel
     * renders nothing — the same as before the league was reachable, not a regression.
     */
    const league = { ...NATIVE({ K: 1 }), leagueSize: null }
    const res = await loadLeagueKickerValue({ prisma: fakePrisma(league, 0), leagueId: 'l1' })
    expect(res).toBeNull()
  })
})
