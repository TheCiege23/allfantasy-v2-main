import { describe, expect, it } from 'vitest'
import { buildValueV2Shadow } from '@/lib/decision-os/value-v2/shadow'
import { resolveWindowDecision, teamFitFor, NEUTRAL_TEAM_FIT, HISTORICAL_RECONSTRUCTION_GAP } from '@/lib/decision-os/value-v2/windowDecision'
import type { WindowFactsPort } from '@/lib/decision-os/value-v2/windowFacts'
import type { AssetValueSnapshot, TradeValueContext } from '@/lib/trade-value/types'

const CAPTURED = '2026-10-06T18:00:00.000Z'
const scope = (week = 6) => ({ leagueId: 'l1', teamId: 't1', season: 2026, week })

/**
 * A port whose facts vary by week, so hysteresis is exercised on a real
 * observation sequence rather than on a hand-built state object.
 */
function weeklyPort(byWeek: Record<number, { wins: number; losses: number; luckWins: number; playoffPct: number; strengthPct: number } | null>): WindowFactsPort {
  return {
    identity: async () => ({ teamId: 't1', teamName: 'Anvil Chorus', managerName: 'Rae', rosterSize: 4 }),
    allPlay: async s => {
      const w = byWeek[s.week]
      return w ? { wins: w.wins, losses: w.losses, ties: 0, luckWins: w.luckWins, weeksCounted: w.wins + w.losses, pointsFor: 1000 } : null
    },
    forecast: async s => {
      const w = byWeek[s.week]
      return w ? { season: s.season, week: s.week, playoffProbabilityPct: w.playoffPct, generatedAt: CAPTURED } : null
    },
    dynasty: async s => {
      const w = byWeek[s.week]
      return w ? { season: s.season, projectedStrength3YearsPct: w.strengthPct, projectedStrengthNextYearPct: w.strengthPct, windowStartYear: null, windowEndYear: null, confidencePct: 70, generatedAt: CAPTURED } : null
    },
    // Dynasty fixtures never read this; the port contract still requires the method.
    restOfSeason: async () => null,
    injuries: async () => ({ unavailableShare: 0, basis: 'test', coverage: 1, treatment: 'excluded' }),
  }
}

const contenderWeek = { wins: 9, losses: 1, luckWins: 0, playoffPct: 95, strengthPct: 90 }
const rebuildWeek = { wins: 1, losses: 9, luckWins: 0, playoffPct: 2, strengthPct: 20 }

describe('hysteresis over a real weekly sequence', () => {
  it('holds the settled window when the change has not persisted', async () => {
    // Weeks 4 and 5 are contender; week 6 is the first rebuild-shaped week.
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: contenderWeek, 5: contenderWeek, 6: rebuildWeek,
    }))
    expect(decision.observed).toBe('rebuilding')
    expect(decision.status).toBe('contender')
    expect(decision.state).toBe('held')
    expect(decision.hysteresis.pendingStatus).toBe('rebuilding')
    expect(decision.hysteresis.pendingObservations).toBe(1)
    // The applied window drives the weighting, not the single observed week.
    expect(decision.teamFit.basis).toBe('contender')
  })

  it('settles the new window after three consecutive observations', async () => {
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: rebuildWeek, 5: rebuildWeek, 6: rebuildWeek,
    }))
    expect(decision.state).toBe('evidenced')
    expect(decision.status).toBe('rebuilding')
    expect(decision.teamFit.basis).toBe('rebuilding')
  })

  it('reports the state as evidenced when observation and window agree', async () => {
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: contenderWeek, 5: contenderWeek, 6: contenderWeek,
    }))
    expect(decision.state).toBe('evidenced')
    expect(decision.observed).toBe('contender')
    expect(decision.status).toBe('contender')
  })

  it('does not let a single unlucky week move the window', async () => {
    // Week 6 loses more games but the scoring earned the same record, so the
    // luck-adjusted rate is unchanged and no new observation is produced.
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: contenderWeek, 5: contenderWeek,
      6: { wins: 7, losses: 3, luckWins: -2, playoffPct: 95, strengthPct: 90 },
    }))
    expect(decision.observed).toBe('contender')
    expect(decision.status).toBe('contender')
    expect(decision.hysteresis.pendingStatus).toBeNull()
  })

  it('declares that the weekly history is reconstructed, not stored', async () => {
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: contenderWeek, 5: contenderWeek, 6: contenderWeek,
    }))
    expect(decision.gaps).toContain(HISTORICAL_RECONSTRUCTION_GAP)
  })

  it('refuses when this weeks evidence is missing, even with resolvable history', async () => {
    const decision = await resolveWindowDecision(scope(6), weeklyPort({
      4: contenderWeek, 5: contenderWeek, 6: null,
    }))
    expect(decision.state).toBe('refused')
    expect(decision.status).toBeNull()
    expect(decision.observed).toBeNull()
  })
})

