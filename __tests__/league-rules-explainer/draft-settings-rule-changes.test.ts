/**
 * Draft settings saves write before/after values for the main draft's rules onto a silent
 * `settings_changed` event (meta.ruleChanges), so members get a "What changed" card — and read them
 * from the store the draft actually runs on (lib/league-rules-explainer/loadDraftRules.ts).
 *
 * The PATCH /settings/draft route runs here against the real loader over a stateful in-memory
 * league, so the before/after come from the writes themselves, not from a stub.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

type Db = {
  league: Record<string, unknown>
  session: Record<string, unknown> | null
  ls: Record<string, unknown> | null
}

const m = vi.hoisted(() => {
  const state: { db: Db } = { db: { league: {}, session: null, ls: null } }
  return {
    state,
    publish: vi.fn(async (_input: unknown) => undefined),
    prisma: {
      league: {
        findUnique: vi.fn(async () => structuredClone(state.db.league)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.db.league = { ...state.db.league, ...structuredClone(data) }
          return {}
        }),
      },
      leagueSettings: {
        findUnique: vi.fn(async () => (state.db.ls ? structuredClone(state.db.ls) : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.db.ls = { ...(state.db.ls ?? {}), ...structuredClone(data) }
          return state.db.ls
        }),
      },
      draftSession: {
        findFirst: vi.fn(async () => (state.db.session ? structuredClone(state.db.session) : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { version: _v, updatedAt: _u, ...rest } = data
          state.db.session = { ...(state.db.session ?? {}), ...rest }
          return state.db.session
        }),
      },
      dynastyLeagueConfig: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    },
  }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ draft_type: 'snake', rounds: 15, timer_seconds: 90, third_round_reversal: false, autopick_behavior: 'queue-first' })),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    timerMode: 'per_pick',
    slowDraftPauseWindow: null,
    allowPicksDuringOvernightPause: false,
    autoPickEnabled: true,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu',
  })),
}))

import { PATCH } from '@/app/api/leagues/[leagueId]/settings/draft/route'

const patch = (body: unknown) =>
  PATCH(createMockNextRequest('http://x/api/leagues/L/settings/draft', { method: 'PATCH', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })

function published(): { meta: Record<string, unknown>; skipNotifications?: boolean } | null {
  const call = m.publish.mock.calls[0]
  return call ? (call[0] as { meta: Record<string, unknown>; skipNotifications?: boolean }) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.db = {
    league: {
      id: 'L', userId: 'commish', platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', isDynasty: false,
      survivorMode: false, guillotineMode: false, leagueVariant: null, settings: {},
    },
    session: {
      status: 'pre_draft', draftType: 'snake', rounds: 15, timerSeconds: 90, thirdRoundReversal: false,
      auctionBudgetPerTeam: null, cpuAutoPick: true, draftModeLabel: null,
    },
    ls: {
      draftDateUtc: null, autostart: false, cpuAutoPick: true, draftType: 'snake', rounds: 15,
      pickTimerPreset: '90s', pickTimerCustomValue: null, draftOrderMethod: 'manual',
    },
  }
})

describe('PATCH /settings/draft → settings_changed.meta.ruleChanges', () => {
  it('a draft type change publishes its before and after, silently', async () => {
    expect((await patch({ draftType: 'linear' })).status).toBe(200)
    const ev = published()
    expect(ev).not.toBeNull()
    expect(ev!.skipNotifications).toBe(true)
    expect(ev!.meta.section).toBe('draft')
    expect(ev!.meta.ruleChanges).toEqual(expect.arrayContaining([{ key: 'draftType', before: 'snake', after: 'linear' }]))
    // Only explainer keys, never the request body.
    for (const c of ev!.meta.ruleChanges as Array<{ key: string }>) expect(c.key).toMatch(/^draft[A-Z]/)
    expect(JSON.stringify(ev!.meta)).not.toContain('requested_draft_type')
  })

  it('switching to a live execution mode turns off the CPU autopick, and the card says the draft now waits', async () => {
    expect((await patch({ executionMode: 'live' })).status).toBe(200)
    expect(published()!.meta.ruleChanges).toEqual([{ key: 'draftOnTimeout', before: 'autopick', after: 'wait' }])
  })

  it('a save that moves no draft rule publishes nothing', async () => {
    expect((await patch({ executionMode: 'auto' })).status).toBe(200)
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('after the draft is complete, a change to its settings is not a change members are told about', async () => {
    const { draftRuleChanges, loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    const { diffRuleSnapshots } = await import('@/lib/league-rules-explainer/changeKeys')
    m.state.db.session = { ...m.state.db.session!, status: 'completed' }
    const before = await loadDraftRules('L')
    m.state.db.ls = { ...m.state.db.ls!, draftDateUtc: new Date('2026-09-01T23:30:00Z'), draftOrderMethod: 'randomized' }
    const after = await loadDraftRules('L')
    // The stored values did move (so this is not vacuous) …
    expect(diffRuleSnapshots(before, after).map((c) => c.key)).toEqual(['draftOrderMethod', 'draftStartAt', 'draftAutostart'])
    // … but a finished draft's settings change nothing this season, so nothing is published.
    expect(draftRuleChanges(before, after)).toEqual([])
  })

  it('an imported league publishes nothing', async () => {
    m.state.db.league = { ...m.state.db.league, platform: 'sleeper' }
    expect((await patch({ draftType: 'linear' })).status).toBe(200)
    expect(m.publish).not.toHaveBeenCalled()
  })
})

describe('loadDraftRules reads the store the draft runs on', () => {
  it('before the start, the pick clock and CPU autopick come from LeagueSettings (startDraftSession re-applies them)', async () => {
    const { loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    m.state.db.session = { ...m.state.db.session!, timerSeconds: 30, cpuAutoPick: false }
    m.state.db.ls = { ...m.state.db.ls!, pickTimerPreset: '8h' }
    const r = await loadDraftRules('L')
    expect(r.draftPickSeconds).toBe(8 * 3600)
    expect(r.draftOnTimeout).toBe('autopick')
  })

  it('once started, the session decides', async () => {
    const { loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    m.state.db.session = { ...m.state.db.session!, status: 'in_progress', timerSeconds: 30, cpuAutoPick: false }
    m.state.db.ls = { ...m.state.db.ls!, pickTimerPreset: '8h' }
    const r = await loadDraftRules('L')
    expect(r).toMatchObject({ draftStatus: 'in_progress', draftPickSeconds: 30, draftOnTimeout: 'wait' })
  })

  it('with no session yet, it describes the draft getOrCreateDraftSession will create', async () => {
    const { loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    m.state.db.session = null
    m.state.db.ls = { ...m.state.db.ls!, draftType: '3rd_reversal', rounds: 14, draftDateUtc: new Date('2026-09-01T23:30:00Z'), autostart: true }
    const r = await loadDraftRules('L')
    expect(r).toMatchObject({ draftType: 'snake', draftThirdRoundReversal: true, draftRounds: 14, draftStartAt: '2026-09-01T23:30:00.000Z', draftAutostart: true })
  })

  it('an auction reads its budget, minimum bid and bid clock from the auction engine', async () => {
    const { loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    m.state.db.session = { ...m.state.db.session!, draftType: 'auction', auctionBudgetPerTeam: 250, timerSeconds: null }
    const r = await loadDraftRules('L')
    expect(r).toMatchObject({ draftType: 'auction', draftAuctionBudget: 250, draftAuctionMinBid: 1, draftPickSeconds: 35 })
  })

  it('the order: draft_order_mode weighted_lottery runs no lottery in a redraft league, so the saved order method stands', async () => {
    const { loadDraftRules } = await import('@/lib/league-rules-explainer/loadDraftRules')
    m.state.db.ls = { ...m.state.db.ls!, draftOrderMethod: 'worst_to_first' }
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('standings')
    m.state.db.league = { ...m.state.db.league, settings: { draft_order_mode: 'weighted_lottery' } }
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('standings')
  })
})
