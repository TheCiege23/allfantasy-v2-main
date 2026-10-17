import { describe, expect, it } from 'vitest'

import type { FaabBidPlan, FaabPlanBid } from '@/lib/chimmy/tools/faabBidTool'
import {
  chopReleaseDedupeKey,
  chopReleaseEnabled,
  chopReleaseMutedBy,
  detectChops,
  pairRosters,
  renderChopRelease,
  rosterPlayerIds,
  snapshotChanged,
  snapshotOf,
} from '@/lib/chimmy-alerts/chopRelease'

/**
 * The chop-release alert's pure half: what counts as a chop, and what the message may say. Every
 * name here is synthetic.
 */

const bid = (id: string, name: string, ceiling: number | null, displacedName: string | null = null): FaabPlanBid => ({
  id,
  name,
  position: 'WR',
  ceiling,
  shareOfSupply: 0.2,
  marginalValue: 100,
  displacedName,
})

const plan = (over: Partial<Extract<FaabBidPlan, { status: 'ok' }>> = {}): FaabBidPlan => ({
  status: 'ok',
  outcome: 'bid',
  leagueName: 'Test Chop League',
  platform: 'sleeper',
  platformLeagueId: 's-1',
  concept: 'guillotine',
  elimination: true,
  valuesSource: 'test',
  valuesAsOf: '2026-09-28',
  remaining: 84,
  seasonBudget: 100,
  seatsLabel: 'FLEX ×2',
  horizonBasis: null,
  allocReason: null,
  rosteredCount: 150,
  pricedCount: 5,
  upgrades: [],
  nonUpgrades: 0,
  ...over,
})

const render = (p: FaabBidPlan, releasedIds = ['p1', 'p2', 'p3', 'p4', 'p5'], choppedTeamNames = ['Gamma Squad']) =>
  renderChopRelease({ leagueId: 'L1', leagueName: 'Test Chop League', choppedTeamNames, releasedIds, plan: p, baseUrl: 'https://example.test' })

describe('the flag', () => {
  it('is off unless the variable is exactly "1"', () => {
    expect(chopReleaseEnabled({})).toBe(false)
    for (const v of ['', '0', 'true', 'yes', ' 1', 'on']) expect(chopReleaseEnabled({ CHOP_RELEASE_ALERTS_ENABLED: v })).toBe(false)
    expect(chopReleaseEnabled({ CHOP_RELEASE_ALERTS_ENABLED: '1' })).toBe(true)
  })
})

describe('what counts as a chop', () => {
  it('"0" placeholders in starters are not players — a chopped roster reads empty', () => {
    expect(rosterPlayerIds({ players: [], starters: ['0', '0', '0'], reserve: null, taxi: [] })).toEqual([])
    expect(rosterPlayerIds({ players: ['p1', 'p2'], starters: ['p1', '0'] })).toEqual(['p1', 'p2'])
    expect(rosterPlayerIds(null)).toEqual([])
  })

  it('pairs rosters to teams by source_team_id, not by the (possibly resolved) platformUserId', () => {
    const entries = pairRosters({
      teams: [
        { externalId: '1', platformUserId: 'sl-a', claimedByUserId: 'u-a', teamName: 'Alpha', ownerName: 'a' },
        { externalId: '2', platformUserId: 'sl-b', claimedByUserId: null, teamName: '', ownerName: 'bravo_owner' },
      ],
      rosters: [
        { platformUserId: 'af-user-a', playerData: { source_team_id: '1', players: ['p1'] } },
        { platformUserId: 'sl-b', playerData: { players: [] } },
      ],
    })
    expect(entries).toEqual([
      { teamKey: '1', playerIds: ['p1'], name: 'Alpha', claimedByUserId: 'u-a' },
      { teamKey: '2', playerIds: [], name: 'bravo_owner', claimedByUserId: null },
    ])
  })

  it('the first run only seeds — an already-empty roster is not news', () => {
    expect(detectChops(null, [{ teamKey: '1', playerIds: [] }, { teamKey: '2', playerIds: ['p1'] }])).toEqual({ kind: 'seed' })
  })

  it('a roster that went from players to none is a chop, carrying what it released', () => {
    const prev = snapshotOf([
      { teamKey: '1', playerIds: ['p1', 'p2'] },
      { teamKey: '2', playerIds: ['p3'] },
      { teamKey: '3', playerIds: ['p4'] },
      { teamKey: '4', playerIds: [] },
    ])
    const got = detectChops(prev, [
      { teamKey: '1', playerIds: [] },
      { teamKey: '2', playerIds: ['p3'] },
      { teamKey: '3', playerIds: ['p4'] },
      { teamKey: '4', playerIds: [] },
    ])
    expect(got).toEqual({ kind: 'chop', chopped: [{ teamKey: '1', releasedIds: ['p1', 'p2'] }] })
  })

  it('an earlier chop (empty before, empty now) and a vanished roster are not chops', () => {
    const prev = snapshotOf([
      { teamKey: '1', playerIds: [] },
      { teamKey: '2', playerIds: ['p3'] },
      { teamKey: '3', playerIds: ['p4'] },
    ])
    expect(detectChops(prev, [{ teamKey: '1', playerIds: [] }, { teamKey: '3', playerIds: ['p4'] }])).toEqual({ kind: 'none' })
  })

  it('half the live rosters emptying at once is a reset, never a chop', () => {
    const prev = snapshotOf([
      { teamKey: '1', playerIds: ['a'] },
      { teamKey: '2', playerIds: ['b'] },
      { teamKey: '3', playerIds: ['c'] },
      { teamKey: '4', playerIds: ['d'] },
    ])
    const empty = (k: string) => ({ teamKey: k, playerIds: [] as string[] })
    expect(detectChops(prev, [empty('1'), empty('2'), empty('3'), { teamKey: '4', playerIds: ['d'] }])).toMatchObject({ kind: 'reset' })
    expect(detectChops(prev, [empty('1'), empty('2'), empty('3'), empty('4')])).toMatchObject({ kind: 'reset' })
    // Two of four is a double chop — allowed.
    expect(detectChops(prev, [empty('1'), empty('2'), { teamKey: '3', playerIds: ['c'] }, { teamKey: '4', playerIds: ['d'] }])).toMatchObject({
      kind: 'chop',
    })
  })

  it('an unchanged league writes no snapshot', () => {
    const s = snapshotOf([{ teamKey: '1', playerIds: ['b', 'a'] }])
    expect(snapshotChanged(s, snapshotOf([{ teamKey: '1', playerIds: ['a', 'b'] }]))).toBe(false)
    expect(snapshotChanged(null, s)).toBe(true)
  })
})

