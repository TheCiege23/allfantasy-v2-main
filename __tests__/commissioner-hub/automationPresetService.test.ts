/** Applying a preset (lib/commissioner-hub/automationPresetService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, plan: true, integrity: null as null | { tankingMonitorEnabled: boolean } }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
  }
  return {
    state,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      league: { findUnique: vi.fn(async () => ({ userId: 'owner', platform: 'allfantasy', settings: state.settings, leagueType: 'dynasty', isDynasty: true, season: 2026 })) },
      leagueIntegritySettings: {
        findUnique: vi.fn(async () => state.integrity),
        upsert: vi.fn(async ({ create }: { create: { tankingMonitorEnabled: boolean } }) => { state.integrity = { tankingMonitorEnabled: create.tankingMonitorEnabled }; return {} }),
      },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
    saveLive: vi.fn(async () => ({})),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: async () => 'commissioner' }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: async () => m.state.plan }))
vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({
  readLiveRookieOrderSettings: () => ({ enabled: false, config: { nonPlayoff: 'reverse_max_pf', playoff: 'finish_then_seed', withinRound: 'worse_seed' } }),
  saveLiveRookieOrderSettings: m.saveLive,
}))

import { applyAutomationPreset, AUTOMATION_PRESET_ACTION } from '@/lib/commissioner-hub/automationPresetService'

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = { other: 1, dynasty_rookie_draft_calendar: { customOpenDate: '2027-05-01' } }
  m.state.plan = true
  m.state.integrity = null
})

describe('applyAutomationPreset', () => {
  it('writes every change, keeps other settings and calendar fields, and logs one action', async () => {
    const r = await applyAutomationPreset('L', 'commish', 'run_it')
    expect(r.ok).toBe(true)
    expect(m.state.settings).toMatchObject({
      other: 1,
      eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill: true },
      ir_auto_move: { enabled: true },
      // With AF Commissioner the draft already opens itself by default, so only the start is written.
      dynasty_rookie_draft_calendar: { customOpenDate: '2027-05-01', autoStartDays: 7 },
      inactive_auto_handover: { days: 14, to: 'autopilot', byUserId: 'commish' },
    })
    expect(m.state.integrity).toEqual({ tankingMonitorEnabled: true })
    expect(m.saveLive).toHaveBeenCalledWith('L', expect.objectContaining({ enabled: true, season: 2026 }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: AUTOMATION_PRESET_ACTION, metadata: expect.objectContaining({ preset: 'run_it' }) }))
  })

  it('without the plan, writes only the free changes', async () => {
    m.state.plan = false
    await applyAutomationPreset('L', 'commish', 'recommended')
    expect(m.state.settings.eliminated_lineup_minimum).toBeUndefined()
    expect(m.state.settings.ir_auto_move).toBeUndefined()
    expect(m.state.integrity).toBeNull()
    expect(m.saveLive).not.toHaveBeenCalled()
    expect(m.state.settings.dynasty_rookie_draft_calendar).toMatchObject({ autoOpen: true, autoStartDays: 7 })
  })

  it('is the commissioner’s only', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await applyAutomationPreset('L', 'member', 'recommended')).toMatchObject({ ok: false, status: 403 })
    expect(m.prisma.$transaction).not.toHaveBeenCalled()
  })
})
