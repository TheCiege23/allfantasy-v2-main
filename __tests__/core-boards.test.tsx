import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { leagueArtUrl, managerArtUrl } from '@/lib/core-app/leagueArt'
import {
  columnsTooUneven,
  leagueMark,
  personMark,
  rankLabel,
} from '@/components/core-app/boards/BoardKit'
import StandingsBoard from '@/components/core-app/boards/StandingsBoard'
import WeekBoard from '@/components/core-app/boards/WeekBoard'
import WaiversBoard from '@/components/core-app/boards/WaiversBoard'
import TradesBoard from '@/components/core-app/boards/TradesBoard'
import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import type { SeasonOutlook, OutlookLeague } from '@/lib/core-app/seasonOutlook'
import type { WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WaiversBoardData } from '@/lib/core-app/waiversBoard'
import type { TradesBoardData } from '@/lib/core-app/tradesBoard'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'

/*
 * The 2026-09-07 core-pages boards.
 *
 * ⚠ EVERY ASSERTION HERE IS AN HONESTY RULE, NOT A LAYOUT ONE. Each board
 * refuses to render some number it does not hold — a 0% where the answer is
 * undefined, a "C" grade drawn from no priced assets, a projected margin
 * rendered like a score, a bench player dropped for a projection that does not
 * exist. Those refusals are the product; the CSS is not. A test that only
 * checked headings would go green with all of them removed.
 */

/* ── the pure helpers ────────────────────────────────────────────────────── */

describe('BoardKit monograms', () => {
  /*
   * ⚠ THE FIRST-TWO-LETTERS RULE IS WHY THIS EXISTS. A real account holds
   * "Guillotine League 26 ($20/1)" through "($20/3)"; taking the first two
   * characters renders four identical marks and the rail becomes unreadable.
   */
  it('takes the first and last word, so near-identical names differ', () => {
    expect(leagueMark('Guillotine League 26 ($20/1)')).toBe('G1')
    expect(leagueMark('Guillotine League 26 ($20/2)')).toBe('G2')
    expect(leagueMark('Dynasty Dragons')).toBe('DD')
  })

  it('still produces a mark for a one-word or empty name', () => {
    expect(leagueMark('KBFL')).toBe('KB')
    expect(leagueMark('')).toBe('—')
    expect(leagueMark(null)).toBe('—')
    expect(personMark('Jordan')).toBe('JO')
    expect(personMark('King Gustov')).toBe('KG')
  })

  it('pads the rank so the column cannot jitter', () => {
    expect(rankLabel(0)).toBe('01')
    expect(rankLabel(9)).toBe('10')
  })

  it('stacks two columns only once they are three rows apart', () => {
    expect(columnsTooUneven(5, 5)).toBe(false)
    expect(columnsTooUneven(3, 5)).toBe(false)
    expect(columnsTooUneven(2, 5)).toBe(true)
    expect(columnsTooUneven(5, 2)).toBe(true)
  })
})

describe('leagueArtUrl', () => {
  /*
   * The whole reason this helper exists: Sleeper stores an avatar ID in the
   * same column other providers put a link in. Passing the raw value into an
   * <img src> is a broken image on roughly half a real account's leagues.
   */
  it('expands a bare Sleeper avatar id into a CDN url', () => {
    expect(leagueArtUrl({ avatarUrl: 'abc123', platform: 'sleeper' })).toBe(
      'https://sleepercdn.com/avatars/thumbs/abc123',
    )
  })

  it('never guesses a CDN for a platform that does not issue ids', () => {
    expect(leagueArtUrl({ avatarUrl: 'abc123', platform: 'espn' })).toBeNull()
    expect(leagueArtUrl({ avatarUrl: 'abc123', platform: null })).toBeNull()
  })

  it('passes a real url through and prefers a commissioner upload', () => {
    expect(leagueArtUrl({ avatarUrl: 'https://x/y.png', platform: 'espn' })).toBe('https://x/y.png')
    expect(
      leagueArtUrl({ logoUrl: 'https://up/l.png', avatarUrl: 'abc', platform: 'sleeper' }),
    ).toBe('https://up/l.png')
  })

  /* No artwork is the COMMON case — 67 of 115 production leagues — not a failure. */
  it('returns null rather than a placeholder when there is no artwork', () => {
    expect(leagueArtUrl({ platform: 'sleeper' })).toBeNull()
    expect(leagueArtUrl({ avatarUrl: '   ', platform: 'sleeper' })).toBeNull()
    expect(managerArtUrl({ avatarUrl: null, platform: 'sleeper' })).toBeNull()
  })
})

