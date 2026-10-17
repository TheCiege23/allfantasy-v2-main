// @vitest-environment node
/**
 * Milestone 32, the INDIRECT half of the `League.settings.psychologyCache` strip: routes whose
 * response carries the settings because a helper put them there, and the helper that pastes
 * settings into model prompts. Each case hands the real code a stored row that still carries the
 * retired labels and checks the league's ordinary settings survive (positive control) while the
 * labels do not.
 *
 *   lifecycle handler            POST /api/leagues/[id]/lifecycle       (transitionLeagueState row)
 *   commissioner-controls        POST /api/leagues/[id]/commissioner-controls (lock / pause rows)
 *   CommissionerSettingsService  GET|PATCH /api/commissioner/leagues/[id]/settings
 *   loadLeagueForTrade           -> trade-value/analyze, start-sit, trending, war-room dashboard
 *   assertLeagueAccess           -> settings JSON pasted into /api/ai/* model prompts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const LABELS = {
  psychologyCache: { '3': { archetype: 'Shark', blindSpot: 'Overpays for RBs' } },
  psychologyCachedAt: '2026-09-01T00:00:00.000Z',
}
const STORED = { description: 'Home league', lineupLockRule: 'game', ...LABELS }
const LEAKED = /psychologyCache|psychologyCachedAt|Shark|Overpays/

const h = vi.hoisted(() => ({
  row: null as any,
  transition: vi.fn(),
  setLeagueLocked: vi.fn(),
  setEmergencyPause: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findFirst: vi.fn(async () => h.row),
    findUnique: vi.fn(async () => h.row),
  }
  const leagueTeam = { findFirst: vi.fn(async () => ({ id: 't1' })) }
  const prisma = { league, leagueTeam }
  return { prisma, default: prisma }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: vi.fn(async () => true),
  isHeadCommissioner: vi.fn(async () => true),
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  getAllowedActions: () => ({ state: 'in_season', locked: false, emergencyPaused: false, actions: [] }),
  loadLeagueForLifecycle: vi.fn(),
  transitionLeagueState: h.transition,
  normalizeLifecycleState: (s: string) => s,
}))
vi.mock('@/server/services/commissionerService', () => ({
  archiveLeague: vi.fn(),
  manualRunAutomation: vi.fn(),
  runWaiversNow: vi.fn(),
  setEmergencyPause: h.setEmergencyPause,
  setLeagueLocked: h.setLeagueLocked,
}))

import { POST as lifecycle } from '@/app/api/leagues/[leagueId]/lifecycle/handler'
import { POST as controls } from '@/app/api/leagues/[leagueId]/commissioner-controls/handler'
import { getLeagueConfiguration } from '@/lib/commissioner-settings/CommissionerSettingsService'
import { loadLeagueForTrade } from '@/lib/trade-value-console/league-loader'
import { assertLeagueAccess } from '@/lib/ai/league-settings-ai/access'

const fullRow = () => ({
  id: 'L1',
  userId: 'u1',
  name: 'League One',
  sport: 'NFL',
  platform: 'sleeper',
  platformLeagueId: 'S1',
  season: 2026,
  scoring: 'PPR',
  leagueSize: 12,
  rosterSize: 16,
  starters: [],
  leagueVariant: null,
  lifecycleState: 'in_season',
  locked: true,
  emergencyPaused: false,
  settings: { ...STORED },
})

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

beforeEach(() => {
  h.row = fullRow()
  h.transition.mockResolvedValue({ ok: true, league: fullRow() })
  h.setLeagueLocked.mockResolvedValue(fullRow())
  h.setEmergencyPause.mockResolvedValue(fullRow())
})

describe('routes that return a helper-built league row', () => {
  it('POST /api/leagues/[id]/lifecycle', async () => {
    const res = await lifecycle(post('http://localhost/api/leagues/L1/lifecycle', { nextState: 'in_season' }), {
      params: { leagueId: 'L1' },
    })
    const out = (await res.json()) as any
    expect(out.league.settings).toMatchObject({ description: 'Home league', lineupLockRule: 'game' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
  })

  it.each(['lock', 'unlock', 'emergency_pause_on', 'emergency_pause_off'])(
    'POST /api/leagues/[id]/commissioner-controls action=%s',
    async (action) => {
      const res = await controls(post('http://localhost/api/leagues/L1/commissioner-controls', { action }), {
        params: { leagueId: 'L1' },
      })
      const out = (await res.json()) as any
      expect(out.league.settings).toMatchObject({ description: 'Home league' })
      expect(JSON.stringify(out)).not.toMatch(LEAKED)
    },
  )
})

describe('helpers whose output reaches a client or a model', () => {
  it('getLeagueConfiguration (commissioner settings GET/PATCH)', async () => {
    const config = await getLeagueConfiguration('L1')
    expect(config!.description).toBe('Home league')
    expect(config!.settings).toMatchObject({ lineupLockRule: 'game' })
    expect(JSON.stringify(config)).not.toMatch(LEAKED)
  })

  it('loadLeagueForTrade (feeds trade-value/analyze, start-sit, trending, war-room)', async () => {
    const loaded = await loadLeagueForTrade({ leagueId: 'L1', userId: 'u1' })
    expect(loaded!.settings).toMatchObject({ description: 'Home league', lineupLockRule: 'game' })
    expect(JSON.stringify(loaded)).not.toMatch(LEAKED)
  })

  it('assertLeagueAccess (settings JSON pasted into /api/ai/* prompts) — commissioner and member paths', async () => {
    const asCommish = await assertLeagueAccess('L1', 'u1')
    const asMember = await assertLeagueAccess('L1', 'someone-else')
    for (const l of [asCommish, asMember]) {
      expect(l!.settings).toMatchObject({ description: 'Home league' })
      expect(JSON.stringify(l!.settings)).not.toMatch(LEAKED)
    }
  })
})
