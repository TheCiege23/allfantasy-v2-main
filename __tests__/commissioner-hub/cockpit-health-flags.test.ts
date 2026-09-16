import { describe, it, expect } from 'vitest'
import {
  abandonedTeamsFlag,
  missingLineupsFlag,
  openPolls,
  rankFlags,
  readDuesTracker,
  unequalSchedulesFlag,
  unpaidDuesFlag,
  unresolvedVotesFlag,
  type LeaguePoll,
} from '@/lib/core-app/commissioner/health'

/**
 * Commissioner Hub item 7 — the five health flags.
 *
 * The contract every test here defends: a flag is MEASURED or it says why it is
 * not. An unmeasured flag must never come back green, because "0 unpaid" off a
 * league that does not track dues is the most confident wrong answer the panel
 * could give.
 */

const NOW = new Date('2026-10-12T15:00:00Z')

describe('abandoned teams', () => {
  it('keeps unowned seats and quiet managers apart, and calls quiet a warning', () => {
    const flag = abandonedTeamsFlag({
      managers: [
        { name: 'Busy Bees', status: 'active' },
        { name: 'Sleepy', status: 'inactive' },
      ],
      orphanTeams: ['Ghost Town'],
      totalTeams: 3,
      action: null,
    })
    expect(flag.measured).toBe(true)
    if (!flag.measured) return
    expect(flag.count).toBe(2)
    expect(flag.severity).toBe('warn')
    expect(flag.headline).toBe('1 team with no owner · 1 manager with no moves in 14 days')
    expect(flag.detail).toContain('No owner: Ghost Town.')
    expect(flag.detail).toContain('Quiet isn’t the same as gone')
    expect(flag.names).toEqual(['Ghost Town', 'Sleepy'])
  })

  it('is red only for two or more seats with nobody in them', () => {
    const quietOnly = abandonedTeamsFlag({
      managers: [
        { name: 'a', status: 'inactive' },
        { name: 'b', status: 'inactive' },
        { name: 'c', status: 'active' },
      ],
      orphanTeams: [],
      totalTeams: 3,
      action: null,
    })
    expect(quietOnly.measured && quietOnly.severity).toBe('warn')
    // Two unowned teams with the same imported name are still two teams.
    const unowned = abandonedTeamsFlag({ managers: [], orphanTeams: ['Unnamed team', 'Unnamed team'], totalTeams: 14, action: null })
    expect(unowned.measured && unowned.severity).toBe('bad')
    expect(unowned.measured && unowned.headline).toBe('2 teams with no owner')
  })

  it('refuses rather than reporting zero when manager activity could not be read', () => {
    const flag = abandonedTeamsFlag({ managers: null, orphanTeams: [], totalTeams: 12, action: null })
    expect(flag.measured).toBe(false)
  })

  it('refuses to judge activity on data that has stopped arriving', () => {
    const resync = { label: 'Re-sync this league', href: '/core/sync?league=L1', external: false }
    const flag = abandonedTeamsFlag({
      managers: [{ name: 'Everyone', status: 'inactive' }],
      orphanTeams: [],
      totalTeams: 12,
      action: null,
      stale: { reason: 'AllFantasy last read this league 14 days ago', action: resync },
    })
    expect(flag.measured).toBe(false)
    expect(flag.action).toEqual(resync)
    const lineups = missingLineupsFlag({
      platform: 'sleeper',
      inSeason: true,
      rosters: [{ name: 'Holes', starters: ['0'] }],
      action: null,
      stale: { reason: 'old', action: resync },
    })
    expect(lineups.measured).toBe(false)
  })

  it('calls a league where nobody moved quiet, instead of naming every manager', () => {
    const flag = abandonedTeamsFlag({
      managers: [
        { name: 'a', status: 'inactive' },
        { name: 'b', status: 'inactive' },
      ],
      orphanTeams: [],
      totalTeams: 2,
      action: { label: 'x', href: '/x', external: false },
    })
    expect(flag.measured && flag.severity).toBe('warn')
    expect(flag.measured && flag.headline).toBe('No manager has made a move in 14 days')
    expect(flag.measured && flag.names).toEqual([])
  })

  it('says why activity was not judged', () => {
    const flag = abandonedTeamsFlag({
      managers: null,
      activityReason: 'The newest imported move is 20 days old',
      orphanTeams: [],
      totalTeams: 12,
      action: null,
    })
    expect(flag.measured).toBe(false)
    expect(!flag.measured && flag.reason).toBe('The newest imported move is 20 days old')
  })

  it('is green only when every team is covered', () => {
    const flag = abandonedTeamsFlag({
      managers: [{ name: 'A', status: 'active' }, { name: 'B', status: 'at_risk' }],
      orphanTeams: [],
      totalTeams: 2,
      action: { label: 'x', href: '/x', external: false },
    })
    expect(flag.measured && flag.severity).toBe('good')
    // No action on a green flag — there is nothing to do.
    expect(flag.action).toBeNull()
  })
})

