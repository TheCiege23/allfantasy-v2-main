// @vitest-environment node
/**
 * Undo a chop — the rules (lib/guillotine/chopUndo.ts). The tables themselves are proven against a real database in
 * chop-week-db.test.ts ("undo a chop"); this covers the decisions, which run in every unit pass.
 */
import { describe, expect, it } from 'vitest'

import { chopUndoBlockers, faabResetReturnPlan, faabReturnPlan, validateChopInstead, type ChopUndoFacts } from '@/lib/guillotine/chopUndo'
import { describeLogEntry, rosterIdsNamedBy } from '@/lib/league-log/leagueLog'

const clear: ChopUndoFacts = {
  importedLeague: false,
  week: 5,
  latestRecordedWeek: 5,
  seasonComplete: false,
  inFinalStage: false,
  claimsProcessedSinceChop: 0,
  claimedReleasedPlayers: 0,
  teamsWithoutReleaseRecord: 0,
  unmatchedTeams: 0,
  faabSplitWithoutShares: false,
}

describe('when a chop can be undone', () => {
  it('can, while the world still looks the way the chop left it', () => {
    expect(chopUndoBlockers(clear)).toEqual([])
  })

  it('never on an imported league, and not before anyone was chopped', () => {
    expect(chopUndoBlockers({ ...clear, importedLeague: true })).toEqual(['imported_league'])
    expect(chopUndoBlockers({ ...clear, week: null })).toEqual(['no_chop'])
  })

  it('names every reason it cannot, so the commissioner is not sent round in circles', () => {
    expect(
      chopUndoBlockers({ ...clear, latestRecordedWeek: 6, claimsProcessedSinceChop: 3, claimedReleasedPlayers: 1, teamsWithoutReleaseRecord: 1, unmatchedTeams: 1, faabSplitWithoutShares: true }),
    ).toEqual(['not_latest', 'waivers_ran', 'players_claimed', 'unmatched_team', 'no_release_record', 'faab_unknown'])
    expect(chopUndoBlockers({ ...clear, seasonComplete: true, inFinalStage: true })).toEqual(['season_over'])
    expect(chopUndoBlockers({ ...clear, inFinalStage: true })).toEqual(['final_stage'])
  })
})

describe('chop a different team instead', () => {
  const args = { undoneRosterIds: ['blades'], eligibleRosterIds: ['axes', 'cleavers', 'daggers'] }
  it('is optional', () => {
    expect(validateChopInstead({ ...args, requested: undefined })).toEqual({ ok: true, rosterIds: [] })
    expect(validateChopInstead({ ...args, requested: [] })).toEqual({ ok: true, rosterIds: [] })
  })
  it('takes the same number of teams, alive that week, and never the team coming back', () => {
    expect(validateChopInstead({ ...args, requested: ['daggers'] })).toEqual({ ok: true, rosterIds: ['daggers'] })
    expect(validateChopInstead({ ...args, requested: ['daggers', 'axes'] })).toMatchObject({ ok: false })
    expect(validateChopInstead({ ...args, requested: ['blades'] })).toMatchObject({ ok: false })
    expect(validateChopInstead({ ...args, requested: ['zombies'] })).toMatchObject({ ok: false })
  })
})

describe('giving split FAAB back', () => {
  it('nothing was split: nothing to give back', () => {
    expect(faabReturnPlan(null, ['blades'])).toEqual({ fromSurvivors: new Map(), toChopped: new Map() })
  })
  it('each chopped team gets back exactly what it gave', () => {
    const plan = faabReturnPlan({ pool: 150, shares: { axes: 50, cleavers: 50, daggers: 50 }, taken: { blades: 90, broadswords: 60 } }, ['blades', 'broadswords'])
    expect(plan?.toChopped).toEqual(new Map([['blades', 90], ['broadswords', 60]]))
    expect(plan?.fromSurvivors).toEqual(new Map([['axes', 50], ['cleavers', 50], ['daggers', 50]]))
  })
  it('a split recorded before each team’s share was: exact for one team, refused for several', () => {
    expect(faabReturnPlan({ pool: 90, shares: { axes: 30, cleavers: 30, daggers: 30 } }, ['blades'])?.toChopped).toEqual(new Map([['blades', 90]]))
    expect(faabReturnPlan({ pool: 150, shares: { axes: 75, cleavers: 75 } }, ['blades', 'broadswords'])).toBeNull()
  })
})

describe('the league log', () => {
  const row = {
    id: 'r1',
    actionType: 'guillotine_chop_undone',
    entityId: 'g1:5',
    userId: 'owner-1',
    beforeState: null,
    afterState: { restoredRosterIds: ['blades'], playersRestored: 14, claimsDenied: 0 },
    metadata: { week: 5 },
    createdAt: new Date('2026-11-15T12:00:00Z'),
  }
  it('tells members which team is back', () => {
    const entry = describeLogEntry(row, { lang: 'en', names: { users: {}, teams: { blades: 'Bench Mob' } }, forCommissioner: false })
    expect(entry?.title).toBe('Undid the week 5 chop: Bench Mob is back in')
    expect(describeLogEntry(row, { lang: 'es', names: { users: {}, teams: { blades: 'Bench Mob' } }, forCommissioner: false })?.title).toBe(
      'Deshizo la eliminación de la semana 5: Bench Mob vuelve',
    )
    expect(rosterIdsNamedBy([row])).toEqual(['blades'])
  })
})

describe('putting back a FAAB top-up or reset (owner, 2026-11-22: undo reverses it)', () => {
  it('no reset ran this week: nothing to put back', () => {
    expect(faabResetReturnPlan(null)).toEqual(new Map())
  })
  it('each survivor goes back to its balance before the chop; rosters the rule left alone are skipped', () => {
    const plan = faabResetReturnPlan({
      changes: [
        { rosterId: 'a', before: 40, after: 100 },
        { rosterId: 'b', before: 100, after: 100 },
        { rosterId: 'c', before: null, after: 25 },
      ],
    })
    expect(plan).toEqual(new Map([['a', { before: 40, after: 100 }], ['c', { before: null, after: 25 }]]))
  })
  it('a record it cannot read refuses the undo rather than guessing a balance', () => {
    expect(faabResetReturnPlan({})).toBeNull()
    expect(faabResetReturnPlan({ changes: [{ rosterId: 'a', after: 100 }] })).toBeNull()
    expect(faabResetReturnPlan({ changes: [{ rosterId: 'a', before: 40 }] })).toBeNull()
    expect(chopUndoBlockers({ ...clear, faabResetWithoutChanges: true })).toEqual(['faab_reset_unknown'])
  })
})

describe('giving back a payout made under any rule (lib/guillotine/faabOnChop.ts)', () => {
  it('a share to one team: that team gives back what it got, the chopped team gets back what was taken, not its whole balance', () => {
    // Half of a $90 balance went to the week's highest scorer.
    const event = { key: 's1:1', weekOrPeriod: 1, pool: 45, shares: { top: 45 }, taken: { chopped: 45 }, policy: 'top_scorer', applied: 'top_scorer', percent: 50, __eventId: 'e1' }
    const plan = faabReturnPlan(event, ['chopped'])!
    expect(Object.fromEntries(plan.fromSurvivors)).toEqual({ top: 45 })
    expect(Object.fromEntries(plan.toChopped)).toEqual({ chopped: 45 })
  })
})
