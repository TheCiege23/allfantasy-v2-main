import { describe, expect, it } from 'vitest'
import { FORMAT_KEYS, countFormats, leagueFormats } from '@/lib/core-app/homeFormats'
import { buildPlatformCalendar } from '@/lib/core-app/platformCalendar'
import { homeLearnMessages } from '@/lib/core-app/messages/homeLearn'

describe('leagueFormats', () => {
  it('reads every format a league is at once, in catalog order', () => {
    expect(
      leagueFormats({ isDynasty: true, leagueVariant: 'DYNASTY_IDP', bestBallMode: true, scoring: 'PPR Superflex TEP' }),
    ).toEqual(['dynasty', 'best-ball', 'idp', 'superflex', 'te-premium'])
  })

  it('calls a league redraft only when nothing says it keeps players', () => {
    expect(leagueFormats({ leagueType: 'Redraft', scoring: 'ppr' })).toEqual(['redraft'])
    expect(leagueFormats({ leagueType: 'Keeper' })).toEqual(['keeper'])
    expect(leagueFormats({ leagueVariant: 'devy_dynasty' })).toEqual(['dynasty', 'devy'])
    expect(leagueFormats({})).toEqual(['redraft'])
  })

  it('uses the same guillotine and survivor tests as the rest of the app', () => {
    expect(leagueFormats({ guillotineMode: true })).toContain('guillotine')
    expect(leagueFormats({ leagueVariant: 'survivor_guillotine' })).toEqual(['redraft', 'guillotine', 'survivor'])
    expect(leagueFormats({ leagueVariant: 'zombie' })).toContain('zombie')
  })

  it('does not guess superflex from anything but the scoring label', () => {
    expect(leagueFormats({ scoring: 'PPR' })).not.toContain('superflex')
    expect(leagueFormats({ scoring: 'Half PPR 2QB' })).toContain('superflex')
  })
})

describe('countFormats', () => {
  it('counts across leagues, most common first', () => {
    const counts = countFormats([
      { isDynasty: true, scoring: 'PPR Superflex' },
      { isDynasty: true },
      { leagueType: 'Redraft', guillotineMode: true },
    ])
    expect(counts).toEqual([
      { key: 'dynasty', count: 2 },
      { key: 'redraft', count: 1 },
      { key: 'guillotine', count: 1 },
      { key: 'superflex', count: 1 },
    ])
  })
})

describe('format copy', () => {
  it('has a name, rule and watch line for every format, in both languages', () => {
    for (const lang of [homeLearnMessages.en, homeLearnMessages.es]) {
      for (const key of FORMAT_KEYS) {
        expect(lang.formatName!(key), key).toBeTruthy()
        expect(lang.formatRule!(key), key).toMatch(/\.$/)
        expect(lang.formatWatchLine!(key), key).toMatch(/\.$/)
      }
    }
  })
})

describe('buildPlatformCalendar', () => {
  const NOW = Date.parse('2026-11-12T21:00:00Z') // a Thursday
  const wed = { dayOfWeek: 3, time: '00:00', timeZone: 'America/Los_Angeles' }
  const daily = { dayOfWeek: null, time: '03:00', timeZone: 'America/Los_Angeles' }

  it('groups each platform by schedule, most leagues first, and counts what it could not read', () => {
    const rows = buildPlatformCalendar(
      [
        { id: 's1', platform: 'sleeper' },
        { id: 's2', platform: 'Sleeper' },
        { id: 's3', platform: 'sleeper' },
        { id: 's4', platform: 'sleeper' },
        { id: 'e1', platform: 'espn' },
        { id: 'n1', platform: null },
      ],
      new Map([
        ['s1', wed],
        ['s2', wed],
        ['s3', daily],
      ]),
      NOW,
    )
    expect(rows.map((r) => [r.platform, r.leagues, r.unread])).toEqual([
      ['sleeper', 4, 1],
      ['allfantasy', 1, 1],
      ['espn', 1, 1],
    ])
    const sleeper = rows[0]!
    expect(sleeper.waivers.map((w) => w.leagues)).toEqual([2, 1])
    // Next Wednesday 00:00 Pacific after Thursday 13:00 Pacific is six days and eleven hours away.
    expect(sleeper.waivers[0]!.nextRunIso).toBe('2026-11-18T08:00:00.000Z')
    // A platform with nothing stored gets no schedule at all — never a platform default.
    expect(rows.find((r) => r.platform === 'espn')!.waivers).toEqual([])
  })
})
