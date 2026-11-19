/**
 * The normalized league context (start/sit, Chimmy's roster tool, Chimmy portfolio) carries the one
 * lineup-mode answer for both best ball shapes (lib/bestball/bestBallLeagueState.ts). `bestBallMode` stays
 * the Classic column; a best ball Guilly league reads false there and true on `lineupSetsItself`.
 */
import { expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: reads.findFirst } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMemberWithCode: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/league-context-engine/normalizeScoring', () => ({ normalizeLeagueScoring: vi.fn().mockReturnValue({}) }))
vi.mock('@/lib/league-context-engine/resolvePeriod', () => ({ resolveMatchupPeriod: vi.fn().mockResolvedValue({}) }))

import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine/resolveNormalizedLeagueContext'

const base = { name: 'L', sport: 'NBA', season: 2026, platform: 'manual', platformLeagueId: 'p', syncError: null, teams: [], leagueVariant: null }
const CLASSIC = { ...base, id: 'classic', leagueType: 'best_ball', bestBallMode: true, guillotineMode: false, settings: { best_ball_settings: { scoringPeriod: 'weekly' } } }
const GUILLY = { ...base, id: 'guilly', leagueType: 'guillotine', bestBallMode: false, guillotineMode: true, settings: { best_ball: true } }
const PLAIN_GUILLY = { ...GUILLY, id: 'plain', settings: {} }

it.each([
  ['Classic', CLASSIC, true, true],
  ['Guilly + Best Ball', GUILLY, false, true],
  ['plain Guilly', PLAIN_GUILLY, false, false],
])('%s: bestBallMode=%s, lineupSetsItself=%s', async (_l, league, column, setsItself) => {
  reads.findFirst.mockResolvedValue(league)
  const r = await resolveNormalizedLeagueContext({ leagueId: league.id, userId: 'viewer' })
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.context.lineupBehavior.bestBallMode).toBe(column)
  expect(r.context.lineupBehavior.lineupSetsItself).toBe(setsItself)
  expect(r.context.lineupBehavior.scoringPeriod).toBe('weekly')
})
