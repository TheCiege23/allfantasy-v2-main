import { describe, expect, it } from 'vitest'
import {
  buildGamePlan,
  buildLineupView,
  buildRosterNeeds,
  buildRosterStrength,
  humanizeEngineReason,
  resolveWriteCapability,
  slotStatusFor,
  toLineupPlayer,
} from '@/lib/my-team/derive'
import type { MatchupCenterPayload, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import type { LineupActionItem } from '@/lib/lineup-actions/types'

/**
 * These cover the honesty invariants of the My Team surface — the rules that stop
 * the page showing a number it cannot source. `lib/my-team/derive.ts` is pure by
 * design so all of this runs with no mocks, no prisma, and no network.
 */

function slot(over: Partial<MatchupPlayerSlot> = {}): MatchupPlayerSlot {
  return {
    playerId: 'p1',
    name: 'Test Player',
    position: 'RB',
    team: 'BUF',
    opponent: 'MIA',
    headshotUrl: null,
    currentPoints: 0,
    projectedPoints: 12.5,
    injuryStatus: null,
    newsBlurb: null,
    weatherSummary: null,
    gameStatus: 'upcoming',
    gameLabel: 'Sun 1:00',
    aiInsight: null,
    ...over,
  }
}

function side(starters: MatchupPlayerSlot[], over: Partial<MatchupSidePayload> = {}): MatchupSidePayload {
  return {
    rosterId: 'r1',
    teamName: 'My Team',
    avatarUrl: null,
    record: { wins: 1, losses: 0, ties: 0 },
    winPct: 1,
    totalPoints: 0,
    projectedTotal: starters.reduce((s, x) => s + (Number.isFinite(x.projectedPoints) ? x.projectedPoints : 0), 0),
    starters,
    remainingStarters: starters.length,
    ...over,
  }
}

function payload(starters: MatchupPlayerSlot[], over: Partial<MatchupCenterPayload> = {}): MatchupCenterPayload {
  return {
    leagueId: 'L1',
    season: 2026,
    week: 8,
    sport: 'NFL',
    matchupStatus: 'upcoming',
    conceptOverlay: null,
    left: side(starters),
    right: side([slot({ playerId: 'p9', name: 'Opp' })], { rosterId: 'r2', teamName: 'Them' }),
    winProbabilityLeft: 0.64,
    insights: {
      matchupEdge: '',
      startSit: '',
      weather: '',
      injuryNews: '',
      swingPlayers: [],
      riskLevel: 'low',
      floorVsCeiling: '',
    },
    partialData: false,
    refreshIntervalMs: 60000,
    ...over,
  }
}

function action(over: Partial<LineupActionItem> = {}): LineupActionItem {
  return {
    leagueId: 'L1',
    leagueName: 'Test League',
    sport: 'NFL' as LineupActionItem['sport'],
    platform: 'sleeper',
    teamId: null,
    slotIndex: null,
    slotId: null,
    slotLabel: 'RB',
    playerId: 'p1',
    playerName: 'Test Player',
    reasonType: 'empty_starter',
    urgency: 'urgent',
    lockTime: null,
    recommendedAction: null,
    suggestedReplacementPlayerId: null,
    confidence: null,
    expectedGain: null,
    sourceModule: 'lineup_scan',
    message: 'Empty FLEX slot',
    severity: 'critical',
    ...over,
  }
}

describe('resolveWriteCapability', () => {
  it('makes every imported platform read-only', () => {
    for (const platform of ['sleeper', 'espn', 'yahoo', 'cbs', 'fantrax', 'mfl']) {
      const cap = resolveWriteCapability({ platform, platformLeagueId: '123', hasRoster: true })
      expect(cap.canEditLineup, platform).toBe(false)
      expect(cap.canSubmitWaiverClaim, platform).toBe(false)
      expect(cap.canProposeTrade, platform).toBe(false)
      expect(cap.canMoveToIr, platform).toBe(false)
      expect(cap.readOnlyReason, platform).toBeTruthy()
    }
  })

  it('stays read-only for an imported league even when the viewer holds a roster', () => {
    // The point of the rule: role never unlocks writes on a league AllFantasy
    // does not own. Commissioner-ness is deliberately not an input here.
    const cap = resolveWriteCapability({ platform: 'sleeper', platformLeagueId: 'abc', hasRoster: true })
    expect(cap.canEditLineup).toBe(false)
    expect(cap.platformHref).toBe('https://sleeper.com/leagues/abc')
    expect(cap.platformLabel).toBe('Sleeper')
  })

  it('does not invent a platform link when the platform league id is missing', () => {
    const cap = resolveWriteCapability({ platform: 'sleeper', platformLeagueId: null, hasRoster: true })
    expect(cap.platformHref).toBeNull()
    expect(cap.readOnlyReason).toContain('Sleeper')
  })

  it('is case- and whitespace-insensitive about the platform name', () => {
    const cap = resolveWriteCapability({ platform: '  SLEEPER ', platformLeagueId: null, hasRoster: true })
    expect(cap.canEditLineup).toBe(false)
  })

  it('allows writes on a native league where the viewer has a roster', () => {
    const cap = resolveWriteCapability({ platform: 'allfantasy', platformLeagueId: null, hasRoster: true })
    expect(cap.canEditLineup).toBe(true)
    expect(cap.readOnlyReason).toBeNull()
  })

  it('blocks writes on a native league when the viewer has no claimed team', () => {
    const cap = resolveWriteCapability({ platform: 'allfantasy', platformLeagueId: null, hasRoster: false })
    expect(cap.canEditLineup).toBe(false)
    expect(cap.readOnlyReason).toBe('You do not have a claimed team in this league yet.')
  })
})

describe('humanizeEngineReason', () => {
  it('never surfaces a raw engine token to a manager', () => {
    // Reproduced live: matchupCenterService authorizes on LeagueTeam.platformUserId
    // while this page authorizes on Roster.platformUserId, so a real member can be
    // told "Forbidden" about their own league.
    const copy = humanizeEngineReason('Forbidden')
    expect(copy).not.toBe('Forbidden')
    expect(copy.toLowerCase()).not.toContain('forbidden')
    expect(copy.length).toBeGreaterThan(40)
  })

  it('is case-insensitive about the engine token', () => {
    expect(humanizeEngineReason('forbidden')).toBe(humanizeEngineReason('Forbidden'))
  })

  it('explains the other known engine failures in manager language', () => {
    expect(humanizeEngineReason('Roster not found').toLowerCase()).toContain('no roster')
    expect(humanizeEngineReason('Opponent roster missing').toLowerCase()).toContain('opponent')
  })

  it('falls back to something readable for an empty reason', () => {
    expect(humanizeEngineReason(null)).toContain('could not be loaded')
    expect(humanizeEngineReason('')).toContain('could not be loaded')
  })

  it('passes through an unrecognized message rather than swallowing it', () => {
    expect(humanizeEngineReason('Season has not started')).toBe('Season has not started')
  })
})

describe('slotStatusFor', () => {
  it('treats a started game as locked even when the player carries a designation', () => {
    // Once the game is underway the injury tag is no longer actionable, so lock wins.
    expect(slotStatusFor(slot({ gameStatus: 'live', injuryStatus: 'QUESTIONABLE' }))).toBe('locked')
    expect(slotStatusFor(slot({ gameStatus: 'final', injuryStatus: 'OUT' }))).toBe('locked')
  })

  it('maps designations to distinct actionable statuses', () => {
    expect(slotStatusFor(slot({ injuryStatus: 'OUT' }))).toBe('out')
    expect(slotStatusFor(slot({ injuryStatus: 'IR' }))).toBe('out')
    expect(slotStatusFor(slot({ injuryStatus: 'DOUBTFUL' }))).toBe('injured')
    expect(slotStatusFor(slot({ injuryStatus: 'QUESTIONABLE' }))).toBe('questionable')
    expect(slotStatusFor(slot({ injuryStatus: 'questionable' }))).toBe('questionable')
    expect(slotStatusFor(slot({ injuryStatus: null }))).toBe('ok')
  })
})

describe('toLineupPlayer', () => {
  it('reports no current points before kickoff rather than a scored zero', () => {
    // 0.0 scored and "has not played yet" are different facts and must not collapse.
    const player = toLineupPlayer(slot({ gameStatus: 'upcoming', currentPoints: 0 }))
    expect(player.currentPoints).toBeNull()
  })

  it('reports a real zero once the game is underway', () => {
    const player = toLineupPlayer(slot({ gameStatus: 'live', currentPoints: 0 }))
    expect(player.currentPoints).toBe(0)
  })

  it('nulls a non-finite projection instead of passing NaN through', () => {
    const player = toLineupPlayer(slot({ projectedPoints: Number.NaN }))
    expect(player.projectedPoints).toBeNull()
  })
})

describe('buildLineupView', () => {
  it('marks a slot with no player as empty', () => {
    const view = buildLineupView(payload([slot({ playerId: '' })]))
    expect(view.starters[0].player).toBeNull()
    expect(view.starters[0].status).toBe('empty')
  })

  it('withholds the projected total when any starter projection is missing', () => {
    // A total summed over an incomplete set reads as authoritative; withholding is honest.
    const view = buildLineupView(payload([slot({ playerId: 'a' }), slot({ playerId: 'b', projectedPoints: Number.NaN })]))
    expect(view.projectedTotal).toBeNull()
    expect(view.partial).toBe(true)
  })

  it('reports the projected total when every starter has one', () => {
    const view = buildLineupView(payload([slot({ playerId: 'a', projectedPoints: 10 }), slot({ playerId: 'b', projectedPoints: 5 })]))
    expect(view.projectedTotal).toBe(15)
    expect(view.partial).toBe(false)
  })

  it('propagates upstream partial data even when projections are complete', () => {
    const view = buildLineupView(payload([slot({ playerId: 'a' })], { partialData: true }))
    expect(view.partial).toBe(true)
  })

  it('withholds the projected total entirely when no slots are readable', () => {
    // 0 starters must not render as a lineup genuinely projected to score 0.0.
    const view = buildLineupView(payload([]))
    expect(view.starters).toEqual([])
    expect(view.projectedTotal).toBeNull()
  })

  it('does not claim bench data the matchup source never returns', () => {
    const view = buildLineupView(payload([slot()]))
    expect(view.bench).toEqual([])
    expect(view.reserve).toEqual([])
  })
})

describe('buildGamePlan', () => {
  const imported = resolveWriteCapability({ platform: 'sleeper', platformLeagueId: 'abc', hasRoster: true })
  const native = resolveWriteCapability({ platform: 'allfantasy', platformLeagueId: null, hasRoster: true })

  it('routes every action to the source platform on an imported league', () => {
    const plan = buildGamePlan([action()], imported, 'L1')
    expect(plan[0].externalOnly).toBe(true)
    expect(plan[0].actionLabel).toBe('Open in Sleeper')
    expect(plan[0].actionHref).toBe('https://sleeper.com/leagues/abc')
  })

  it('routes actions in-app on a native league', () => {
    const plan = buildGamePlan([action()], native, 'L1')
    expect(plan[0].externalOnly).toBe(false)
    expect(plan[0].actionHref).toBe('/league/L1?tab=roster')
  })

  it('orders critical work ahead of lower priorities', () => {
    const plan = buildGamePlan(
      [
        action({ playerId: 'low', severity: 'info', urgency: 'low', reasonType: 'matchup_prep' }),
        action({ playerId: 'crit', severity: 'critical', urgency: 'urgent' }),
        action({ playerId: 'med', severity: 'info', urgency: 'normal', reasonType: 'ai_waiver' }),
      ],
      native,
      'L1',
    )
    expect(plan.map((p) => p.priority)).toEqual(['critical', 'medium', 'low'])
  })

  it('collapses one underlying problem reported per-slot into a single item', () => {
    // The scan emits one row per affected slot with an identical message. Seven rows
    // for one finding inflates the headline count, which is the most glanceable
    // number on the page.
    const perSlot = ['QB', 'RB', 'RB', 'WR', 'TE'].map((slotLabel, i) =>
      action({
        playerId: `p${i}`,
        slotLabel,
        reasonType: 'native_starter_gap',
        message: 'Missing 5 starter slot(s) vs roster template',
      }),
    )
    const plan = buildGamePlan(perSlot, native, 'L1')
    expect(plan).toHaveLength(1)
    // Grouping must not lose which positions are affected.
    expect(plan[0].slotLabel).toBe('QB, RB, WR, TE')
  })

  it('keeps genuinely different problems at the same position separate', () => {
    const plan = buildGamePlan(
      [
        action({ playerId: 'a', slotLabel: 'RB', reasonType: 'empty_starter', message: 'Empty RB slot' }),
        action({ playerId: 'b', slotLabel: 'RB', reasonType: 'injured_starter', message: 'RB is questionable' }),
      ],
      native,
      'L1',
    )
    expect(plan).toHaveLength(2)
  })

  it('keeps the engine-supplied confidence and gain rather than defaulting them', () => {
    const plan = buildGamePlan([action({ confidence: null, expectedGain: null })], native, 'L1')
    expect(plan[0].confidence).toBeNull()
    expect(plan[0].expectedGain).toBeNull()
  })
})

describe('buildRosterStrength', () => {
  it('never emits an overall grade', () => {
    // Grades need league-wide comparison this payload does not carry.
    const view = buildRosterStrength(payload([slot({ playerId: 'a', position: 'RB', projectedPoints: 10 })]))
    expect(view?.overallGrade).toBeNull()
    expect(view?.gradeBasis).toBeTruthy()
  })

  it('never claims a league rank it cannot compute', () => {
    const view = buildRosterStrength(payload([slot({ playerId: 'a', projectedPoints: 10 })]))
    expect(view?.positions.every((p) => p.leagueRank === null)).toBe(true)
  })

  it('aggregates by position and sorts strongest first', () => {
    const view = buildRosterStrength(
      payload([
        slot({ playerId: 'a', position: 'RB', projectedPoints: 5 }),
        slot({ playerId: 'b', position: 'RB', projectedPoints: 6 }),
        slot({ playerId: 'c', position: 'WR', projectedPoints: 20 }),
      ]),
    )
    expect(view?.positions[0]).toMatchObject({ position: 'WR', value: 20 })
    expect(view?.positions[1]).toMatchObject({ position: 'RB', value: 11, starterCount: 2 })
  })

  it('returns null when nothing has a projection, so the caller can say why', () => {
    const view = buildRosterStrength(payload([slot({ playerId: 'a', projectedPoints: Number.NaN })]))
    expect(view).toBeNull()
  })

  it('explains itself differently when projections were partially missing', () => {
    const view = buildRosterStrength(
      payload([slot({ playerId: 'a', projectedPoints: 10 }), slot({ playerId: 'b', projectedPoints: Number.NaN })]),
    )
    expect(view?.gradeBasis).toContain('incomplete data')
  })
})

describe('buildRosterNeeds', () => {
  it('only derives needs from reasons that genuinely imply one', () => {
    const needs = buildRosterNeeds([action({ reasonType: 'matchup_prep', slotLabel: 'WR' })])
    expect(needs).toEqual([])
  })

  it('escalates a position to critical when a slot is empty', () => {
    const needs = buildRosterNeeds([
      action({ playerId: '1', reasonType: 'injured_starter', slotLabel: 'RB', severity: 'warning' }),
      action({ playerId: '2', reasonType: 'empty_starter', slotLabel: 'RB' }),
    ])
    expect(needs).toHaveLength(1)
    expect(needs[0].severity).toBe('critical')
    expect(needs[0].evidence).toHaveLength(2)
  })

  it('ignores actions with no slot to attribute the need to', () => {
    const needs = buildRosterNeeds([action({ slotLabel: null })])
    expect(needs).toEqual([])
  })
})