/* ── Standings ───────────────────────────────────────────────────────────── */

function outlookLeague(over: Partial<OutlookLeague> = {}): OutlookLeague {
  const you = {
    rosterId: '1',
    name: 'Your team',
    isYou: true,
    wins: 8,
    losses: 3,
    pointsFor: 1200,
    seed: 1,
    playoffPct: 94,
    titlePct: 22,
    modelled: true,
  }
  return {
    leagueId: 'l1',
    leagueName: "Chimmy's Champions",
    platform: 'sleeper',
    season: 2026,
    weeksRemaining: 3,
    playoffTeams: 6,
    you,
    teams: [you, { ...you, rosterId: '2', isYou: false, seed: 2 }],
    whatDecidesIt: 'Win once in three',
    href: '/core/standings?league=l1',
    ...over,
  }
}

function outlook(over: Partial<SeasonOutlook> = {}): SeasonOutlook {
  return {
    leagues: [outlookLeague()],
    summary: { makingPlayoffs: 1, clinched: 0, onTheBubble: 0, bestTitle: null },
    weekThatMatters: null,
    swingByLeague: {},
    priorities: [],
    basis: '10,000 simulated seasons',
    withheld: [],
    firstKickoffAt: null,
    ...(over as Partial<SeasonOutlook>),
  } as SeasonOutlook
}

describe('StandingsBoard', () => {
  it('states the field size beside the seed, so #3 of 10 is not read as #3 of 32', () => {
    const { container } = render(
      <StandingsBoard outlook={outlook()} allHref="/core/standings?all=1" totalLeagues={9} />,
    )
    expect(container.textContent ?? '').toContain('#1 of 2')
  })

  /*
   * ⚠ `modelled: false` MEANS TOO FEW WEEKS TO MODEL THAT TEAM, so the number
   * beside it is the simulation's prior rather than a read on them. Marking it
   * is the difference between a model output and an asserted fact.
   */
  it('marks a percentage that came from an unmodelled team', () => {
    const l = outlookLeague()
    const { container } = render(
      <StandingsBoard
        outlook={outlook({ leagues: [{ ...l, you: { ...l.you!, modelled: false } }] })}
        allHref="/core/standings?all=1"
        totalLeagues={9}
      />,
    )
    expect(container.textContent ?? '').toContain('94%*')
    expect(container.textContent ?? '').toMatch(/too few completed weeks to model/i)
  })

  it('never prints 0-0 for a season with no games played', () => {
    const l = outlookLeague()
    const { container } = render(
      <StandingsBoard
        outlook={outlook({ leagues: [{ ...l, you: { ...l.you!, wins: 0, losses: 0 } }] })}
        allHref="/core/standings?all=1"
        totalLeagues={9}
      />,
    )
    expect(container.textContent ?? '').not.toContain('0-0')
    expect(container.textContent ?? '').toContain('no games played yet')
  })

  it('counts and explains a league whose team could not be identified', () => {
    const { container } = render(
      <StandingsBoard
        outlook={outlook({ leagues: [outlookLeague(), outlookLeague({ leagueId: 'l2', you: null })] })}
        allHref="/core/standings?all=1"
        totalLeagues={9}
      />,
    )
    expect(container.textContent ?? '').toMatch(/1 league could not be ranked/i)
  })

  it('states that the odds are simulated, never bare', () => {
    const { container } = render(
      <StandingsBoard outlook={outlook()} allHref="/core/standings?all=1" totalLeagues={9} />,
    )
    expect(container.textContent ?? '').toMatch(/simulated over each league/i)
  })
})

