import { describe, expect, it } from 'vitest'
import { platformCountsOf } from '@/components/core-app/screens/dash3aPortfolio'

/**
 * The portfolio chart's counts, now computed on the server and handed to the client chart. The rules
 * are the ones the chart always used — this pins them so the move cannot quietly change what it shows.
 */
describe('platformCountsOf', () => {
  it('counts leagues per platform, most first, ties by name', () => {
    expect(
      platformCountsOf([
        { platform: 'sleeper' },
        { platform: 'espn' },
        { platform: 'sleeper' },
        { platform: 'yahoo' },
        { platform: 'espn' },
      ]),
    ).toEqual([
      { label: 'espn', value: 2, displayValue: '2' },
      { label: 'sleeper', value: 2, displayValue: '2' },
      { label: 'yahoo', value: 1, displayValue: '1' },
    ])
  })

  it('files a league with no platform, or a blank one, under AllFantasy', () => {
    expect(platformCountsOf([{ platform: null }, { platform: '   ' }, {}])).toEqual([
      { label: 'AllFantasy', value: 3, displayValue: '3' },
    ])
  })

  it('draws nothing for no leagues', () => {
    expect(platformCountsOf([])).toEqual([])
  })
})
