import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(), ingestBatch: vi.fn(),
  identityFind: vi.fn(), rawQuery: vi.fn(), profileFind: vi.fn(),
  rosterFind: vi.fn(), appUserFind: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterPlayer: { findMany: h.findMany },
    playerIdentityMap: { findMany: h.identityFind },
    userProfile: { findMany: h.profileFind },
    roster: { findMany: h.rosterFind },
    appUser: { findMany: h.appUserFind },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: h.ingestBatch }))

import { namedIn, parsePlayByPlay, playsToLiveEvents } from '@/lib/live/rollingInsightsPlayByPlay'
import { headlineFor, playActionParts } from '@/lib/live/playFeedPresentation'
import { notificationTitleFor, notifyBigPlays } from '@/lib/live/bigPlayNotifier'
import { playActionText } from '@/lib/core-app/homeBandsCopy'
import type { LiveEvent } from '@/lib/live/eventDetector'

/**
 * User report 2026-10-13: "a 2 pt post TD play happened and the phone notification called it a TD".
 *
 * The REAL row, from production's `pbp:feed:NFL` cache (read-only, 2026-10-13): game `20261012-1-8`
 * (BUF @ LA), sequence 123, `event: 'run'`, 1 yard, description verbatim below. It became
 * `TOUCHDOWN` about Dalton Kincaid (RI 7481, role receiver) with passer Josh Allen (RI 3348), and
 * `platform_notifications` holds the pushes: 10 × "Touchdown — Dalton Kincaid 1-yard receiving TD
 * from Josh Allen" and 9 × "Touchdown — Josh Allen 1-yard TD pass to Dalton Kincaid".
 *
 * The cache keeps the LiveEvent, not the vendor's `players[]`, so the arrays below are reconstructed:
 * each is one the pre-fix subject rule turns into exactly those two prod bodies (verified by disabling
 * the try split: the push test then receives them verbatim), and the two differ in whether the vendor
 * lists Allen's run at all.
 */
const REAL_DESCRIPTION =
  'J.Allen up the middle for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Allen pass to D.Kincaid is complete. ATTEMPT SUCCEEDS.'

const allenPasser = { id: 3348, name: 'Josh Allen', role: 'passer', action: 'pass', position: 'QB', teamAbbr: null }
const allenRusher = { ...allenPasser, role: 'rusher', action: 'rush' }
const kincaid = { id: 7481, name: 'Dalton Kincaid', role: 'receiver', action: 'receive', position: 'TE', teamAbbr: null }

const realPlay = (players: unknown[], over: Record<string, unknown> = {}) => ({
  sequence: 123,
  quarter: 3,
  gameClock: '0:00',
  event: 'run',
  yardsGained: 1,
  yardLine: 'LA 1',
  possession: 'Buffalo Bills',
  isTouchdown: true,
  isScoringPlay: true,
  isReturned: false,
  isReversed: false,
  description: REAL_DESCRIPTION,
  players,
  details: {},
  ...over,
})

const gameOf = (plays: unknown[]) =>
  parsePlayByPlay({ data: { NFL: [{ game_ID: '20261012-1-8', awayTeamName: 'Buffalo Bills', homeTeamName: 'Los Angeles Rams', plays }] } })[0]!

const eventsOf = (plays: unknown[]) => playsToLiveEvents(gameOf(plays), { now: new Date('2026-10-13T02:47:48Z') })

const SHAPES: Array<[string, unknown[]]> = [
  ['the try QB is the only Allen entry', [allenPasser, kincaid]],
  ['Allen listed for the run AND the try, receiver first', [kincaid, allenRusher, allenPasser]],
]

