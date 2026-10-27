/**
 * "Rules explained" (2026-10-27): every setting the commissioner chose, with what it means. The
 * wording is a fixed template per setting, so each one is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { buildLeagueRulebook, welcomeRules, type BuildRulebookInput, type RulebookEntry } from '@/lib/league-rules/buildLeagueRulebook'

function input(league: Partial<BuildRulebookInput['league']> = {}, overrides: Partial<BuildRulebookInput> = {}): BuildRulebookInput {
  return {
    league: {
      id: 'lg1',
      name: 'Sunday Crew',
      sport: 'NFL',
      leagueSize: 12,
      leagueVariant: 'redraft',
      guillotineMode: false,
      waiverType: 'faab',
      waiverBudget: 200,
      tradeDeadlineWeek: 11,
      playoffTeams: 6,
      playoffStartWeek: 15,
      settings: { scoring_mode: 'points', trade_review_mode: 'commissioner' },
      ...league,
    },
    formatLabel: 'Redraft',
    scoringLabel: 'PPR',
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 2 },
    draft: { dateIso: '2026-09-01T00:00:00.000Z', type: 'snake', rounds: 15, timerSeconds: 90, autostart: true },
    guillotine: null,
    viewerTimeZone: 'America/New_York',
    ...overrides,
  }
}

function entry(i: BuildRulebookInput, id: string): RulebookEntry {
  const found = buildLeagueRulebook(i).flatMap((s) => s.entries).find((e) => e.id === id)
  if (!found) throw new Error(`no entry ${id}`)
  return found
}

const ids = (i: BuildRulebookInput) => buildLeagueRulebook(i).flatMap((s) => s.entries.map((e) => e.id))

describe('buildLeagueRulebook — a redraft league', () => {
  it('explains the format, roster, draft, waivers, trades and playoffs', () => {
    const i = input()
    expect(entry(i, 'format')).toMatchObject({ value: 'Redraft · Points', meaning: "Your starters' points are added up each week, and the higher total wins the matchup." })
    expect(entry(i, 'scoring').meaning).toContain('PPR')
    expect(entry(i, 'roster').meaning).toBe(
      'You start 9 players; only starters score. 6 bench spots hold players who don\'t score that week. 2 injured-reserve spots let you stash an injured player without using a bench spot.',
    )
    expect(entry(i, 'draft-date')).toMatchObject({ value: 'Mon Aug 31, 8:00 PM ET', meaning: 'The draft starts by itself at this time.' })
    expect(entry(i, 'draft-type')).toMatchObject({ value: 'Snake · 15 rounds' })
    expect(entry(i, 'draft-type').meaning).toMatch(/reverses each round/)
    expect(entry(i, 'pick-timer').meaning).toBe('You have 90s to make each pick.')
    expect(entry(i, 'waivers')).toMatchObject({
      value: 'FAAB · $200',
      meaning: 'Each team has $200 for the season to bid on free agents. The highest bid wins the player, and the amount comes off your budget.',
    })
    expect(entry(i, 'trades').meaning).toBe('The commissioner approves or vetoes every trade. No trades after the week 11 deadline.')
    expect(entry(i, 'playoffs')).toMatchObject({ value: '6 teams · starts Wk 15', meaning: 'The top 6 teams make the playoffs, which start in week 15.' })
    expect(ids(i)).not.toContain('how-guilly-works')
  })

  it('a weekly lineup locks per player; a manual and a first-game lock say so', () => {
    expect(entry(input(), 'lineup-lock').value).toBe('Lock at each game')
    expect(entry(input({ settings: { sportConfig: { lineupLockType: 'first_game_of_week' } } }), 'lineup-lock').value).toBe('Lock at the first game of the week')
    expect(entry(input({ settings: { sportConfig: { lineupLockType: 'manual' } } }), 'lineup-lock').value).toBe('Locked by the commissioner')
  })

  it('daily lineups only when the league is really on them — the same gate the lock reads', () => {
    const daily = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
    expect(entry(input({ sport: 'NBA', settings: daily }), 'lineup-lock').value).toBe('Daily')
    expect(entry(input({ sport: 'NBA', settings: daily }), 'lineup-lock').meaning).toMatch(/every day/)
    // Asked for but not switched on, or a sport that cannot run daily: the weekly per-game lock.
    expect(entry(input({ sport: 'NBA', settings: { sportConfig: { lineupLockType: 'daily' } } }), 'lineup-lock').value).toBe('Lock at each game')
    expect(entry(input({ sport: 'NFL', settings: daily }), 'lineup-lock').value).toBe('Lock at each game')
  })

  it('categories and roto read differently from points', () => {
    expect(entry(input({ settings: { scoring_mode: 'h2h_categories' } }), 'format').meaning).toMatch(/Each stat category is a separate win or loss/)
    expect(entry(input({ settings: { scoring_mode: 'roto' } }), 'format').meaning).toMatch(/ranked in every stat category/)
  })

  it('every waiver type and trade review mode has its own sentence', () => {
    expect(entry(input({ waiverType: 'rolling' }), 'waivers').meaning).toBe('A successful claim sends you to the back of the waiver line.')
    expect(entry(input({ waiverType: 'reverse_standings' }), 'waivers').meaning).toBe('The team with the worst record gets first claim on a player.')
    expect(entry(input({ settings: { trade_review_mode: 'league_vote' } }), 'trades').meaning).toMatch(/^The league votes/)
    expect(entry(input({ settings: { trade_review_mode: 'instant' }, tradeDeadlineWeek: null }), 'trades').meaning).toBe(
      'Trades go through as soon as both teams accept. There is no trade deadline.',
    )
    expect(entry(input({ settings: { trade_review_mode: 'none' } }), 'trades').meaning).toBe('Trading is turned off in this league.')
  })

  it('an unscheduled draft and an untimed one say so', () => {
    const i = input({}, { draft: { dateIso: null, type: 'auction', rounds: null, timerSeconds: null, autostart: false } })
    expect(entry(i, 'draft-date').meaning).toBe('The commissioner has not scheduled the draft yet.')
    expect(entry(i, 'draft-type').meaning).toMatch(/bids on players/)
    expect(entry(i, 'pick-timer').meaning).toBe('There is no clock on picks.')
  })

  it('values still loading are marked pending, never explained', () => {
    const i = input({}, { rosterSlots: null, draft: null })
    expect(entry(i, 'roster')).toMatchObject({ pending: true, meaning: '…' })
    expect(entry(i, 'draft-date')).toMatchObject({ pending: true, meaning: '…' })
  })
})

describe('buildLeagueRulebook — a Guilly league', () => {
  const guilly = (g: Partial<NonNullable<BuildRulebookInput['guillotine']>> = {}, league: Partial<BuildRulebookInput['league']> = {}) =>
    input(
      { sport: 'NBA', leagueVariant: 'guillotine', guillotineMode: true, guillotineEndgame: 'final_four', waiverBudget: 1000, ...league },
      {
        formatLabel: 'Guillotine',
        guillotine: {
          firstChopWeek: 3,
          endWeek: 20,
          locked: false,
          teamsPerChop: 1,
          scheduleLines: ['From week 3: 1 team a week.', 'Week 10: no chop.'],
          tiebreakerOrder: ['bench_points', 'season_points', 'random'],
          rosterReleaseTiming: 'next_waiver_run',
          dangerMarginPoints: 10,
          blindAuction: true,
          ...g,
        },
      },
    )

  it('explains the chop, its timing, the endgame and what happens to a chopped team', () => {
    const i = guilly()
    expect(entry(i, 'how-guilly-works').meaning).toBe(
      'Every week the lowest-scoring team is chopped: out of the league, with their players released to waivers for everyone else.',
    )
    expect(entry(i, 'first-chop').meaning).toBe('Chops start in week 3 and the last one is in week 20.')
    expect(entry(i, 'chop-schedule-changes').meaning).toBe('Week 10: no chop.')
    expect(entry(i, 'chop-timing').value).toMatch(/^Chop /)
    expect(entry(i, 'release').value).toBe('At the next waiver run')
    expect(entry(i, 'tiebreakers').meaning).toBe(
      'If the lowest scores tie: fewer bench points is chopped; if still tied, fewer season points is chopped and random.',
    )
    expect(entry(i, 'danger').meaning).toBe('Teams within 10 points of the chop line show as in danger.')
    expect(entry(i, 'endgame')).toMatchObject({ value: 'Final four' })
    expect(entry(i, 'faab-on-chop').value).toBe('It leaves with the team')
    expect(entry(i, 'format').meaning).toMatch(/no head-to-head matchups/)
    expect(ids(i)).not.toContain('playoffs')
  })

  it('several teams a week reads in the plural', () => {
    expect(entry(guilly({ teamsPerChop: 2 }), 'how-guilly-works').meaning).toMatch(/the 2 lowest-scoring teams are chopped/)
  })

  it('the blind auction is explained only where the server says bids are sealed', () => {
    expect(entry(guilly(), 'blind-auction').meaning).toMatch(/36 hours before waivers run are sealed/)
    expect(ids(guilly({ blindAuction: false }))).not.toContain('blind-auction')
  })

  it('the FAAB-on-chop rule only shows in a FAAB league; immunity only when it is on', () => {
    expect(ids(guilly({}, { waiverType: 'rolling' }))).not.toContain('faab-on-chop')
    expect(ids(guilly())).not.toContain('immunity')
    expect(ids(guilly({ advanced: { steps: [], overrides: {}, immunity: 'off' } }))).not.toContain('immunity')
    expect(entry(guilly({ advanced: { steps: [], overrides: {}, immunity: 'top_scorer' } }), 'immunity').meaning).toMatch(/top scorer cannot be chopped/)
  })

  it('the welcome sheet leads with the Guilly rules and stops at six', () => {
    const rules = welcomeRules(buildLeagueRulebook(guilly()))
    expect(rules.map((r) => r.id)).toEqual(['how-guilly-works', 'first-chop', 'chop-timing', 'blind-auction', 'endgame', 'lineup-lock'])
  })
})

describe('welcomeRules — a redraft league', () => {
  it('shows the key rules in rulebook order', () => {
    expect(welcomeRules(buildLeagueRulebook(input())).map((r) => r.id)).toEqual(['format', 'lineup-lock', 'draft-date', 'waivers', 'trades', 'playoffs'])
  })
})
