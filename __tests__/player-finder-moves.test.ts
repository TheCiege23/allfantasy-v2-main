import { describe, expect, it } from 'vitest'

import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { RecommendedMove } from '@/lib/core-app/playerFinder'
import { composePlayerMoves, fixesTotal, readiness } from '@/lib/core-app/playerMoves'
import { claimLink, lineupLink, movePath, tradeLink } from '@/lib/core-app/platformLinks'

/*
 * The Player Finder's "Recommended moves" and the verdict's "+13.0", as
 * composed from the loaders' output. Pure, so this runs without a database.
 *
 * The fixture is the handoff's worked example, Dalton Kincaid across three
 * leagues: benched behind Ferguson in a Sleeper TE-premium league (+2.4),
 * parked in an ESPN IR slot while active (+10.6), and correctly started on
 * Yahoo. The handoff's verdict is "two minutes of fixes for +13.0".
 */

function impact(over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: { available: false, reason: 'unpriced in fixture' },
    replacements: { available: false, reason: 'none in fixture' },
    startOver: null,
    ...over,
  }
}

const DRAGONS = impact({
  leagueId: 'L-dragons',
  leagueName: 'Dynasty Dragons',
  platform: 'sleeper',
  platformLeagueId: '123456',
  slot: 'BENCH',
  afPoints: { available: true, data: { points: 11.1, matchedKeys: 4, scoredKeys: 30 } },
  startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', slot: 'TE', afPoints: 8.7, delta: 2.4 },
})

const ELITES = impact({
  leagueId: 'L-elites',
  leagueName: 'End Zone Elites',
  platform: 'espn',
  platformLeagueId: '777',
  slot: 'IR SLOT',
  afPoints: { available: true, data: { points: 10.6, matchedKeys: 4, scoredKeys: 28 } },
})

const WARRIORS = impact({
  leagueId: 'L-warriors',
  leagueName: 'Waiver Warriors',
  platform: 'yahoo',
  platformLeagueId: '55',
  slot: 'STARTER',
  exactSlot: 'TE',
  afPoints: { available: true, data: { points: 9.9, matchedKeys: 4, scoredKeys: 20 } },
})

/*
 * Legal moves only (2026-09-06): a swap the platform would refuse right now
 * is marked locked and sorted last. Sunday 2026-10-25: BUF and DAL 1:00pm ET.
 */
describe('composePlayerMoves — game-day legality', () => {
  const KICKOFFS = { BUF: '2026-10-25T17:00:00.000Z', DAL: '2026-10-25T17:00:00.000Z', BAL: '2026-10-25T20:25:00.000Z' }
  const dragons = impact({ ...DRAGONS, startOver: { ...DRAGONS.startOver!, team: 'DAL' } })
  const base = { playerName: 'Dalton Kincaid', injuryStatus: 'Active', impact: [dragons, ELITES], freeAgents: [], kickoffs: KICKOFFS, playerTeam: 'BUF' }

  it('leaves every move makeable before kickoff, and without kickoffs at all', () => {
    const before = composePlayerMoves({ ...base, nowIso: '2026-10-25T16:18:00.000Z' })
    expect(before.map((m) => [m.key, m.locked])).toEqual([
      ['start:L-dragons', null],
      ['ir:L-elites', null],
    ])
    expect(composePlayerMoves({ ...base, kickoffs: {}, nowIso: '2026-10-25T17:30:00.000Z' }).every((m) => m.locked === null)).toBe(true)
  })

  it('locks the swap once either side has kicked off, names the game, and sorts locked moves last', () => {
    const after = composePlayerMoves({ ...base, nowIso: '2026-10-25T17:30:00.000Z' })
    // Both are locked here (his own game and Ferguson's), so the order falls back to tone.
    expect(after.map((m) => m.key)).toEqual(['start:L-dragons', 'ir:L-elites'])
    expect(after[0].locked).toBe('locked — both games have kicked off')
    expect(after[0].note).toBe('locked — both games have kicked off')
    expect(after[1].locked).toBe('locked — Kincaid’s game kicked off Sun 1:00p ET')
    expect(after[1].note).toBe('locked — Kincaid’s game kicked off Sun 1:00p ET · an IR-slot player scores nothing')

    // Only the displaced starter has kicked off: the swap is locked and drops below the still-makeable IR move.
    const lateBuf = composePlayerMoves({ ...base, kickoffs: { ...KICKOFFS, BUF: '2026-10-25T20:25:00.000Z' }, nowIso: '2026-10-25T17:30:00.000Z' })
    expect(lateBuf.map((m) => [m.key, m.locked])).toEqual([
      ['ir:L-elites', null],
      ['start:L-dragons', 'locked — Ferguson’s game kicked off Sun 1:00p ET'],
    ])
    expect(lateBuf[1].link).not.toBeNull() // the link is kept; the card hides the button
  })
})

