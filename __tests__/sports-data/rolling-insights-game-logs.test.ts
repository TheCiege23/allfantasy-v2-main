import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'

/**
 * Pins the `/live` box-score parser to the COMMITTED FIXTURE.
 *
 * The first version of this parser was written from a hint in the field maps rather than from a
 * real payload, and it was wrong in three places at once — it found ZERO games on a date that had
 * fifteen, while the provider returned HTTP 200 with no error. Nothing failed; the pipeline just
 * quietly wrote nothing.
 *
 * These assertions exist so that can only ever happen once. They read
 * `contracts/rolling-insights/fixtures/live.MLB.json`, captured 2026-08-26 via the contract's own
 * `scripts/probe.sh`, so the parser is checked against what the vendor actually sent rather than
 * against what we believed it would send.
 */

const FIXTURE = path.join(
  process.cwd(),
  'contracts',
  'rolling-insights',
  'fixtures',
  'live.MLB.json',
)

function loadGames(): unknown[] {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { data?: Record<string, unknown[]> }
  const games = raw.data?.MLB
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error('fixture has no data.MLB rows — re-capture before trusting this suite')
  }
  return games
}

describe('normalizeRiGameBox — against the committed MLB fixture', () => {
  it('finds games at all (the exact failure that shipped)', () => {
    const parsed = loadGames().map(normalizeRiGameBox)
    const withLines = parsed.filter((g) => g && g.lines.length > 0)
    expect(withLines.length).toBeGreaterThan(0)
    // The captured slate. A parser that silently degrades to one game still fails here.
    expect(withLines.length).toBe(loadGames().length)
  })

  it('reads the player id from the KEY, because the entry carries none', () => {
    const box = normalizeRiGameBox(loadGames()[0])!
    expect(box.lines.length).toBeGreaterThan(0)
    for (const line of box.lines) {
      expect(line.providerPlayerId).toMatch(/^\d+$/)
      expect(line.playerName).toBeTruthy()
    }
  })

  it('keeps batting and pitching as distinct groups', () => {
    const groups = new Set(loadGames().flatMap((g) => normalizeRiGameBox(g)?.lines.map((l) => l.group) ?? []))
    expect(groups.has('batting')).toBe(true)
    expect(groups.has('pitching')).toBe(true)
  })

  it('folds the id into the stored payload so provenance survives', () => {
    const line = normalizeRiGameBox(loadGames()[0])!.lines[0]!
    expect(String(line.raw.player_id)).toBe(line.providerPlayerId)
  })

  it('carries team and opponent from full_box, bounded to the VarChar(8) column', () => {
    const box = normalizeRiGameBox(loadGames()[0])!
    const teams = new Set(box.lines.map((l) => l.team))
    const opponents = new Set(box.lines.map((l) => l.opponent))
    expect(teams.size).toBe(2)
    expect(opponents.size).toBe(2)
    for (const line of box.lines) {
      expect(line.team).toBeTruthy()
      expect(line.opponent).not.toBe(line.team)
      expect((line.team ?? '').length).toBeLessThanOrEqual(8)
      expect((line.opponent ?? '').length).toBeLessThanOrEqual(8)
    }
  })

  it('carries the game identity the upsert key depends on', () => {
    for (const game of loadGames()) {
      const box = normalizeRiGameBox(game)!
      expect(box.providerGameId).toBeTruthy()
      expect(box.season).toBe(2026)
      // MLB has no weeks; 0 is the column's documented "no week" value, never an invented round.
      expect(box.weekOrRound).toBe(0)
    }
  })

  it('still accepts the ARRAY form, which other sports may use (G-01..G-04 unverified)', () => {
    const box = normalizeRiGameBox({
      game_ID: '20260826-1-2',
      season: 2026,
      full_box: { home_team: { abbrv: 'AAA' }, away_team: { abbrv: 'BBB' } },
      player_box: { home_team: { all: [{ player_id: '77', player: 'Array Form' }] } },
    })
    expect(box?.lines).toHaveLength(1)
    expect(box?.lines[0]?.providerPlayerId).toBe('77')
  })

  it('returns null for a game with no id rather than inventing one', () => {
    expect(normalizeRiGameBox({ season: 2026 })).toBeNull()
  })
})
