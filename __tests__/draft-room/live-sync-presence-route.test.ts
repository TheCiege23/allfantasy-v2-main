/**
 * /api/leagues/[leagueId]/draft/live-sync carries presence: each poll marks the caller's teams as
 * in the room and returns every team that is (lib/draft-room/draftPresence.ts).
 */
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ user: 'u1' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/queues/bullmq', () => ({ getRedisClient: () => null }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: h.user } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdsForLeague: vi.fn(async (_l: string, u: string) => (u === 'u1' ? ['roster-a'] : u === 'u2' ? ['roster-b'] : [])),
}))
vi.mock('@/lib/live-draft-engine/draftAutomationTicks', () => ({ runAutomationTicksThrottled: vi.fn(async () => {}) }))
vi.mock('@/lib/draft/mirrorActiveSleeperDrafts', () => ({ mirrorSleeperDraftForLeagueThrottled: vi.fn(async () => {}) }))
vi.mock('@/lib/draft-room/buildDraftLiveSyncPayload', () => ({
  buildDraftLiveSyncPayload: vi.fn(async (leagueId: string) => ({ leagueId, updated: false, session: null })),
}))

import { GET } from '@/app/api/leagues/[leagueId]/draft/live-sync/route'

const call = async (user: string) => {
  h.user = user
  const res = await GET(new NextRequest('http://localhost/api/leagues/lg-1/draft/live-sync?queue=0&chat=0'), {
    params: Promise.resolve({ leagueId: 'lg-1' }),
  })
  return (await res.json()) as { presence?: { onlineRosterIds: string[] }; leagueId: string }
}

describe('live-sync presence', () => {
  it("each manager's poll marks their team present; everyone sees everyone", async () => {
    expect((await call('u1')).presence?.onlineRosterIds).toEqual(['roster-a'])
    const second = await call('u2')
    expect(second.presence?.onlineRosterIds).toEqual(['roster-a', 'roster-b'])
    expect(second.leagueId).toBe('lg-1') // the rest of the payload is untouched
    // A spectator with no team reads the room without joining it.
    expect((await call('watcher')).presence?.onlineRosterIds).toEqual(['roster-a', 'roster-b'])
  })
})
