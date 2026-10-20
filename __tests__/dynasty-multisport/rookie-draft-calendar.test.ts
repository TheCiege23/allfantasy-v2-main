import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ROOKIE_DRAFT_AUTO_OPEN_DEFAULT,
  ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY,
  defaultRookieDraftWindow,
  describeRookieDraftWindow,
  normalizeCustomOpenDate,
  readRookieDraftCalendarSettings,
  resolveRookieDraftWindow,
} from '@/lib/dynasty-core/rookieDraftCalendar'
import { DYNASTY_SPORT_CONFIGS } from '@/lib/dynasty-core/dynastySportConfig'
import { getPickValue } from '@/lib/fantasycalc'

/**
 * One calendar per sport: the real pro draft (`proDraftMonth`) and the fantasy rookie-draft window
 * that follows it. MLB's real draft is mid-season, so its dynasty draft is held after the World
 * Series, in the winter BEFORE the season it seeds.
 */

const iso = (d: Date | null) => d?.toISOString() ?? null

describe('rookie-draft windows, per sport', () => {
  it('real pro-draft months: NFL April, NBA June, NHL June, MLB July', () => {
    expect(DYNASTY_SPORT_CONFIGS.nfl.offseason.proDraftMonth).toBe(4)
    expect(DYNASTY_SPORT_CONFIGS.nba.offseason.proDraftMonth).toBe(6)
    expect(DYNASTY_SPORT_CONFIGS.nhl.offseason.proDraftMonth).toBe(6)
    expect(DYNASTY_SPORT_CONFIGS.mlb.offseason.proDraftMonth).toBe(7)
  })

  it('every window opens after the real draft it drafts from', () => {
    for (const k of ['nfl', 'nba', 'nhl']) {
      const o = DYNASTY_SPORT_CONFIGS[k].offseason
      expect(o.rookieDraftMonth).toBeGreaterThan(o.proDraftMonth)
    }
    // MLB's July draft is mid-season; its rookie window is the following offseason.
    const mlb = DYNASTY_SPORT_CONFIGS.mlb.offseason
    expect(mlb.rookieDraftMonth).toBe(11)
    expect(mlb.rookieDraftYearOffset).toBe(-1)
  })

  it('NFL: May of the seeded season', () => {
    const w = defaultRookieDraftWindow('NFL', 2027)!
    expect(iso(w.opensAt)).toBe('2027-05-01T12:00:00.000Z')
    expect(iso(w.closesAt)).toBe('2027-06-01T12:00:00.000Z')
  })

  it('NBA: July, after the late-June draft', () => {
    const w = defaultRookieDraftWindow('NBA', 2027)!
    expect(iso(w.opensAt)).toBe('2027-07-01T12:00:00.000Z')
    expect(iso(w.closesAt)).toBe('2027-08-01T12:00:00.000Z')
  })

  it('NHL: July (was August), after the late-June Entry Draft', () => {
    const w = defaultRookieDraftWindow('NHL', 2027)!
    expect(iso(w.opensAt)).toBe('2027-07-01T12:00:00.000Z')
  })

  it('MLB: November–January AFTER the season — the 2027 draft opens November 2026', () => {
    const w = defaultRookieDraftWindow('MLB', 2027)!
    expect(iso(w.opensAt)).toBe('2026-11-01T12:00:00.000Z')
    expect(iso(w.closesAt)).toBe('2027-02-01T12:00:00.000Z')
    // ...which is after the 2026 regular season and World Series, and before 2027's Opening Day.
    expect(w.opensAt.getTime()).toBeGreaterThan(Date.parse('2026-10-31T00:00:00Z'))
    expect(w.closesAt!.getTime()).toBeLessThan(Date.parse('2027-03-15T00:00:00Z'))
  })

  it('a sport with no calendar has no window (not NFL\'s by fallback)', () => {
    expect(defaultRookieDraftWindow('CRICKET', 2027)).toBeNull()
    expect(describeRookieDraftWindow('CRICKET')).toBeNull()
  })

  it('describes the windows in words', () => {
    expect(describeRookieDraftWindow('NFL')).toBe('May')
    expect(describeRookieDraftWindow('NBA')).toBe('July')
    expect(describeRookieDraftWindow('NHL')).toBe('July')
    expect(describeRookieDraftWindow('MLB')).toBe('November–January')
  })
})

describe('commissioner settings', () => {
  it('auto-open is OFF unless a commissioner turns it on', () => {
    expect(ROOKIE_DRAFT_AUTO_OPEN_DEFAULT).toBe(false)
    expect(readRookieDraftCalendarSettings({})).toEqual({ autoOpen: false, customOpenDate: null })
    expect(readRookieDraftCalendarSettings(null).autoOpen).toBe(false)
    expect(
      readRookieDraftCalendarSettings({ [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2027-05-10' } }),
    ).toEqual({ autoOpen: true, customOpenDate: '2027-05-10' })
  })

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(normalizeCustomOpenDate('2027-05-10')).toBe('2027-05-10')
    expect(normalizeCustomOpenDate('2027-02-30')).toBeNull()
    expect(normalizeCustomOpenDate('05/10/2027')).toBeNull()
    expect(normalizeCustomOpenDate(20270510)).toBeNull()
  })

  it('a custom date for this offseason overrides the sport default', () => {
    const settings = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2027-04-20' } }
    const w = resolveRookieDraftWindow({ sport: 'NFL', season: 2027, settings, offseasonStartedAt: new Date('2027-01-12T03:00:00Z') })!
    expect(w.source).toBe('custom')
    expect(iso(w.opensAt)).toBe('2027-04-20T12:00:00.000Z')
  })

  it('last offseason\'s custom date is ignored, not treated as "open now"', () => {
    const settings = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { autoOpen: true, customOpenDate: '2027-04-20' } }
    const w = resolveRookieDraftWindow({ sport: 'NFL', season: 2028, settings, offseasonStartedAt: new Date('2028-01-10T03:00:00Z') })!
    expect(w.source).toBe('sport_default')
    expect(iso(w.opensAt)).toBe('2028-05-01T12:00:00.000Z')
  })

  it('MLB custom date in February of the seeded year applies to the offseason that began in October', () => {
    const settings = { [ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY]: { customOpenDate: '2027-02-01' } }
    const w = resolveRookieDraftWindow({ sport: 'MLB', season: 2027, settings, offseasonStartedAt: new Date('2026-10-05T00:00:00Z') })!
    expect(w.source).toBe('custom')
    expect(iso(w.opensAt)).toBe('2027-02-01T12:00:00.000Z')
  })
})

describe('pick valuation reads the same calendar', () => {
  afterEach(() => vi.useRealTimers())

  it('NHL\'s pre-draft bump counts down to July, not August', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // June 15: July 1 is 16 days out (bump 1.06); August would have been ~47 days (1.03).
    vi.setSystemTime(new Date('2027-06-15T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'NHL')).toBe(Math.round(6000 * 1.06))
  })

  it('an MLB pick\'s bump counts down to the November BEFORE its season', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    expect(getPickValue(2027, 1, true, undefined, undefined, 'MLB')).toBe(Math.round(6000 * 0.92 * 1.06))
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'))
    // January 2027: the 2027 class was drafted in November, so no bump (it was 1.06 when MLB said January).
    expect(getPickValue(2027, 1, true, undefined, undefined, 'MLB')).toBe(6000)
  })
})
