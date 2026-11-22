/**
 * A league that plays on AllFantasy keeps `League.status` in step with its lifecycle.
 *
 * It read `setup` for the league's whole life, and readers that ask `status ?? lifecycleState`
 * (My Team's pre-draft flag, automatic lineup subs, the commissioner hub) believed it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), logAction: vi.fn(async () => undefined) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.findUnique, update: m.update } } }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))

import { nativeLeagueStatusForLifecycle, nativeLeagueStatusPatch } from '@/lib/league/nativeLeagueStatus'
import {
  applyPostDraftLifecycleInTransaction,
  transitionLeagueState,
  transitionLeagueStateInTransaction,
} from '@/server/services/leagueLifecycleService'

beforeEach(() => {
  vi.clearAllMocks()
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data)
})

describe('the status a lifecycle state carries', () => {
  it('uses the spellings the readers already know', () => {
    expect(['setup', 'pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs', 'completed', 'offseason', 'renewal_pending'].map(nativeLeagueStatusForLifecycle)).toEqual([
      'setup', 'pre_draft', 'drafting', 'in_season', 'in_season', 'in_season', 'complete', 'complete', 'complete',
    ])
    // Archiving never touches status; an unknown state says nothing.
    expect(nativeLeagueStatusForLifecycle('archived')).toBeNull()
    expect(nativeLeagueStatusForLifecycle('CURRENT')).toBeNull()
    expect(nativeLeagueStatusForLifecycle(null)).toBeNull()
  })
  it('🛑 is written for a native league only: an imported league keeps its provider’s status', () => {
    expect(nativeLeagueStatusPatch('manual', 'post_draft')).toEqual({ status: 'in_season' })
    expect(nativeLeagueStatusPatch(null, 'completed')).toEqual({ status: 'complete' })
    expect(nativeLeagueStatusPatch('sleeper', 'post_draft')).toEqual({})
    expect(nativeLeagueStatusPatch('fantrax', 'completed')).toEqual({})
    expect(nativeLeagueStatusPatch('manual', 'archived')).toEqual({})
  })
})

describe('the lifecycle writes', () => {
  const tx = { league: { findUnique: m.findUnique, update: m.update } } as never
  const written = () => m.update.mock.calls.at(-1)![0].data as Record<string, unknown>

  it('a native draft finishing moves the league out of setup', async () => {
    m.findUnique.mockResolvedValue({ id: 'L', userId: 'c', lifecycleState: 'drafting', lifecycleMetadata: null, platform: 'manual' })
    await applyPostDraftLifecycleInTransaction(tx, 'L')
    expect(written()).toMatchObject({ lifecycleState: 'post_draft', status: 'in_season' })
  })
  it('an imported league’s draft finishing leaves its status alone', async () => {
    m.findUnique.mockResolvedValue({ id: 'L', userId: 'c', lifecycleState: 'drafting', lifecycleMetadata: null, platform: 'sleeper' })
    await applyPostDraftLifecycleInTransaction(tx, 'L')
    expect(written()).toMatchObject({ lifecycleState: 'post_draft' })
    expect('status' in written()).toBe(false)
  })
  it('the season ending reads complete, and the draft starting reads drafting', async () => {
    m.findUnique.mockResolvedValue({ lifecycleState: 'playoffs', lifecycleMetadata: null, platform: 'manual' })
    await transitionLeagueStateInTransaction(tx, { leagueId: 'L', nextState: 'completed', source: 't', idempotencyKey: 'k' })
    expect(written()).toMatchObject({ lifecycleState: 'completed', status: 'complete' })

    m.findUnique.mockResolvedValue({ id: 'L', lifecycleState: 'pre_draft', lifecycleMetadata: null, platform: 'manual' })
    expect(await transitionLeagueState('L', 'drafting', 'c')).toMatchObject({ ok: true })
    expect(written()).toMatchObject({ lifecycleState: 'drafting', status: 'drafting' })
  })
})
