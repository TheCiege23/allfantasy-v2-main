import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { gradeLeagueOptions } from '@/components/trade-evaluator/GradeLeaguePicker'
import { defaultShareVoteLeagueId, type ShareVoteLeagueRow } from '@/lib/legacy/shareTradeVoteLeague'

/*
 * The AF Legacy Share tab's Trade Vote chooses a league and SENDS it (2026-11-26). Before this the tab
 * sent no `league_id`, so `/api/legacy/trade-vote-analyze` withheld every vote with "no league is
 * selected". The route's grading with and without a league is covered by
 * `trade-vote-analyze-one-grade.test.ts`; this covers the choice and the request.
 */

const ROWS: ShareVoteLeagueRow[] = [
  { id: 'af-old', name: 'Old Dynasty', sport: 'NFL', season: 2024, hasUnifiedRecord: true, unifiedLeagueId: 'af-old', platformLeagueId: 'sl-old' },
  { id: 'af-new', name: 'Newest League', sport: 'NFL', season: 2026, hasUnifiedRecord: true, unifiedLeagueId: 'af-new', platformLeagueId: 'sl-new' },
  { id: 'af-mid', name: 'Middle League', sport: 'NFL', season: 2025, hasUnifiedRecord: true, unifiedLeagueId: 'af-mid', platformLeagueId: 'sl-mid' },
  // A legacy-only row (no AllFantasy league) is never offered: its id would not pass the route's gate.
  { id: 'legacy-1', name: 'Legacy Only', sport: 'NFL', season: 2026, hasUnifiedRecord: false, platformLeagueId: 'sl-legacy' },
]
const PLAYERS = { p1: { name: "Ja'Marr Chase" }, p2: { name: 'CeeDee Lamb' }, p3: { name: 'Bijan Robinson' } }
const SLEEPER = [
  { league_id: 'sl-old', season: 2024, roster: { starters: ['p1'], bench: ['p3'] } },
  { league_id: 'sl-mid', season: 2025, roster: { starters: ['p9'], bench: [], taxi: ['p3'] } },
  { league_id: 'sl-legacy', season: 2026, roster: { starters: ['p1', 'p2', 'p3'] } },
]
const optionIds = gradeLeagueOptions(ROWS).map((o) => o.id)

describe('the Trade Vote league default', () => {
  it('offers only unified AllFantasy leagues', () => {
    expect(optionIds.sort()).toEqual(['af-mid', 'af-new', 'af-old'])
  })

  it('defaults to the league whose roster holds the typed players (most matches wins)', () => {
    const id = defaultShareVoteLeagueId({ optionIds, rows: ROWS, typedNames: ["Ja'Marr Chase", 'Bijan Robinson'], sleeperLeagues: SLEEPER, playerNames: PLAYERS })
    expect(id).toBe('af-old')
  })

  it('matches names loosely (case, apostrophes) and ignores a roster league that is not offered', () => {
    const id = defaultShareVoteLeagueId({ optionIds, rows: ROWS, typedNames: ['jamarr chase'], sleeperLeagues: SLEEPER, playerNames: PLAYERS })
    // sl-legacy also holds Chase but has no AllFantasy league, so it cannot be the grade's league.
    expect(id).toBe('af-old')
  })

  it('a tie on matches goes to the newer season', () => {
    const id = defaultShareVoteLeagueId({ optionIds, rows: ROWS, typedNames: ['Bijan Robinson'], sleeperLeagues: SLEEPER, playerNames: PLAYERS })
    expect(id).toBe('af-mid')
  })

  it('falls back to the most recent league when the players are not on any roster', () => {
    const id = defaultShareVoteLeagueId({ optionIds, rows: ROWS, typedNames: ['Nobody Known', '2026 1st'], sleeperLeagues: SLEEPER, playerNames: PLAYERS })
    expect(id).toBe('af-new')
  })

  it('no league to offer is no league — the route then withholds honestly', () => {
    expect(defaultShareVoteLeagueId({ optionIds: [], rows: [], typedNames: ["Ja'Marr Chase"], sleeperLeagues: SLEEPER, playerNames: PLAYERS })).toBe('')
  })
})

const page = readFileSync(resolve(process.cwd(), 'app/af-legacy/page.tsx'), 'utf8').replace(/\r\n/g, '\n')
const analyze = page.slice(page.indexOf('const analyzeShareTrade = async'), page.indexOf('// Look up player stock for Share tab'))

describe('the Share tab sends the league it graded in', () => {
  it('the Trade Vote request carries league_id from the picker', () => {
    expect(analyze).toContain("fetch('/api/legacy/trade-vote-analyze'")
    expect(analyze).toMatch(/\.\.\.\(shareVoteLeagueId \? \{ league_id: shareVoteLeagueId \} : \{\}\)/)
  })

  it('the picker is the analyzer picker’s option set, read from the existing league list', () => {
    expect(page).toContain("fetch('/api/league/list?summary=1'")
    expect(page).toMatch(/gradeLeagueOptions\(shareVoteLeagueRows \?\? \[\]\)/)
    expect(page).toContain('data-testid="share-trade-league-select"')
  })

  it('a withheld grade shows "Not graded" and the reason, never an empty letter', () => {
    expect(analyze).toContain('gradeWithheld: data.gradeWithheld ?? null')
    expect(page).toContain('data-testid="share-trade-grade-withheld"')
  })
})
