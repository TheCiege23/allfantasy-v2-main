// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { gunzipSync } from 'node:zlib'

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(async () => true),
  snapshot: vi.fn(),
  roster: vi.fn(async (_leagueId: string, userId: string) => 'roster-' + userId),
  preference: vi.fn(async (_sessionId: string, userId: string) => ({ enabled: userId === 'alice' })),
  repair: vi.fn(async () => {}),
}))

vi.mock('next-auth', () => ({ getServerSession: mock.auth }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: mock.access, getCurrentUserRosterIdForLeague: mock.roster }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: mock.snapshot }))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({ getViewerAutopickPreference: mock.preference }))
vi.mock('@/lib/live-draft-engine/auction', () => ({ runAuctionAutomationTick: async () => {} }))
vi.mock('@/lib/live-draft-engine/keeper', () => ({ runKeeperAutomationTick: async () => {} }))
vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({ runSlowDraftAutomationTick: async () => {} }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({
  repairDraftCompletionIfBoardFull: mock.repair, syncPostDraftArtifactsIfCompletedThrottled: async () => {},
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: async () => ({}) }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: async () => [] }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({ getDraftOrderModeAndLotteryConfig: async () => null }))
vi.mock('@/lib/draft/getCanonicalDraftState', () => ({ getCanonicalDraftState: async () => null }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getDraftPoolReadiness: async () => ({ready: true}) }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({anyAi: false}) }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: () => {} }))

import { GET } from '@/app/api/leagues/[leagueId]/draft/session/route'

describe('draft session polling', () => {
  it('shares the in-flight board, reads each viewer preference separately, and refreshes on the next poll', async () => {
    let reading!: () => void
    let finish!: () => void
    const entered = new Promise<void>(resolve => { reading = resolve })
    const blocked = new Promise<void>(resolve => { finish = resolve })
    const board = { id: 'session', status: 'in_progress', draftType: 'snake', currentPick: { rosterId: 'on-clock' }, picks: [], viewerAutopick: null }
    mock.snapshot.mockImplementationOnce(async () => { reading(); await blocked; return board })
    mock.snapshot.mockResolvedValueOnce({ ...board, picks: [{overall: 1}] })
    for (const id of ['alice', 'bob', 'alice']) mock.auth.mockResolvedValueOnce({user:{id}})
    const poll = () => GET(new NextRequest('https://example.invalid/api/leagues/league/draft/session'), {
      params: Promise.resolve({ leagueId: 'league' }),
    })
    const alice = poll()
    await entered
    const bob = poll()
    await vi.waitFor(() => expect(mock.access).toHaveBeenCalledTimes(2))
    finish()
    const [a, b] = await Promise.all([alice, bob].map(async req => (await req).json()))
    expect(mock.roster).toHaveBeenCalledWith('league', 'alice', undefined, board)
    expect(mock.roster).toHaveBeenCalledWith('league', 'bob', undefined, board)
    expect(mock.snapshot).toHaveBeenCalledTimes(1)
    expect(mock.snapshot).toHaveBeenCalledWith('league', expect.any(Date))
    expect(a.session).toMatchObject({currentUserRosterId:'roster-alice', viewerAutopick:{enabled:true}})
    expect(b.session).toMatchObject({currentUserRosterId:'roster-bob', viewerAutopick:{enabled:false}})
    expect((await (await poll()).json()).session.picks).toEqual([{overall:1}])
    expect(mock.snapshot).toHaveBeenCalledTimes(2)
  })

  it('serves the full board and private viewer fields before maintenance finishes', async () => {
    let releaseRepair!: () => void
    mock.repair.mockImplementationOnce(() => new Promise<void>(resolve => { releaseRepair = resolve }))
    const picks = Array.from({ length: 300 }, (_, index) => ({ overall: index + 1, playerName: 'Player '.repeat(35) }))
    const board = { id: 'large-session', status: 'in_progress', picks }
    mock.snapshot.mockResolvedValue(board)
    mock.auth.mockResolvedValueOnce({ user: { id: 'alice' } }).mockResolvedValueOnce({ user: { id: 'bob' } })
    const poll = (encoding: string) => GET(
      new NextRequest('https://example.invalid/api/leagues/large-league/draft/session', {
        headers: { 'Accept-Encoding': encoding },
      }),
      { params: Promise.resolve({ leagueId: 'large-league' }) },
    )
    try {
      const [alice, bob] = await Promise.all([poll('gzip'), poll('gzip;q=0, identity')])
      expect(alice.headers.get('Content-Encoding')).toBe('gzip')
      expect(bob.headers.get('Content-Encoding')).toBeNull()
      const a = JSON.parse(gunzipSync(Buffer.from(await alice.arrayBuffer())).toString())
      const b = await bob.json()
      expect(a.session).toMatchObject({ picks, currentUserRosterId: 'roster-alice', viewerAutopick: { enabled: true } })
      expect(b.session).toMatchObject({ picks, currentUserRosterId: 'roster-bob', viewerAutopick: { enabled: false } })
      expect(releaseRepair).toBeTypeOf('function')
    } finally {
      releaseRepair?.()
    }
  })
})
