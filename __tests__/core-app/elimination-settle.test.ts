import { describe, expect, it } from 'vitest'

import { settleEliminationWeek, settleSentence, type SettleTeam } from '@/lib/core-app/eliminationSettle'

/*
 * The live case, 2026-09-28 (Monday night, week 3), measured on Sleeper: 16 teams alive; the user
 * 4th on 87.74 with all five starters finished; the team in last on 46.54, also finished; the only
 * unfinished starters (Philadelphia and Chicago, yet to play) on OTHER teams. Chimmy said "you'd
 * need a collapse". The user could not be chopped. Team ids and scores otherwise synthetic.
 */
const F = ['final', 'final', 'final', 'final', 'final'] as const
const team = (rosterId: string, points: number, starters: SettleTeam['starters'] = F): SettleTeam => ({ rosterId, points, starters })

const LIVE_WEEK: SettleTeam[] = [
  team('8', 110.14), team('17', 96.46), team('15', 95.64),
  team('4', 87.74),
  team('13', 77.2), team('16', 76.18, ['final', 'final', 'upcoming', 'final', 'final']),
  team('10', 70.88), team('1', 70, ['final', 'upcoming', 'final', 'final', 'final']),
  team('3', 68.8, ['final', 'final', 'final', 'final', 'upcoming']), team('9', 67.18), team('11', 66.86),
  team('18', 63.58, ['final', 'upcoming', 'final', 'final', 'final']), team('14', 60.44, ['upcoming', 'final', 'final', 'final', 'final']),
  team('12', 55.54), team('2', 55.06),
  team('7', 46.54),
]

describe('settleEliminationWeek', () => {
  it('the live case is DECIDED: every starter of yours and of the team in last has finished', () => {
    const s = settleEliminationWeek({ field: LIVE_WEEK, yourRosterId: '4', chops: 1 })
    expect(s?.verdict).toBe('safe')
    expect(settleSentence(s!)).toMatch(/^SAFE THIS WEEK — IT IS DECIDED: every one of their starters has finished, and 7 teams below them have finished too/)
    expect(settleSentence(s!)).toMatch(/not that they are "comfortably clear"/)
  })

  it('still OPEN when the team in last has a starter to play, even though you are done', () => {
    const field = LIVE_WEEK.map((t) => (t.rosterId === '7' ? team('7', 46.54, ['final', 'upcoming', 'final', 'final', 'final']) : t))
    // Remove every other finished team below the user, so the last one is the only candidate.
    const narrow = field.filter((t) => t.points >= 87.74 || t.rosterId === '7' || t.starters.includes('upcoming'))
    const s = settleEliminationWeek({ field: narrow, yourRosterId: '4', chops: 1 })
    expect(s).toMatchObject({ verdict: 'open', yourUpcoming: 0, finishedBelow: 0, cutLinePending: 1 })
    expect(settleSentence(s!)).toBe(
      'NOT YET DECIDED. All their starters have finished. The team currently lowest still has 1 starter to finish. The margin can still move, in either direction.',
    )
  })

  it('still OPEN while one of YOUR starters has not played', () => {
    const field = LIVE_WEEK.map((t) => (t.rosterId === '4' ? team('4', 87.74, ['final', 'live', 'upcoming', 'final', 'final']) : t))
    const s = settleEliminationWeek({ field, yourRosterId: '4', chops: 1 })
    expect(s).toMatchObject({ verdict: 'open', yourUpcoming: 1, yourLive: 1 })
    expect(settleSentence(s!)).toMatch(/^NOT YET DECIDED\. Their starters: 1 yet to kick off, 1 in progress\./)
  })

  it('UNKNOWN is never final: a team whose game state is unreadable, or with no starters on file, does not count', () => {
    const unread = [team('4', 90), team('7', 40, ['final', 'unknown']), team('9', 120)]
    expect(settleEliminationWeek({ field: unread, yourRosterId: '4', chops: 1 })?.verdict).toBe('open')
    const empty = [team('4', 90), team('7', 40, []), team('9', 120)]
    expect(settleEliminationWeek({ field: empty, yourRosterId: '4', chops: 1 })?.verdict).toBe('open')
    const mineUnknown = settleEliminationWeek({ field: [team('4', 90, ['final', 'unknown']), team('7', 40)], yourRosterId: '4', chops: 1 })
    expect(mineUnknown).toMatchObject({ verdict: 'open', yourUnknown: 1 })
  })

  it('a two-chop week needs TWO finished teams below you', () => {
    const field = [team('4', 90), team('7', 40), team('8', 60, ['upcoming']), team('9', 120)]
    expect(settleEliminationWeek({ field, yourRosterId: '4', chops: 2 })?.verdict).toBe('open')
    const both = [team('4', 90), team('7', 40), team('8', 60), team('9', 120, ['upcoming'])]
    expect(settleEliminationWeek({ field: both, yourRosterId: '4', chops: 2 })).toMatchObject({ verdict: 'safe', finishedBelow: 2 })
  })

  it('CHOPPED only when the whole field has finished — a team above you still playing can lose points', () => {
    const allDone = [team('4', 40), team('7', 60), team('9', 120)]
    expect(settleEliminationWeek({ field: allDone, yourRosterId: '4', chops: 1 })?.verdict).toBe('chopped')
    const aboveStillPlaying = [team('4', 40), team('7', 41, ['final', 'live']), team('9', 120)]
    expect(settleEliminationWeek({ field: aboveStillPlaying, yourRosterId: '4', chops: 1 })?.verdict).toBe('open')
  })

  it('a tie with a finished team is not "below" you', () => {
    expect(settleEliminationWeek({ field: [team('4', 50), team('7', 50), team('9', 90)], yourRosterId: '4', chops: 1 })?.verdict).not.toBe('safe')
  })

  it('no chop this week, a field of one, or a user not in the field', () => {
    expect(settleEliminationWeek({ field: LIVE_WEEK, yourRosterId: '4', chops: 0 })?.verdict).toBe('no_chop')
    expect(settleEliminationWeek({ field: [team('4', 90)], yourRosterId: '4', chops: 1 })).toBeNull()
    expect(settleEliminationWeek({ field: LIVE_WEEK, yourRosterId: '99', chops: 1 })).toBeNull()
  })
})
