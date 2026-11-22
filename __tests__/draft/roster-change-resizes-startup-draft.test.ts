/**
 * A commissioner's roster edit before a dynasty startup draft re-runs the draft-length sync. Two things
 * were wrong there (dynasty simulation, 2026-11-08):
 *
 *   1. It counted taxi spots, so ONE more bench spot took a 12-team startup from 24 rounds to 35 — more
 *      players than the active roster holds, which then refuses every trade that adds a player. League
 *      creation already caps the startup at `computeStartupDraftCapacity` (#3390); this path did not.
 *   2. With that corrected it still did not resize: "unchanged" compared the computed rounds against the
 *      draft CONFIG, which falls back to the sport default (25) when nothing is stored, while the session
 *      itself still had 24.
 *
 * And a rookie draft's rounds are its own setting; a roster edit in the offseason must not resize it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  slots: [] as Array<Record<string, unknown>>,
  league: { isDynasty: true, leagueVariant: null, leagueType: 'dynasty', settings: {} } as Record<string, unknown>,
  session: { status: 'pre_draft', draftModeLabel: null as string | null, rounds: 24 },
  configRounds: 25,
  updates: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => h.league), update: vi.fn(async () => ({})) },
    draftSession: { findFirst: vi.fn(async () => h.session) },
    leagueSettings: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}))
vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => ({ template: { slots: h.slots }, formatType: 'dynasty' })),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: vi.fn(async () => ({ rounds: h.configRounds })) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({
  updateDraftVariantSettings: vi.fn(async (_id: string, patch: unknown) => {
    h.updates.push(patch)
    h.session.rounds = (patch as { config: { rounds: number } }).config.rounds
  }),
}))

import { getComputedDraftRounds } from '@/lib/draft/computedDraftRounds'
import { syncDraftRoundsToRoster } from '@/lib/draft/syncDraftRoundsToRoster'

/** The NFL dynasty default the simulation used, with the commissioner's extra bench spot (15). */
function dynastyTemplate(bench: number) {
  h.slots = [
    { slotName: 'QB', starterCount: 1 },
    { slotName: 'RB', starterCount: 2 },
    { slotName: 'WR', starterCount: 3 },
    { slotName: 'TE', starterCount: 1 },
    { slotName: 'FLEX', starterCount: 2 },
    { slotName: 'SUPERFLEX', starterCount: 1 },
    { slotName: 'BN', benchCount: bench },
    { slotName: 'IR', reserveCount: 3 },
    { slotName: 'TAXI', taxiCount: 5 },
  ]
}

beforeEach(() => {
  h.updates = []
  h.session = { status: 'pre_draft', draftModeLabel: null, rounds: 24 }
  h.configRounds = 25
})

describe('a roster edit before a dynasty startup draft', () => {
  it('sizes the startup to the active roster — starters + bench, not taxi or IR', async () => {
    dynastyTemplate(15)
    const computed = await getComputedDraftRounds('lg')
    expect(computed?.rounds).toBe(25)
  })

  it('resizes the session even when the draft config already reads the same number', async () => {
    dynastyTemplate(15)
    const result = await syncDraftRoundsToRoster('lg', { keepManualOverride: false })
    expect(result).toMatchObject({ synced: true, rounds: 25 })
    expect(h.session.rounds).toBe(25)
  })

  it('is unchanged only when the session already has the rounds', async () => {
    dynastyTemplate(15)
    h.session.rounds = 25
    expect(await syncDraftRoundsToRoster('lg', { keepManualOverride: false })).toEqual({ synced: false, reason: 'unchanged' })
    expect(h.updates).toEqual([])
  })
})

describe('a roster edit in the offseason', () => {
  it('leaves a pre-draft ROOKIE draft at its own rounds', async () => {
    dynastyTemplate(15)
    h.session = { status: 'pre_draft', draftModeLabel: 'rookie', rounds: 4 }
    expect(await syncDraftRoundsToRoster('lg', { keepManualOverride: false })).toEqual({ synced: false, reason: 'not_startup_draft' })
    expect(h.session.rounds).toBe(4)
  })
})
