/**
 * Tournament walk, 2026-11-22: the cut ran with no week played and with a league still drafting,
 * the home page stayed on "Qualification" after the cut, and a finished draft read "Scheduled".
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { summarizeAdvanceReadiness } from '@/lib/tournament-mode/advanceReadiness'
import { currentLegacyRoundIndex, legacyLeagueDraftStatus } from '@/lib/tournament/tournamentPageData'

describe('summarizeAdvanceReadiness', () => {
  it('is ready once the last week of the round is scored and no draft is running', () => {
    expect(summarizeAdvanceReadiness({ draftsRunning: 0, startWeek: 1, endWeek: 9, lastScoredWeek: 9 })).toEqual({ ready: true, blockers: [], warnings: [] })
  })

  it('stops outright while a league in the round is drafting', () => {
    const r = summarizeAdvanceReadiness({ draftsRunning: 2, startWeek: 1, endWeek: 9, lastScoredWeek: 9 })
    expect(r.ready).toBe(false)
    expect(r.blockers).toEqual(['2 leagues in this round are still drafting. Wait for their drafts to finish.'])
    expect(r.warnings).toEqual([])
  })

  it('warns, without stopping, when weeks are still to play', () => {
    const r = summarizeAdvanceReadiness({ draftsRunning: 0, startWeek: 1, endWeek: 9, lastScoredWeek: 3 })
    expect(r.ready).toBe(false)
    expect(r.blockers).toEqual([])
    expect(r.warnings).toEqual(['This round runs through week 9, and results are in through week 3.'])
  })

  it('warns when nothing has been scored at all', () => {
    expect(summarizeAdvanceReadiness({ draftsRunning: 0, startWeek: 1, endWeek: 9, lastScoredWeek: null }).warnings).toEqual([
      'No week of this round has been scored yet. It runs through week 9.',
    ])
  })

  it('does not guess when the round has no end week on file', () => {
    expect(summarizeAdvanceReadiness({ draftsRunning: 0, startWeek: null, endWeek: 0, lastScoredWeek: null }).ready).toBe(true)
  })
})

describe('currentLegacyRoundIndex', () => {
  it('is the first round before anything has started', () => {
    expect(currentLegacyRoundIndex([{ roundIndex: 0, status: 'pending' }])).toBe(0)
    expect(currentLegacyRoundIndex([])).toBe(0)
  })
  it('moves to the round the cut opened', () => {
    expect(currentLegacyRoundIndex([{ roundIndex: 0, status: 'completed' }, { roundIndex: 1, status: 'active' }])).toBe(1)
  })
  it('ignores a later round that has not started', () => {
    expect(currentLegacyRoundIndex([{ roundIndex: 0, status: 'active' }, { roundIndex: 1, status: 'pending' }])).toBe(0)
  })
})

describe('legacyLeagueDraftStatus', () => {
  it.each([['pre_draft', 'scheduled'], ['setup', 'scheduled'], [null, 'scheduled'], ['drafting', 'drafting'], ['post_draft', 'complete'], ['in_season', 'complete'], ['completed', 'complete']])('%s reads as %s', (state, expected) => {
    expect(legacyLeagueDraftStatus(state)).toBe(expected)
  })
})
