import { describe, expect, it } from 'vitest'
import {
  HIDDEN_WHISPERER_NAME,
  redactStatusEntries,
  redactSurvivorAndZombieIds,
  redactWhispererRecord,
  redactZombieAIContext,
  redactZombieEvent,
  redactZombieTeam,
  withWhispererRoster,
  type WhispererIdentity,
} from '@/lib/zombie/whispererRedaction'
import { buildZombieAIPrompt } from '@/lib/zombie/ai/ZombieAIPrompts'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'
const W_NAME = 'Quiet Menace'

const identity: WhispererIdentity = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }
const empty: WhispererIdentity = { rosterIds: new Set(), userIds: new Set() }

describe('redactZombieTeam', () => {
  it('disguises the Whisperer team as a Survivor and strips its tells', () => {
    const out = redactZombieTeam(
      { rosterId: W_ROSTER, status: 'Whisperer', isWhisperer: true, ambushesRemaining: 2, ambushesUsed: 1, statusHistory: ['Whisperer'] },
      identity,
    )
    expect(out).toEqual({ rosterId: W_ROSTER, status: 'Survivor', isWhisperer: false, ambushesRemaining: 0, ambushesUsed: 0, statusHistory: null })
  })

  it('masks a Whisperer status even when the identity could not be loaded', () => {
    expect(redactZombieTeam({ rosterId: W_ROSTER, status: 'Whisperer' }, empty).status).toBe('Survivor')
  })

  it('nulls pointers from infected teams back to the Whisperer', () => {
    const out = redactZombieTeam({ rosterId: 'roster-2', status: 'Zombie', killedByRosterId: W_ROSTER, killedByUserId: W_USER }, identity)
    expect(out).toMatchObject({ status: 'Zombie', killedByRosterId: null, killedByUserId: null })
  })

  it('leaves other teams untouched', () => {
    const team = { rosterId: 'roster-3', status: 'Zombie', killedByRosterId: 'roster-4', killedByUserId: 'user-4' }
    expect(redactZombieTeam(team, identity)).toEqual(team)
  })
})

describe('redactStatusEntries and redactSurvivorAndZombieIds', () => {
  it('masks the Whisperer status entry', () => {
    expect(redactStatusEntries([{ rosterId: W_ROSTER, status: 'Whisperer' }, { rosterId: 'roster-2', status: 'Zombie' }], identity)).toEqual([
      { rosterId: W_ROSTER, status: 'Survivor' },
      { rosterId: 'roster-2', status: 'Zombie' },
    ])
  })

  it('folds the Whisperer into a sorted survivors list so elimination does not find it', () => {
    expect(redactSurvivorAndZombieIds({ survivors: ['roster-z', 'roster-a'], zombies: ['roster-2', W_ROSTER] }, identity)).toEqual({
      survivors: ['roster-a', W_ROSTER, 'roster-z'],
      zombies: ['roster-2'],
    })
  })
})

describe('redactZombieEvent', () => {
  it('makes a Whisperer infector anonymous but keeps the label', () => {
    const out = redactZombieEvent(
      { infectorUserId: W_USER, infectorName: W_NAME, infectorStatus: 'Whisperer', victimUserId: 'user-2', victimName: 'Victim', victimPriorStatus: 'Survivor' },
      identity,
    )
    expect(out).toMatchObject({ infectorUserId: null, infectorName: HIDDEN_WHISPERER_NAME, infectorStatus: 'Whisperer', victimUserId: 'user-2', victimName: 'Victim' })
  })

  it('catches a Whisperer actor by status alone', () => {
    expect(redactZombieEvent({ winnerUserId: 'user-x', winnerStatus: 'Whisperer', loserUserId: 'user-2', loserStatus: 'Survivor' }, empty)).toMatchObject({
      winnerUserId: null,
      loserUserId: 'user-2',
    })
  })

  it('always nulls newWhispererUserId', () => {
    expect(redactZombieEvent({ maulerUserId: 'user-3', maulerStatus: 'Zombie', newWhispererUserId: 'user-3' }, empty)).toMatchObject({
      maulerUserId: 'user-3',
      newWhispererUserId: null,
    })
  })
})

describe('redactWhispererRecord', () => {
  it('keeps the shape but removes identity and forces unrevealed', () => {
    expect(redactWhispererRecord({ id: 'rec-1', userId: W_USER, displayName: W_NAME, ambushesRemaining: 2, isPubliclyRevealed: true })).toEqual({
      id: 'rec-1',
      userId: null,
      displayName: null,
      ambushesRemaining: 2,
      isPubliclyRevealed: false,
    })
  })

  it('stays null when there is no record', () => {
    expect(redactWhispererRecord(null)).toBeNull()
  })
})

describe('redactZombieAIContext and the AI prompt', () => {
  const ctx = {
    leagueId: 'league-1',
    sport: 'NFL',
    week: 3,
    config: { whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true, serumReviveCount: 1, zombieTradeBlocked: true },
    whispererRosterId: W_ROSTER,
    survivors: ['roster-a'],
    zombies: ['roster-2'],
    statuses: [
      { rosterId: W_ROSTER, status: 'Whisperer' },
      { rosterId: 'roster-a', status: 'Survivor' },
    ],
    movementWatch: [],
    rosterDisplayNames: { [W_ROSTER]: W_NAME, 'roster-a': 'Team A', 'roster-2': 'Team Two' },
    myRosterId: 'roster-a',
    myResources: { serums: 0, weapons: 0, ambush: 0 },
    winningsByRoster: {},
    serumBalanceByRoster: {},
    weaponBalanceByRoster: {},
    chompinBlockCandidates: [],
    collusionFlags: [],
    dangerousDropFlags: [],
    historicalContext: null,
  }

  it('removes the Whisperer id, masks its status and hides it among survivors', () => {
    const out = redactZombieAIContext(ctx, withWhispererRoster(empty, null))
    expect(out.whispererRosterId).toBeNull()
    expect(out.whispererHidden).toBe(true)
    expect(out.statuses).toContainEqual({ rosterId: W_ROSTER, status: 'Survivor' })
    expect(out.survivors).toEqual(['roster-a', W_ROSTER])
  })

  it('keeps the Whisperer name out of the model prompt when hidden', () => {
    const prompt = buildZombieAIPrompt(redactZombieAIContext(ctx, empty), 'weekly_zombie_recap')
    expect(`${prompt.system}\n${prompt.user}`).not.toMatch(/Whisperer: Quiet Menace/)
    expect(prompt.user).toContain('Whisperer: identity hidden from this user')
  })

  it('still names the Whisperer in the prompt for a viewer who may see it', () => {
    const prompt = buildZombieAIPrompt(ctx, 'weekly_zombie_recap')
    expect(prompt.user).toContain(`Whisperer: ${W_NAME}.`)
  })
})
