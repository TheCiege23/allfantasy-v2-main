import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import TradesBoard from '@/components/core-app/boards/TradesBoard'
import WaiversBoard from '@/components/core-app/boards/WaiversBoard'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import type { TradesBoardData } from '@/lib/core-app/tradesBoard'
import type { WaiversBoardData } from '@/lib/core-app/waiversBoard'
import type { LiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import type { DraftHqAllRow, DraftHqAllData } from '@/lib/core-app/draftHqAll'

/*
 * Player names on the cross-league boards open the player card.
 *
 * ⚠ WHY THIS IS NOT COVERED BY THE EXISTING BOARD SUITE. `core-boards.test.tsx`
 * asserts that names APPEAR — and `PlayerName` renders the name inside a
 * `<button>`, so every one of those assertions stays green with this wiring
 * deleted. A suite that passes either way is not evidence about the wiring; it
 * is evidence about the text. These assert the CONTROL, not the label.
 *
 * ⚠ AND THEY PIN THE LEAGUE SCOPE, which is the half that is silently wrong
 * rather than absent. A board row belongs to one league, and a card opened
 * without that league falls back to the universal flavour — same name, same
 * price tile, quietly missing "who holds him here" and this league's own book.
 * Nothing about that looks broken on screen.
 */

/*
 * ⚠ THESE TWO BUILDERS ARE COPIED VERBATIM FROM `core-boards.test.tsx`, and the
 * duplication is deliberate. Reverse-engineering the fixture field by field
 * produced two rounds of `Cannot read properties of undefined` — the shapes
 * carry numeric fields the components format unconditionally. Copying the
 * working fixture is cheaper and, more importantly, keeps this suite asserting
 * the WIRING rather than accidentally asserting my guess at the data shape.
 * They are not exported from that file; if they drift, this suite fails loudly
 * on a shape error rather than silently passing.
 */
function tradesData(over: Partial<TradesBoardData> = {}): TradesBoardData {
  return {
    pending: [],
    windows: [
      {
        leagueId: 'l1',
        leagueName: 'Ice Kings',
        platform: 'sleeper',
        logoUrl: null,
        deadlineWeek: 11,
        noDeadline: false,
        weeksLeft: 1,
        regularSeasonLength: 14,
        tradesOnFile: 3,
        latest: {
          transactionId: 't1',
          season: 2026,
          week: 4,
          at: null,
          fromName: 'TheCiege24',
          toName: 'Jordan',
          sent: [
            {
              id: 'a',
              name: 'Perry Vance',
              position: 'WR',
              team: 'PHI',
              imageUrl: null,
              value: 6552,
            },
          ],
          received: [
            { id: 'b', name: 'Dana Okoye', position: 'WR', team: 'BUF', imageUrl: null, value: null },
          ],
          letter: null,
          sharePct: null,
          withheldReason: 'one side could not be priced',
        },
        href: '/core/trades?league=l1',
        reasoning: '1 week until the week 11 deadline. 3 trades on file here.',
      },
    ],
    considered: 40,
    deadlineUnknown: 12,
    currentWeek: 10,
    ...over,
  }
}

function waiversData(over: Partial<WaiversBoardData> = {}): WaiversBoardData {
  return {
    rows: [
      {
        leagueId: 'l1',
        leagueName: 'Dynasty Dragons',
        platform: 'sleeper',
        logoUrl: null,
        format: 'Dynasty · PPR',
        netGain: 14.6,
        add: {
          playerId: 'p1',
          name: 'Tank Bigsby',
          position: 'RB',
          team: 'JAX',
          imageUrl: null,
          projected: 15.8,
          ownPct: 0.62,
          startPct: 0.48,
        },
        drop: {
          playerId: 'p2',
          name: 'Roman Wilson',
          position: 'WR',
          team: 'PIT',
          imageUrl: null,
          projected: 1.2,
          ownPct: null,
          startPct: null,
        },
        faabRemaining: 42,
        runsAt: 'Wednesday 09:00 UTC',
        href: '/core/waivers?league=l1',
        reasoning: 'Tank Bigsby (RB) projects 15.8 under this league’s own scoring.',
      },
    ],
    considered: 40,
    withheld: { noRoster: 1, idSpace: 6, noScoring: 3, noCandidate: 0 },
    marketLeagues: 120,
    at: { season: '2026', week: 3 },
    ...over,
  }
}

/** Every player-card trigger, as {name, wired}. */
function triggers(container: HTMLElement) {
  return [...container.querySelectorAll('button.af-pc-trigger')].map((b) => b.textContent?.trim() ?? '')
}

describe('cross-league boards — player names open the card', () => {
  it('makes both sides of a trade openable', () => {
    const { container } = render(<TradesBoard data={tradesData()} allHref="/core/trades?all=1" totalLeagues={65} />)
    const t = triggers(container)
    expect(t).toContain('Perry Vance')
    expect(t).toContain('Dana Okoye')
  })

  it('makes the waiver add AND drop openable', () => {
    const { container } = render(<WaiversBoard data={waiversData()} allHref="/core/waivers?all=1" totalLeagues={65} />)
    const t = triggers(container)
    expect(t).toContain('Tank Bigsby')
    expect(t).toContain('Roman Wilson')
  })

  /*
   * The names still render as text — the wiring must not have replaced the
   * label with a control that reads differently to a screen reader or a scan.
   */
  it('keeps the name as the control’s accessible label', () => {
    const { container } = render(<TradesBoard data={tradesData()} allHref="/core/trades?all=1" totalLeagues={65} />)
    const btn = [...container.querySelectorAll('button.af-pc-trigger')].find(
      (b) => b.textContent?.trim() === 'Perry Vance'
    )
    expect(btn).toBeTruthy()
    expect(btn?.tagName).toBe('BUTTON')
  })
})

/*
 * ⚠ THE WAR ROOM IS THE ONE BOARD WHERE A NAME IS NOT ALWAYS OPENABLE, and that
 * is the whole reason it was wired last. `DraftPick.playerId` carries whichever
 * id the drafting room had — ours, the provider's, or Sleeper's — so the loader
 * runs a three-key join and puts the RESOLVED Sleeper id on the row. When that
 * join finds nobody, `sleeperId` is null and the name must stay plain text: an
 * inert control would promise a lookup that cannot happen, and a raw
 * `DraftPick.playerId` handed to a Sleeper-keyed API would open somebody else.
 */
function warRoomPicks(): LiveDraftPicks {
  return {
    byLeague: {
      wr1: [
        {
          overall: 1, round: 1, pickInRound: 1, rosterId: '1',
          managerName: 'Riley', isYours: false,
          playerName: 'Josh Allen', position: 'QB', imageUrl: null, team: 'BUF',
          sleeperId: '4984',
        },
        {
          overall: 2, round: 1, pickInRound: 2, rosterId: '2',
          managerName: null, isYours: true,
          /* Named, but the three-key join landed nothing — must NOT be a control. */
          playerName: 'Some Rookie', position: 'RB', imageUrl: null, team: null,
          sleeperId: null,
        },
      ],
    },
    queueByLeague: {},
  }
}

function draftRow(over: Partial<DraftHqAllRow> = {}): DraftHqAllRow {
  return {
    leagueId: 'l1',
    leagueName: 'Four Horsemen Vol. 5',
    platform: 'sleeper',
    imageUrl: null,
    phase: 'live',
    rawStatus: 'in_progress',
    draftType: 'snake',
    rounds: 4,
    teamCount: 28,
    yourSlot: 5,
    picksMade: 47,
    pickExpiresAt: null,
    onClockName: 'Riley',
    yoursOnClock: false,
    currentRound: 2,
    nextOverallPick: 48,
    queuedCount: 0,
    modeLabel: 'rookie',
    startedAt: null,
    ...over,
  }
}

function draftData(rows: DraftHqAllRow[], over: Partial<DraftHqAllData> = {}): DraftHqAllData {
  return {
    rows,
    counts: { live: 1, upcoming: 0, done: 0, unknown: 0 },
    withoutDraft: 55,
    ...over,
  }
}

/*
 * The live board tail moved from the retired cross-league War Room into
 * DraftHqBoard; these two cases moved with it rather than being deleted with
 * the component, because the join they guard still runs.
 */
describe('draft hq — a pick opens the card only when its id resolved', () => {
  it('makes a RESOLVED pick openable', () => {
    const { container } = render(
      <DraftHqBoard data={draftData([draftRow({ leagueId: 'wr1', phase: 'live' })])} picks={warRoomPicks()} allHref="/core/draft-hq?all=1" totalLeagues={1} />
    )
    expect(triggers(container)).toContain('Josh Allen')
  })

  /* The case the whole three-key join exists for. */
  it('renders an UNRESOLVED pick as plain text, never a control', () => {
    const { container } = render(
      <DraftHqBoard data={draftData([draftRow({ leagueId: 'wr1', phase: 'live' })])} picks={warRoomPicks()} allHref="/core/draft-hq?all=1" totalLeagues={1} />
    )
    expect(container.textContent).toContain('Some Rookie')
    expect(triggers(container)).not.toContain('Some Rookie')
  })
})