describe('the real 2026-10-12 play: a rushing TD and a 2-pt conversion pass', () => {
  it.each(SHAPES)('%s → Allen scores the TD, Kincaid the 2-pt conversion', (_label, players) => {
    const events = eventsOf([realPlay(players)])
    const td = events.find((e) => e.type === 'TOUCHDOWN')
    const two = events.find((e) => e.type === 'TWO_POINT_CONVERSION')
    expect(events).toHaveLength(2)
    expect(td).toMatchObject({
      playerId: '3348', playerName: 'Josh Allen', role: 'rusher', passerId: null, passerName: null, delta: 1,
      idempotencyKey: 'pbp:20261012-1-8:123:TOUCHDOWN',
    })
    expect(two).toMatchObject({
      playerId: '7481', playerName: 'Dalton Kincaid', role: 'receiver', passerId: '3348', passerName: 'Josh Allen',
      stat: 'two_point_conversion', idempotencyKey: 'pbp:20261012-1-8:123:TWO_POINT_CONVERSION',
    })
    // Kincaid is never the subject of a touchdown, which is what the TD clip pilot and TD copy key on.
    expect(events.filter((e) => e.type === 'TOUCHDOWN').map((e) => e.playerName)).toEqual(['Josh Allen'])
  })

  it('reads as a rushing TD and a 2-pt conversion, in English and Spanish', () => {
    // The touchdown first, the try after it: the order they happened, and the order the pushes go out.
    const [td, two] = eventsOf([realPlay([allenPasser, kincaid])]) as [LiveEvent, LiveEvent]
    expect([td.type, two.type]).toEqual(['TOUCHDOWN', 'TWO_POINT_CONVERSION'])
    expect(td.detail).toBe('J.Allen up the middle for 1 yard, TOUCHDOWN.')
    expect(headlineFor(td, null)).toBe('Josh Allen 1-yard rushing TD')
    expect(headlineFor(two, null)).toBe('Dalton Kincaid 2-pt conversion catch from Josh Allen')
    expect(playActionParts(two)).toEqual({ kind: 'two-point-catch', yards: null, from: 'Josh Allen', to: null })
    expect(playActionText(playActionParts(two))).toBe('conversión de 2 puntos por recepción, pase de Josh Allen')
    expect(notificationTitleFor(two)).toBe('2-pt conversion')
  })
})

describe('the other ways a try can go', () => {
  it('a FAILED try is not announced as anything, and its receiver is not the scorer', () => {
    const events = eventsOf([realPlay([kincaid, allenPasser], {
      description: 'J.Allen up the middle for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Allen pass to D.Kincaid is incomplete. ATTEMPT FAILS.',
    })])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'TOUCHDOWN', playerName: 'Josh Allen', role: 'rusher' })
  })

  it("the vendor's own `successful: false` wins over the prose", () => {
    const events = eventsOf([realPlay([kincaid, allenPasser], {
      details: { pointsAfterTouchdown: { type: 'two_point_conversion', successful: false } },
    })])
    expect(events.map((e) => e.type)).toEqual(['TOUCHDOWN'])
  })

  // Synthetic prose in the gamebook's form; no defensive return has been captured on this feed yet.
  it('a DEFENSIVE return of the try does not turn the touchdown into a pick-six, and credits no player', () => {
    const events = eventsOf([{
      ...realPlay([
        { id: 1, name: 'Matthew Stafford', role: 'passer', action: 'pass', position: 'QB', teamAbbr: 'LA' },
        { id: 2, name: 'Davante Adams', role: 'receiver', action: 'receive', position: 'WR', teamAbbr: 'LA' },
        { id: 3, name: 'Cole Bishop', role: 'interceptor', action: 'intercepted', position: 'S', teamAbbr: 'BUF' },
        { id: 4, name: 'Puka Nacua', role: 'receiver', action: 'receive', position: 'WR', teamAbbr: 'LA' },
      ]),
      event: 'pass',
      yardsGained: 2,
      possession: 'Los Angeles Rams',
      description: 'M.Stafford pass short left to P.Nacua for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford pass to D.Adams is intercepted. ATTEMPT FAILS. DEFENSIVE TWO-POINT ATTEMPT. C.Bishop intercepted the try attempt. ATTEMPT SUCCEEDS.',
    }])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'TOUCHDOWN', playerName: 'Puka Nacua', role: 'receiver', passerName: 'Matthew Stafford' })
  })

  it('a pass TD then a 2-pt pass by the same QB: each receiver gets his own event', () => {
    const stafford = { id: 1, name: 'Matthew Stafford', role: 'passer', action: 'pass', position: 'QB', teamAbbr: null }
    const events = eventsOf([{
      ...realPlay([
        stafford,
        { id: 2, name: 'Davante Adams', role: 'receiver', action: 'receive', position: 'WR', teamAbbr: null },
        { id: 4, name: 'Puka Nacua', role: 'receiver', action: 'receive', position: 'WR', teamAbbr: null },
      ]),
      event: 'pass',
      yardsGained: 2,
      description: 'M.Stafford pass short left to P.Nacua for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford pass to D.Adams is complete. ATTEMPT SUCCEEDS.',
    }])
    expect(events.find((e) => e.type === 'TOUCHDOWN')).toMatchObject({ playerName: 'Puka Nacua', passerName: 'Matthew Stafford' })
    expect(events.find((e) => e.type === 'TWO_POINT_CONVERSION')).toMatchObject({ playerName: 'Davante Adams', passerName: 'Matthew Stafford' })
  })

  it('a 2-pt RUN names the runner and no passer', () => {
    const events = eventsOf([realPlay([
      allenPasser,
      kincaid,
      { id: 5, name: 'James Cook III', role: 'rusher', action: 'rush', position: 'RB', teamAbbr: null },
    ], {
      event: 'pass',
      description: 'J.Allen pass short middle to D.Kincaid for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Cook rushes up the middle. ATTEMPT SUCCEEDS.',
    })])
    const two = events.find((e) => e.type === 'TWO_POINT_CONVERSION')!
    expect(two).toMatchObject({ playerName: 'James Cook III', role: 'rusher', passerName: null })
    expect(headlineFor(two, null)).toBe('James Cook III 2-pt conversion run')
    expect(events.find((e) => e.type === 'TOUCHDOWN')).toMatchObject({ playerName: 'Dalton Kincaid', passerName: 'Josh Allen' })
  })

  it('control: a real extra-point row (sequence 146) is one touchdown and nothing else', () => {
    const events = eventsOf([realPlay(
      [{ id: 9, name: 'James Cook III', role: 'rusher', action: 'rush', position: 'RB', teamAbbr: null },
        { id: 10, name: 'Bass', role: 'kicker', action: 'kick', position: 'K', teamAbbr: null }],
      { sequence: 146, yardsGained: 5, description: 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD, Center-R.Ferguson, Holder-T.Doman.' },
    )])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'TOUCHDOWN', playerName: 'James Cook III', role: 'rusher' })
  })
})

