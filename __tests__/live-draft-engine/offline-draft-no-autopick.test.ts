/**
 * An offline draft is drafted in person and the commissioner enters every pick. The automatic pickers
 * stop before doing any work there — the best-available path would otherwise spend an AI opponent's
 * model call on a pick the submission then refuses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ mode: 'offline' as string }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (load) => ({
  ...(await load<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()),
  getDraftUISettingsForLeague: vi.fn(async () => ({ executionMode: h.mode, autoPickEnabled: true, orphanTeamAiManagerEnabled: true })),
}))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: vi.fn(async () => null), loadSeasonDraftPlayers: vi.fn(), validateSeasonDraftPlayer: vi.fn() }))
const aiTry = vi.hoisted(() => vi.fn(async () => ({ ok: false })))
vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({ tryAiOpponentAutopickForExpiredTimer: aiTry }))
const submitPick = vi.hoisted(() => vi.fn(async () => ({ success: false })))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', async (load) => ({
  ...(await load<typeof import('@/lib/live-draft-engine/PickSubmissionService')>()),
  submitPick,
}))
const findFirst = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst }, roster: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) }, league: { findUnique: vi.fn(async () => null) } } }))

import { isOfflineDraft } from '@/lib/live-draft-engine/offlineDraft'
import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { tryQueueAutoPick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { executeDraftPickForOrphan } from '@/lib/orphan-ai-manager/OrphanAIManagerService'

beforeEach(() => {
  h.mode = 'offline'
  vi.clearAllMocks()
})

describe('offline draft: automatic pickers do nothing', () => {
  it('reads the league as offline', async () => {
    expect(await isOfflineDraft('L')).toBe(true)
    h.mode = 'live'
    expect(await isOfflineDraft('L')).toBe(false)
  })

  it('best available: no AI call, no pick', async () => {
    expect(await submitBestAvailableAutopickForExpiredTimer('L', 'r1', 1)).toEqual({ ok: false, error: 'offline_draft' })
    expect(aiTry).not.toHaveBeenCalled()
    expect(submitPick).not.toHaveBeenCalled()
  })

  it('queue autopick: no pick, and not even a session read', async () => {
    expect(await tryQueueAutoPick('L', 'r1')).toEqual({ success: false })
    expect(findFirst).not.toHaveBeenCalled()
    expect(submitPick).not.toHaveBeenCalled()
  })

  it('orphan / Chimmy-run team: no pick', async () => {
    const r = await executeDraftPickForOrphan({ leagueId: 'L', triggeredByUserId: 'u' } as never)
    expect(r).toMatchObject({ success: false })
    expect(String((r as { error?: string }).error)).toMatch(/offline draft/)
    expect(submitPick).not.toHaveBeenCalled()
  })

  it('CONTROL: in a live draft the best-available path does try (the AI opponent first)', async () => {
    h.mode = 'live'
    await submitBestAvailableAutopickForExpiredTimer('L', 'r1', 1).catch(() => undefined)
    expect(aiTry).toHaveBeenCalled()
  })
})