describe('the deadband', () => {
  it('ignores a crossing whose present strength has barely moved', async () => {
    const seed = { active: 'competitive' as const, activeScore: null, revision: 0, pending: null }
    const decision = await resolveWindowDecision(scope(6), weeklyPort({ 4: contenderWeek, 5: contenderWeek, 6: contenderWeek }), {
      seed: { ...seed, activeScore: 0.925 },
    })
    // 0.925 is within materialScoreDelta of the contender score, so no proposal opens.
    expect(decision.hysteresis.pendingStatus).toBeNull()
    expect(decision.status).toBe('competitive')
    expect(decision.state).toBe('held')
  })

  it('opens a proposal once the present strength has materially moved', async () => {
    const decision = await resolveWindowDecision(scope(6), weeklyPort({ 4: contenderWeek, 5: contenderWeek, 6: contenderWeek }), {
      seed: { active: 'competitive', activeScore: 0.2, revision: 0, pending: null },
    })
    expect(decision.status).toBe('contender')
  })
})

describe('team fit never becomes market value', () => {
  it('leaves the middle and the ambiguous window neutral', () => {
    expect(teamFitFor('competitive')).toMatchObject({ winNowWeight: 1, longTermWeight: 1 })
    expect(teamFitFor('declining')).toMatchObject({ winNowWeight: 1, longTermWeight: 1 })
  })

  it('applies no adjustment at all when there is no window', () => {
    expect(teamFitFor(null)).toEqual(NEUTRAL_TEAM_FIT)
    expect(NEUTRAL_TEAM_FIT.basis).toBe('unresolved')
  })

  it('points a contender at win-now and a rebuilder at the long term', () => {
    expect(teamFitFor('contender').winNowWeight).toBeGreaterThan(teamFitFor('contender').longTermWeight)
    expect(teamFitFor('rebuilding').longTermWeight).toBeGreaterThan(teamFitFor('rebuilding').winNowWeight)
  })
})

const asset = (playerId: string, value: number): AssetValueSnapshot => ({
  kind: 'player', fromRosterId: 'a', toRosterId: 'b', playerId, playerName: playerId,
  position: 'WR', internalValue: value,
  sources: { fantasyCalcValue: value, marketObservation: null, projectionValue: null, adpValue: null, rankingValue: null, idpValue: null },
})

/**
 * An asset carrying a REAL market observation, so `marketSnapshot` produces a non-null
 * `marketValue`. `asset()` above deliberately has none; a price invariant needs a price.
 */
const priced = (playerId: string, value: number): AssetValueSnapshot => ({
  kind: 'player', fromRosterId: 'a', toRosterId: 'b', playerId, playerName: playerId,
  position: 'WR', internalValue: value,
  sources: {
    fantasyCalcValue: value,
    marketObservation: {
      assetId: playerId, source: 'fantasycalc', observedAt: CAPTURED,
      timestampResolution: 'instant',
      cohort: { sport: 'nfl', format: 'dynasty', numQbs: 1, numTeams: 12, ppr: 1 },
      value, liquidity: null, trend30d: null, standardDeviation: null, sampleSize: 100,
    },
    projectionValue: null, adpValue: null, rankingValue: null, idpValue: null,
  },
} as unknown as AssetValueSnapshot)

const context = (over: Partial<TradeValueContext> = {}): TradeValueContext => ({
  sport: 'nfl', leagueType: 'dynasty', scoring: 'ppr:1', rosterFormat: '12teams/1QB',
  capturedAt: CAPTURED, ...over,
})

