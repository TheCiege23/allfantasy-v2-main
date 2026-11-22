import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Draft recommendation recorder (2026-11-14) — the forward test for replacement value. Pins that it
 * records both modes and the projections they saw, records nothing when the modes cannot differ,
 * dedupes a pick moment, honours the kill switch, and treats a missing table as "not recording yet"
 * (warned once, never thrown into a request).
 */

const createMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { draftRecommendationRecord: { createMany } } }))

import {
  __resetRecorderForTests,
  buildRecommendationRecord,
  recordDedupeKey,
  recordDraftRecommendation,
  type RecordArgs,
} from '@/lib/shared-services/draft/recommendationRecorder'

// A board where the projections disagree with ADP: QB One goes early by ADP, but the RB has far more
// projected value over his replacement, so replacement value (active) should move off the ADP pick.
const BOARD = [
  { name: 'QB One', position: 'QB', team: 'AAA', adp: 13, projectedPoints: 300 },
  { name: 'QB Two', position: 'QB', team: 'BBB', adp: 30, projectedPoints: 298 },
  { name: 'QB Three', position: 'QB', team: 'CCC', adp: 45, projectedPoints: 296 },
  { name: 'RB One', position: 'RB', team: 'DDD', adp: 16, projectedPoints: 260 },
  { name: 'RB Two', position: 'RB', team: 'EEE', adp: 40, projectedPoints: 150 },
  { name: 'RB Three', position: 'RB', team: 'FFF', adp: 60, projectedPoints: 120 },
  { name: 'WR One', position: 'WR', team: 'GGG', adp: 18, projectedPoints: 200 },
  { name: 'WR Two', position: 'WR', team: 'HHH', adp: 35, projectedPoints: 190 },
]

const args = (available = BOARD): RecordArgs => ({
  surface: 'decision_card',
  sport: 'nfl',
  leagueId: 'lg',
  sessionKey: 'sess',
  rosterKey: 'r1',
  overallPick: 13,
  round: 2,
  input: {
    available,
    teamRoster: [{ position: 'WR' }],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX'],
    round: 2,
    pick: 1,
    totalTeams: 12,
    sport: 'NFL',
    mode: 'needs',
  },
})

describe('buildRecommendationRecord', () => {
  it('records both modes, the projections they saw, and the mode being served', () => {
    const row = buildRecommendationRecord(args(), { DRAFT_VORP_MODE: 'active' } as NodeJS.ProcessEnv)!
    expect(row.servedMode).toBe('active')
    expect(row.sport).toBe('NFL')
    expect(row.projectionCount).toBe(BOARD.length)
    expect(row.detail.projections['RB One|RB']).toBe(260)
    expect(row.observeName).toBeTruthy()
    expect(row.activeName).toBeTruthy()
    expect(row.agree).toBe(row.observeName === row.activeName)
    expect(row.dedupeKey).toBe(recordDedupeKey(args()))
  })

  it('the two modes really are both computed — they can disagree on a board with projections', () => {
    const row = buildRecommendationRecord(args())!
    // Positive control: if this board ever stops separating the modes, the forward test would only
    // ever record agreements and the assertion above would prove nothing.
    expect(row.agree).toBe(false)
    expect(row.detail.active?.projectedPoints).not.toBeNull()
  })

  it('records nothing when no player has a projection — the modes cannot differ', () => {
    expect(buildRecommendationRecord(args(BOARD.map((p) => ({ ...p, projectedPoints: null }))))).toBeNull()
  })
})

describe('recordDraftRecommendation', () => {
  beforeEach(() => {
    createMany.mockReset()
    __resetRecorderForTests()
  })

  it('writes once and reports a re-fetched pick moment as a duplicate', async () => {
    createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    expect(await recordDraftRecommendation(args())).toBe('recorded')
    expect(await recordDraftRecommendation(args())).toBe('duplicate')
    expect(createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true })
  })

  it('honours the kill switch without touching the database', async () => {
    expect(await recordDraftRecommendation(args(), { DRAFT_RECOMMENDATION_RECORDER: 'off' } as NodeJS.ProcessEnv)).toBe('disabled')
    expect(createMany).not.toHaveBeenCalled()
  })

  it('treats a missing table as not recording yet, warns once, and stops trying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    createMany.mockRejectedValue(Object.assign(new Error('The table `public.draft_recommendation_records` does not exist'), { code: 'P2021' }))
    expect(await recordDraftRecommendation(args())).toBe('not_recording_yet')
    expect(await recordDraftRecommendation(args())).toBe('not_recording_yet')
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('never throws on any other failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    createMany.mockRejectedValue(new Error('connection reset'))
    expect(await recordDraftRecommendation(args())).toBe('failed')
    warn.mockRestore()
  })
})
