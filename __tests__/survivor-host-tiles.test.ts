import { describe, expect, it } from 'vitest'

import { buildFairnessRadarTile, buildMinigamePlannerTile, buildRiskAlertsTile } from '@/lib/survivor/premium/survivorHostTiles'

const NOW = new Date('2026-10-22T12:00:00Z')

describe('mini-game planner', () => {
  it('shows the planning window around this week, with status, winners and the weekly call', () => {
    const base = { title: '', challengeType: 'verified_weekly_slate', locksAt: null, closesAt: null, winnerTribeId: null, winnerUserIds: [] as string[] }
    const tile = buildMinigamePlannerTile({
      currentWeek: 5,
      systemRun: true,
      seasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8],
      now: NOW,
      tribeNames: { t1: 'Fire', t2: 'Water' },
      playerNames: { 'u-ana': 'Ana' },
      challenges: [
        { ...base, week: 3, scope: 'tribe', status: 'settled', winnerTribeId: 't1' },
        { ...base, week: 4, scope: 'tribe', status: 'settled', winnerTribeId: 't1' },
        { ...base, week: 4, scope: 'individual', status: 'settled', winnerUserIds: ['u-ana'] },
        { ...base, week: 5, scope: 'tribe', status: 'open' },
        { ...base, week: 2, scope: 'tribe', status: 'settled', winnerTribeId: 't2' },
      ],
      weeklyCalls: [{ week: 5, answers: 7 }],
    })
    expect(tile.weeks.map(w => w.week)).toEqual([3, 4, 5, 6, 7])
    expect(tile.weeks.find(w => w.week === 4)?.challenges.map(c => [c.scope, c.status, c.winner])).toEqual([['tribe', 'settled', 'Fire'], ['individual', 'settled', 'Ana']])
    expect(tile.weeks.find(w => w.week === 5)).toMatchObject({ isCurrent: true, weeklyCall: { posted: true, answers: 7 } })
    expect(tile.weeks.find(w => w.week === 4)?.weeklyCall).toEqual({ posted: false, answers: 0 })
    expect(tile.weeks.find(w => w.week === 6)).toMatchObject({ challenges: [], weeklyCall: null })
    // Wins cover the whole season, not just the window.
    expect(tile.winsByTribe).toEqual([{ name: 'Fire', wins: 2 }, { name: 'Water', wins: 1 }])
  })
})

describe('risk alerts', () => {
  const cast = [{ userId: 'u-ana', displayName: 'Ana' }, { userId: 'u-bo', displayName: 'Bo' }, { userId: 'u-cy', displayName: 'Cy' }]
  const lastMessageAt = new Map([['u-ana', new Date('2026-10-21T00:00:00Z')], ['u-bo', new Date('2026-09-01T00:00:00Z')]])
  const autoCastCount = new Map([['u-ana', 2]])
  const flags = [{ flagType: 'collusion', severity: 'high', summary: 'Lopsided trade', affectedTeamNames: ['Ana FC', 'Bo United'], createdAt: NOW }]

  it('lists open flags, and quiet managers with their missed ballots for a non-playing host', () => {
    const tile = buildRiskAlertsTile({ now: NOW, blind: false, flags, activeCast: cast, lastMessageAt, autoCastCount })
    expect(tile.flags).toEqual([{ kind: 'collusion', severity: 'high', summary: 'Lopsided trade', teams: ['Ana FC', 'Bo United'], raisedAt: NOW.toISOString() }])
    // Ana talks but missed two ballots; Bo has been silent since September; Cy never posted.
    expect(tile.quiet.map(q => [q.name, q.missedBallots, q.lastMessageAt != null])).toEqual([['Ana', 2, true], ['Cy', 0, false], ['Bo', 0, true]])
    expect(tile.showsMissedBallots).toBe(true)
  })

  it('a commissioner who also plays sees silence only: missed ballots stay sealed', () => {
    const tile = buildRiskAlertsTile({ now: NOW, blind: true, flags: [], activeCast: cast, lastMessageAt, autoCastCount })
    expect(tile.showsMissedBallots).toBe(false)
    expect(tile.quiet.map(q => q.name)).toEqual(['Cy', 'Bo'])
    expect(tile.quiet.every(q => q.missedBallots === null)).toBe(true)
  })
})

describe('fairness radar', () => {
  it('counts the shape of the season and lists only manual overrides', () => {
    const tile = buildFairnessRadarTile({
      councils: [{ isTie: false, tiePhase: null }, { isTie: true, tiePhase: 'revote' }, { isTie: false, tiePhase: 'commissioner_tiebreak_required' }],
      tieDecisions: 1,
      autoCastBallots: 4,
      lateBallots: 2,
      scoreCorrections: 1,
      actions: [
        { week: 3, actionType: 'pause_season', description: 'Paused for the bye', commissionerId: 'owner', executedAt: new Date('2026-10-01T00:00:00Z') },
        { week: 4, actionType: 'sit_out_shuffle_approved', description: 'Auto redraw', commissionerId: 'survivor-ai-host', executedAt: new Date('2026-10-08T00:00:00Z') },
        { week: 5, actionType: 'exact_tie_commissioner_decision', description: 'Broke the tie', commissionerId: 'owner', executedAt: new Date('2026-10-15T00:00:00Z') },
      ],
    })
    expect(tile).toMatchObject({ councils: 3, ties: { total: 2, settledByCommissioner: 1 }, autoCastBallots: 4, lateBallots: 2, scoreCorrections: 1, automaticActions: 1 })
    expect(tile.overrides.map(o => [o.week, o.action])).toEqual([[5, 'exact tie commissioner decision'], [3, 'pause season']])
  })
})
