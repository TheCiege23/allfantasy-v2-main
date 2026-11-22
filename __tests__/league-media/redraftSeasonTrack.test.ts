/**
 * The redraft header's season track: real data only, and a marker without data is dropped.
 * lib/league-media/redraftSeasonTrack.ts
 */
import { describe, expect, it } from 'vitest'
import { buildRedraftSeasonTrack } from '@/lib/league-media/redraftSeasonTrack'

const ids = (t: ReturnType<typeof buildRedraftSeasonTrack>) => t.markers.map(m => m.id)

describe('buildRedraftSeasonTrack', () => {
  it('full data: week of N, fill, and all five markers placed on the bar', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 9, totalWeeks: 17, playoffStartWeek: 15, tradeDeadlineWeek: 12, draftComplete: true })
    expect(t.weekLabel).toBe('Week 9 of 17')
    expect(t.progress).toBeCloseTo(9 / 17, 3)
    expect(ids(t)).toEqual(['draft', 'now', 'deadline', 'playoffs', 'championship'])
    expect(t.markers.map(m => m.label)).toEqual(['Draft ✓', 'Week 9 · now', 'Trade deadline · Wk 12', 'Playoffs · Wk 15', 'Championship · Wk 17'])
    expect(t.markers.map(m => m.at)).toEqual([0, 0.529, 0.706, 0.882, 1])
    expect(t.markers.map(m => m.state)).toEqual(['done', 'now', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('past the deadline and into the playoffs, those markers read done', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 16, totalWeeks: 17, playoffStartWeek: 15, tradeDeadlineWeek: 12, draftComplete: true })
    expect(t.markers.find(m => m.id === 'deadline')!.state).toBe('done')
    expect(t.markers.find(m => m.id === 'playoffs')!.state).toBe('done')
    expect(t.markers.find(m => m.id === 'championship')!.state).toBe('upcoming')
  })

  it('no season length: no "of N", no fill, no championship, and nothing positioned', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 4, playoffStartWeek: 19, tradeDeadlineWeek: 16, draftComplete: true })
    expect(t.weekLabel).toBe('Week 4')
    expect(t.progress).toBeNull()
    expect(ids(t)).toEqual(['draft', 'now', 'deadline', 'playoffs'])
    expect(t.markers.every(m => m.at === null)).toBe(true)
  })

  it('no trade deadline set: the deadline marker is dropped, not estimated', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 3, totalWeeks: 17, playoffStartWeek: 15, tradeDeadlineWeek: null, draftComplete: true })
    expect(ids(t)).toEqual(['draft', 'now', 'playoffs', 'championship'])
  })

  it('a season with no playoffs (start week past the last week) drops playoffs AND championship', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 3, totalWeeks: 17, playoffStartWeek: 18, tradeDeadlineWeek: 10, draftComplete: true })
    expect(ids(t)).toEqual(['draft', 'now', 'deadline'])
  })

  it('a deadline after the last week is not drawn off the end of the bar', () => {
    expect(ids(buildRedraftSeasonTrack({ currentWeek: 3, totalWeeks: 17, tradeDeadlineWeek: 99, draftComplete: true }))).toEqual(['draft', 'now'])
  })

  it.each([0, -1, 2.5, Number.NaN])('an invalid week (%s) is dropped', bad => {
    const t = buildRedraftSeasonTrack({ currentWeek: bad, totalWeeks: bad, playoffStartWeek: bad, tradeDeadlineWeek: bad, draftComplete: true })
    expect(t.weekLabel).toBeNull()
    expect(t.progress).toBeNull()
    expect(ids(t)).toEqual(['draft'])
  })

  it('before the draft there is no "now" even if a week number is present', () => {
    const t = buildRedraftSeasonTrack({ currentWeek: 1, totalWeeks: 17, playoffStartWeek: 15, draftComplete: false })
    expect(t.weekLabel).toBeNull()
    expect(t.progress).toBeNull()
    expect(t.markers[0]).toMatchObject({ id: 'draft', label: 'Draft', state: 'upcoming' })
    expect(ids(t)).not.toContain('now')
  })

  it('a live draft reads as now', () => {
    expect(buildRedraftSeasonTrack({ draftComplete: false, drafting: true }).markers[0]).toMatchObject({ label: 'Draft · live', state: 'now' })
  })

  it('the fill never exceeds the bar once the season is over', () => {
    expect(buildRedraftSeasonTrack({ currentWeek: 20, totalWeeks: 17, draftComplete: true }).progress).toBe(1)
  })
})
