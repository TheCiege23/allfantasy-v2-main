import { describe, expect, it } from 'vitest'

import { buildInjuredStarterSignals } from '@/lib/chimmy-alerts/hydrateInjuredStarters'

function item(over: Partial<Record<string, unknown>> = {}) {
  return {
    displayName: 'Player One',
    position: 'RB',
    injury: { status: 'out', freshness: { stale: false } },
    projection: { projectedPoints: 12 },
    leagueAppearances: [
      { canonicalLeagueId: 'lg-1', leagueName: 'IDP Dynasty', provider: 'sleeper', rosterStatus: 'starter' },
    ],
    ...over,
  }
}

describe('buildInjuredStarterSignals', () => {
  it('emits one signal per league where the injured player STARTS', () => {
    const r = buildInjuredStarterSignals({
      items: [
        item({
          leagueAppearances: [
            { canonicalLeagueId: 'lg-1', leagueName: 'A', provider: 'sleeper', rosterStatus: 'starter' },
            { canonicalLeagueId: 'lg-2', leagueName: 'B', provider: 'espn', rosterStatus: 'starter' },
            { canonicalLeagueId: 'lg-3', leagueName: 'C', provider: 'sleeper', rosterStatus: 'bench' },
          ],
        }),
      ],
    } as never)
    // Two starting spots, not three — the bench appearance is not an emergency.
    expect(r.injuredStarters).toHaveLength(2)
    expect(r.injuredStarters.map((s) => s.leagueId).sort()).toEqual(['lg-1', 'lg-2'])
  })

  it('labels the platform the manager must actually go to', () => {
    const r = buildInjuredStarterSignals({ items: [item()] } as never)
    expect(r.injuredStarters[0]!.platform).toBe('Sleeper')
  })

  it('leaves platform null for native leagues, so the message does not misdirect', () => {
    const r = buildInjuredStarterSignals({
      items: [item({ leagueAppearances: [{ canonicalLeagueId: 'lg-1', leagueName: 'A', provider: 'manual', rosterStatus: 'starter' }] })],
    } as never)
    expect(r.injuredStarters[0]!.platform).toBeNull()
  })

  it('ignores healthy and questionable players', () => {
    const r = buildInjuredStarterSignals({
      items: [
        item({ injury: { status: 'healthy' } }),
        item({ injury: { status: 'questionable' } }),
        item({ injury: null }),
      ],
    } as never)
    expect(r.injuredStarters).toHaveLength(0)
  })

  it('picks the highest-projected BENCH player in the same league as replacement', () => {
    const r = buildInjuredStarterSignals({
      items: [
        item(),
        {
          displayName: 'Bench Low',
          position: 'RB',
          injury: null,
          projection: { projectedPoints: 5 },
          leagueAppearances: [{ canonicalLeagueId: 'lg-1', leagueName: 'IDP Dynasty', provider: 'sleeper', rosterStatus: 'bench' }],
        },
        {
          displayName: 'Bench High',
          position: 'RB',
          injury: null,
          projection: { projectedPoints: 14 },
          leagueAppearances: [{ canonicalLeagueId: 'lg-1', leagueName: 'IDP Dynasty', provider: 'sleeper', rosterStatus: 'bench' }],
        },
      ],
    } as never)
    expect(r.injuredStarters[0]!.replacement?.playerName).toBe('Bench High')
    expect(r.injuredStarters[0]!.replacement?.projectedPoints).toBe(14)
  })

  it('never suggests a bench player from a DIFFERENT league', () => {
    const r = buildInjuredStarterSignals({
      items: [
        item(),
        {
          displayName: 'Other League Bench',
          position: 'RB',
          injury: null,
          projection: { projectedPoints: 99 },
          leagueAppearances: [{ canonicalLeagueId: 'lg-OTHER', leagueName: 'Z', provider: 'sleeper', rosterStatus: 'bench' }],
        },
      ],
    } as never)
    expect(r.injuredStarters[0]!.replacement).toBeNull()
  })

  it('never suggests an injured bench player as the replacement', () => {
    const r = buildInjuredStarterSignals({
      items: [
        item(),
        {
          displayName: 'Hurt Bench',
          position: 'RB',
          injury: { status: 'out' },
          projection: { projectedPoints: 99 },
          leagueAppearances: [{ canonicalLeagueId: 'lg-1', leagueName: 'IDP Dynasty', provider: 'sleeper', rosterStatus: 'bench' }],
        },
      ],
    } as never)
    expect(r.injuredStarters[0]!.replacement).toBeNull()
  })

  it('keeps an unprojected bench player as a candidate rather than dropping him', () => {
    // "We have no number for him" is not "he is a bad option" — he sorts last, not out.
    const r = buildInjuredStarterSignals({
      items: [
        item(),
        {
          displayName: 'No Projection',
          position: 'RB',
          injury: null,
          projection: null,
          leagueAppearances: [{ canonicalLeagueId: 'lg-1', leagueName: 'IDP Dynasty', provider: 'sleeper', rosterStatus: 'bench' }],
        },
      ],
    } as never)
    expect(r.injuredStarters[0]!.replacement?.playerName).toBe('No Projection')
    expect(r.injuredStarters[0]!.replacement?.projectedPoints).toBeNull()
  })

  it('marks every signal stale when the injury FEED is stale', () => {
    const r = buildInjuredStarterSignals({ items: [item()], injuryPort: { feedStale: true } } as never)
    expect(r.injuredStarters[0]!.stale).toBe(true)
    expect(r.feedStale).toBe(true)
  })

  it('marks an individually stale row stale even on a fresh feed', () => {
    const r = buildInjuredStarterSignals({
      items: [item({ injury: { status: 'out', freshness: { stale: true } } })],
      injuryPort: { feedStale: false },
    } as never)
    expect(r.injuredStarters[0]!.stale).toBe(true)
  })
})
