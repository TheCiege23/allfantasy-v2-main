import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ lock: vi.fn(), capture: vi.fn() }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: mocked.lock }))
vi.mock('@/lib/tournament/seasonObservedBoxCapture', () => ({ captureSeasonObservedBoxCandidates: mocked.capture }))
import { runSeasonOutcomeEvidenceJob } from '@/lib/tournament/seasonOutcomeEvidenceWorker'

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  process.env.TOURNAMENT_EVIDENCE_WORKER_ENABLED = 'true'
  mocked.lock.mockImplementation(async (_key, _options, run) => ({ ok: true, value: await run() }))
  mocked.capture.mockResolvedValue({ saved: 2, contractVerified: false, scoringCertified: false, launchReady: false })
})
afterEach(() => { vi.useRealTimers(); delete process.env.TOURNAMENT_EVIDENCE_WORKER_ENABLED })

it('holds a shared lease through the capture and provider cooldown', async () => {
  const pending = runSeasonOutcomeEvidenceJob('owner', 't1', 'f1', 'pool', 1, '2026-10-11')
  await vi.advanceTimersByTimeAsync(5999)
  expect(mocked.capture).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool', 1, '2026-10-11')
  expect(mocked.lock).toHaveBeenCalledWith('tournament:rolling-insights:evidence',
    expect.objectContaining({ ttlMs: 300_000, owner: expect.any(String) }), expect.any(Function))
  await vi.advanceTimersByTimeAsync(1)
  await expect(pending).resolves.toMatchObject({ saved: 2, scoringCertified: false })
})

it('fails closed when disabled or the shared lease is busy', async () => {
  delete process.env.TOURNAMENT_EVIDENCE_WORKER_ENABLED
  await expect(runSeasonOutcomeEvidenceJob('owner', 't1', 'f1', 'pool', 1, '2026-10-11')).rejects.toThrow('not enabled')
  expect(mocked.capture).not.toHaveBeenCalled()
  process.env.TOURNAMENT_EVIDENCE_WORKER_ENABLED = 'true'
  mocked.lock.mockResolvedValue({ ok: false, reason: 'busy' })
  await expect(runSeasonOutcomeEvidenceJob('owner', 't1', 'f1', 'pool', 1, '2026-10-11')).rejects.toThrow('busy')
  expect(mocked.capture).not.toHaveBeenCalled()
})
