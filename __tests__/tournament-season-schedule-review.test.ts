import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
const db = vi.hoisted(() => ({ shell: vi.fn(), audit: vi.fn() }))
const schedule = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentShell: { findUnique: db.shell }, tournamentAuditLog: { findFirst: db.audit } } }))
vi.mock('@/lib/tournament/seasonCalendarVerification', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tournament/seasonCalendarVerification')>()
  return { ...actual, fetchSeasonCalendarGames: schedule.fetch }
})
vi.mock('@/lib/tournament/seasonNativeContract', () => ({ readOpeningManifest: (raw: { parsed: unknown }) => raw.parsed }))
import { reviewSeasonPublishedSchedule } from '@/lib/tournament/seasonScheduleReview'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'

function arrange() {
  const config = completeConfig()
  const calendar = {
    provider: 'rolling_insights' as const, season: 2026, ready: true, blockers: [], warnings: [],
    regularGames: 1, pendingGames: 0, periods: [{ number: 1, games: 1 }],
    assignments: [{ gameId: 'g1', startsAt: '2026-10-21T00:00:00Z', period: 1 }], excludedGames: [],
  }
  const digest = seasonContractHash({ config, evidence: calendar })
  const hash = seasonContractHash({ config, calendarDigest: digest, acceptExcludedGames: false, acceptPendingGames: false })
  const manifest = { publicationId: 'published', rulesHash: hash, config }
  const payload = { parsed: manifest }
  const frozen = { data: { ...payload, manifestHash: seasonContractHash(payload) } }
  const publication = { data: { hash, config, calendar: { ...calendar, digest, checkedAt: '2026-10-01T00:00:00Z' }, acceptExcludedGames: false, acceptPendingGames: false } }
  db.shell.mockResolvedValue({ commissionerId: 'owner', status: 'rules_published' })
  db.audit.mockImplementation(({ where }: { where: { action: string } }) => Promise.resolve(where.action === 'season_opening_field_frozen' ? frozen : publication))
  schedule.fetch.mockResolvedValue({ season: 2026, games: [{ gameId: 'g1', startTime: '2026-10-29T00:00:00Z', seasonType: 'regular', status: 'postponed', replacedBy: null }] })
  return { publication }
}

beforeEach(() => vi.resetAllMocks())
describe('commissioner published schedule review', () => {
  it('checks owner access before requesting provider data', async () => {
    arrange()
    await expect(reviewSeasonPublishedSchedule('other', 'tournament', 'freeze')).rejects.toMatchObject({ status: 403 })
    expect(schedule.fetch).not.toHaveBeenCalled()
  })
  it('reports postponed schedule drift without mutating the frozen assignments', async () => {
    const { publication } = arrange()
    const result = await reviewSeasonPublishedSchedule('owner', 'tournament', 'freeze')
    expect(result).toMatchObject({ requiresReview: true, actualStartVerified: false, launchReady: false })
    expect(result.changes[0]).toMatchObject({ kind: 'postponed', publishedPeriod: 1, currentScheduledPeriod: 2 })
    expect(result.reconciliation[0]).toMatchObject({ case: 'period_change', canApplyAutomatically: false, requiresActualStartEvidence: true })
    expect(publication.data.calendar.assignments[0]!.period).toBe(1)
    expect(schedule.fetch).toHaveBeenCalledOnce()
  })
  it('rejects changed publication evidence before requesting the provider', async () => {
    const { publication } = arrange()
    publication.data.calendar.assignments[0]!.period = 2
    await expect(reviewSeasonPublishedSchedule('owner', 'tournament', 'freeze')).rejects.toMatchObject({ status: 409 })
    expect(schedule.fetch).not.toHaveBeenCalled()
  })
})
