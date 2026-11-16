// @vitest-environment node
/**
 * Round 2 of the one commissioner rule (lib/league/commissionerAccess.ts, 2026-11-16): the shared gates that sat in
 * front of ~150 commissioner actions now ask for the action's area, and the money and chat holes are closed.
 *
 *   - the lifecycle gate (server/services/leagueActionGate.ts) passed ANY "elevated" co-commissioner;
 *   - `assertLeagueCommissioner` (lib/league/league-access.ts) passed any co-commissioner, and now takes a required area;
 *   - payouts let any co-commissioner approve or freeze one; chat-thread broadcasts let any co-commissioner post.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  user: 'co-user' as string | null,
  allowed: new Set<string>(),
  asked: [] as string[],
  elevated: true,
  decide: vi.fn(async () => ({ ok: true })),
  post: vi.fn(async () => ({ id: 'm1' })),
}))

vi.mock('@/lib/league/commissionerAccess', () => {
  const decide = (need: unknown) => {
    const key = Array.isArray(need) ? need.join('+') : String(need)
    h.asked.push(key)
    return key === 'view' || h.allowed.has(key)
  }
  return {
    commissionerAccess: vi.fn(async (_l: string, _u: string, need: unknown) =>
      decide(need) ? { ok: true, role: 'co_commissioner', scopes: [] } : { ok: false, status: 403, error: `missing ${String(need)}` },
    ),
    commissionerAccessResponse: vi.fn(async (_l: string, _u: string, need: unknown) =>
      decide(need) ? null : NextResponse.json({ error: `missing ${String(need)}` }, { status: 403 }),
    ),
    canCommissionerAct: vi.fn(async (_l: string, _u: string, need: unknown) => decide(need)),
  }
})
vi.mock('@/server/services/permissionService', () => ({
  canViewLeague: vi.fn(async () => true),
  isElevatedCommissioner: vi.fn(async () => h.elevated),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  assertLifecycleActionAllowed: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.user ? { user: { id: h.user } } : null)) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/monetization/leagueEntryFeeKillSwitch', () => ({ leagueMoneyRefusal: () => null }))
vi.mock('@/lib/league-finance/leagueFinanceService', () => ({ decidePayout: h.decide, setPayoutFrozen: h.decide }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: h.user })) }))
vi.mock('@/lib/platform/chat-service', () => ({ createPlatformThreadTypedMessage: h.post }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async () => ({ id: 'L', userId: 'owner', teams: [] })),
      findMany: vi.fn(async () => []),
    },
  },
}))

import { assertLeagueActionGate, LIFECYCLE_ACTION_SCOPE } from '@/server/services/leagueActionGate'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { POST as payout } from '@/app/api/leagues/[leagueId]/finance/payout/[payoutId]/route'
import { POST as broadcast } from '@/app/api/shared/chat/threads/[threadId]/broadcast/route'

const json = (body: unknown) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  h.user = 'co-user'
  h.allowed = new Set()
  h.asked = []
  h.elevated = true
  vi.clearAllMocks()
})

describe('the lifecycle gate asks for the action\'s area', () => {
  it('a co-commissioner without league setup cannot run a draft control; with it they can', async () => {
    const refused = await assertLeagueActionGate('L', 'co-user', 'draft_commissioner_control')
    expect(refused).toMatchObject({ ok: false, err: { status: 403 } })
    expect(h.asked).toEqual(['league'])
    h.allowed.add('league')
    expect(await assertLeagueActionGate('L', 'co-user', 'draft_commissioner_control')).toEqual({ ok: true })
  })

  it('each action maps to its area; archiving is head-only', () => {
    expect(LIFECYCLE_ACTION_SCOPE.scoring_process_week).toBe('scoring')
    expect(LIFECYCLE_ACTION_SCOPE.settings_edit_roster).toBe('rosters')
    expect(LIFECYCLE_ACTION_SCOPE.settings_edit_trades).toBe('trades')
    expect(LIFECYCLE_ACTION_SCOPE.waiver_process_run).toBe('league')
    expect(LIFECYCLE_ACTION_SCOPE.league_archive).toBe('head')
  })

  it('member actions are unchanged: a manager making their own pick asks for no commissioner area', async () => {
    h.elevated = false
    expect(await assertLeagueActionGate('L', 'manager', 'draft_pick')).toEqual({ ok: true })
    expect(h.asked).toEqual([])
  })
})

describe('assertLeagueCommissioner takes the area', () => {
  it('refuses a co-commissioner missing it and passes one holding it', async () => {
    expect(await assertLeagueCommissioner('L', 'co-user', 'trades')).toMatchObject({ ok: false, status: 403 })
    h.allowed.add('trades')
    expect(await assertLeagueCommissioner('L', 'co-user', 'trades')).toMatchObject({ ok: true })
  })
})

describe('money and chat', () => {
  it('a payout decision needs money', async () => {
    const params = { params: Promise.resolve({ leagueId: 'L', payoutId: 'p' }) }
    expect((await payout(json({ action: 'freeze' }), params)).status).toBe(403)
    expect(h.decide).not.toHaveBeenCalled()
    expect(h.asked).toEqual(['money'])
  })

  it('a chat-thread broadcast needs chat', async () => {
    const send = () => broadcast(json({ announcement: 'Draft is Sunday' }), { params: Promise.resolve({ threadId: 'league:L' }) })
    expect((await send()).status).toBe(403)
    expect(h.post).not.toHaveBeenCalled()
    expect(h.asked).toEqual(['chat'])
    h.allowed.add('chat')
    expect((await send()).status).toBe(200)
    expect(h.post).toHaveBeenCalledTimes(1)
  })
})
