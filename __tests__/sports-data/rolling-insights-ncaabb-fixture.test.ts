import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'

/**
 * Pins the `/live` parser to the COMMITTED college-basketball fixture (GAPS G-03).
 *
 * NCAAB has been in the daily game-log sweep (`MULTI_SPORT_GAME_LOG_SPORTS`) since 2026-08-27,
 * but no season was in play, so its shape had never been seen. This parser once extracted ZERO
 * NBA lines from a real payload without a single error. Captured 2026-09-24 with the contract's
 * own `scripts/probe.sh live NCAAB "" 2026-04-06` so the 2026-11-02 opener is not the first test.
 *
 * The one game is the 2026 national final, UConn at Michigan, which also carries the
 * postseason label (GAPS N-13) and a box score the vendor left INCOMPLETE (GAPS N-15).
 */

const FIXTURE = path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'live.NCAABB.json')

function game(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { data?: Record<string, unknown[]> }
  const games = raw.data?.NCAABB
  if (!Array.isArray(games) || games.length !== 1) throw new Error('fixture must hold the one captured NCAABB game')
  return games[0] as Record<string, unknown>
}

describe('normalizeRiGameBox — against the committed NCAABB fixture', () => {
  it('extracts every player line (the NBA-shaped box: no group level)', () => {
    const box = normalizeRiGameBox(game())
    expect(box).not.toBeNull()
    expect(box!.lines).toHaveLength(14)
    // A parser expecting MLB/NHL grouping reads stat NAMES as player ids. None may appear.
    const ids = box!.lines.map((l) => l.providerPlayerId)
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true)
    expect(new Set(box!.lines.map((l) => l.group))).toEqual(new Set(['all']))
  })

  it('reads the game envelope: ids, teams, start-year season, Eastern game-id date', () => {
    const box = normalizeRiGameBox(game())!
    expect(box.providerGameId).toBe('20260406-12-103')
    expect(box.season).toBe(2025) // "2025-2026" -> the year the season started
    expect(box.gameDate?.toISOString()).toBe('2026-04-07T00:50:00.000Z') // GMT; the id carries the ET day
    const teams = new Set(box.lines.map((l) => `${l.team}@${l.opponent}`))
    expect(teams).toEqual(new Set(['MICH@CONN', 'CONN@MICH']))
  })

  it('labels the NCAA Tournament as postseason (GAPS N-13)', () => {
    const box = normalizeRiGameBox(game())!
    expect(box.seasonTypeLabel).toBe('Postseason')
    expect(box.seasonType).toBe('post')
  })

  it('REGRESSION CATCHER (GAPS N-15): the vendor box can be missing players — the sum does not reach the score', () => {
    const g = game()
    const box = normalizeRiGameBox(g)!
    const fullBox = g.full_box as Record<string, { abbrv: string; score: number }>
    const scored = (team: string) =>
      box.lines.filter((l) => l.team === team).reduce((a, l) => a + (Number(l.raw.points) || 0), 0)
    expect(scored('MICH')).toBe(fullBox.home_team.score) // 69: complete
    expect(fullBox.away_team.score).toBe(63)
    expect(scored('CONN')).toBe(50) // 13 points of UConn's box are simply absent
  })
})
