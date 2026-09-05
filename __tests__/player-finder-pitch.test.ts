import { describe, expect, it } from 'vitest'

import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'
import { agoLabel, movedToday, pitchLine, pitchText } from '@/lib/core-app/tradePitch'

/*
 * The sentences on the trade-window card, from the loader's output. Pure.
 * The fixture is the handoff's: Tasha owns Kincaid in Gridiron Gang and moves
 * on Sunday mornings; Mike is thin at TE and answers Tuesday evenings.
 */

const SUNDAY_MORNING = { weekday: 0, startHour: 10, endHour: 12, daypart: 'morning' as const, precision: 'window' as const, share: 0.8, sample: 12, zone: 'ET' }
const TUESDAY_EVENINGS = { weekday: 2, startHour: 17, endHour: 22, daypart: 'evening' as const, precision: 'daypart' as const, share: 0.7, sample: 9, zone: 'ET' }

const TASHA: PresenceManager = {
  role: 'owner',
  teamName: "Tasha's Titans",
  ownerName: 'tashaR',
  avatarUrl: null,
  externalId: '1',
  record: '4-2',
  rank: 3,
  need: null,
  startsHim: true,
  window: SUNDAY_MORNING,
  lastMove: { at: '2026-10-20T18:00:00.000Z', kind: 'trade' },
  moves: 13,
}

const MIKE: PresenceManager = {
  ...TASHA,
  role: 'buyer',
  teamName: 'Mike Mayhem',
  ownerName: 'mikeD',
  externalId: '3',
  record: '3-3',
  rank: 5,
  need: { position: 'TE', held: 0, starters: 1, level: 'thin' },
  startsHim: null,
  window: TUESDAY_EVENINGS,
  lastMove: { at: '2026-10-22T23:10:00.000Z', kind: 'waiver' },
  moves: 9,
}

const PRESENCE: ManagerPresence = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'sleeper',
  platformLeagueId: '123456',
  season: 2026,
  timeZone: 'America/New_York',
  zone: 'ET',
  player: { sleeperId: '10236', position: 'TE' },
  holder: 'other',
  managers: [TASHA],
  activityIngested: true,
  newestMove: '2026-10-22T23:10:00.000Z',
  unattributed: 0,
}

const PKG = { give: ['Tony Pollard'], fairness: 'balanced' }
const SUNDAY_1030A = new Date('2026-10-25T14:30:00Z') // Sun 10:30a EDT — inside her window
const SATURDAY = new Date('2026-10-24T14:30:00Z')

describe('pitchLine', () => {
  it('owner, inside her window: what she does with him, the package, and "pitch now"', () => {
    const line = pitchLine({ presence: PRESENCE, manager: TASHA, playerName: 'Dalton Kincaid', now: SUNDAY_1030A, pkg: PKG })
    expect(line.lead).toBe('@tashaR usually moves Sun 10a–12p ET')
    expect(line.body).toBe('They start Kincaid in Gridiron Gang. Send Tony Pollard for Kincaid — values are balanced. Pitch now — this is their window.')
    expect(line.timing).toBe('now')
  })

  it('owner, outside the window: "pitch Sunday, not now" — and no package means "ask what it takes"', () => {
    const line = pitchLine({ presence: PRESENCE, manager: { ...TASHA, startsHim: false }, playerName: 'Dalton Kincaid', now: SATURDAY, pkg: null })
    expect(line.body).toBe('They have Kincaid on the bench in Gridiron Gang. Ask what it takes. Pitch Sun 10a–12p, not now.')
    expect(line.timing).toBe('later')
  })

  it('buyer: the need, the standing, and the last move when there is no window', () => {
    const line = pitchLine({ presence: { ...PRESENCE, holder: 'yours', managers: [MIKE] }, manager: { ...MIKE, window: null }, playerName: 'Dalton Kincaid', now: SATURDAY, pkg: null })
    expect(line.lead).toBe('@mikeD moves at no set time')
    expect(line.body).toBe('Thin at TE (0 for 1 slot), 3-3, #5 — pitch Kincaid there. Last won a claim 1d ago.')
    expect(line.timing).toBe('unknown')
  })

  /* ⚠ NO WINDOW IS NOT "NO PATTERN" WHEN WE NEVER LOOKED. */
  it('says the platform’s moves are not ingested rather than "no set time"', () => {
    const espn = { ...PRESENCE, platform: 'espn', activityIngested: false }
    const line = pitchLine({ presence: espn, manager: { ...TASHA, window: null, lastMove: null, moves: 0 }, playerName: 'Dalton Kincaid', now: SATURDAY, pkg: null })
    expect(line.lead).toBe('@tashaR — no ESPN moves ingested yet')
    expect(line.body).toBe('They start Kincaid in Gridiron Gang. Ask what it takes.')
  })

  it('a manager with no moves in an ingested league is said so, not given a pattern', () => {
    const line = pitchLine({ presence: PRESENCE, manager: { ...TASHA, window: null, lastMove: null, moves: 0 }, playerName: 'Dalton Kincaid', now: SATURDAY, pkg: null })
    expect(line.lead).toBe("@tashaR hasn't made a move here")
  })
})

describe('pitchText', () => {
  it('writes the owner a message around the package, or an open question without one', () => {
    expect(pitchText({ manager: TASHA, playerName: 'Dalton Kincaid', pkg: PKG })).toBe(
      "Hey tashaR — would you move Dalton Kincaid for Tony Pollard? AllFantasy has the values balanced. If there's a version of that you'd do, I'm listening.",
    )
    expect(pitchText({ manager: TASHA, playerName: 'Dalton Kincaid', pkg: null })).toMatch(/^Hey tashaR — what would it take to get Dalton Kincaid\?/)
  })
  it('writes a buyer a message around their need', () => {
    expect(pitchText({ manager: MIKE, playerName: 'Dalton Kincaid', pkg: null })).toBe(
      "Hey mikeD — you look thin at TE — any interest in Dalton Kincaid? Tell me what you'd move and I'll run it through AllFantasy.",
    )
  })
})

describe('movedToday / agoLabel', () => {
  it('the dot pulses only for a move inside the last day', () => {
    expect(movedToday(PRESENCE, new Date('2026-10-21T10:00:00Z'))).toBe(true)
    expect(movedToday(PRESENCE, new Date('2026-10-22T10:00:00Z'))).toBe(false)
  })
  it('mirrors formatAgo', () => {
    expect(agoLabel(30_000)).toBe('just now')
    expect(agoLabel(5 * 60_000)).toBe('5 min ago')
    expect(agoLabel(3 * 3_600_000)).toBe('3h ago')
    expect(agoLabel(2 * 86_400_000)).toBe('2d ago')
    expect(agoLabel(15 * 86_400_000)).toBe('2w ago')
  })
})
