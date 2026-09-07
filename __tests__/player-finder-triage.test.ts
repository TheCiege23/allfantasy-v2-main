import { describe, expect, it } from 'vitest'

import { triageRows, type TriageInjury, type TriageStarter } from '@/lib/core-app/gameDayTriage'

/*
 * The finder's game-day home: your flagged starters, soonest lock first.
 * Sunday 2026-10-25 12:18pm ET: the 1:00 games are 42 minutes out, the 4:25
 * game is later, and one early game (Thursday) has already been played.
 */

const NOW = '2026-10-25T16:18:00.000Z'
const KICKOFFS = {
  BUF: '2026-10-25T17:00:00.000Z',
  MIA: '2026-10-25T17:00:00.000Z',
  BAL: '2026-10-25T20:25:00.000Z',
  LAR: '2026-10-23T00:15:00.000Z', // Thursday night, already played
}

function starter(sleeperId: string, name: string, team: string | null, leagueId: string, leagueName: string, platform = 'sleeper'): TriageStarter {
  return { sleeperId, sport: 'NFL', externalId: `ri-${sleeperId}`, name, position: 'TE', team, imageUrl: null, leagueId, leagueName, platform }
}
// Reported Friday evening — the injury report's ruling, not a game-day scratch (see the Inactive case below).
const inj = (status: string, description: string | null = null): TriageInjury => ({ status, description, reportedAt: '2026-10-23T20:31:00.000Z' })

describe('triageRows', () => {
  const starters = [
    starter('1', 'Dalton Kincaid', 'BUF', 'L-dragons', 'Dynasty Dragons'),
    starter('1', 'Dalton Kincaid', 'BUF', 'L-elites', 'End Zone Elites', 'espn'),
    starter('2', 'Mark Andrews', 'BAL', 'L-dragons', 'Dynasty Dragons'),
    starter('3', 'Tyler Higbee', 'LAR', 'L-elites', 'End Zone Elites', 'espn'),
    starter('4', 'Jake Ferguson', 'DAL', 'L-dragons', 'Dynasty Dragons'),
    starter('5', 'Healthy Guy', 'MIA', 'L-dragons', 'Dynasty Dragons'),
    starter('6', 'Unreported Guy', 'MIA', 'L-dragons', 'Dynasty Dragons'),
  ]
  const injuries = new Map<string, TriageInjury>([
    ['dalton kincaid', inj('Out', 'Ankle')],
    ['mark andrews', inj('Questionable', 'Knee')],
    ['tyler higbee', inj('Doubtful')],
    ['healthy guy', inj('Active')],
  ])

  it('lists only flagged starters, one row per player with every league he starts in, soonest lock first', () => {
    const rows = triageRows({ starters, injuries, kickoffs: KICKOFFS, nowIso: NOW })
    expect(rows.map((r) => r.player.name)).toEqual(['Dalton Kincaid', 'Mark Andrews', 'Jake Ferguson', 'Tyler Higbee'])
    // Kincaid: 1:00 kickoff, two leagues folded into one row.
    expect(rows[0].status).toEqual({ tone: 'bad', label: 'Out' })
    expect(rows[0].description).toBe('Ankle')
    expect(rows[0].leagues.map((l) => l.leagueName)).toEqual(['Dynasty Dragons', 'End Zone Elites'])
    expect(rows[0].kickoff).toBe(KICKOFFS.BUF)
    // Andrews: 4:25 kickoff, later.
    expect(rows[1]).toMatchObject({ status: { tone: 'warn', label: 'Questionable' }, kickoff: KICKOFFS.BAL, noGame: false })
    // Ferguson: no report, but his club is not on the week's schedule — flagged as no game, after the games still ahead.
    expect(rows[2]).toMatchObject({ status: null, kickoff: null, noGame: true })
    // Higbee: Doubtful, but his game was Thursday — already locked, so last.
    expect(rows[3]).toMatchObject({ status: { tone: 'warn', label: 'Doubtful' }, kickoff: KICKOFFS.LAR })
    // Healthy and unreported starters with a game are not listed.
    expect(rows.some((r) => r.player.name === 'Healthy Guy' || r.player.name === 'Unreported Guy')).toBe(false)
  })

  it('reads an Out that landed inside the pregame window as "Inactive", with when and how long before kickoff', () => {
    // Kincaid's Out reported 11:32a ET for a 1:00p kickoff; Andrews' Questionable at the same minute is a forecast, not a scratch.
    const late = new Map<string, TriageInjury>([
      ['dalton kincaid', { status: 'Out', description: 'Ankle', reportedAt: '2026-10-25T15:32:00.000Z' }],
      ['mark andrews', { status: 'Questionable', description: 'Knee', reportedAt: '2026-10-25T15:32:00.000Z' }],
    ])
    const rows = triageRows({ starters, injuries: late, kickoffs: KICKOFFS, nowIso: NOW, week: 12 })
    const kincaid = rows.find((r) => r.player.name === 'Dalton Kincaid')!
    expect(kincaid.status).toEqual({ tone: 'bad', label: 'Inactive' })
    expect(kincaid.inactive).toEqual({ announcedAt: '2026-10-25T15:32:00.000Z', minutesBeforeKickoff: 88, clock: '11:32a ET' })
    expect(rows.find((r) => r.player.name === 'Mark Andrews')!.inactive).toBeNull()
    // The Friday ruling in the default fixture is Out, not Inactive.
    expect(triageRows({ starters, injuries, kickoffs: KICKOFFS, nowIso: NOW, week: 12 }).find((r) => r.player.name === 'Dalton Kincaid')!).toMatchObject({ status: { label: 'Out' }, inactive: null })
  })

  it('does not call a missing club "no game" when the schedule itself is missing', () => {
    const rows = triageRows({ starters, injuries, kickoffs: {}, nowIso: NOW })
    expect(rows.map((r) => r.player.name)).toEqual(['Dalton Kincaid', 'Mark Andrews', 'Tyler Higbee'])
    expect(rows.every((r) => r.kickoff === null && r.noGame === false)).toBe(true)
  })

  it('breaks a tie on the same kickoff by severity, then name', () => {
    const same = [starter('7', 'Zed Questionable', 'BUF', 'L-a', 'A'), starter('8', 'Abe Questionable', 'BUF', 'L-a', 'A'), starter('9', 'Out Guy', 'BUF', 'L-a', 'A')]
    const map = new Map<string, TriageInjury>([
      ['zed questionable', inj('Questionable')],
      ['abe questionable', inj('Questionable')],
      ['out guy', inj('Out')],
    ])
    expect(triageRows({ starters: same, injuries: map, kickoffs: KICKOFFS, nowIso: NOW }).map((r) => r.player.name)).toEqual(['Out Guy', 'Abe Questionable', 'Zed Questionable'])
  })
})
