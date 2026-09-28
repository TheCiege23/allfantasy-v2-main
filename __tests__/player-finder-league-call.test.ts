import { describe, expect, it } from 'vitest'

import { chimmyAsk, inactiveListClock, leagueCall } from '@/lib/core-app/leagueCall'
import type { LeagueImpact, ReplacementOption } from '@/lib/core-app/playerImpact'

/*
 * One computed start/sit call per league (Phase 3). Sunday 12:18p ET: BUF/MIA kick off 1:00p,
 * DAL played Thursday (locked).
 */
const NOW = '2026-10-25T16:18:00.000Z'
const KICKOFFS = { BUF: '2026-10-25T17:00:00.000Z', MIA: '2026-10-25T17:00:00.000Z', DAL: '2026-10-23T00:15:00.000Z' }
const HIM = { sleeperId: '10236', name: 'Dalton Kincaid', team: 'BUF' }

const opt = (o: Partial<ReplacementOption>): ReplacementOption =>
  ({ playerId: 'x', name: 'X', position: 'TE', team: 'MIA', afPoints: 9, delta: 1, injuryStatus: null, from: 'BENCH', ...o }) as ReplacementOption
const impact = (o: Partial<LeagueImpact>): LeagueImpact =>
  ({
    leagueId: 'L1',
    leagueName: 'KBFL',
    platform: 'sleeper',
    isStarting: true,
    replacements: { available: true, data: [] },
    startOver: null,
    ...o,
  }) as unknown as LeagueImpact

describe('leagueCall', () => {
  it('locked when his game has kicked off — nothing can move', () => {
    const c = leagueCall({ impact: impact({}), player: { ...HIM, team: 'DAL' }, readinessTone: 'bad', kickoffs: KICKOFFS, nowIso: NOW })
    expect(c).toMatchObject({ kind: 'locked', swap: null })
  })

  it('sit an OUT starter for the best movable bench player — never an IR, taxi, locked or hurt one', () => {
    const options = [
      opt({ playerId: 'ir', name: 'On IR', from: 'IR', afPoints: 20 }),
      opt({ playerId: 'locked', name: 'Played Thursday', team: 'DAL', afPoints: 15 }),
      opt({ playerId: 'hurt', name: 'Also Out', injuryStatus: 'Out', afPoints: 14 }),
      opt({ playerId: 'ok', name: 'Tucker Kraft', afPoints: 8.2 }),
    ]
    const c = leagueCall({ impact: impact({ replacements: { available: true, data: options } }), player: HIM, readinessTone: 'bad', kickoffs: KICKOFFS, nowIso: NOW })
    expect(c).toMatchObject({ kind: 'sit', tone: 'bad', headline: 'Sit him — start Tucker Kraft', swap: { startId: 'ok', benchId: '10236' } })
  })

  it('sit a healthy starter only when a movable bench player out-projects him HERE', () => {
    const better = leagueCall({ impact: impact({ replacements: { available: true, data: [opt({ playerId: 'b', name: 'Better', delta: 2.4 })] } }), player: HIM, readinessTone: 'warn', kickoffs: KICKOFFS, nowIso: NOW })
    expect(better).toMatchObject({ kind: 'sit', tone: 'warn', why: 'Better projects +2.4 over him under this league\'s scoring.' })
    const worse = leagueCall({ impact: impact({ replacements: { available: true, data: [opt({ delta: -1 })] } }), player: HIM, readinessTone: null, kickoffs: KICKOFFS, nowIso: NOW })
    expect(worse).toMatchObject({ kind: 'hold', headline: 'Keep him in', swap: null })
  })

  it('start him from the bench when he out-projects the starter he would replace — unless that starter is locked', () => {
    const so = { playerId: 's', name: 'Sam LaPorta', position: 'TE', team: 'MIA', slot: 'TE', afPoints: 7, delta: 3.1 }
    const start = leagueCall({ impact: impact({ isStarting: false, startOver: so }), player: HIM, readinessTone: null, kickoffs: KICKOFFS, nowIso: NOW })
    expect(start).toMatchObject({ kind: 'start', headline: 'Start him over Sam LaPorta', swap: { startId: '10236', benchId: 's' } })
    const partnerLocked = leagueCall({ impact: impact({ isStarting: false, startOver: { ...so, team: 'DAL' } }), player: HIM, readinessTone: null, kickoffs: KICKOFFS, nowIso: NOW })
    expect(partnerLocked).toMatchObject({ kind: 'locked', swap: null })
    const bench = leagueCall({ impact: impact({ isStarting: false, startOver: { ...so, delta: -0.5 } }), player: HIM, readinessTone: null, kickoffs: KICKOFFS, nowIso: NOW })
    expect(bench).toMatchObject({ kind: 'hold', headline: 'Bench is right' })
  })

  it('never recommends starting a ruled-out player off the bench', () => {
    const so = { playerId: 's', name: 'Sam LaPorta', position: 'TE', team: 'MIA', slot: 'TE', afPoints: 7, delta: 3.1 }
    expect(leagueCall({ impact: impact({ isStarting: false, startOver: so }), player: HIM, readinessTone: 'bad', kickoffs: KICKOFFS, nowIso: NOW }).kind).toBe('hold')
  })

  it('asks Chimmy the question the card already framed, naming the league', () => {
    const c = leagueCall({ impact: impact({ replacements: { available: true, data: [opt({ playerId: 'b', name: 'Tucker Kraft', delta: 2 })] } }), player: HIM, readinessTone: null, kickoffs: KICKOFFS, nowIso: NOW })
    expect(chimmyAsk(c, HIM.name)).toBe('In KBFL: should I bench Dalton Kincaid for Tucker Kraft this week?')
  })
})

