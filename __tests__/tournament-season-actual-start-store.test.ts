import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
const db = vi.hoisted(() => ({ shell: vi.fn(), find: vi.fn(), create: vi.fn(), transaction: vi.fn() }))
const provider = vi.hoisted(() => ({ schedule: vi.fn(), live: vi.fn(), contract: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: db.transaction } }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: provider.live }))
vi.mock('@/lib/tournament/seasonCalendarVerification', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tournament/seasonCalendarVerification')>()
  return { ...actual, fetchSeasonCalendarGames: provider.schedule }
})
vi.mock('@/lib/tournament/seasonScheduleReview', () => ({ loadPublishedScheduleContract: provider.contract }))
import { sampleSeasonGameStart } from '@/lib/tournament/seasonActualStartStore'

const gameId = '20261020-1-13'
let saved: Array<{ data: unknown; targetId: string }> = []
function setup() {
  const config = completeConfig()
  provider.contract.mockResolvedValue({ manifest: { config, manifestHash: 'm'.repeat(64), rulesHash: 'r'.repeat(64), leagues: [] }, calendar: { assignments: [{ gameId, startsAt: '2026-10-21T00:00:00Z', period: 1 }] } })
  provider.schedule.mockResolvedValue({ games: [{ gameId, startTime: '2026-10-21T00:00:00Z', seasonType: 'regular' }] })
  db.shell.mockResolvedValue({ commissionerId: 'owner', status: 'rules_published' })
  db.find.mockImplementation(async () => saved.map((row, i) => ({ ...row, createdAt: new Date(Date.parse('2026-10-20T23:59:00Z') + i * 60000) })))
  db.create.mockImplementation(async ({ data }: { data: { targetId: string; data: unknown } }) => { saved.push(data); return data })
  db.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ tournamentShell: { findUnique: db.shell }, gameProviderIdentity: { findMany: async () => [] }, tournamentAuditLog: { findMany: db.find, create: db.create } }))
}
function live(status: string) { provider.live.mockResolvedValue({ rows: [{ game_ID: gameId, status, season_type: 'Regular Season', game_time: 'Wed, 21 Oct 2026 00:00:00 GMT' }], error: null, notModified: false, unsupported: false }) }
beforeEach(() => { vi.resetAllMocks(); saved = []; setup(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T23:59:00Z')) })
afterEach(() => vi.useRealTimers())
describe('server-sampled game start evidence', () => {
  it('saves digest-bound pregame and live observations, then invalidates on a later postponement', async () => {
    live('scheduled')
    expect(await sampleSeasonGameStart('owner', 't1', 'f1', gameId)).toMatchObject({ verifiedWindow: false, exactStartVerified: false, lineupLockCertified: false })
    vi.setSystemTime(new Date('2026-10-21T00:03:00Z')); live('inprogress')
    expect(await sampleSeasonGameStart('owner', 't1', 'f1', gameId)).toMatchObject({ verifiedWindow: true, startAfter: '2026-10-20T23:59:00.000Z', startedBy: '2026-10-21T00:03:00.000Z', launchReady: false })
    expect(saved).toHaveLength(2)
    vi.setSystemTime(new Date('2026-10-21T00:05:00Z')); live('postponed')
    expect(await sampleSeasonGameStart('owner', 't1', 'f1', gameId)).toMatchObject({ verifiedWindow: false, needsCorrectionReview: true })
  })
  it('does not write for missing or ambiguous live rows', async () => {
    provider.live.mockResolvedValue({ rows: [], error: null, notModified: false, unsupported: false })
    await expect(sampleSeasonGameStart('owner', 't1', 'f1', gameId)).rejects.toThrow('exactly once')
    expect(db.create).not.toHaveBeenCalled()
  })
  it('refuses a tampered earlier observation before saving another', async () => {
    saved.push({ targetId: gameId, data: { version: 1, digest: 'bad' } })
    live('inprogress')
    await expect(sampleSeasonGameStart('owner', 't1', 'f1', gameId)).rejects.toThrow('checksum differs')
    expect(db.create).not.toHaveBeenCalled()
  })
  it('enforces owner permission before any provider request', async () => {
    provider.contract.mockRejectedValue(new Error('owner only'))
    await expect(sampleSeasonGameStart('other', 't1', 'f1', gameId)).rejects.toThrow('owner only')
    expect(provider.schedule).not.toHaveBeenCalled()
    expect(provider.live).not.toHaveBeenCalled()
  })
})
