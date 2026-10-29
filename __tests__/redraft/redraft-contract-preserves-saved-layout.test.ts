/**
 * `ensureRedraftLeagueContract` runs on every load of /league/[leagueId]/draft. The owner's rule
 * (2026-10-20): a league that has ANY saved roster layout keeps exactly that layout — no FLEX or K
 * added, no second flex / defense from a FLEX-vs-FLX or DST-vs-DEF spelling difference, no default
 * starters carried in beside it. Only a league with no saved layout at all gets the full default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, transaction, tx } = vi.hoisted(() => {
  const tx = {
    league: { update: vi.fn().mockResolvedValue({}) },
    leagueSettings: { create: vi.fn().mockResolvedValue({}) },
    leagueWaiverSettings: { create: vi.fn().mockResolvedValue({}) },
    redraftLeagueExtendedSettings: { create: vi.fn().mockResolvedValue({}) },
    redraftLeagueDraftProfile: { create: vi.fn().mockResolvedValue({}) },
    redraftLeagueHomepageState: { create: vi.fn().mockResolvedValue({}) },
    draftSession: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
  }
  return {
    tx,
    leagueFindUnique: vi.fn(),
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: leagueFindUnique }, $transaction: transaction },
}))

import {
  buildRedraftContractRepairPlan,
  ensureRedraftLeagueContract,
} from '@/lib/redraft-core-contract'
import { buildRedraftSettingsSnapshot, normalizeRedraftRosterSlotKey } from '@/lib/league-concepts/redraftDefaults'

const FULL_NFL = { QB: 1, RB: 2, WR: 2, TE: 1, FLX: 1, K: 1, DEF: 1 }
const { DEF: _noCollegeDefense, ...FULL_NCAAF } = FULL_NFL

function plan(sport: 'NFL' | 'NCAAF', settings: Record<string, unknown>) {
  return buildRedraftContractRepairPlan({
    sport,
    leagueType: 'redraft',
    teamCount: 12,
    settings,
    draftSession: { status: 'pre_draft', slotOrder: [] },
  })
}

function normalizedCounts(map: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(map)) {
    const slot = normalizeRedraftRosterSlotKey(key)
    out[slot] = (out[slot] ?? 0) + Number(value)
  }
  return out
}

describe('redraft contract repair never adds to a saved roster layout', () => {
  it('leaves a saved cut lineup (QB, RB, WR, WR, TE, DEF) and its slot order exactly as they are', () => {
    const starterSlots = { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 }
    const starterSlotOrder = ['QB', 'RB', 'WR', 'WR', 'TE', 'DEF']
    for (const sport of ['NFL', 'NCAAF'] as const) {
      const result = plan(sport, {
        starter_slots: { ...starterSlots },
        starter_slot_order: [...starterSlotOrder],
        bench_slots: 6,
      })
      expect(result.nextSettings.starter_slots).toEqual(starterSlots)
      expect(result.nextSettings.starter_slot_order).toEqual(starterSlotOrder)
      expect(result.nextSettings.bench_slots).toBe(6)
      // None of the default layout may be carried in beside the league's own.
      for (const key of ['roster_slot_order', 'compact_roster_slot_order', 'rosterTemplate', 'rosterSettings', 'roster_size', 'rosterSize', 'lineupValidationRules', 'ir_slots']) {
        expect(result.nextSettings).not.toHaveProperty(key)
      }
      // Rounds come from the league's own roster (6 starters + 6 bench), not the 15/16-round default.
      expect(result.draftSession.data.rounds).toBe(12)
      expect(result.nextSettings).not.toHaveProperty('draft_rounds')
    }
  })

  it('leaves a FLEX / DST spelled custom lineup unchanged, with no FLX or DEF duplicate', () => {
    const custom = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1 }
    const result = plan('NFL', { starter_slots: { ...custom } })
    expect(result.nextSettings.starter_slots).toEqual(custom)
    const counts = normalizedCounts(result.nextSettings.starter_slots as Record<string, unknown>)
    expect(counts.FLX).toBe(1)
    expect(counts.DEF).toBe(1)
  })

  it('keeps the known legacy full map as saved (no respelling, and NCAAF keeps its saved DEF)', () => {
    const nflLegacy = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }
    const ncaafLegacy = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 }
    expect(plan('NFL', { starter_slots: { ...nflLegacy } }).nextSettings.starter_slots).toEqual(nflLegacy)
    expect(plan('NCAAF', { starter_slots: { ...ncaafLegacy } }).nextSettings.starter_slots).toEqual(ncaafLegacy)
  })

  it('treats a commissioner roster.config layout as saved and adds no starter_slots beside it', () => {
    const settings = { roster: { config: { sections: [{ slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1, BN: 5 } }] } } }
    const result = plan('NFL', settings)
    expect(result.nextSettings).not.toHaveProperty('starter_slots')
    expect(result.nextSettings.roster).toEqual(settings.roster)
    expect(result.draftSession.data.rounds).toBe(11)
  })

  it('fills the full default layout into a league with no saved layout at all', () => {
    for (const [sport, full, rounds] of [['NFL', FULL_NFL, 15], ['NCAAF', FULL_NCAAF, 16]] as const) {
      const result = plan(sport, { scoring_preset_id: sport === 'NFL' ? 'fb_half_ppr' : 'ncaaf_half_ppr' })
      expect(result.nextSettings.starter_slots).toEqual(full)
      const order = result.nextSettings.starter_slot_order as string[]
      const orderCounts: Record<string, number> = {}
      for (const slot of order) orderCounts[slot] = (orderCounts[slot] ?? 0) + 1
      expect(orderCounts).toEqual(full)
      expect((result.nextSettings.rosterSettings as Record<string, unknown>).starterSlots).toEqual(full)
      expect(result.draftSession.data.rounds).toBe(rounds)
    }
  })

  it('keeps an empty league idempotent after its first fill', () => {
    const first = plan('NFL', {})
    const second = plan('NFL', first.nextSettings)
    expect(second.settingsChanged).toBe(false)
    expect(second.nextSettings.starter_slots).toEqual(FULL_NFL)
  })
})

describe('draft page load for a brand-new league (ensureRedraftLeagueContract)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const sport of ['NFL', 'NCAAF'] as const) {
    it(`${sport}: runs cleanly on fresh create settings and leaves the full lineup in place`, async () => {
      const settings = buildRedraftSettingsSnapshot({
        sport,
        draftType: 'snake',
        scoringPresetId: sport === 'NFL' ? 'fb_half_ppr' : 'ncaaf_half_ppr',
        teamCount: 12,
      })
      leagueFindUnique.mockResolvedValue({
        id: 'league-new',
        sport,
        leagueType: 'redraft',
        isDynasty: false,
        leagueSize: 12,
        timezone: 'America/New_York',
        rosterSize: 15,
        settings,
        leagueSettings: { id: 'ls' },
        waiverSettings: { id: 'ws' },
        redraftExtendedSettings: { id: 'ext' },
        redraftDraftProfile: { id: 'dp' },
        redraftHomepageState: { id: 'hp' },
        draftSessions: [{ status: 'pre_draft', slotOrder: [], rounds: 15, timerSeconds: 90 }],
        rosters: [{ id: 'r1' }],
        teams: [{ ownerName: 'Commish', teamName: 'Team 1' }],
      })

      const result = await ensureRedraftLeagueContract('league-new')
      expect(result.ok).toBe(true)
      // A fresh create already carries the whole contract, so settings are not rewritten at all.
      expect(result.repaired).not.toContain('league.settings')
      expect(tx.league.update).not.toHaveBeenCalled()
      // The incomplete placeholder slot order is still repaired, as before.
      expect(tx.draftSession.update).toHaveBeenCalledTimes(1)
      const written = tx.draftSession.update.mock.calls[0]?.[0]?.data
      expect(written?.slotOrder).toHaveLength(12)
    })
  }
})