describe('missing lineups', () => {
  it('treats Sleeper\'s "0" as an empty slot, which filter(Boolean) does not', () => {
    const flag = missingLineupsFlag({
      platform: 'sleeper',
      inSeason: true,
      rosters: [
        { name: 'Holes', starters: ['4046', '0', '0', '6794'] },
        { name: 'Full', starters: ['1', '2', '3', '4'] },
      ],
      action: null,
    })
    expect(flag.measured).toBe(true)
    if (!flag.measured) return
    expect(flag.count).toBe(1)
    expect(flag.names).toEqual(['Holes'])
    expect(flag.detail).toContain('Holes (2 empty slots)')
  })

  it('does not accuse MFL or Fantrax managers — a blank lineup there is unreported, not empty', () => {
    for (const platform of ['mfl', 'fantrax']) {
      const flag = missingLineupsFlag({ platform, inSeason: true, rosters: [{ name: 'X', starters: [] }], action: null })
      expect(flag.measured).toBe(false)
    }
  })

  it('does not check lineups outside the season', () => {
    const flag = missingLineupsFlag({
      platform: 'sleeper',
      inSeason: false,
      rosters: [{ name: 'Holes', starters: ['0', '0'] }],
      action: null,
    })
    expect(flag.measured).toBe(false)
  })

  it('excludes unreadable rosters and says how many', () => {
    const flag = missingLineupsFlag({
      platform: 'sleeper',
      inSeason: true,
      rosters: [
        { name: 'Full', starters: ['1', '2'] },
        { name: 'Unknown', starters: null },
      ],
      action: null,
    })
    expect(flag.measured && flag.count).toBe(0)
    expect(flag.measured && flag.detail).toContain('1 roster could not be read')
  })
})

describe('unequal schedules', () => {
  const teamName = (id: string) => `Team ${id}`
  it('flags a team with fewer played weeks than the rest', () => {
    const games = [
      ...[1, 2, 3].flatMap((week) => [
        { rosterId: '1', week, matchupId: week },
        { rosterId: '2', week, matchupId: week },
      ]),
      { rosterId: '3', week: 1, matchupId: 9 },
      { rosterId: '3', week: 2, matchupId: 9 },
      // Week 3 exists for team 3 but has no matchup — a bye it should not have had.
      { rosterId: '3', week: 3, matchupId: null },
    ]
    const flag = unequalSchedulesFlag({
      games,
      rosterIds: ['1', '2', '3', '4'],
      teamName,
      throughWeek: 3,
      eliminationFormat: false,
      action: null,
    })
    expect(flag.measured).toBe(true)
    if (!flag.measured) return
    // Team 4 has no rows at all and still counts as behind.
    expect(flag.names).toEqual(['Team 4', 'Team 3'])
  })

  it('ignores weeks after the last played one', () => {
    const flag = unequalSchedulesFlag({
      games: [
        { rosterId: '1', week: 1, matchupId: 1 },
        { rosterId: '2', week: 1, matchupId: 1 },
        { rosterId: '1', week: 2, matchupId: 2 },
      ],
      rosterIds: ['1', '2'],
      teamName,
      throughWeek: 1,
      eliminationFormat: false,
      action: null,
    })
    expect(flag.measured && flag.count).toBe(0)
  })

  it('does not call an elimination format unequal', () => {
    const flag = unequalSchedulesFlag({
      games: [{ rosterId: '1', week: 1, matchupId: 1 }],
      rosterIds: ['1', '2'],
      teamName,
      throughWeek: 1,
      eliminationFormat: true,
      action: null,
    })
    expect(flag.measured).toBe(false)
  })
})

