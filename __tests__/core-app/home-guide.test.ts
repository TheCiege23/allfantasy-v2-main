import { describe, expect, it } from 'vitest'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import {
  INJURY_REPORT_ANCHOR,
  INJURY_SUMMARY_ID,
  buildSeasonPulse,
  decisionTier,
  foldInjuredStarters,
  groupByTier,
  stripVerificationStamp,
  teachLine,
} from '@/lib/core-app/homeGuide'
import { verificationStamp } from '@/lib/core-app/lineupVerification'

const NOW = Date.parse('2026-11-12T21:00:00Z')
const HOUR = 3_600_000

function issue(over: Partial<CoreIssue>): CoreIssue {
  return {
    id: over.id ?? 'x',
    severity: 'warn',
    glyph: '!',
    title: 'Something',
    meta: 'Sleeper › Lineup',
    leagueId: 'L1',
    leagueName: 'League One',
    platform: 'sleeper',
    deadline: null,
    action: null,
    ...over,
  }
}

function starterOut(id: string, leagueId: string, name: string, kickoffInHours: number, flaggedCount = 1): CoreIssue {
  return issue({
    id,
    severity: 'bad',
    leagueId,
    leagueName: leagueId,
    deadline: new Date(NOW + kickoffInHours * HOUR),
    parts: {
      kind: 'starter-out',
      leagueName: leagueId,
      platform: 'Sleeper',
      flaggedCount,
      flagged: flaggedCount === 1 ? { name, slot: 'WR', status: 'Out' } : null,
      week: 10,
      kickoffAt: null,
      checkedAt: null,
    },
  })
}

describe('decisionTier', () => {
  it('puts an untimed bad row in now — it has already happened', () => {
    expect(decisionTier(issue({ severity: 'bad' }), NOW)).toBe('now')
  })
  it('puts a bad row inside a day in now and one further out in week', () => {
    expect(decisionTier(issue({ severity: 'bad', deadline: new Date(NOW + 5 * HOUR) }), NOW)).toBe('now')
    expect(decisionTier(issue({ severity: 'bad', deadline: new Date(NOW + 48 * HOUR) }), NOW)).toBe('week')
  })
  it('puts a warn inside a week in week, an untimed warn and every info in fyi', () => {
    expect(decisionTier(issue({ severity: 'warn', deadline: new Date(NOW + 72 * HOUR) }), NOW)).toBe('week')
    expect(decisionTier(issue({ severity: 'warn' }), NOW)).toBe('fyi')
    expect(decisionTier(issue({ severity: 'info', deadline: new Date(NOW + HOUR) }), NOW)).toBe('fyi')
  })
  it('reads an ISO deadline that crossed the server boundary', () => {
    const crossed = issue({ severity: 'bad', deadline: new Date(NOW + 48 * HOUR).toISOString() as unknown as Date })
    expect(decisionTier(crossed, NOW)).toBe('week')
  })
})

describe('groupByTier', () => {
  it('keeps ranked order inside each tier and drops empty tiers', () => {
    const rows = [
      issue({ id: 'a', severity: 'bad' }),
      issue({ id: 'b', severity: 'info' }),
      issue({ id: 'c', severity: 'bad', deadline: new Date(NOW + HOUR) }),
    ]
    const groups = groupByTier(rows, NOW)
    expect(groups.map((g) => g.tier)).toEqual(['now', 'fyi'])
    expect(groups[0]!.issues.map((i) => i.id)).toEqual(['a', 'c'])
  })
})

describe('teachLine', () => {
  it('names a lesson for every kind it knows and none for one it does not', () => {
    expect(teachLine(issue({ parts: { kind: 'drafting', leagueName: 'L', platform: 'Sleeper' } }))).toEqual({ key: 'drafting' })
    expect(teachLine(issue({ parts: { kind: 'stale', leagueName: 'L', platform: 'ESPN', lastReadAgo: null, actionPlatform: null } }))).toEqual({
      key: 'stale',
      platform: 'ESPN',
    })
    expect(
      teachLine(issue({ parts: { kind: 'stale-aggregate', count: 3, neverRead: false, platforms: ['Sleeper', 'ESPN'] } })),
    ).toEqual({ key: 'stale', platform: null })
    expect(teachLine(issue({}))).toBeNull()
  })
})