const CLAIM: RecommendedMove = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'sleeper',
  projectionWeek: 12,
  affectedProjection: 6.2,
  freeAgents: [{ playerId: '9', name: 'Isaiah Likely', position: 'TE', projectedPoints: 12.3, delta: 6.1 }],
  claimTarget: { kind: 'provider', provider: 'sleeper', url: 'https://sleeper.com/leagues/999/players' },
}

describe('composePlayerMoves', () => {
  it('turns a benched player who out-projects a starter into a lineup fix with the platform link', () => {
    const [move] = composePlayerMoves({
      playerName: 'Dalton Kincaid',
      injuryStatus: 'Active',
      impact: [DRAGONS],
      freeAgents: [],
    })
    expect(move).toMatchObject({
      tone: 'bad',
      title: 'Swap Ferguson out for Kincaid at TE',
      path: 'Sleeper › Dynasty Dragons › Lineup',
      delta: 2.4,
      scoring: 'league',
    })
    expect(move.link).toMatchObject({ href: 'https://sleeper.com/leagues/123456/team', label: 'Open in Sleeper', external: true })
  })

  it('an IR-slot player who is not ruled out gets the IR fix, worth his whole projection', () => {
    const [move] = composePlayerMoves({
      playerName: 'Dalton Kincaid',
      injuryStatus: 'Active',
      impact: [ELITES],
      freeAgents: [],
    })
    expect(move).toMatchObject({
      tone: 'warn',
      title: "Move Kincaid off IR — he's active",
      path: 'ESPN › End Zone Elites › Roster',
      note: 'an IR-slot player scores nothing',
      delta: 10.6,
    })
    // ESPN has a verified league page and nothing deeper; the link says so.
    expect(move.link?.href).toBe('https://fantasy.espn.com/football/league?leagueId=777&seasonId=2026')
    expect(move.link?.screen).toBe('League')
  })

  /*
   * ⚠ A PLAYER GENUINELY ON IR STAYS THERE. "Move him off IR" on someone the
   * league has ruled out is the wrong advice, and with no report at all we
   * cannot tell — so no card either way.
   */
  it('never tells you to move a ruled-out or unreported player off IR', () => {
    for (const status of ['IR', 'Out', 'Injured Reserve', null]) {
      expect(
        composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: status, impact: [ELITES], freeAgents: [] }),
      ).toEqual([])
    }
  })

  it('a starter, and a benched player whose bench is right, produce no card', () => {
    const benchIsRight = impact({ ...DRAGONS, startOver: { ...DRAGONS.startOver!, delta: -1.2 } })
    expect(
      composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: 'Active', impact: [WARRIORS, benchIsRight], freeAgents: [] }),
    ).toEqual([])
  })

  it('a free agent who beats him becomes a standard-scoring claim, and a worse one does not', () => {
    const [claim] = composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: null, impact: [], freeAgents: [CLAIM] })
    expect(claim).toMatchObject({
      tone: 'good',
      title: 'Claim Isaiah Likely over Kincaid',
      path: 'Sleeper › Gridiron Gang › Waivers',
      delta: 6.1,
      scoring: 'standard',
    })
    expect(claim.link?.href).toBe('https://sleeper.com/leagues/999/players')

    const worse: RecommendedMove = { ...CLAIM, freeAgents: [{ ...CLAIM.freeAgents[0], delta: -0.4 }] }
    expect(composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: null, impact: [], freeAgents: [worse] })).toEqual([])
  })

  /* Urgent first: a wrong lineup today outranks a claim that can wait until Tuesday. */
  it('orders lineup fixes, then IR, then claims — and the verdict total is the league-scored fixes only', () => {
    const moves = composePlayerMoves({
      playerName: 'Dalton Kincaid',
      injuryStatus: 'Active',
      impact: [WARRIORS, ELITES, DRAGONS],
      freeAgents: [CLAIM],
    })
    expect(moves.map((m) => m.tone)).toEqual(['bad', 'warn', 'good'])
    expect(fixesTotal(moves)).toBe(13.0)
  })

  it('reports no total when none of the fixes could be priced', () => {
    const unpriced = impact({ ...ELITES, afPoints: { available: false, reason: 'no rules' } })
    const moves = composePlayerMoves({ playerName: 'Dalton Kincaid', injuryStatus: 'Active', impact: [unpriced], freeAgents: [] })
    expect(moves).toHaveLength(1)
    expect(fixesTotal(moves)).toBeNull()
  })
})

