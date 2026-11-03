/**
 * The dynasty season clock is ONE rule for the league header and its chat
 * (lib/league-media/dynastySeasonClock.ts; lib/league-chat/dynastyChatSkin.ts delegates to it).
 *
 * Before, the header showed the bare season whenever `startup_season` was unset while chat fell back
 * to the creation season, so one league read "2026 season" up top and "Year 3 · 2026" in chat.
 */
import { describe, expect, it } from 'vitest'
import { dynastySeasonClock as headerClock } from '@/lib/league-media/dynastySeasonClock'
import { dynastySeasonClock as chatClock } from '@/lib/league-chat/dynastyChatSkin'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'

const created = '2024-06-01T12:00:00Z'
const createdSeason = resolveLeagueCreationSeason('NFL', new Date(created))

describe('dynasty season clock: header and chat agree', () => {
  it('native league without startup_season: both fall back to the creation season', () => {
    const league = { season: 2026, sport: 'NFL', createdAt: created, settings: {}, platform: 'allfantasy' }
    const year = 2026 - createdSeason + 1
    expect(headerClock(league)).toEqual({ year, season: 2026 })
    expect(chatClock(league)).toEqual({ year, season: 2026 })
  })

  it('startup_season wins over the creation season, in both', () => {
    const league = { season: 2026, sport: 'NFL', createdAt: created, settings: { startup_season: 2023 } }
    expect(headerClock(league)).toEqual({ year: 4, season: 2026 })
    expect(chatClock(league)).toEqual({ year: 4, season: 2026 })
  })

  it('reads a numeric-string startup_season the same way in both', () => {
    const league = { season: 2026, sport: 'NFL', settings: { startup_season: '2025' } }
    expect(headerClock(league)).toEqual({ year: 2, season: 2026 })
    expect(chatClock(league)).toEqual({ year: 2, season: 2026 })
  })

  it('imported league: no creation-season guess — header shows the season alone, chat shows nothing', () => {
    const league = { season: 2026, sport: 'NFL', createdAt: created, settings: {}, platform: 'sleeper' }
    expect(headerClock(league)).toEqual({ year: null, season: 2026 })
    expect(chatClock(league)).toBeNull()
  })

  it('an imported league that does carry startup_season still gets its year', () => {
    const league = { season: 2026, sport: 'NFL', createdAt: created, settings: { startup_season: 2022 }, platform: 'sleeper' }
    expect(headerClock(league)).toEqual({ year: 5, season: 2026 })
    expect(chatClock(league)).toEqual({ year: 5, season: 2026 })
  })

  it('first season after the current one is a data problem, never Year 0', () => {
    const league = { season: 2024, sport: 'NFL', settings: { startup_season: 2026 } }
    expect(headerClock(league)).toEqual({ year: null, season: 2024 })
    expect(chatClock(league)).toBeNull()
  })

  it('unreadable current season: no clock anywhere', () => {
    expect(headerClock({ season: null, settings: { startup_season: 2023 } })).toBeNull()
    expect(chatClock({ season: null, settings: { startup_season: 2023 } })).toBeNull()
  })
})
