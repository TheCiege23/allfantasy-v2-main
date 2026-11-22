import { describe, expect, it } from 'vitest'
import { resolveTsdbScheduleSports } from '@/lib/cron/tsdbScheduleSports'

const SPORTS = ['NFL', 'NCAAF', 'NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER'] as const

describe('TheSportsDB schedule scope', () => {
  it('preserves the normal cron scope when omitted', () => {
    expect(resolveTsdbScheduleSports(null, SPORTS)).toEqual(SPORTS)
  })
  it('limits explicit runs and removes duplicates', () => {
    expect(resolveTsdbScheduleSports(' nba, NHL,nba,MLB ', SPORTS)).toEqual(['NBA', 'NHL', 'MLB'])
  })
  it.each(['', 'NBA,', 'NBA,unknown', 'NFL;DROP TABLE', 'all'])('rejects invalid scope %s before provider work', (scope) => {
    expect(() => resolveTsdbScheduleSports(scope, SPORTS)).toThrow()
  })
})