describe('the production consumer receives and uses the window', () => {
  it('carries the decision onto the shadow payload', async () => {
    const window = await resolveWindowDecision(scope(6), weeklyPort({ 4: contenderWeek, 5: contenderWeek, 6: contenderWeek }))
    const shadow = buildValueV2Shadow([asset('p1', 4000)], context({ teamWindowV2: window }))
    expect(shadow.window!.status).toBe('contender')
    expect(shadow.window!.state).toBe('evidenced')
    expect(shadow.window!.teamFit.winNowWeight).toBeGreaterThan(1)
    expect(shadow.window!.hysteresis.persistenceWeeks).toBe(3)
    expect(shadow.window!.timestamps.assembledAt).toBeTruthy()
    expect(shadow.window!.identity).toMatchObject({ leagueId: 'l1', season: 2026, week: 6, teamId: 't1' })
  })

  it('exposes the window gaps without letting them vanish into a neutral weight', async () => {
    const window = await resolveWindowDecision(scope(6), weeklyPort({ 4: null, 5: null, 6: null }))
    const shadow = buildValueV2Shadow([asset('p1', 4000)], context({ teamWindowV2: window }))
    expect(shadow.window!.state).toBe('refused')
    expect(shadow.gaps).toContain('team_competitive_window_refused')
    expect(shadow.gaps.some(g => g.startsWith('window:'))).toBe(true)
  })

  it('says the window is missing when none was resolved, and never assumes one', () => {
    const shadow = buildValueV2Shadow([asset('p1', 4000)], context())
    expect(shadow.window).toBeUndefined()
    expect(shadow.gaps).toContain('team_competitive_window_missing')
  })

  it('never reports competitive as a fallback anywhere in the payload', async () => {
    const window = await resolveWindowDecision(scope(6), weeklyPort({ 4: null, 5: null, 6: null }))
    const shadow = buildValueV2Shadow([asset('p1', 4000)], context({ teamWindowV2: window }))
    expect(shadow.window!.status).toBeNull()
    expect(shadow.window!.teamFit.basis).toBe('unresolved')
    expect(JSON.stringify(shadow)).not.toContain('"competitive"')
  })

  it('does not change any market value when the window changes', async () => {
    const contender = await resolveWindowDecision(scope(6), weeklyPort({ 4: contenderWeek, 5: contenderWeek, 6: contenderWeek }))
    const rebuilder = await resolveWindowDecision(scope(6), weeklyPort({ 4: rebuildWeek, 5: rebuildWeek, 6: rebuildWeek }))
    const assets = [asset('p1', 4000), asset('p2', 1200)]
    const a = buildValueV2Shadow(assets, context({ teamWindowV2: contender }))
    const b = buildValueV2Shadow(assets, context({ teamWindowV2: rebuilder }))
    expect(a.window!.status).toBe('contender')
    expect(b.window!.status).toBe('rebuilding')
    expect(a.window!.teamFit).not.toEqual(b.window!.teamFit)
    // The prices are byte-identical across two opposite windows.
    expect(JSON.stringify(a.assets)).toBe(JSON.stringify(b.assets))
    expect(a.marketComplete).toBe(b.marketComplete)
  })

  /*
   * The same invariant, over assets that actually HAVE a price.
   *
   * The case above supplies `marketObservation: null`, so `marketSnapshot` returns
   * `marketValue: null` for every asset and the byte-comparison holds two nulls up against
   * each other. It passes with the window folded straight into the price -- measured, by
   * scaling every marketValue by `window.teamFit.winNowWeight` (1.15 contender vs 0.85
   * rebuilder) and watching all 16 tests stay green. An invariant asserted over absent
   * values is not an invariant.
   *
   * A priced asset is what gives the assertion something to protect, and it is the only
   * form of this test that can fail.
   */
  it('does not change a REAL market price when the window changes', async () => {
    const contender = await resolveWindowDecision(scope(6), weeklyPort({ 4: contenderWeek, 5: contenderWeek, 6: contenderWeek }))
    const rebuilder = await resolveWindowDecision(scope(6), weeklyPort({ 4: rebuildWeek, 5: rebuildWeek, 6: rebuildWeek }))
    const assets = [priced('p1', 4000), priced('p2', 1200)]

    const a = buildValueV2Shadow(assets, context({ teamWindowV2: contender }))
    const b = buildValueV2Shadow(assets, context({ teamWindowV2: rebuilder }))

    // Guard the guard: if these are null the comparison below proves nothing.
    expect(a.assets[0].marketValue).not.toBeNull()
    expect(a.assets[0].marketValue!.value).toBe(4000)
    expect(a.marketComplete).toBe(true)

    // Opposite windows, opposite team fit...
    expect(a.window!.status).toBe('contender')
    expect(b.window!.status).toBe('rebuilding')
    expect(a.window!.teamFit.winNowWeight).not.toBe(b.window!.teamFit.winNowWeight)

    // ...and identical prices, asset by asset.
    for (let i = 0; i < assets.length; i += 1) {
      expect(a.assets[i].marketValue!.value).toBe(b.assets[i].marketValue!.value)
    }
    expect(JSON.stringify(a.assets)).toBe(JSON.stringify(b.assets))

    // And the price is the observed one, not a weighted derivative of it.
    expect(a.assets[0].marketValue!.value).toBe(4000)
    expect(b.assets[0].marketValue!.value).toBe(4000)
  })
})