describe('readiness', () => {
  /* ⚠ NO ROW, NO CHIP — "we hold nothing" is not "healthy". */
  it('renders no chip without an injury report', () => {
    expect(readiness(null, false)).toBeNull()
  })
  it('reads the designation the way the rest of the app does', () => {
    expect(readiness('Active', true)).toEqual({ tone: 'good', label: 'Ready' })
    expect(readiness('Questionable', true)).toEqual({ tone: 'warn', label: 'Questionable' })
    expect(readiness('IR', true)).toEqual({ tone: 'bad', label: 'IR' })
    expect(readiness('Out', true)).toEqual({ tone: 'bad', label: 'Out' })
  })
})

describe('platform links', () => {
  const yahoo = { id: 'L1', platform: 'yahoo', platformLeagueId: '55', season: 2026, name: 'Waiver Warriors' }
  const native = { id: 'L2', platform: 'manual', platformLeagueId: null, season: 2026, name: 'House League' }
  const sleeperNoId = { id: 'L3', platform: 'sleeper', platformLeagueId: null, season: 2026, name: 'Old Import' }

  it('sends Yahoo to its verified screens over https — waivers needs no team id, lineup does', () => {
    // No team id in this fixture, so the lineup link falls back to the league page.
    expect(lineupLink(yahoo)).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/55', external: true, screen: 'League' })
    // Waivers verified 2026-09-05 on league 1361311; the format needs only the league number.
    expect(claimLink(yahoo)).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/55/players', screen: 'Waivers' })
    expect(lineupLink({ ...yahoo, teamId: '10' })).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/55/10', screen: 'Lineup' })
  })

  it('keeps a native league inside AllFantasy', () => {
    expect(lineupLink(native)).toMatchObject({ href: '/core/my-team?league=L2', external: false, label: 'Open in AllFantasy' })
    expect(claimLink(native)?.href).toBe('/waiver-wire?leagueId=L2')
  })

  /* No platform id means no team page; the resolver's homepage fallback is named as such. */
  it('falls back honestly when a Sleeper league has no platform id', () => {
    const l = lineupLink(sleeperNoId)
    expect(l?.href).toBe('https://sleeper.com')
    expect(l?.screen).toBe('Sleeper home')
  })

  it('a trade starts on our own trade screen, with the platform page beside it when known', () => {
    const t = tradeLink(yahoo)
    expect(t.here.href).toBe('/core/trades?league=L1')
    expect(t.there?.href).toBe('https://football.fantasysports.yahoo.com/f1/55')
    expect(tradeLink(native).there).toBeNull()
  })

  it('spells the path the way the handoff does', () => {
    expect(movePath(yahoo, 'Lineup')).toBe('Yahoo › Waiver Warriors › Lineup')
    expect(movePath(native, 'Waivers')).toBe('AllFantasy › House League › Waivers')
  })
})
