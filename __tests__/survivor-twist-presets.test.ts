// @vitest-environment node
/**
 * Twist presets: Simple (one idol per tribe, no Exile, no surprise tribes), Classic (the defaults)
 * and Full twists. One choice at creation or before the draft; any hand change reads as custom.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  detectSurvivorTwistPreset, simplePresetIdolTypeIds, survivorTwistFoundationPatch, survivorTwistIdolConfig,
} from '@/lib/survivor/survivorTwistPresets'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'
import { BUNDLED_SURVIVOR_IDOL_TYPES } from '@/lib/survivor/survivorIdolTypes'
import { validatePickedIdolTypes } from '@/lib/survivor/survivorIdolDraw'

const base = { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, tribeCount: 3 }

describe('preset contents', () => {
  it('Simple: one Immunity Idol per tribe, no Exile, no surprise tribes', () => {
    expect(simplePresetIdolTypeIds(2)).toEqual(['immunity', 'immunity'])
    expect(simplePresetIdolTypeIds(4)).toEqual(['immunity', 'immunity', 'immunity', 'immunity'])
    expect(survivorTwistFoundationPatch('simple', 3)).toEqual({ idolsEnabled: true, idolCount: 3, exileIslandEnabled: false, eliminationOutcome: 'removed_to_waivers', postMergeSurpriseTribeWeeks: 0, twoHighestTribesImmune: false })
    const idol = survivorTwistIdolConfig('simple', 3)
    // The real pick validation accepts it: the always-in type is present and playable.
    expect(validatePickedIdolTypes(BUNDLED_SURVIVOR_IDOL_TYPES, idol.count, idol.pickedTypeIds).ok).toBe(true)
  })

  it('Classic keeps the defaults; Full adds idols, a surprise week and top-two immunity with 3+ tribes', () => {
    expect(survivorTwistIdolConfig('classic', 4)).toEqual({ mode: 'random', count: 7, pickedTypeIds: [] })
    expect(survivorTwistFoundationPatch('full', 3)).toEqual(expect.objectContaining({ idolCount: 8, exileIslandEnabled: true, postMergeSurpriseTribeWeeks: 1, twoHighestTribesImmune: true }))
    expect(survivorTwistFoundationPatch('full', 2).twoHighestTribesImmune).toBe(false)
  })
})

describe('detectSurvivorTwistPreset', () => {
  const apply = (id: 'simple' | 'classic' | 'full') => ({ ...base, ...survivorTwistFoundationPatch(id, 3) })
  it('reads each preset back, and a new league with no idol setup as Classic', () => {
    for (const id of ['simple', 'classic', 'full'] as const) expect(detectSurvivorTwistPreset(apply(id), survivorTwistIdolConfig(id, 3))).toBe(id)
    expect(detectSurvivorTwistPreset(apply('classic'), null)).toBe('classic')
  })
  it('turns custom after any hand change', () => {
    expect(detectSurvivorTwistPreset({ ...apply('simple'), exileIslandEnabled: true }, survivorTwistIdolConfig('simple', 3))).toBe('custom')
    expect(detectSurvivorTwistPreset(apply('classic'), { mode: 'random', count: 6, pickedTypeIds: [] })).toBe('custom')
  })
})

const m = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), view: vi.fn(), started: vi.fn(), saveIdol: vi.fn(), upsertConfig: vi.fn(),
  settings: {} as Record<string, unknown>,
  db: { league: { findUnique: vi.fn(), update: vi.fn() }, draftSession: { findFirst: vi.fn() } },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorAccessControl', async original => ({ ...await original<typeof import('@/lib/survivor/survivorAccessControl')>(), resolveSurvivorAccessContext: m.access }))
vi.mock('@/lib/survivor/survivorIdolConfigService', () => ({ getSurvivorIdolSetupView: m.view, isSurvivorDraftStarted: m.started, saveSurvivorIdolConfig: m.saveIdol }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', async original => ({ ...await original<typeof import('@/lib/survivor/SurvivorLeagueConfig')>(), upsertSurvivorConfig: m.upsertConfig }))

import { buildSurvivorAccessContextFromSnapshot } from '@/lib/survivor/survivorAccessControl'
import { POST } from '@/server/api-route-modules/league-survivor/foundation/route'

const post = (body: object) => POST(new NextRequest('http://localhost/api/leagues/L1/survivor/apply-twist-preset', { method: 'POST', body: JSON.stringify(body) }), { params: { leagueId: 'L1', action: 'apply-twist-preset' } } as never)

describe('POST apply-twist-preset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.settings = { tribeCount: 2, defaultTeamCount: 16, survivorTribeSlots: undefined }
    m.session.mockResolvedValue({ user: { id: 'host' } })
    m.access.mockImplementation(async () => buildSurvivorAccessContextFromSnapshot({ leagueId: 'L1', userId: 'host', role: 'commissioner', settings: { ...m.settings }, player: null }))
    m.db.league.findUnique.mockImplementation(async () => ({ settings: { ...m.settings } }))
    m.db.league.update.mockImplementation(async ({ data }: { data: { settings?: Record<string, unknown> } }) => { if (data.settings) m.settings = data.settings })
    m.db.draftSession.findFirst.mockResolvedValue(null)
    m.started.mockResolvedValue(false)
    m.view.mockResolvedValue({ config: { mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], pointSurgePct: 20, tributePct: 10 } })
    m.saveIdol.mockResolvedValue({ ok: true, config: {} })
  })

  it('Simple saves the picked idols (keeping the other idol options) and turns Exile off, then records the preset', async () => {
    const res = await post({ preset: 'simple' })
    expect(res.status).toBe(200)
    expect(m.saveIdol).toHaveBeenCalledWith('L1', expect.objectContaining({ mode: 'pick', count: 2, pickedTypeIds: ['immunity', 'immunity'], pointSurgePct: 20 }))
    expect(m.settings.survivor_twist_preset).toBe('simple')
    expect(m.settings.survivorFoundationSettings).toEqual(expect.objectContaining({ exileIslandEnabled: false, eliminationOutcome: 'removed_to_waivers', postMergeSurpriseTribeWeeks: 0, idolCount: 2 }))
  })

  it('is refused after the draft starts, for a bad preset, and for a non-commissioner', async () => {
    m.started.mockResolvedValue(true)
    expect((await post({ preset: 'full' })).status).toBe(409)
    m.started.mockResolvedValue(false)
    expect((await post({ preset: 'chaos' })).status).toBe(400)
    m.access.mockImplementation(async () => buildSurvivorAccessContextFromSnapshot({ leagueId: 'L1', userId: 'host', role: 'member', settings: {}, player: { userId: 'host', playerState: 'active' } }))
    expect((await post({ preset: 'full' })).status).toBe(403)
    expect(m.saveIdol).not.toHaveBeenCalled()
  })
})

describe('the idol setup a league without a saved row uses', () => {
  it('follows a Simple preset, and otherwise draws at random with the league count', async () => {
    const actual = await vi.importActual<typeof import('@/lib/survivor/survivorIdolConfigService')>('@/lib/survivor/survivorIdolConfigService')
    expect(actual.survivorIdolConfigFallback({ survivorIdolCount: 7, settings: { survivor_twist_preset: 'simple', tribeCount: 3 } }))
      .toEqual(expect.objectContaining({ mode: 'pick', count: 3, pickedTypeIds: ['immunity', 'immunity', 'immunity'] }))
    expect(actual.survivorIdolConfigFallback({ survivorIdolCount: 8, settings: { survivor_twist_preset: 'full' } })).toEqual(expect.objectContaining({ mode: 'random', count: 8 }))
    expect(actual.survivorIdolConfigFallback(null)).toEqual(expect.objectContaining({ mode: 'random', count: 7 }))
  })
})
