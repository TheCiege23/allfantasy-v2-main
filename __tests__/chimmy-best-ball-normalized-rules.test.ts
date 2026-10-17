import { expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: reads.findFirst } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMemberWithCode: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/league-context-engine/normalizeScoring', () => ({ normalizeLeagueScoring: vi.fn().mockReturnValue({}) }))
vi.mock('@/lib/league-context-engine/resolvePeriod', () => ({ resolveMatchupPeriod: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/sport-scope', () => ({ normalizeToSupportedSport: vi.fn().mockReturnValue('NFL') }))
vi.mock('@/lib/league/leagueConceptOptions', () => ({ resolveLeagueConcept: vi.fn().mockReturnValue('dynasty') }))
vi.mock('@/lib/bestball/rules', () => ({ normalizeBestBallSettings: vi.fn((input: { conceptSetup?: Record<string, unknown> | null }) => ({
  mode: 'standard', matchupFormat: 'h2h', waiversEnabled: input.conceptSetup?.waiversEnabled ?? false,
  tradesEnabled: input.conceptSetup?.tradesEnabled ?? false,
  substitutionsEnabled: input.conceptSetup?.substitutionsEnabled ?? false, lineupTemplateId: null,
})) }))

import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine/resolveNormalizedLeagueContext'

function league(settings: Record<string, unknown>) {
  return {
    id: 'selected-league', name: 'Imported Best Ball', sport: 'NFL', season: 2026,
    platform: 'sleeper', platformLeagueId: 'provider-league', syncError: null,
    bestBallMode: true, bbScoringPeriod: 'weekly', teams: [], settings,
  }
}

it('does not promote new-league Best Ball defaults into imported provider permissions', async () => {
  reads.findFirst.mockResolvedValue(league({ best_ball: 1 }))
  const result = await resolveNormalizedLeagueContext({ leagueId: 'selected-league', userId: 'viewer' })
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.context.lineupBehavior.bestBallMode).toBe(true)
    expect(result.context.lineupBehavior.bestBallSettings).toBeNull()
  }
})

it('retains explicitly stored Best Ball permissions', async () => {
  reads.findFirst.mockResolvedValue(league({ best_ball_settings: {
    waiversEnabled: true, tradesEnabled: false, substitutionsEnabled: true,
  } }))
  const result = await resolveNormalizedLeagueContext({ leagueId: 'selected-league', userId: 'viewer' })
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.context.lineupBehavior.bestBallSettings).toMatchObject({
    waiversEnabled: true, tradesEnabled: false, substitutionsEnabled: true,
  })
})
