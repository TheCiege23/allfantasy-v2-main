/**
 * Rolling Insights injury ingest.
 *
 * The parser carries the risk here. RI ships NO status field — the designation
 * lives in English prose inside `returns` ("Questionable For Week 1 At Houston")
 * — and `playerUrgency.ts` escalates specifically on OUT. A mis-parse either
 * fabricates an emergency or, worse, hides a real one on a Sunday morning.
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeRiInjuries,
  parseInjuryDesignation,
  parseRiInjuryDate,
  parseWeekFromReturns,
} from '@/lib/injuries/rollingInsightsInjuries'

// Verbatim from the live feed, 2026-08-10.
const LIVE_SAMPLE = {
  data: {
    NFL: [
      {
        team: 'Buffalo Bills',
        team_id: 1,
        injuries: [
          {
            injury: 'Knee',
            player: 'Ty Johnson',
            returns: 'Questionable For Week 1 At Houston',
            player_id: '4434',
            date_injured: '2026-8-8',
          },
        ],
      },
      {
        team: 'New York Jets',
        team_id: 2,
        injuries: [
          {
            injury: 'Achilles',
            player: 'Some Player',
            returns: 'Out For Season',
            player_id: '9001',
            date_injured: '2026-8-1',
          },
        ],
      },
    ],
  },
}

describe('parseInjuryDesignation', () => {
  it('reads the real feed phrasing', () => {
    expect(parseInjuryDesignation('Questionable For Week 1 At Houston').status).toBe('Questionable')
    expect(parseInjuryDesignation('Out For Season').status).toBe('Out')
    expect(parseInjuryDesignation('Doubtful For Week 3').status).toBe('Doubtful')
    expect(parseInjuryDesignation('Probable For Sunday').status).toBe('Probable')
    expect(parseInjuryDesignation('Day-To-Day With A Hamstring').status).toBe('Day-To-Day')
  })

  it('prefers the MORE SEVERE reading when phrasings overlap', () => {
    // "Out For Season" contains "out"; the season-ending rule must win so the
    // reason is accurate even though both map to Out.
    expect(parseInjuryDesignation('Out For Season')).toEqual({ status: 'Out', reason: 'season_ending' })
    expect(parseInjuryDesignation('Season-Ending Knee Surgery')).toEqual({
      status: 'Out',
      reason: 'season_ending',
    })
    expect(parseInjuryDesignation('Placed On Injured Reserve')).toEqual({
      status: 'IR',
      reason: 'injured_reserve',
    })
  })

  it('REFUSES rather than guessing when no designation is stated', () => {
    // The critical case: this says nothing about THIS week's availability.
    // Turning it into Out would fabricate an emergency; turning it into
    // Questionable would invent a designation nobody issued.
    expect(parseInjuryDesignation('Expected To Return Week 3')).toEqual({
      status: null,
      reason: 'unparseable',
    })
    expect(parseInjuryDesignation('Undergoing Evaluation')).toEqual({
      status: null,
      reason: 'unparseable',
    })
    expect(parseInjuryDesignation('')).toEqual({ status: null, reason: 'empty' })
    expect(parseInjuryDesignation(null)).toEqual({ status: null, reason: 'empty' })
  })

  it('does not match designation words embedded in other words', () => {
    // A bare includes('out') matches all of these. Word boundaries are the
    // difference between a correct parse and a fabricated OUT badge.
    expect(parseInjuryDesignation('Limited in workout').status).toBeNull()
    expect(parseInjuryDesignation('Scouted throughout camp').status).toBeNull()
    expect(parseInjuryDesignation('About to begin rehab').status).toBeNull()
  })
})

describe('parseRiInjuryDate', () => {
  it('handles the feed’s unpadded format', () => {
    // "2026-8-8" is not ISO; new Date() on it is implementation-defined.
    const d = parseRiInjuryDate('2026-8-8')
    expect(d?.toISOString().slice(0, 10)).toBe('2026-08-08')
    expect(parseRiInjuryDate('2026-12-25')?.toISOString().slice(0, 10)).toBe('2026-12-25')
  })

  it('returns null instead of an Invalid Date', () => {
    expect(parseRiInjuryDate('not-a-date')).toBeNull()
    expect(parseRiInjuryDate('')).toBeNull()
    expect(parseRiInjuryDate(undefined)).toBeNull()
  })
})

describe('parseWeekFromReturns', () => {
  it('extracts a week when present and refuses otherwise', () => {
    expect(parseWeekFromReturns('Questionable For Week 1 At Houston')).toBe(1)
    expect(parseWeekFromReturns('Out For Week 12')).toBe(12)
    expect(parseWeekFromReturns('Out For Season')).toBeNull()
    expect(parseWeekFromReturns('Week 99')).toBeNull() // out of range
  })
})

describe('normalizeRiInjuries', () => {
  it('flattens team blocks into per-player rows', () => {
    const rows = normalizeRiInjuries(LIVE_SAMPLE)
    expect(rows).toHaveLength(2)

    const ty = rows.find((r) => r.playerName === 'Ty Johnson')!
    expect(ty.externalId).toBe('4434')
    expect(ty.providerPlayerId).toBe('4434')
    expect(ty.teamName).toBe('Buffalo Bills')
    expect(ty.teamId).toBe('1')
    expect(ty.type).toBe('Knee')
    expect(ty.status).toBe('Questionable')
    expect(ty.week).toBe(1)
    expect(ty.date?.toISOString().slice(0, 10)).toBe('2026-08-08')
    // Original prose preserved verbatim — the parse is additive, never lossy.
    expect(ty.description).toBe('Questionable For Week 1 At Houston')
  })

  it('keys externalId on the STABLE player_id so repeat runs update, not duplicate', () => {
    // externalId is half the upsert key. Anything time-based or index-based
    // would insert a new row every 15 minutes instead of updating one.
    const a = normalizeRiInjuries(LIVE_SAMPLE)
    const b = normalizeRiInjuries(LIVE_SAMPLE)
    expect(a.map((r) => r.externalId)).toEqual(b.map((r) => r.externalId))
    expect(a[0]!.externalId).not.toMatch(/\d{4}-\d{1,2}-\d{1,2}/)
  })

  it('keeps rows whose status could not be parsed, flagged for coverage', () => {
    const rows = normalizeRiInjuries({
      data: {
        NFL: [
          {
            team: 'Chicago Bears',
            team_id: 3,
            injuries: [
              { player: 'Mystery Guy', player_id: '77', injury: 'Illness', returns: 'Undergoing Evaluation' },
            ],
          },
        ],
      },
    })
    // The injury is real and worth surfacing; only the designation is unknown.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBeNull()
    expect(rows[0]!.statusReason).toBe('unparseable')
    expect(rows[0]!.type).toBe('Illness')
  })

  it('accepts object-keyed injuries as well as arrays', () => {
    const rows = normalizeRiInjuries({
      data: {
        NFL: {
          bills: {
            team: 'Buffalo Bills',
            team_id: 1,
            injuries: { '0': { player: 'A', player_id: '1', returns: 'Out' } },
          },
        },
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('Out')
  })

  it('dedupes a player appearing twice and survives empty/absent blocks', () => {
    const rows = normalizeRiInjuries({
      data: {
        NFL: [
          { team: 'A', team_id: 1, injuries: [{ player: 'Dup', player_id: '5', returns: 'Out' }] },
          { team: 'B', team_id: 2, injuries: [{ player: 'Dup', player_id: '5', returns: 'Questionable' }] },
          { team: 'C', team_id: 3, injuries: [] },
          { team: 'D', team_id: 4 },
        ],
      },
    })
    expect(rows).toHaveLength(1)
  })

  it('skips rows with neither an id nor a name', () => {
    const rows = normalizeRiInjuries({
      data: { NFL: [{ team: 'A', team_id: 1, injuries: [{ injury: 'Knee', returns: 'Out' }] }] },
    })
    expect(rows).toHaveLength(0)
  })

  it('returns an empty list for a malformed payload rather than throwing', () => {
    expect(normalizeRiInjuries(null)).toEqual([])
    expect(normalizeRiInjuries({})).toEqual([])
    expect(normalizeRiInjuries({ data: {} })).toEqual([])
  })
})
