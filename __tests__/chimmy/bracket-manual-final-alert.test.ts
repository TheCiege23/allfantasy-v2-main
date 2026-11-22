import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gate: vi.fn(), audit: vi.fn(), actor: vi.fn(), challenge: vi.fn(),
  update: vi.fn(), seeds: vi.fn(), alerts: vi.fn() }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: mocks.gate }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAudit: mocks.audit, resolveAdminAuditActor: mocks.actor }))
vi.mock('@/lib/prisma', () => ({ prisma: { playoffBracketChallenge: { findUnique: mocks.challenge },
  playoffBracketSeries: { update: mocks.update } } }))
vi.mock('@/lib/playoffs/cfpSeeds', () => ({ readCfpSeeds: mocks.seeds }))
vi.mock('@/lib/playoffs/nbaCupSeeds', () => ({ readNbaCupField: mocks.seeds }))
vi.mock('@/lib/playoffs/playoffBracketProjection', () => ({ isOfficialTeamName: (value: string) => Boolean(value) }))
vi.mock('@/lib/chimmy/bracketChangeAlerts', () => ({ emitPlayoffDecisionAlerts: mocks.alerts }))

import { POST } from '@/app/api/admin/brackets/single-game-result/route'

const game = { id: 'series-1', seriesNumber: 1, sourceSeriesHome: null, sourceSeriesAway: null,
  homeTeamName: 'Boston', awayTeamName: 'Denver', winnerTeamName: null, status: 'scheduled',
  startsAt: new Date('2025-01-01'), liveHomeScore: null, liveAwayScore: null }
const request = () => new Request('http://localhost/api/admin/brackets/single-game-result', {
  method: 'POST', body: JSON.stringify({ challengeId: 'pool-1', seriesNumber: 1, homeScore: 110, awayScore: 100 }),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.gate.mockResolvedValue({ ok: true, user: { id: 'admin-1' } })
  mocks.actor.mockReturnValue('admin-1')
  mocks.seeds.mockResolvedValue({ seeds: new Map() })
  mocks.challenge.mockResolvedValue({ id: 'pool-1', sport: 'ncaaf', seasonYear: 2026, series: [game] })
  mocks.update.mockResolvedValue({})
  mocks.audit.mockResolvedValue(undefined)
  mocks.alerts.mockResolvedValue(undefined)
})

describe('manual bracket final alerts', () => {
  it('sends a decided result only after the audited final is saved', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.alerts).toHaveBeenCalledWith({ challengeId: 'pool-1', decisions: [{
      seriesId: 'series-1', seriesName: 'Boston vs Denver', beforeWinner: null, winner: 'Boston',
    }] })
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0])
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.alerts.mock.invocationCallOrder[0])
  })

  it('does not alert for an unchanged final', async () => {
    mocks.challenge.mockResolvedValue({ id: 'pool-1', sport: 'ncaaf', seasonYear: 2026,
      series: [{ ...game, status: 'final', winnerTeamName: 'Boston', liveHomeScore: 110, liveAwayScore: 100 }] })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.alerts).not.toHaveBeenCalled()
  })
})