describe('the questionable starter — the game-day case', () => {
  it('keeps him in, names the backup to have ready, and says when the inactive list lands', () => {
    const options = [opt({ playerId: 'k', name: 'Tucker Kraft', afPoints: 8, delta: -1.5 })]
    const c = leagueCall({ impact: impact({ replacements: { available: true, data: options } }), player: HIM, readinessTone: 'warn', kickoffs: KICKOFFS, nowIso: NOW })
    expect(c).toMatchObject({
      kind: 'hold',
      tone: 'warn',
      headline: 'Keep him in — have Tucker Kraft ready',
      why: 'He is questionable and nobody on your bench out-projects him here. If he is ruled out, start Tucker Kraft. Inactives are announced around Sun 11:30a ET.',
      swap: { startId: 'k', benchId: '10236' },
    })
    expect(chimmyAsk(c, HIM.name)).toBe('In KBFL: Dalton Kincaid is questionable — should I keep him in or start Tucker Kraft?')
  })

  it('says plainly when there is no backup who can come in', () => {
    const c = leagueCall({ impact: impact({ replacements: { available: true, data: [opt({ from: 'IR' })] } }), player: HIM, readinessTone: 'warn', kickoffs: KICKOFFS, nowIso: NOW })
    expect(c).toMatchObject({ kind: 'hold', tone: 'warn', headline: 'Keep him in — no backup', swap: null })
  })

  it('a questionable starter WITH a better bench option is a sit, not a hold', () => {
    const c = leagueCall({ impact: impact({ replacements: { available: true, data: [opt({ name: 'Better', delta: 1.2 })] } }), player: HIM, readinessTone: 'warn', kickoffs: KICKOFFS, nowIso: NOW })
    expect(c.kind).toBe('sit')
  })

  it('reads the inactive-list time off his own kickoff, and says nothing without one', () => {
    expect(inactiveListClock('BUF', KICKOFFS)).toBe('Sun 11:30a ET')
    expect(inactiveListClock('Buffalo Bills', KICKOFFS)).toBe('Sun 11:30a ET')
    expect(inactiveListClock('NYJ', KICKOFFS)).toBeNull()
    expect(inactiveListClock(null, KICKOFFS)).toBeNull()
  })
})