describe('what it says', () => {
  it('names the released upgrades with the plan\'s own ceilings and who they bench', () => {
    const m = render(
      plan({
        upgrades: [
          bid('p2', 'Ashton Vale', 12, 'Rory Penn'),
          bid('elsewhere', 'Never Released', 30, 'X'),
          bid('p4', 'Corin Hale', 7),
        ],
      }),
    )!
    expect(m.kind).toBe('bid')
    expect(m.title).toBe("Chop in Test Chop League: Chimmy's bid plan")
    expect(m.body).toBe('Gamma Squad was chopped — 5 players hit waivers. Your plan: bid up to $12 on Ashton Vale (benches Rory Penn), $7 on Corin Hale.')
    // A player the chopped roster did not release is not this message's news, and its $30 is never stated.
    expect(m.body).not.toContain('Never Released')
    expect(m.body).not.toContain('$30')
    expect(m.namedIds).toEqual(['p2', 'p4'])
    expect(new URL(m.actionHref, 'https://x.test').searchParams.get('from')).toBe('chop_release')
    expect(m.email.html).toContain('from=chop_release_email')
  })

  it('caps the list and says how many more', () => {
    const m = render(plan({ upgrades: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => bid(id, `Name ${id}`, 10 - i)) }))!
    expect(m.body).toContain('$8 on Name p3.')
    expect(m.body).not.toContain('Name p4')
    expect(m.body).toContain('(+2 more in your plan.)')
  })

  it('no ceiling (remaining FAAB not on file) names them and states no dollar figure at all', () => {
    const m = render(plan({ remaining: null, upgrades: [bid('p1', 'Ashton Vale', null, 'Rory Penn')] }))!
    expect(m.kind).toBe('name_only')
    expect(m.body).toContain('Upgrades for you: Ashton Vale (benches Rory Penn).')
    expect(m.body).not.toMatch(/\$\d/)
  })

  it('a save plan says hold, with the remaining figure only when the plan has one', () => {
    expect(render(plan({ outcome: 'save' }))!.body).toBe('Gamma Squad was chopped — 5 players hit waivers. Nothing released improves your lineup — hold your $84.')
    const noRemaining = render(plan({ outcome: 'save', remaining: null }))!
    expect(noRemaining.body).toContain('hold your FAAB.')
    expect(noRemaining.body).not.toMatch(/\$\d/)
  })

  it('bids elsewhere but nothing released: says so, with no figure and no "hold"', () => {
    const m = render(plan({ upgrades: [bid('elsewhere', 'Never Released', 30)] }))!
    expect(m.kind).toBe('nothing_released')
    expect(m.body).toBe('Gamma Squad was chopped — 5 players hit waivers. Nothing released improves your lineup. Your full bid plan is a tap away.')
  })

  it('two chopped teams read as both', () => {
    expect(render(plan({ outcome: 'save' }), ['p1'], ['Gamma Squad', 'Delta Crew'])!.body).toMatch(/^Gamma Squad and Delta Crew were chopped — 1 player hit waivers\./)
  })

  it('says nothing when the plan was refused, found nothing, could not run, or is not an elimination plan', () => {
    expect(render({ status: 'refused', line: 'no' })).toBeNull()
    for (const outcome of ['no_pool', 'no_calc', 'rank'] as const) expect(render(plan({ outcome }))).toBeNull()
  })

  it('escapes names in the email', () => {
    const m = render(plan({ upgrades: [bid('p1', '<b>Evil</b>', 5)] }), ['p1'], ['<script>x</script>'])!
    expect(m.email.html).not.toContain('<script>x</script>')
    expect(m.email.html).not.toContain('<b>Evil</b>')
  })
})

describe('keys and mutes', () => {
  it('one key per league per week', () => {
    expect(chopReleaseDedupeKey('L1', 2026, 5)).toBe('chop-release:L1:2026-w5')
  })

  it('the Waivers class, the type, or the league mutes it', () => {
    expect(chopReleaseMutedBy(null, 'L1')).toBeNull()
    expect(chopReleaseMutedBy({ mutedClasses: ['waiver'] } as never, 'L1')).toBe('muted_class')
    expect(chopReleaseMutedBy({ mutedTypes: ['chop_release'] } as never, 'L1')).toBe('muted_type')
    expect(chopReleaseMutedBy({ leaguePrefs: [{ leagueId: 'L1', disabled: true }] } as never, 'L1')).toBe('league_disabled')
    expect(chopReleaseMutedBy({ leaguePrefs: [{ leagueId: 'L1', disabled: true }] } as never, 'L2')).toBeNull()
  })
})