describe('namedIn — gamebook prose against players[] names', () => {
  it.each([
    ['J.Allen up the middle', 'Josh Allen', true],
    ['J.Allen pass to D.Kincaid', 'Dalton Kincaid', true],
    ['J.Cook up the middle', 'James Cook III', true],
    ['A.St. Brown pass', 'Amon-Ra St. Brown', true],
    ['A.St. Brown pass', 'A.St', true],
    ['T.Bass 45 yard field goal', 'Bass', true],
    ['J.Allen up the middle', 'Dalton Kincaid', false],
    ['J.Allende up the middle', 'Josh Allen', false],
    ['K.Allen up the middle', 'Josh Allen', false],
  ])('%s / %s → %s', (text, name, expected) => {
    expect(namedIn(text, name)).toBe(expected)
  })
})

describe('the pushes for the real play', () => {
  beforeEach(() => {
    h.ingestBatch.mockReset(); h.ingestBatch.mockResolvedValue([])
    h.identityFind.mockReset()
    h.identityFind.mockResolvedValue([
      { sport: 'NFL', rollingInsightsId: '3348', sleeperId: '4984' },
      { sport: 'NFL', rollingInsightsId: '7481', sleeperId: '9481' },
    ])
    h.findMany.mockReset()
    h.findMany.mockResolvedValue([
      { playerId: '4984', roster: { ownerId: 'user-allen' } },
      { playerId: '9481', roster: { ownerId: 'user-kincaid' } },
    ])
    h.rawQuery.mockReset(); h.rawQuery.mockResolvedValue([])
    h.profileFind.mockReset(); h.profileFind.mockResolvedValue([])
    h.rosterFind.mockReset(); h.rosterFind.mockResolvedValue([])
    h.appUserFind.mockReset(); h.appUserFind.mockResolvedValue([])
  })

  it("Allen's managers hear a rushing TD and the 2-pt pass; Kincaid's hear a 2-pt conversion, never a touchdown", async () => {
    await notifyBigPlays(eventsOf([realPlay([allenPasser, kincaid])]))
    const sent = (h.ingestBatch.mock.calls[0]![0] as Array<{ userIds: string[]; title: string; body: string; severity: string; meta: Record<string, unknown> }>)
      .map((n) => ({ to: n.userIds.join(','), title: n.title, body: n.body, severity: n.severity, yards: n.meta.yards }))
    expect(sent).toEqual([
      { to: 'user-allen', title: 'Touchdown', body: 'Josh Allen 1-yard rushing TD', severity: 'high', yards: 1 },
      { to: 'user-kincaid', title: '2-pt conversion', body: 'Dalton Kincaid 2-pt conversion catch from Josh Allen', severity: 'medium', yards: null },
      { to: 'user-allen', title: '2-pt conversion', body: 'Josh Allen 2-pt conversion pass to Dalton Kincaid', severity: 'medium', yards: null },
    ])
  })
})
