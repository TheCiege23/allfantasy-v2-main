import { describe, expect, it } from 'vitest'
import { runNflRedraftFullSeasonSimulation } from '@/lib/redraft-season-simulation/canonicalNflRedraftFullSeasonSimulation'

describe('G43 NFL redraft full season simulation', () => {
  it('proves draft to roster to schedule to scoring to waivers to trades to playoffs to champion', () => {
    const result = runNflRedraftFullSeasonSimulation()
    const allInvariantValues = Object.values(result.invariants)

    expect(result.draft).toMatchObject({
      completed: true,
      pickCount: 32,
      uniqueDraftedPlayerCount: 32,
    })
    expect(result.rosterSummaries).toHaveLength(4)
    expect(result.invariants.rostersValidAfterDraft).toBe(true)
    expect(result.rosterSummaries.every((team) => team.valid)).toBe(true)
    expect(result.rosterSummaries.every((team) => team.starters.length === 7)).toBe(true)
    expect(result.rosterSummaries.every((team) => team.bench.length === 1)).toBe(true)

    expect(result.schedule).toMatchObject({
      generated: true,
      regularSeasonWeeks: 3,
    })
    expect(result.schedule.matchups.filter((matchup) => matchup.awayRosterId)).toHaveLength(6)
    expect(result.invariants.scheduleReferencesRealTeams).toBe(true)

    expect(result.weeklyResults).toHaveLength(3)
    expect(result.weeklyResults[0].matchupScores.every((matchup) => matchup.winnerRosterId)).toBe(true)
    expect(result.invariants.scoringUsesOnlyStarters).toBe(true)
    expect(result.invariants.standingsUpdated).toBe(true)
    expect(result.weeklyResults[2].standings).toHaveLength(4)
    expect(result.weeklyResults[2].standings.every((row) => row.wins + row.losses + row.ties === 3)).toBe(true)

    expect(result.waiver).toMatchObject({
      processed: true,
      addedPlayerId: 'waiver-rb',
      droppedPlayerId: 'alpha-bench-wr',
    })
    expect(result.waiver.results.some((row) => row.success && row.transaction.type === 'waiver_claim_approved')).toBe(true)
    expect(result.invariants.waiverUpdatedRosters).toBe(true)

    expect(result.trade).toMatchObject({
      processed: true,
      proposalId: 'g43-trade-alpha-bravo',
    })
    expect(result.trade.movedPlayerIds).toEqual(expect.arrayContaining(['waiver-rb', 'bravo-bench-wr']))
    expect(result.invariants.tradeUpdatedRosters).toBe(true)

    expect(result.playoffs).toMatchObject({
      generated: true,
    })
    expect(result.playoffs.seeds.map((seed) => seed.rosterId)).toEqual(
      result.weeklyResults[2].standings.slice(0, 2).map((row) => row.rosterId),
    )
    expect(result.invariants.playoffSeedsDerivedFromStandings).toBe(true)
    expect(result.invariants.bracketAdvanced).toBe(true)
    expect(result.invariants.championCrowned).toBe(true)
    expect(result.playoffs.finalStandings[0]).toMatchObject({
      rosterId: result.playoffs.championRosterId,
      champion: true,
    })

    expect(result.leagueHistory).toMatchObject({
      championRosterId: result.playoffs.championRosterId,
      season: 2026,
      finalStandingsRecorded: true,
    })
    expect(result.invariants.finalHistoryRecorded).toBe(true)

    expect(result.invariants.notificationsCreated).toBe(true)
    expect(result.communication.notificationCount).toBeGreaterThanOrEqual(20)
    expect(result.communication.feedCount).toBeGreaterThanOrEqual(5)
    expect(result.communication.chatCount).toBeGreaterThanOrEqual(5)
    expect(result.communication.eventTypes).toEqual(
      expect.arrayContaining([
        'draft.completed',
        'waiver.processed',
        'trade.processed',
        'playoffs.bracket.generated',
        'playoffs.champion.crowned',
      ]),
    )

    expect(result.invariants.noDuplicatePlayers).toBe(true)
    expect(result.invariants.canonicalEventsEmitted).toBe(true)
    expect(result.events.length).toBeGreaterThan(70)
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'league.created',
        'settings.updated',
        'draft.completed',
        'roster.player.started',
        'schedule.generated',
        'matchup.created',
        'scoring.period.opened',
        'matchup.finalized',
        'standings.recalculated',
        'waiver.processed',
        'trade.proposed',
        'trade.processed',
        'playoffs.bracket.generated',
        'playoffs.team.advanced',
        'playoffs.champion.crowned',
        'playoffs.final_standings.recorded',
        'season.completed',
      ]),
    )
    expect(allInvariantValues.every(Boolean)).toBe(true)
  })
})
