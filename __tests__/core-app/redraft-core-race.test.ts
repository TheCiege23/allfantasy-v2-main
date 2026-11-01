/**
 * Batch B6 (/core Standings · Season Outlook · Commissioner · Brackets in the redraft identity): the pure
 * mappings in lib/core-app/redraftCoreRace.ts. Each returns null unless the data proves the claim.
 */
import { describe, expect, it } from 'vitest'
import { healthRingPct, redraftRaceTag, REDRAFT_RACE_LABEL } from '@/lib/core-app/redraftCoreRace'
import { harnessStandings } from '@/app/e2e/redraft-core/standings/fixtures'

describe('redraftRaceTag — a tag only for what standingsModel proved', () => {
  it('passes the proven clinch through, bye first', () => {
    expect(redraftRaceTag({ clinched: 'bye', zone: 'bye' })).toBe('clinched-bye')
    expect(redraftRaceTag({ clinched: 'playoff', zone: 'playoff' })).toBe('clinched')
    expect(redraftRaceTag({ clinched: null, zone: 'eliminated' })).toBe('eliminated')
  })

  it('never tags a positional zone — where a team sits today is not a result', () => {
    for (const zone of ['bye', 'playoff', 'bubble', 'out'] as const) expect(redraftRaceTag({ clinched: null, zone })).toBeNull()
  })

  it('gives an elimination league (guillotine, survivor) no race tag at all', () => {
    expect(redraftRaceTag({ clinched: 'playoff', zone: 'playoff' }, true)).toBeNull()
    expect(redraftRaceTag({ clinched: null, zone: 'eliminated' }, true)).toBeNull()
  })

  it('labels every tag', () => {
    expect(REDRAFT_RACE_LABEL).toEqual({ 'clinched-bye': 'Clinched bye', clinched: 'Clinched', eliminated: 'Eliminated' })
  })

  /*
   * End to end through the real model: the harness board is twelve teams' worth of results run through
   * advanceWeek + buildStandingsBoard, two weeks before the end. The tags must come out mixed — some
   * settled, some still racing — or the "only when proven" rule is untested by the frames that show it.
   */
  it('on a real computed board, tags the settled teams and leaves the race open in the middle', () => {
    const d = harnessStandings()
    if (!d.available) throw new Error('fixture board unavailable')
    const tags = d.board.teams.map((t) => redraftRaceTag(t))
    expect(tags.filter((t) => t === 'clinched-bye').length).toBeGreaterThan(0)
    expect(tags.filter((t) => t === 'eliminated').length).toBeGreaterThan(0)
    expect(tags.filter((t) => t === null).length).toBeGreaterThan(2)
    // The viewer's team is in the open middle of the race on this fixture.
    const me = d.board.teams.find((t) => t.isYou)!
    expect(redraftRaceTag(me)).toBeNull()
  })

  it('mutation control: a board that forgot the proof (every team clinched) is not what the fixture yields', () => {
    const d = harnessStandings()
    if (!d.available) throw new Error('fixture board unavailable')
    const forged = d.board.teams.map((t) => redraftRaceTag({ ...t, clinched: 'playoff' }))
    expect(forged.every((t) => t === 'clinched')).toBe(true)
    expect(d.board.teams.map((t) => redraftRaceTag(t))).not.toEqual(forged)
  })
})

describe('healthRingPct — the Commissioner ring only from a real engine score', () => {
  it('rounds and clamps an available score', () => {
    expect(healthRingPct({ available: true, data: { score: 84.4 } })).toBe(84)
    expect(healthRingPct({ available: true, data: { score: 140 } })).toBe(100)
    expect(healthRingPct({ available: true, data: { score: -3 } })).toBe(0)
  })

  it('draws nothing without a score', () => {
    expect(healthRingPct({ available: false })).toBeNull()
    expect(healthRingPct(null)).toBeNull()
    expect(healthRingPct(undefined)).toBeNull()
    expect(healthRingPct({ available: true, data: { score: Number.NaN } })).toBeNull()
  })
})
