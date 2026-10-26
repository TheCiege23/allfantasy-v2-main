/**
 * The after-drop waiver period, per player type (lib/waiver-wire/hold-by-position.ts and
 * dropped-player-waivers.ts): a commissioner gives a position its own period — K and DEF clear at
 * once, a QB waits 48 — and every hold path reads it: the add/drop route, the waiver screen's pool,
 * the claim service and the processor all go through `loadDroppedPlayerHolds` with the policy.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), count: vi.fn() },
    waiverClaim: { count: vi.fn(), findFirst: vi.fn() },
    waiverTransaction: { findFirst: vi.fn(), findMany: vi.fn() },
    sportsPlayer: { findMany: vi.fn() },
    player: { findMany: vi.fn() },
  },
  executeAdd: vi.fn(),
  effective: vi.fn(),
  gate: vi.fn(),
}))
const patches = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: vi.fn().mockResolvedValue(null) }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: m.gate }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language][k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: (p: Record<string, unknown>) => patches.push(p), saving: false }),
}))

import { POST } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import {
  DROPPED_PLAYER_ON_WAIVERS_MESSAGE,
  activeDropHolds,
  droppedPlayerHoldPolicy,
  holdHoursForPosition,
  loadDroppedPlayerHolds,
  maxHoldHours,
  normalizeHoldPosition,
  parseHoldHoursByPositionInput,
  readHoldHoursByPosition,
} from '@/lib/waiver-wire/dropped-player-waivers'
import { HUB_WAIVER_OPTION_KEYS, hubWaiverEngineConfigPatch, parseHubWaiverOptions } from '@/lib/waiver-wire/hub-waiver-options'
import { WaiversSection } from '@/components/league-settings/tabs/WaiversTab'
import { translations } from '@/lib/i18n/translations'

const NOW = new Date('2026-10-20T15:00:00Z')
const HOUR = 3_600_000
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR)
const policy = (byPosition: Record<string, number>, hours = 24) => ({ hours, byPosition, sport: 'NFL' })

describe('the policy', () => {
  it('a position takes its own period, a group key covers its members, anything else takes the league period', () => {
    const p = policy({ K: 0, DEF: 0, QB: 48, DL: 12 })
    expect(holdHoursForPosition(p, 'K')).toBe(0)
    expect(holdHoursForPosition(p, 'PK')).toBe(0)
    expect(holdHoursForPosition(p, 'DST')).toBe(0)
    expect(holdHoursForPosition(p, 'd/st')).toBe(0)
    expect(holdHoursForPosition(p, 'QB')).toBe(48)
    expect(holdHoursForPosition(p, 'DE')).toBe(12)
    expect(holdHoursForPosition(p, 'RB')).toBe(24)
    expect(holdHoursForPosition(p, null)).toBe(24)
    expect(maxHoldHours(p)).toBe(48)
    expect(maxHoldHours(policy({}, 0))).toBe(0)
    expect(maxHoldHours(policy({ QB: 6 }, 0))).toBe(6)
  })

  it('IDP groups come from the canonical position service, and only in football leagues', () => {
    const p = policy({ LB: 6, DB: 3 })
    expect(holdHoursForPosition(p, 'OLB')).toBe(6)
    expect(holdHoursForPosition(p, 'FS')).toBe(3)
    expect(holdHoursForPosition(p, 'EDGE')).toBe(24)
    // An NBA "C" is not a football centre, and no football group applies outside football.
    const nba = { hours: 24, byPosition: { DB: 1 }, sport: 'NBA' }
    expect(holdHoursForPosition(nba, 'CB')).toBe(24)
  })

  it('a multi-position player reads as his first position', () => {
    expect(normalizeHoldPosition('SF/PF')).toBe('SF')
    expect(normalizeHoldPosition('rb, wr')).toBe('RB')
  })

  it('FCFS has no hold for anyone, overrides or not', () => {
    const p = droppedPlayerHoldPolicy({
      normalizedWaiverType: 'fcfs',
      waiverHours: 24,
      waiverEngineConfig: { dropped_player_hold_hours_by_position: { QB: 48 } },
    })
    expect(maxHoldHours(p)).toBe(0)
    const faab = droppedPlayerHoldPolicy({
      normalizedWaiverType: 'faab',
      waiverHours: 24,
      waiverEngineConfig: { dropped_player_hold_hours_by_position: { QB: 48, K: 0 } },
    })
    expect(faab.byPosition).toEqual({ QB: 48, K: 0 })
  })

  it('the stored map is cleaned, never trusted: bad keys and hours are dropped', () => {
    expect(readHoldHoursByPosition({ k: 0, DST: 6, QB: 1.5, RB: -1, WR: 200, '<script>': 1, TE: '12' })).toEqual({ K: 0, DEF: 6 })
    expect(readHoldHoursByPosition(null)).toEqual({})
    expect(readHoldHoursByPosition([1, 2])).toEqual({})
  })

  it('a save is refused with the reason rather than trimmed', () => {
    expect(parseHoldHoursByPositionInput({ K: 0, DEF: 0 })).toEqual({ ok: true, value: { K: 0, DEF: 0 } })
    expect(parseHoldHoursByPositionInput(null)).toEqual({ ok: true, value: {} })
    expect(parseHoldHoursByPositionInput({ QB: 169 }).ok).toBe(false)
    expect(parseHoldHoursByPositionInput({ QB: 2.5 }).ok).toBe(false)
    expect(parseHoldHoursByPositionInput({ 'not a position': 1 }).ok).toBe(false)
    expect(parseHoldHoursByPositionInput('K=0').ok).toBe(false)
  })
})

describe('the holds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.sportsPlayer.findMany.mockResolvedValue([])
    m.prisma.player.findMany.mockResolvedValue([])
  })

  it('each drop is held for its own position period', () => {
    const rows = [
      { dropPlayerId: 'kicker', processedAt: ago(1), rosterId: 'r1' },
      { dropPlayerId: 'back', processedAt: ago(1), rosterId: 'r1' },
      { dropPlayerId: 'qb', processedAt: ago(30), rosterId: 'r2' },
    ]
    const pos: Record<string, string> = { kicker: 'K', back: 'RB', qb: 'QB' }
    const p = policy({ K: 0, QB: 48 })
    const holds = activeDropHolds(rows, NOW, (id) => holdHoursForPosition(p, pos[id]))
    expect([...holds.keys()].sort()).toEqual(['back', 'qb'])
    expect(holds.get('qb')!.until.toISOString()).toBe(new Date(ago(30).getTime() + 48 * HOUR).toISOString())
  })

  it('reads drops as far back as the longest period, and positions by every id a roster stores', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'sp-uuid', processedAt: ago(1), rosterId: 'r1' },
      { dropPlayerId: '4046', processedAt: ago(30), rosterId: 'r2' },
      { dropPlayerId: 'ply-1', processedAt: ago(2), rosterId: 'r3' },
      { dropPlayerId: 'nobody', processedAt: ago(2), rosterId: 'r3' },
    ])
    m.prisma.sportsPlayer.findMany.mockResolvedValue([
      { id: 'sp-uuid', externalId: 'x', sleeperId: null, position: 'K' },
      { id: 'other', externalId: '4046', sleeperId: null, position: 'QB' },
    ])
    m.prisma.player.findMany.mockResolvedValue([{ id: 'ply-1', position: 'DST' }])
    const holds = await loadDroppedPlayerHolds('L', policy({ K: 0, DEF: 0, QB: 48 }), { now: NOW })
    const where = m.prisma.waiverTransaction.findMany.mock.calls[0][0].where
    expect(where.processedAt.gte.toISOString()).toBe(ago(48).toISOString())
    expect(m.prisma.sportsPlayer.findMany.mock.calls[0][0].where.sport).toBe('NFL')
    // K and DEF (by its DST spelling) cleared at once; the QB found by external id waits 48; a player
    // with no position on file takes the league's 24.
    expect([...holds.keys()].sort()).toEqual(['4046', 'nobody'])
  })

  it('positive control: with no overrides it is the league period for all, and positions are never read', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([{ dropPlayerId: 'sp-uuid', processedAt: ago(1), rosterId: 'r1' }])
    const holds = await loadDroppedPlayerHolds('L', policy({}), { now: NOW })
    expect([...holds.keys()]).toEqual(['sp-uuid'])
    expect(m.prisma.waiverTransaction.findMany.mock.calls[0][0].where.processedAt.gte.toISOString()).toBe(ago(24).toISOString())
    expect(m.prisma.sportsPlayer.findMany).not.toHaveBeenCalled()
  })

  it('a failed position read throws, so each caller applies its own failure rule', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([{ dropPlayerId: 'a', processedAt: ago(1), rosterId: 'r1' }])
    m.prisma.sportsPlayer.findMany.mockRejectedValue(new Error('db down'))
    await expect(loadDroppedPlayerHolds('L', policy({ K: 0 }), { now: NOW })).rejects.toThrow('db down')
  })
})

describe('the add/drop route', () => {
  async function call(addPlayerId: string) {
    const req = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId }) }) as never
    const res = await POST(req, { params: Promise.resolve({ leagueId: 'L' }) })
    return { status: res.status, body: (await res.json()) as { code?: string; error?: string; onWaiversUntil?: string } }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    m.gate.mockResolvedValue({ ok: true })
    m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 24, sport: 'NFL', lifecycleState: 'in_season' })
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(null)
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', status: 'active' })
    m.prisma.redraftSeason.count.mockResolvedValue(0)
    m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
    m.prisma.player.findMany.mockResolvedValue([])
    m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
    m.effective.mockResolvedValue({
      normalizedWaiverType: 'faab',
      instantFaAfterClear: true,
      freeAgentUnlockBehavior: 'after_waiver_run',
      waiverEngineConfig: { dropped_player_hold_hours_by_position: { K: 0 } },
    })
  })
  afterEach(() => vi.useRealTimers())

  it('a kicker dropped an hour ago is a free agent already; a running back is still on waivers', async () => {
    m.prisma.sportsPlayer.findMany.mockImplementation(async ({ where }: { where: { OR: Array<{ id?: { in: string[] } }> } }) => {
      const ids = where.OR[0].id!.in
      return [
        { id: 'kick', externalId: 'k1', sleeperId: null, position: 'K' },
        { id: 'rb', externalId: 'r1', sleeperId: null, position: 'RB' },
      ].filter((r) => ids.includes(r.id))
    })
    m.prisma.waiverTransaction.findMany.mockImplementation(async ({ where }: { where: { dropPlayerId: { in: string[] } } }) =>
      where.dropPlayerId.in.map((id) => ({ dropPlayerId: id, processedAt: ago(1), rosterId: 'r2' })),
    )
    const kick = await call('kick')
    expect(kick.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledTimes(1)

    const rb = await call('rb')
    expect(rb.body.code).toBe('WAIVER_REQUIRED')
    expect(rb.body.error).toBe(DROPPED_PLAYER_ON_WAIVERS_MESSAGE)
    expect(rb.body.onWaiversUntil).toBe(new Date(ago(1).getTime() + 24 * HOUR).toISOString())
  })

  it('a failed position read fails closed to a claim, like any unreadable hold', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([{ dropPlayerId: 'kick', processedAt: ago(1), rosterId: 'r2' }])
    m.prisma.sportsPlayer.findMany.mockRejectedValue(new Error('db down'))
    const res = await call('kick')
    expect(res.body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })
})

describe('the hub save', () => {
  const parse = (body: Record<string, unknown>) => parseHubWaiverOptions(body, { budget: 100 })

  it('validates the map and writes it into waiverEngineConfig', () => {
    const r = parse({ waiverHoldHoursByPosition: { K: 0, dst: 0 } })
    expect(r).toEqual({ ok: true, options: { holdHoursByPosition: { K: 0, DEF: 0 } } })
    expect(hubWaiverEngineConfigPatch((r as { options: never }).options)).toEqual({
      dropped_player_hold_hours_by_position: { K: 0, DEF: 0 },
    })
    expect(parse({ waiverHoldHoursByPosition: { QB: 500 } })).toEqual({
      ok: false,
      error: 'The waiver period for QB must be a whole number of hours, 0–168.',
    })
    // Names "waiver", so the settings lock and co-commissioner scopes file it under waivers.
    expect(HUB_WAIVER_OPTION_KEYS).toContain('waiverHoldHoursByPosition')
  })
})

describe('the hub control', () => {
  const ctx = { league: { id: 'l1', sport: 'NFL', settings: {}, waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, waiverType: 'faab' } } as never
  afterEach(() => {
    cleanup()
    patches.length = 0
    lang.language = 'en'
    vi.unstubAllGlobals()
  })

  it('loads the saved periods, adds a position at 0 hours, edits and removes one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ waiverEngineConfig: { dropped_player_hold_hours_by_position: { QB: 48 } } }),
    })))
    const r = render(<WaiversSection ctx={ctx} canEdit timezone="America/New_York" />)
    const qb = (await r.findByTestId('league-settings-waiver-hold-QB')) as HTMLInputElement
    expect(qb.value).toBe('48')

    fireEvent.change(r.getByTestId('league-settings-waiver-hold-pick'), { target: { value: 'K' } })
    fireEvent.click(r.getByTestId('league-settings-waiver-hold-add'))
    expect(patches.at(-1)).toEqual({ waiverHoldHoursByPosition: { QB: 48, K: 0 } })

    fireEvent.change(r.getByTestId('league-settings-waiver-hold-QB'), { target: { value: '36' } })
    expect(patches.at(-1)).toEqual({ waiverHoldHoursByPosition: { QB: 36, K: 0 } })

    fireEvent.click(r.getByTestId('league-settings-waiver-hold-remove-QB'))
    expect(patches.at(-1)).toEqual({ waiverHoldHoursByPosition: { K: 0 } })
    await waitFor(() => expect(r.queryByTestId('league-settings-waiver-hold-QB')).toBeNull())
  })

  it('reads in Spanish, and every new key has a Spanish string', async () => {
    lang.language = 'es'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const r = render(<WaiversSection ctx={ctx} canEdit timezone="America/New_York" />)
    const box = r.getByTestId('league-settings-waiver-hold-by-position')
    expect(box.textContent).toContain('Período de reclamos por posición')
    expect(box.textContent).toContain('Todas las posiciones usan el período de reclamos de arriba.')
    expect(box.textContent).toContain('Añadir posición')
    const keys = Object.keys(translations.en).filter((k) => k.startsWith('lsHub.wv.byPos'))
    expect(keys.length).toBe(8)
    for (const k of keys) expect(translations.es[k], k).toBeTruthy()
  })
})
