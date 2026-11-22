/**
 * Draft HQ as a dynasty rookie-draft room: the builder (lib/core-app/draftHqRookieRoom.ts) passes only
 * stored facts through and drops a block whose data is missing — never estimating one — and the screen
 * draws what it is given, in English and Spanish, only when the loader built a room.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRookieDraftRoom,
  rookieDraftBoard,
  rookieRoomDate,
  sessionDrivesRoom,
  type RookieRoomSession,
} from '@/lib/core-app/draftHqRookieRoom'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { DraftHqRookieRoom } from '@/components/core-app/screens/DraftHqRookieRoom'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { dynastyDraftHqFixture, FIXTURE_NOW } from '@/app/e2e/dynasty-core/draft-hq/fixture'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

const order = ['A', 'B', 'C', 'D'].map((displayName, i) => ({ slot: i + 1, rosterId: `r${i + 1}`, displayName }))
const session = (over: Partial<RookieRoomSession> = {}): RookieRoomSession => ({
  status: 'pre_draft',
  draftType: 'linear',
  rounds: 3,
  teamCount: 4,
  thirdRoundReversal: false,
  modeLabel: null,
  slotOrder: order,
  tradedPicks: [
    { round: 1, originalRosterId: 'r1', previousOwnerName: 'A', newRosterId: 'r2', newOwnerName: 'B' },
    { round: 2, originalRosterId: 'r2', previousOwnerName: 'B', newRosterId: 'r4', newOwnerName: 'D' },
  ],
  myRosterId: 'r2',
  ...over,
})
const NOW = new Date('2027-04-26T16:00:00Z')
const base = { leagueSeason: 2027, draftDateUtc: null, leagueSettings: {}, inventory: null, taxi: null, now: NOW }

describe('rookieDraftBoard', () => {
  it('resolves every pick’s owner from the session’s order and recorded trades', () => {
    const board = rookieDraftBoard(session())
    expect(board.map((r) => r.picks.length)).toEqual([4, 4, 4])
    expect(board[0].picks[0]).toMatchObject({ label: '1.01', team: 'B', isYou: true, via: 'A', wasYours: false })
    expect(board[1].picks[1]).toMatchObject({ label: '2.02', team: 'D', isYou: false, via: 'B', wasYours: true })
    expect(board[2].picks[1]).toMatchObject({ label: '3.02', team: 'B', isYou: true, via: null })
  })
})

describe('buildRookieDraftRoom', () => {
  it('a live session is the room: season, rounds, teams, the board, your picks and what you traded away', () => {
    const room = buildRookieDraftRoom({ ...base, session: session(), syncNote: 'note' })
    expect(room).toMatchObject({ kind: 'rookie', season: 2027, status: 'pre_draft', rounds: 3, teams: 4 })
    expect(room.picks).toEqual({
      list: [
        { round: 1, label: '1.01', via: 'A' },
        { round: 1, label: '1.02', via: null },
        { round: 3, label: '3.02', via: null },
      ],
      firstRounders: 2,
      tradedAway: [{ label: '2.02', to: 'D' }],
      exact: true,
      partial: false,
      note: 'note',
    })
  })

  it('names a startup or dispersal draft for what it is', () => {
    expect(buildRookieDraftRoom({ ...base, session: session({ modeLabel: 'startup' }) }).kind).toBe('startup')
    expect(buildRookieDraftRoom({ ...base, session: session({ modeLabel: 'Dispersal' }) }).kind).toBe('dispersal')
  })

  it('with no live session, reads the next draft from the pick inventory, round-level, and says it is partial', () => {
    const room = buildRookieDraftRoom({
      ...base,
      leagueSeason: 2026,
      session: session({ status: 'completed' }),
      inventory: {
        available: true,
        coverage: 'traded_only',
        bySeason: [
          { season: 2027, picks: [{ round: 1, label: '1st', fromTeamName: 'Rival' }] },
          { season: 2028, picks: [{ round: 2, label: '2nd', fromTeamName: null }] },
        ],
      },
    })
    expect(room).toMatchObject({ season: 2027, status: null, rounds: null, teams: null, board: null })
    expect(room.picks).toMatchObject({ list: [{ round: 1, label: '1st', via: 'Rival' }], exact: false, partial: true, firstRounders: 1 })
  })

  it('a block with no data is null — never estimated', () => {
    const room = buildRookieDraftRoom({ ...base, session: null, inventory: { available: false, reason: 'x' }, taxi: { count: 0, slots: 0 } })
    expect(room).toEqual({ kind: 'rookie', season: 2027, status: null, rounds: null, teams: null, date: null, board: null, picks: null, taxi: null })
  })

  it('an auction (no fixed slots) or an order not yet set draws no board', () => {
    expect(sessionDrivesRoom(session({ draftType: 'auction' }))).toBe(false)
    expect(sessionDrivesRoom(session({ slotOrder: [] }))).toBe(false)
    expect(buildRookieDraftRoom({ ...base, session: session({ slotOrder: [] }) }).board).toBeNull()
  })
})

describe('rookieRoomDate', () => {
  it('takes a stored start first, then a provider draft time, then the commissioner’s open date', () => {
    expect(rookieRoomDate({ draftDateUtc: '2027-05-09T00:00:00Z', leagueSettings: {}, now: NOW })).toEqual({ at: '2027-05-09T00:00:00.000Z', kind: 'starts', daysAway: 13 })
    expect(rookieRoomDate({ draftDateUtc: null, leagueSettings: { draft_start: '2027-05-02T00:00:00Z' }, now: NOW })?.kind).toBe('starts')
    expect(rookieRoomDate({ draftDateUtc: null, leagueSettings: { dynasty_rookie_draft_calendar: { customOpenDate: '2027-05-01' } }, now: NOW })).toMatchObject({ kind: 'opens', daysAway: 5 })
  })

  it('a date already past is no date — a stale startup date must not sit on a rookie room', () => {
    expect(rookieRoomDate({ draftDateUtc: '2026-08-30T00:00:00Z', leagueSettings: {}, now: NOW })).toBeNull()
    // and the sport's default window is a rule, not a stored date
    expect(rookieRoomDate({ draftDateUtc: null, leagueSettings: {}, now: NOW })).toBeNull()
  })

  it('a live draft shows no countdown', () => {
    expect(buildRookieDraftRoom({ ...base, draftDateUtc: '2027-05-09T00:00:00Z', session: session({ status: 'in_progress' }) }).date).toBeNull()
  })
})

describe('DraftHqRookieRoom', () => {
  const room = () => dynastyDraftHqFixture({ identity: true, noDraft: false }).rookieRoom!

  it('draws the band, countdown, your gold picks, taxi room and the board — in English', () => {
    render(<DraftHqRookieRoom room={room()} leagueId="L1" />)
    expect(screen.getByTestId('draft-hq-rookie-title').textContent).toBe('2027 Rookie draft')
    expect(screen.getByTestId('draft-hq-rookie-date').textContent).toContain('13')
    expect(screen.getByTestId('draft-hq-rookie-date').textContent).toContain('Starts')
    expect(screen.getByTestId('draft-hq-rookie-rounds').textContent).toContain('4')
    const picks = screen.getByTestId('draft-hq-rookie-picks')
    expect(picks.textContent).toContain('via Taco Tuesday')
    expect(picks.textContent).toContain('2 first-rounders')
    expect(picks.querySelectorAll('[data-round="1"]').length).toBe(2)
    expect(screen.getByTestId('draft-hq-rookie-away').textContent).toContain('2.09 to Bench Mob')
    expect(screen.getByTestId('draft-hq-rookie-taxi').textContent).toContain('2 of 4 slots used')
    const board = screen.getByTestId('draft-hq-rookie-board')
    expect(board.querySelectorAll('[data-you="true"]').length).toBe(5)
    expect(board.querySelectorAll('[data-you="true"][data-round="1"]').length).toBe(2)
  })

  it('in Spanish', () => {
    lang.language = 'es'
    render(<DraftHqRookieRoom room={room()} leagueId="L1" />)
    expect(screen.getByTestId('draft-hq-rookie-title').textContent).toBe('Draft de novatos 2027')
    expect(screen.getByTestId('draft-hq-rookie-date').textContent).toContain('Empieza')
    expect(screen.getByTestId('draft-hq-rookie-picks').textContent).toContain('vía Taco Tuesday')
    expect(screen.getByTestId('draft-hq-rookie-taxi').textContent).toContain('2 de 4 plazas ocupadas')
    expect(screen.getByTestId('draft-hq-rookie-board').textContent).toContain('Ronda 1')
  })

  it('an inventory-only room: round-level picks, the opens date, a full taxi squad, no board', () => {
    const r = dynastyDraftHqFixture({ identity: true, noDraft: true }).rookieRoom!
    render(<DraftHqRookieRoom room={r} leagueId="L1" />)
    expect(screen.getByTestId('draft-hq-rookie-date').textContent).toContain('Opens')
    expect(screen.getByTestId('draft-hq-rookie-picks').textContent).toContain('1st')
    expect(screen.getByTestId('draft-hq-rookie-taxi').textContent).toContain('Taxi squad is full')
    expect(screen.queryByTestId('draft-hq-rookie-board')).toBeNull()
    expect(screen.queryByTestId('draft-hq-rookie-rounds')).toBeNull()
  })
})

describe('DraftHq with and without a room', () => {
  it('a dynasty league draws the room, and its own "Your picks" list steps aside rather than repeat it', () => {
    render(<DraftHq data={dynastyDraftHqFixture({ identity: true, noDraft: false })} />)
    expect(screen.getByTestId('draft-hq-rookie-room')).toBeTruthy()
    expect(screen.queryByTestId('draft-hq-picks-held')).toBeNull()
  })

  it('without a room (every other league) Draft HQ is unchanged', () => {
    render(<DraftHq data={dynastyDraftHqFixture({ identity: false, noDraft: false })} />)
    expect(screen.queryByTestId('draft-hq-rookie-room')).toBeNull()
    expect(screen.getByTestId('draft-hq-picks-held')).toBeTruthy()
  })

  it('the fixture clock is pinned', () => {
    expect(FIXTURE_NOW.toISOString()).toBe('2027-04-26T16:00:00.000Z')
  })
})