describe('stripVerificationStamp', () => {
  it('removes the English and Spanish stamps the producers append, and nothing else', () => {
    const at = '2026-11-12T21:27:00.000Z'
    const en = `Sleeper › Lineup · a slot with nobody in it scores zero · ${verificationStamp(at, 'en')}`
    const es = `Sleeper › Alineación · un puesto sin nadie anota cero · ${verificationStamp(at, 'es')}`
    expect(en).toContain('21:27 UTC') // positive control: the stamp really is there before stripping
    expect(stripVerificationStamp(en)).toBe('Sleeper › Lineup · a slot with nobody in it scores zero')
    expect(stripVerificationStamp(es)).toBe('Sleeper › Alineación · un puesto sin nadie anota cero')
    expect(stripVerificationStamp('ESPN › Lineup · kicks off Sun 4:05p ET')).toBe('ESPN › Lineup · kicks off Sun 4:05p ET')
  })
})

describe('foldInjuredStarters', () => {
  const rows = [
    issue({ id: 'slot', severity: 'bad' }),
    starterOut('s1', 'A', 'Puka Nacua', 60),
    starterOut('s2', 'B', 'Puka Nacua', 60),
    starterOut('s3', 'C', 'Carlton Davis', 40, 2),
    issue({ id: 'stale', severity: 'warn' }),
  ]

  it('leaves the rows alone when the injury report is not on the page', () => {
    expect(foldInjuredStarters(rows, false).map((r) => r.id)).toEqual(['slot', 's1', 's2', 's3', 'stale'])
  })

  it('replaces every starter-out row with one summary in the first one’s place', () => {
    const out = foldInjuredStarters(rows, true)
    expect(out.map((r) => r.id)).toEqual(['slot', INJURY_SUMMARY_ID, 'stale'])
    const summary = out[1]!
    expect(summary.parts).toEqual({ kind: 'injury-summary', starters: 4, leagues: 3 })
    expect(summary.title).toBe('4 injured starters in 3 leagues')
    expect(summary.action).toEqual({ label: 'See swaps', href: INJURY_REPORT_ANCHOR, external: false })
    // Soonest kickoff of the folded rows, so it still sorts by when points are first lost.
    expect(new Date(summary.deadline as Date).getTime()).toBe(NOW + 40 * HOUR)
  })

  it('adds nothing when there is nothing to fold', () => {
    const plain = [issue({ id: 'a' })]
    expect(foldInjuredStarters(plain, true)).toEqual(plain)
  })
})

describe('buildSeasonPulse', () => {
  const s = (rank: number | null, wins: number, losses: number, ties = 0) => ({ rank, wins, losses, ties })

  it('buckets leagues by half, counts the bubble and first place, and sums the record', () => {
    const pulse = buildSeasonPulse([
      { id: 'a', name: 'Alpha', platform: 'sleeper', teams: 12, standing: s(1, 8, 1) },
      { id: 'b', name: 'Bravo', platform: 'espn', teams: 12, standing: s(6, 5, 4) },
      { id: 'c', name: 'Charlie', platform: 'sleeper', teams: 12, standing: s(7, 4, 5) },
      { id: 'd', name: 'Delta', platform: 'yahoo', teams: 10, standing: s(10, 1, 8) },
      { id: 'e', name: 'Echo', platform: 'sleeper', teams: 12, standing: s(null, 0, 0) },
      { id: 'f', name: 'Foxtrot', platform: 'sleeper', teams: null, standing: s(3, 6, 3) },
    ])
    expect(pulse).toMatchObject({ ranked: 4, unranked: 2, topHalf: 2, bottomHalf: 2, bubble: 2, firstPlace: 1 })
    // Foxtrot's record still counts even though its rank cannot be placed without a league size.
    expect([pulse.wins, pulse.losses, pulse.ties]).toEqual([24, 21, 0])
    expect(pulse.best.map((r) => r.id)).toEqual(['a', 'b'])
    expect(pulse.worst.map((r) => r.id)).toEqual(['d', 'c'])
    expect(pulse.best[0]).toEqual({ id: 'a', name: 'Alpha', platform: 'sleeper', rank: 1, teams: 12, record: '8-1' })
  })

  it('withholds a rank taken before any game — it was never earned', () => {
    const pulse = buildSeasonPulse([{ id: 'a', name: 'A', platform: 'x', teams: 10, standing: s(1, 0, 0) }])
    expect(pulse.ranked).toBe(0)
    expect(pulse.unranked).toBe(1)
  })

  it('lists a bottom-half team under needs a look even with only two leagues', () => {
    const pulse = buildSeasonPulse([
      { id: 'a', name: 'A', platform: 'x', teams: 10, standing: s(2, 5, 2) },
      { id: 'b', name: 'B', platform: 'x', teams: 10, standing: s(9, 2, 5) },
    ])
    expect(pulse.best.map((r) => r.id)).toEqual(['a'])
    expect(pulse.worst.map((r) => r.id)).toEqual(['b'])
  })
})