describe('unpaid dues', () => {
  const teams = [
    { id: 't1', name: 'Paid Up' },
    { id: 't2', name: 'Owes' },
  ]

  it('is unmeasured — never green — when the league does not track dues', () => {
    expect(unpaidDuesFlag({ tracker: null, teams, action: null }).measured).toBe(false)
    const off = readDuesTracker({ dues_tracker: { enabled: false, entries: [] } })
    expect(unpaidDuesFlag({ tracker: off, teams, action: null }).measured).toBe(false)
  })

  it('counts a team with no entry as unpaid', () => {
    const tracker = readDuesTracker({
      dues_tracker: { enabled: true, amount: 100, currency: 'USD', entries: [{ teamId: 't1', paid: true }] },
    })
    const flag = unpaidDuesFlag({ tracker, teams, action: null })
    expect(flag.measured && flag.names).toEqual(['Owes'])
    expect(flag.measured && flag.headline).toContain('$100')
  })

  it('never renders a payment link that is not https', () => {
    expect(readDuesTracker({ dues_tracker: { enabled: true, paymentLink: 'javascript:alert(1)' } })?.paymentLink).toBeNull()
    expect(readDuesTracker({ dues_tracker: { enabled: true, paymentLink: 'https://www.leaguesafe.com/x' } })?.paymentLink).toBe(
      'https://www.leaguesafe.com/x',
    )
  })
})

describe('unresolved votes', () => {
  const poll = (over: Partial<LeaguePoll>): LeaguePoll => ({
    id: 'p',
    question: 'Keepers?',
    options: [{ id: 'a', text: 'Yes', count: 1, mine: false }],
    totalVotes: 1,
    closesAt: null,
    closedByHand: false,
    allowMultiple: false,
    anonymous: false,
    postedAt: '2026-10-11T00:00:00Z',
    ...over,
  })

  it('counts only polls still open, soonest deadline first', () => {
    const polls = [
      poll({ id: 'late', closesAt: '2026-10-20T00:00:00Z' }),
      poll({ id: 'soon', closesAt: '2026-10-13T00:00:00Z' }),
      poll({ id: 'closed', closedByHand: true }),
      poll({ id: 'expired', closesAt: '2026-10-01T00:00:00Z' }),
    ]
    expect(openPolls(polls, NOW).map((p) => p.id)).toEqual(['soon', 'late'])
    const flag = unresolvedVotesFlag({ polls, now: NOW, action: null })
    expect(flag.measured && flag.count).toBe(2)
    // One closes inside 24 hours — worth a warning.
    expect(flag.measured && flag.severity).toBe('warn')
  })

  it('says it could not read chat rather than reporting no votes', () => {
    expect(unresolvedVotesFlag({ polls: null, now: NOW, action: null }).measured).toBe(false)
  })
})

it('ranks the worst flags first and unmeasured ones last', () => {
  const flags = rankFlags([
    unpaidDuesFlag({ tracker: null, teams: [], action: null }),
    abandonedTeamsFlag({ managers: [], orphanTeams: [], totalTeams: 2, action: null }),
    abandonedTeamsFlag({
      managers: [{ name: 'c', status: 'active' }],
      orphanTeams: ['x', 'y'],
      totalTeams: 3,
      action: null,
    }),
  ])
  expect(flags.map((f) => (f.measured ? f.severity : 'unmeasured'))).toEqual(['bad', 'good', 'unmeasured'])
})
