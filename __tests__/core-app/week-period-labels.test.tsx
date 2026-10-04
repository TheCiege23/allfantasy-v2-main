import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeekBoard as Board, WeekMatchup } from '@/lib/core-app/weekBoard'
const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
import WeekBoard from '@/components/core-app/boards/WeekBoard'
import YourWeek from '@/components/core-app/screens/YourWeek'
afterEach(cleanup)
const matchup = (leagueId: string, season: number, week: number): WeekMatchup => ({
  leagueId, leagueName: leagueId + ' Very Long League Name To Test Mobile Wrapping', platform: 'sleeper', leagueImageUrl: null, season, week,
  opponent: { rosterId: '2', name: 'Opponent', avatarUrl: null }, elimination: false,
  projection: { you: 100, them: 95, margin: 5, winProbability: 0.55 }, form: null,
  yourSampleWeeks: 3, live: null, href: '/core/matchup?league=' + leagueId,
})
const board: Board = { season: null, week: null, coinFlips: [matchup('NFL', 2026, 4), matchup('NBA', 2027, 20)],
  leaning: [], unprojected: [], eliminationWeeks: [], model: { basis: 'Completed league scores', sampleSize: 6 },
  withoutSchedule: 0, firstKickoffAt: null, leagueBoard: null }
describe('portfolio scoring-period labels', () => {
  it.each(['en', 'es'])('shows each league period on both portfolio views in %s', (language) => {
    lang.language = language
    const label = language === 'es' ? 'Período' : 'Period'
    const compact = render(<WeekBoard board={board} outlook={null} allHref="/core/week?all=1" totalLeagues={2} rivalriesHref="/core/week?view=rivalries" />)
    expect(compact.container.textContent).toContain('2026 · ' + label + ' 4')
    expect(compact.container.textContent).toContain('2027 · ' + label + ' 20')
    compact.unmount()
    const full = render(<YourWeek data={board} rivalriesHref="/core/week?view=rivalries" />)
    expect(full.container.textContent).toContain('2026 · ' + label + ' 4')
    expect(full.container.textContent).toContain('2027 · ' + label + ' 20')
    for (const label of full.container.querySelectorAll<HTMLElement>('.af-wk-league')) {
      expect(label.style.whiteSpace).toBe('normal')
      expect(label.style.overflowWrap).toBe('anywhere')
    }
  })
})
