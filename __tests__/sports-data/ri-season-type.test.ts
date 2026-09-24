import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'
import { classifyRiSeasonType, resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'

/**
 * `/live` returns preseason, regular-season and playoff games through one call. Until
 * 2026-09-24 the ingest dropped the game's `season_type`, and 619 NHL PRESEASON rows sat in
 * season 2026 with nothing marking them. These pin the label to the committed fixtures and the
 * contract's documented spellings, and pin UNKNOWN to `null` rather than to "regular".
 */

function fixtureGames(sport: 'MLB' | 'NBA' | 'NHL'): unknown[] {
  const file = path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', `live.${sport}.json`)
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { data?: Record<string, unknown[]> }
  const games = raw.data?.[sport]
  if (!Array.isArray(games) || games.length === 0) throw new Error(`fixture live.${sport}.json has no games`)
  return games
}

describe('classifyRiSeasonType', () => {
  it('reads the one label measured for MLB / NBA / NHL', () => {
    expect(classifyRiSeasonType('Regular Season')).toBe('regular')
  })

  it('reads the labels the contract documents for NFL', () => {
    expect(classifyRiSeasonType('Preseason')).toBe('pre')
    for (const label of ['WILD CARD', 'DIV RD', 'CONF CHAMP', 'SUPER BOWL']) {
      expect(classifyRiSeasonType(label), label).toBe('post')
    }
  })

  it('reads the obvious spellings for the daily sports', () => {
    expect(classifyRiSeasonType('Pre-Season')).toBe('pre')
    expect(classifyRiSeasonType('Spring Training')).toBe('pre')
    expect(classifyRiSeasonType('Postseason')).toBe('post')
    expect(classifyRiSeasonType('Playoffs')).toBe('post')
    expect(classifyRiSeasonType('World Series')).toBe('post')
    expect(classifyRiSeasonType('Stanley Cup Final')).toBe('post')
  })

  it('never guesses: unknown, missing or non-string is null, not regular', () => {
    expect(classifyRiSeasonType('All-Star')).toBeNull()
    expect(classifyRiSeasonType('')).toBeNull()
    expect(classifyRiSeasonType(undefined)).toBeNull()
    expect(classifyRiSeasonType(2)).toBeNull()
  })
})

describe('normalizeRiGameBox carries season_type', () => {
  it.each(['MLB', 'NBA', 'NHL'] as const)('every %s fixture game is labelled regular', (sport) => {
    const boxes = fixtureGames(sport).map(normalizeRiGameBox).filter((b) => b !== null)
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) {
      expect(box.seasonType).toBe('regular')
      expect(box.seasonTypeLabel).toBe('Regular Season')
    }
  })

  it('labels a preseason game as preseason', () => {
    const game = { ...(fixtureGames('NHL')[0] as Record<string, unknown>), season_type: 'Preseason' }
    const box = normalizeRiGameBox(game)
    expect(box?.seasonType).toBe('pre')
    expect(box?.lines.length).toBeGreaterThan(0)
  })

  it('keeps an unrecognised label verbatim and classifies it unknown', () => {
    const game = { ...(fixtureGames('MLB')[0] as Record<string, unknown>), season_type: 'Exotic Round' }
    const box = normalizeRiGameBox(game)
    expect(box?.seasonType).toBeNull()
    expect(box?.seasonTypeLabel).toBe('Exotic Round')
  })
})

describe('resolveStoredSeasonType', () => {
  const at = (iso: string) => new Date(iso)

  it('trusts a stored label over the date', () => {
    expect(
      resolveStoredSeasonType({ normalizedStatMap: { seasonType: 'post' }, sport: 'NHL', season: 2026, gameDate: at('2026-09-22T04:00:00Z') }),
    ).toBe('post')
  })

  it('marks a legacy NHL row before the recorded opener as preseason (the 619 rows)', () => {
    expect(
      resolveStoredSeasonType({ normalizedStatMap: { stats: {} }, sport: 'NHL', season: 2026, gameDate: at('2026-09-22T04:00:00Z') }),
    ).toBe('pre')
  })

  it('does not call a legacy row regular just because it is after the opener', () => {
    expect(
      resolveStoredSeasonType({ normalizedStatMap: { stats: {} }, sport: 'NHL', season: 2026, gameDate: at('2026-10-05T04:00:00Z') }),
    ).toBeNull()
  })

  it('is unknown for a sport with no recorded opener', () => {
    expect(
      resolveStoredSeasonType({ normalizedStatMap: {}, sport: 'MLB', season: 2026, gameDate: at('2026-03-01T04:00:00Z') }),
    ).toBeNull()
  })
})
