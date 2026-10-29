import { describe, expect, it } from 'vitest'
import { SURVIVOR_REVEAL_NIGHT_MS, resolveSurvivorMood, survivorBackgroundSrc, survivorSceneSport } from '@/lib/survivor/survivorMood'

const tz = 'America/New_York'
const at = (iso: string) => new Date(iso)

describe('survivor island mood follows league state', () => {
  it('is dusk when the vote deadline is later today', () => {
    expect(resolveSurvivorMood({ now: at('2026-10-20T15:00:00Z'), voteDeadlineAt: '2026-10-21T00:00:00Z', timeZone: tz })).toBe('dusk')
  })

  it('is day when the deadline is tomorrow, already past, or missing', () => {
    expect(resolveSurvivorMood({ now: at('2026-10-20T15:00:00Z'), voteDeadlineAt: '2026-10-22T00:00:00Z', timeZone: tz })).toBe('day')
    expect(resolveSurvivorMood({ now: at('2026-10-20T15:00:00Z'), voteDeadlineAt: '2026-10-20T14:00:00Z', timeZone: tz })).toBe('day')
    expect(resolveSurvivorMood({ now: at('2026-10-20T15:00:00Z'), timeZone: tz })).toBe('day')
  })

  it('reads "today" in the viewer time zone', () => {
    // 02:00Z on the 21st is still the evening of the 20th in New York.
    const input = { now: at('2026-10-20T23:00:00Z'), voteDeadlineAt: '2026-10-21T02:00:00Z' }
    expect(resolveSurvivorMood({ ...input, timeZone: tz })).toBe('dusk')
    expect(resolveSurvivorMood({ ...input, timeZone: 'Asia/Tokyo' })).toBe('dusk')
    expect(resolveSurvivorMood({ now: at('2026-10-20T14:00:00Z'), voteDeadlineAt: '2026-10-21T02:00:00Z', timeZone: 'Asia/Tokyo' })).toBe('day')
  })

  it('is night from revealStartsAt until the reveal ends, then day again', () => {
    const start = '2026-10-21T00:30:00Z'
    expect(resolveSurvivorMood({ now: at('2026-10-21T00:29:00Z'), revealStartsAt: start, timeZone: tz })).toBe('day')
    expect(resolveSurvivorMood({ now: at('2026-10-21T00:30:00Z'), revealStartsAt: start, timeZone: tz })).toBe('night')
    expect(resolveSurvivorMood({ now: Date.parse(start) + SURVIVOR_REVEAL_NIGHT_MS - 1, revealStartsAt: start })).toBe('night')
    expect(resolveSurvivorMood({ now: Date.parse(start) + SURVIVOR_REVEAL_NIGHT_MS, revealStartsAt: start })).toBe('day')
    expect(resolveSurvivorMood({ now: at('2026-10-21T00:45:00Z'), revealStartsAt: start, revealEndsAt: '2026-10-21T00:40:00Z' })).toBe('day')
  })

  it('night outranks dusk, and an Exile screen is always exile', () => {
    const now = at('2026-10-20T20:00:00Z')
    expect(resolveSurvivorMood({ now, voteDeadlineAt: '2026-10-20T23:00:00Z', revealStartsAt: '2026-10-20T19:30:00Z', timeZone: tz })).toBe('night')
    expect(resolveSurvivorMood({ now, voteDeadlineAt: '2026-10-20T23:00:00Z', exileScreen: true, timeZone: tz })).toBe('exile')
  })
})

describe('survivor scene artwork', () => {
  it('maps every sport to its kit, college sports included', () => {
    expect(survivorSceneSport('NFL')).toBe('football')
    expect(survivorSceneSport('NCAAF')).toBe('football')
    expect(survivorSceneSport('NBA')).toBe('basketball')
    expect(survivorSceneSport('NCAAB')).toBe('basketball')
    expect(survivorSceneSport('MLB')).toBe('baseball')
    expect(survivorSceneSport('NHL')).toBe('hockey')
    expect(survivorSceneSport('SOCCER')).toBe('soccer')
    expect(survivorSceneSport(null)).toBe('football')
  })

  it('builds only whitelisted background paths', () => {
    expect(survivorBackgroundSrc('dusk', 'NFL')).toBe('/survivor/backgrounds/dusk-football.svg')
    expect(survivorBackgroundSrc('night', 'soccer')).toBe('/survivor/backgrounds/night-soccer.svg')
    expect(survivorBackgroundSrc('../x' as never, '../../etc')).toBe('/survivor/backgrounds/day-football.svg')
  })
})