/* ── Week ────────────────────────────────────────────────────────────────── */

function weekMatchup(over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'espn',
    season: 2026,
    week: 3,
    opponent: { rosterId: '2', name: 'Gridiron Ghosts' },
    elimination: false,
    projection: { you: 120, them: 82, margin: 38.2, winProbability: 0.91 },
    yourSampleWeeks: 5,
    href: '/core/week?league=l1',
    ...over,
  }
}

function weekData(over: Partial<WeekBoardData> = {}): WeekBoardData {
  return {
    season: 2026,
    week: 3,
    coinFlips: [],
    leaning: [weekMatchup()],
    unprojected: [],
    model: { basis: 'per-team scoring distributions', sampleSize: 412 },
    withoutSchedule: 0,
    firstKickoffAt: null,
    leagueBoard: null,
    ...over,
  }
}

describe('WeekBoard', () => {
  /*
   * The trailing column's whole purpose. Being 20 points down in a league you
   * cannot reach the playoffs in is not something to spend a Sunday on, and a
   * board that lists it anyway is back to being the 47-tile grid this replaced.
   */
  it('drops a trailing league with no realistic playoff path, and says how many', () => {
    const behind = weekMatchup({
      leagueId: 'dead',
      leagueName: 'World Football Draft',
      projection: { you: 80, them: 110, margin: -30, winProbability: 0.14 },
    })
    const l = outlookLeague({ leagueId: 'dead' })
    const { container } = render(
      <WeekBoard
        board={weekData({ leaning: [weekMatchup(), behind] })}
        outlook={outlook({ leagues: [{ ...l, you: { ...l.you!, playoffPct: 1 } }] })}
        rivalriesHref="/core/week?view=rivalries"
        allHref="/core/week?all=1"
        totalLeagues={9}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('World Football Draft')
    expect(text).toMatch(/1 league is behind with no realistic\s+playoff path/i)
  })

  /*
   * ⚠ WITHOUT AN OUTLOOK THE FILTER CANNOT RUN, AND EXCLUDING EVERYTHING WOULD BE
   * WORSE THAN SHOWING AN UNFILTERED COLUMN. The board says which it did.
   */
  it('shows an unfiltered trailing column when the simulation is unavailable, and says so', () => {
    const behind = weekMatchup({
      leagueId: 'x',
      leagueName: 'Cream Bowl',
      projection: { you: 80, them: 110, margin: -30, winProbability: 0.14 },
    })
    const { container } = render(
      <WeekBoard
        board={weekData({ leaning: [behind] })}
        outlook={null}
        rivalriesHref="/core/week?view=rivalries"
        allHref="/core/week?all=1"
        totalLeagues={9}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Cream Bowl')
    expect(text).toMatch(/playoff filter did not run/i)
  })

  it('never ranks an unprojected matchup by a margin it does not have', () => {
    const { container } = render(
      <WeekBoard
        board={weekData({
          leaning: [],
          unprojected: [weekMatchup({ leagueId: 'u', leagueName: 'Unknowable', projection: null })],
        })}
        outlook={outlook()}
        rivalriesHref="/core/week?view=rivalries"
        allHref="/core/week?all=1"
        totalLeagues={9}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('Unknowable')
    expect(text).toMatch(/1 could not be projected/i)
  })

  it('states the model basis and its sample size', () => {
    const { container } = render(
      <WeekBoard
        board={weekData()}
        outlook={outlook()}
        rivalriesHref="/core/week?view=rivalries"
        allHref="/core/week?all=1"
        totalLeagues={9}
      />,
    )
    expect(container.textContent ?? '').toContain('412 roster-weeks')
  })
})

/* ── Waivers ─────────────────────────────────────────────────────────────── */

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

describe('WaiversBoard', () => {
  /*
   * ⚠ A 0% OWN RATE COMPUTED OVER FOUR LEAGUES WOULD CALL A WIDELY-ROSTERED
   * PLAYER A FREE AGENT. Below the denominator gate the loader carries null, and
   * an em dash is the correct rendering of that.
   */
  it('renders an em dash, not 0%, for a market rate below the gate', () => {
    const { container } = render(
      <WaiversBoard data={waiversData()} allHref="/core/waivers?all=1" totalLeagues={65} />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('62%')
    expect(text).not.toContain('0%')
  })

  /*
   * Four different exclusions, named separately. A single "N leagues excluded"
   * is the shape that makes a board stop being trustworthy at sixty leagues.
   */
  it('names every reason a league is off the board, separately', () => {
    const { container } = render(
      <WaiversBoard data={waiversData()} allHref="/core/waivers?all=1" totalLeagues={65} />,
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/10 leagues are not on this board/i)
    expect(text).toMatch(/6 store player ids the projection feed does not use/i)
    expect(text).toMatch(/3 have never published their scoring settings/i)
    expect(text).toMatch(/1 has no roster of yours imported/i)
  })

  it('says the projections were re-scored under each league own rules', () => {
    const { container } = render(
      <WaiversBoard data={waiversData()} allHref="/core/waivers?all=1" totalLeagues={65} />,
    )
    expect(container.textContent ?? '').toMatch(/re-scored under that league/i)
  })

  it('says no drop was named rather than inventing one', () => {
    const d = waiversData()
    const { container } = render(
      <WaiversBoard
        data={{ ...d, rows: [{ ...d.rows[0], drop: null }] }}
        allHref="/core/waivers?all=1"
        totalLeagues={65}
      />,
    )
    expect(container.textContent ?? '').toMatch(/No bench player here could be priced/i)
  })
})

/* ── Trades ──────────────────────────────────────────────────────────────── */

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

describe('TradesBoard', () => {
  /*
   * The single most important assertion on this screen. `gradeTrade` returns a
   * middle-band "C" when nothing on either side could be priced — that letter
   * would mean ZERO DATA while reading as "an average trade".
   */
  it('shows the withheld reason instead of a letter when a trade could not be priced', () => {
    const { container } = render(
      <TradesBoard data={tradesData()} allHref="/core/trades?all=1" />,
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/ungraded: one side could not be priced/i)
    expect(container.querySelector('.af-bd-v')?.textContent).not.toBe('C')
  })

  /* An unpriced asset is a dash. A zero beside a real name says he is worthless. */
  it('renders an unpriced asset as a dash, never a zero', () => {
    const { container } = render(
      <TradesBoard data={tradesData()} allHref="/core/trades?all=1" />,
    )
    const vals = [...container.querySelectorAll('.af-bd-asset-val')].map((n) => n.textContent)
    expect(vals).toContain('6,552')
    expect(vals).toContain('—')
    expect(vals).not.toContain('0')
  })

  /*
   * ⚠ "WE DO NOT HOLD THE SETTING" IS NOT "THERE IS NO DEADLINE". Present on 54
   * of 120 production leagues; treating the rest as open-all-season tells a
   * manager their window is safe on no evidence.
   */
  it('separates a league with no ingested deadline from one with no deadline', () => {
    const { container } = render(
      <TradesBoard data={tradesData()} allHref="/core/trades?all=1" />,
    )
    expect(container.textContent ?? '').toMatch(
      /12 of your leagues have never published a trade deadline/i,
    )
  })

  /*
   * ⚠ THE PENDING SECTION IS WIRED AND ALMOST ALWAYS EMPTY. It must not render
   * an empty shell — that tells every user their inbox is broken — and it must
   * render the moment a row exists.
   */
  it('hides the pending section when there is nothing pending, and shows it when there is', () => {
    const none = render(<TradesBoard data={tradesData()} allHref="/core/trades?all=1" />)
    expect(none.container.textContent ?? '').not.toMatch(/waiting on you/i)

    const some = render(
      <TradesBoard
        data={tradesData({
          pending: [
            {
              id: 'p1',
              leagueId: 'l1',
              leagueName: 'Ice Kings',
              platform: 'native',
              logoUrl: null,
              status: 'pending',
              expiresAt: null,
              youProposed: false,
              items: [{ itemType: 'player', reference: 'Perry Vance', faabAmount: null }],
            },
          ],
        })}
        allHref="/core/trades?all=1"
      />,
    )
    expect(some.container.textContent ?? '').toMatch(/waiting on you/i)
    expect(some.container.textContent ?? '').toContain('Proposed to you')
  })
})

/* ── Draft HQ ────────────────────────────────────────────────────────────── */

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

describe('DraftHqBoard', () => {
  it('puts your own clock above every other draft', () => {
    const { container } = render(
      <DraftHqBoard
        data={draftData([
          draftRow({ leagueId: 'a', leagueName: 'Someone else' }),
          draftRow({ leagueId: 'b', leagueName: 'Your pick', yoursOnClock: true }),
        ])}
        allHref="/core/draft-hq?all=1"
        totalLeagues={65}
      />,
    )
    const names = [...container.querySelectorAll('.af-bd-name')].map((n) => n.textContent)
    expect(names[0]).toBe('Your pick')
  })

  /*
   * ⚠ "NO QUEUE HERE", NOT "NO QUEUE". The queue tables are AllFantasy's own; a
   * Sleeper draft keeps its queue on Sleeper, so zero means we hold nothing —
   * not that the manager is unprepared.
   */
  it('says an empty queue is an AllFantasy gap, not an unprepared manager', () => {
    const { container } = render(
      <DraftHqBoard
        data={draftData([draftRow({ queuedCount: 0 })])}
        allHref="/core/draft-hq?all=1"
        totalLeagues={65}
      />,
    )
    expect(container.textContent ?? '').toMatch(/No queue built in AllFantasy/i)
  })

  /*
   * ⚠ AN UNRECOGNISED STATUS IS SHOWN, NOT BUCKETED. The draft-status vocabulary
   * is inconsistent across providers; filing a finished draft under "upcoming"
   * is a confident lie, while `post_draft_v2` is something a reader can look up.
   */
  it('prints an unrecognised status verbatim rather than guessing a phase', () => {
    const { container } = render(
      <DraftHqBoard
        data={draftData([draftRow({ phase: 'unknown', rawStatus: 'post_draft_v2' })], {
          counts: { live: 0, upcoming: 0, done: 0, unknown: 1 },
        })}
        allHref="/core/draft-hq?all=1"
        totalLeagues={65}
      />,
    )
    expect(container.textContent ?? '').toContain('POST_DRAFT_V2')
  })

  it('accounts for leagues with no draft rather than filling the board with them', () => {
    const { container } = render(
      <DraftHqBoard
        data={draftData([draftRow()])}
        allHref="/core/draft-hq?all=1"
        totalLeagues={65}
      />,
    )
    expect(container.textContent ?? '').toMatch(/55 of your leagues carry no draft we can read/i)
  })
})

/*
 * 🛑 THIS BLOCK EXISTS BECAUSE A RENDER FOUND IT AND NO TEST WOULD HAVE. On a
 * real account not one league had an ingested trade deadline, and the section
 * still read "Top 4 · ranked by deadline" over four rows every one of which said
 * DEADLINE UNKNOWN. A label that states a ranking rule the list is not following
 * is exactly what this whole batch replaced.
 */
describe('TradesBoard — the label must describe what the list did', () => {
  it('does not claim a deadline ranking when no deadline is known', () => {
    const d = tradesData()
    const { container } = render(
      <TradesBoard
        data={{
          ...d,
          windows: d.windows.map((w) => ({
            ...w,
            deadlineWeek: null,
            noDeadline: false,
            weeksLeft: null,
          })),
        }}
        allHref="/core/trades?all=1"
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/ranked by deadline/i)
    expect(text).toMatch(/no deadline ingested for any of them/i)
  })

  it('states the deadline ranking as soon as one league has one', () => {
    const { container } = render(
      <TradesBoard data={tradesData()} allHref="/core/trades?all=1" />,
    )
    expect(container.textContent ?? '').toMatch(/ranked by deadline/i)
  })
})
