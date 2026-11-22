// @vitest-environment node
/**
 * A real ESPN NFL summary (PIT 16 at NO 10, final, 2026-10-25), captured through
 * contracts/espn/scripts/probe.sh, run through the parser and the play-alert rules.
 * The hand-built plays in game-events.test.ts cannot catch ESPN wording they never imagined;
 * this one already did: a field goal "NULLIFIED by Penalty … - No Play" was sent as a score.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { gamePlayAlerts } from '@/lib/engagement-alerts/gameEvents'
import { trimEspnGameSummary } from '@/lib/live/espnGameSummary'

const raw = JSON.parse(readFileSync('contracts/espn/fixtures/summary.NFL.event401873011.json', 'utf8'))
const detail = trimEspnGameSummary(raw, { sport: 'NFL', gameId: '401873011', fetchedAt: '2026-10-25T20:00:00.000Z' })!
const alerts = gamePlayAlerts(detail)
const plays = detail.drives.flatMap((d) => d.plays)

describe('ESPN NFL summary fixture', () => {
  it('parses the final', () => {
    expect(detail.status.state).toBe('post')
    expect(detail.startTime).toBe('2026-10-25T13:30Z')
    expect([detail.away.abbrev, detail.away.score, detail.home.abbrev, detail.home.score]).toEqual(['PIT', 16, 'NO', 10])
    expect(detail.drives).toHaveLength(13)
    expect(plays).toHaveLength(168)
    expect(detail.scoringPlays).toHaveLength(6)
  })

  it('sends exactly the six real scores, in order, and nothing for the field goal a penalty wiped out', () => {
    const scores = alerts.filter((a) => a.type === 'game_scoring_play')
    expect(scores.map((a) => a.key)).toEqual(detail.scoringPlays.map((s) => `play:${s.id}`))
    expect(scores.map((a) => a.title)).toEqual([
      '🎯 Field goal · PIT 3, NO 0',
      '🎯 Field goal · PIT 3, NO 3',
      '🏈 Touchdown · PIT 10, NO 3',
      '🏈 Touchdown · PIT 10, NO 10',
      '🎯 Field goal · PIT 13, NO 10',
      '🎯 Field goal · PIT 16, NO 10',
    ])
    const nullified = plays.find((p) => /NULLIFIED/.test(p.text))!
    expect(nullified).toBeDefined()
    expect(alerts.some((a) => a.key === `play:${nullified.id}`)).toBe(false)
  })

  it('big plays are real runs and catches of 19+ yards, or sacks — never a penalty', () => {
    const big = alerts.filter((a) => a.type === 'game_big_play')
    expect(big.length).toBeGreaterThan(0)
    for (const a of big) {
      const p = plays.find((x) => `play:${x.id}` === a.key)!
      expect(p.text).not.toMatch(/PENALTY/)
      expect(/Sack/.test(a.title) || (p.statYardage ?? 0) >= 19).toBe(true)
    }
  })

  it('names players from the box score and keys every alert once', () => {
    expect(new Set(alerts.map((a) => a.key)).size).toBe(alerts.length)
    expect(alerts.every((a) => (a.athleteIds ?? []).length > 0)).toBe(true)
  })
})
