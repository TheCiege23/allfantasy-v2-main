import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Two fabrications the rankings/legacy audit found, pinned at the source.
 *
 * Both are the same defect this codebase keeps producing: a confident number
 * standing in for a measurement nobody took. Neither can be covered by a runtime
 * test cheaply — one needs an authenticated session, the other a full league
 * compute — so these assert the shape of the code that produced them, which is
 * what actually regressed.
 */

const RANK_ROUTE = readFileSync('app/api/user/rank/route.ts', 'utf8')
const RANKINGS_ENGINE = readFileSync('lib/rankings-engine/league-rankings-v2.ts', 'utf8')

describe('a career grade is never invented', () => {
  it('does not hardcode a letter grade or score', () => {
    // legacy_ai_reports holds 0 rows and NOTHING in the codebase writes it, so
    // `clampScore(aiReport?.rating, 70)` gave every user 70 — and a grade ring
    // rendered the letter as if it had been earned. Two more sites hardcoded
    // 'B' outright for users who had imported nothing.
    expect(RANK_ROUTE).not.toMatch(/aiReportGrade:\s*'[A-F][+-]?'/)
    expect(RANK_ROUTE).not.toMatch(/aiScore:\s*\d+\s*,/)
  })

  it('only derives a grade when a score exists', () => {
    expect(RANK_ROUTE).toContain('aiScore != null ? scoreToLetterGrade(aiScore) : null')
  })

  it('does not fall back to a number when no report exists', () => {
    // The fallback argument is what manufactured the 70. Asserted against the
    // ASSIGNMENT, not any mention — the comment explaining the fix quotes the old
    // expression by name, and that mention is the documentation, not a relapse.
    expect(RANK_ROUTE).not.toMatch(/=\s*clampScore\(aiReport\?\.rating,\s*70\)/)
    expect(RANK_ROUTE).toContain('aiReport?.rating != null')
  })

  it('reports an unplayed career as unknown, not as zero', () => {
    // winRate: 0 renders as "0%", which reads as a terrible record rather than
    // "no games on file".
    expect(RANK_ROUTE).not.toMatch(/winRate:\s*0\s*,\s*\n\s*playoffRate:\s*0\s*,/)
    expect(RANK_ROUTE).toContain('winRate: null')
  })
})

describe('ranking confidence reflects whether the inputs carry information', () => {
  it('counts weeks actually scored, not array length', () => {
    // weeklyPts can hold a zero-filled entry for a league that has not kicked
    // off, so `length` reports history that does not exist. A real played week
    // always scores something.
    expect(RANKINGS_ENGINE).toContain('weeklyPts.filter((pts) => pts > 0).length')
  })

  it('caps confidence when three of five composite inputs are constants', () => {
    // winScore, luckScore and managerSkillScore all derive from played games.
    // With none played they are identical for every team, so the ranking is
    // really roster value alone — but confidence measured only source freshness
    // and reported 79/100 HIGH, against 80/100 for a full completed season.
    expect(RANKINGS_ENGINE).toContain('const informativeInputs = playedWeeks > 0 ? 5 : 2')
    expect(RANKINGS_ENGINE).toMatch(/confidence = Math\.min\(confidence, 55\)/)
  })

  it('says plainly why the ranking is weaker', () => {
    expect(RANKINGS_ENGINE).toContain('No games played yet')
    expect(RANKINGS_ENGINE).toContain('reflects roster value only')
  })

  it('does not call coverage FULL when the performance half is empty', () => {
    // Rich valuation data does not compensate for having watched nobody play.
    expect(RANKINGS_ENGINE).toMatch(/if \(playedWeeks === 0\) \{[\s\S]{0,300}dataCoverage = 'MINIMAL'/)
  })
})
