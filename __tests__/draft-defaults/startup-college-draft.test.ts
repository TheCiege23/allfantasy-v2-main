/**
 * Devy and C2C startup drafts: a pro draft then a college draft by default, one merged draft when the
 * commissioner turns it on (owner's rule, 2026-11-22). lib/draft-defaults/startupCollegeDraft.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  collegeDraftRoundConfig,
  openStartupCollegeDraftInTransaction,
  planStartupDrafts,
  poolTypeForStartupDraftLabel,
  readStartupCollegeDraft,
  supportsSeparateStartupDrafts,
  switchStartupDraftMode,
} from '@/lib/draft-defaults/startupCollegeDraft'
import { validateC2CEligibilityAsync, validateDevyEligibilityAsync } from '@/lib/live-draft-engine/PickValidation'

// The configs the league defaults give one draft today (measured from getLeagueDefaults, 2026-11-22).
const NFL_DEVY = { enabled: true, adapterId: 'nfl_devy', devySlotCount: 6 }
const NFL_C2C = { enabled: true, collegeRounds: [14, 15] }

describe('which leagues get two drafts', () => {
  it('NFL and NBA Devy / C2C: the pool keeps pro and college apart there', () => {
    for (const format of ['devy', 'c2c']) for (const sport of ['NFL', 'nba']) expect(supportsSeparateStartupDrafts(format, sport)).toBe(true)
  })
  it('a college-sport league, and every other format, keeps one draft', () => {
    for (const sport of ['NCAAF', 'NCAAB']) expect(supportsSeparateStartupDrafts('c2c', sport)).toBe(false)
    expect(supportsSeparateStartupDrafts('dynasty', 'NFL')).toBe(false)
  })
})

describe('planStartupDrafts', () => {
  it('Devy, default: a pro-only draft of the same length, then a college draft filling the DEVY seats', () => {
    const plan = planStartupDrafts({ format: 'devy', rounds: 21, devyConfig: NFL_DEVY, c2cConfig: null, collegeDraftRounds: 6, merged: false })
    expect(plan.first).toMatchObject({ rounds: 21, draftModeLabel: 'startup_pro', devyConfig: { enabled: true, devyRounds: [] }, c2cConfig: null })
    expect(plan.first.devyConfig).toMatchObject({ adapterId: 'nfl_devy' })
    expect(plan.state).toEqual({ mode: 'separate', format: 'devy', collegeRounds: 6, mergedCollegeRounds: 0, status: 'pending' })
  })

  it('C2C, default: the college rounds leave the first draft, which becomes pro-only', () => {
    const plan = planStartupDrafts({ format: 'c2c', rounds: 15, devyConfig: null, c2cConfig: NFL_C2C, collegeDraftRounds: 6, merged: false })
    expect(plan.first).toMatchObject({ rounds: 13, draftModeLabel: 'startup_pro', c2cConfig: { enabled: true, collegeRounds: [] } })
    expect(plan.state).toMatchObject({ mode: 'separate', collegeRounds: 6, mergedCollegeRounds: 2, status: 'pending' })
  })

  it('merged: the one draft exactly as it was before', () => {
    const devy = planStartupDrafts({ format: 'devy', rounds: 21, devyConfig: NFL_DEVY, c2cConfig: null, collegeDraftRounds: 6, merged: true })
    expect(devy.first).toEqual({ rounds: 21, draftModeLabel: null, devyConfig: NFL_DEVY, c2cConfig: null })
    const c2c = planStartupDrafts({ format: 'c2c', rounds: 15, devyConfig: null, c2cConfig: NFL_C2C, collegeDraftRounds: 6, merged: true })
    expect(c2c.first).toEqual({ rounds: 15, draftModeLabel: null, devyConfig: null, c2cConfig: NFL_C2C })
    expect(c2c.state.mode).toBe('merged')
  })
})

describe('the round restrictions the engine already enforces', () => {
  const db = (college: boolean) => ({ devyPlayer: { findFirst: vi.fn(async () => (college ? { graduatedToNFL: false } : null)) } })

  it('the pro draft refuses a college player in every round, and takes a pro', async () => {
    const { first } = planStartupDrafts({ format: 'c2c', rounds: 15, devyConfig: null, c2cConfig: NFL_C2C, collegeDraftRounds: 6, merged: false })
    const c2cConfig = first.c2cConfig as { enabled: boolean; collegeRounds: number[] }
    for (const currentRound of [1, 13]) {
      expect((await validateC2CEligibilityAsync({ currentRound, playerName: 'A', c2cConfig }, db(true))).valid).toBe(false)
      expect((await validateC2CEligibilityAsync({ currentRound, playerName: 'B', c2cConfig }, db(false))).valid).toBe(true)
    }
    const devy = planStartupDrafts({ format: 'devy', rounds: 21, devyConfig: NFL_DEVY, c2cConfig: null, collegeDraftRounds: 6, merged: false })
    const devyConfig = devy.first.devyConfig as { enabled: boolean; devyRounds: number[] }
    expect((await validateDevyEligibilityAsync({ currentRound: 21, playerName: 'A', devyConfig }, db(true))).valid).toBe(false)
  })

  it('the college draft takes only college players, in every round', async () => {
    const { c2cConfig } = collegeDraftRoundConfig('c2c', 6, null)
    for (const currentRound of [1, 6]) {
      expect((await validateC2CEligibilityAsync({ currentRound, playerName: 'A', c2cConfig: c2cConfig as never }, db(true))).valid).toBe(true)
      expect((await validateC2CEligibilityAsync({ currentRound, playerName: 'B', c2cConfig: c2cConfig as never }, db(false))).valid).toBe(false)
    }
    const { devyConfig } = collegeDraftRoundConfig('devy', 6, NFL_DEVY)
    expect(devyConfig).toMatchObject({ adapterId: 'nfl_devy', devyRounds: [1, 2, 3, 4, 5, 6] })
    expect((await validateDevyEligibilityAsync({ currentRound: 4, playerName: 'B', devyConfig: devyConfig as never }, db(false))).valid).toBe(false)
  })

  it('each draft reads its own side of the pool', () => {
    expect(poolTypeForStartupDraftLabel('startup_pro', { isC2C: true, isDevy: false })).toBe('startup_pro')
    expect(poolTypeForStartupDraftLabel('startup_pro', { isC2C: false, isDevy: true })).toBe('startup_vet')
    expect(poolTypeForStartupDraftLabel('college', { isC2C: true, isDevy: false })).toBe('startup_college')
    expect(poolTypeForStartupDraftLabel('college', { isC2C: false, isDevy: true })).toBe('devy')
    expect(poolTypeForStartupDraftLabel(null, { isC2C: true, isDevy: false })).toBeNull()
    expect(poolTypeForStartupDraftLabel('rookie', { isC2C: true, isDevy: false })).toBeNull()
  })
})

describe('openStartupCollegeDraftInTransaction', () => {
  const pro = {
    id: 's1', draftModeLabel: 'startup_pro', draftType: 'snake', teamCount: 12, slotOrder: [{ slot: 1, rosterId: 'r1' }],
    timerSeconds: 90, thirdRoundReversal: false, sportType: 'NFL', cpuAutoPick: true, aiAutoPick: false,
    devyConfig: null, c2cConfig: { enabled: true, collegeRounds: [] },
  }
  const tx = (settings: unknown, existing = 0) => ({
    league: { findUnique: vi.fn(async () => ({ settings })), update: vi.fn(async () => ({})) },
    draftSession: { count: vi.fn(async () => existing), create: vi.fn(async () => ({ id: 's2' })) },
  })
  const pending = { theme: 'x', startupCollegeDraft: { mode: 'separate', format: 'c2c', collegeRounds: 6, mergedCollegeRounds: 2, status: 'pending' } }

  it('opens the college draft when the pro draft completes: college-only, same order, and marks it open', async () => {
    const t = tx(pending)
    expect(await openStartupCollegeDraftInTransaction(t, 'L', pro)).toBe('s2')
    expect(t.draftSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'L', status: 'pre_draft', rounds: 6, teamCount: 12, slotOrder: pro.slotOrder, draftModeLabel: 'college',
        c2cConfig: { enabled: true, collegeRounds: [1, 2, 3, 4, 5, 6] },
      }),
    })
    expect(t.league.update).toHaveBeenCalledWith({
      where: { id: 'L' },
      data: { settings: { theme: 'x', startupCollegeDraft: { ...pending.startupCollegeDraft, status: 'open' } } },
    })
  })

  it('does nothing for any other draft, a merged league, an opened plan, or a second call', async () => {
    for (const [settings, session, existing] of [
      [pending, { ...pro, draftModeLabel: null }, 0],
      [pending, { ...pro, draftModeLabel: 'rookie' }, 0],
      [{ startupCollegeDraft: { ...pending.startupCollegeDraft, mode: 'merged' } }, pro, 0],
      [{ startupCollegeDraft: { ...pending.startupCollegeDraft, status: 'open' } }, pro, 0],
      [{}, pro, 0],
      [pending, pro, 1],
    ] as const) {
      const t = tx(settings, existing)
      expect(await openStartupCollegeDraftInTransaction(t, 'L', session as never)).toBeNull()
      expect(t.draftSession.create).not.toHaveBeenCalled()
    }
  })

  it('an auction pro draft is followed by a snake college draft', async () => {
    const t = tx(pending)
    await openStartupCollegeDraftInTransaction(t, 'L', { ...pro, draftType: 'auction' })
    expect(t.draftSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ draftType: 'snake' }) })
  })
})

describe('the commissioner switch', () => {
  it('C2C: two drafts → one merged draft and back, with the same rounds either way', () => {
    const separate = planStartupDrafts({ format: 'c2c', rounds: 15, devyConfig: null, c2cConfig: NFL_C2C, collegeDraftRounds: 6, merged: false })
    const merged = switchStartupDraftMode(separate.state, { rounds: 13, devyConfig: null, c2cConfig: separate.first.c2cConfig }, 'merged')!
    expect(merged).toMatchObject({ rounds: 15, draftModeLabel: null, c2cConfig: { enabled: true, collegeRounds: [14, 15] }, state: { mode: 'merged' } })
    const back = switchStartupDraftMode(merged.state, { rounds: merged.rounds, devyConfig: null, c2cConfig: merged.c2cConfig }, 'separate')!
    expect(back).toMatchObject({ rounds: 13, draftModeLabel: 'startup_pro', c2cConfig: { enabled: true, collegeRounds: [] } })
    expect(back.state).toEqual(separate.state)
  })

  it('Devy: merged takes any player in any round (no round list), separate is pro-only', () => {
    const separate = planStartupDrafts({ format: 'devy', rounds: 21, devyConfig: NFL_DEVY, c2cConfig: null, collegeDraftRounds: 6, merged: false })
    const merged = switchStartupDraftMode(separate.state, { rounds: 21, devyConfig: separate.first.devyConfig, c2cConfig: null }, 'merged')!
    expect(merged.rounds).toBe(21)
    expect(merged.devyConfig).toEqual({ ...NFL_DEVY, enabled: true })
    const back = switchStartupDraftMode(merged.state, { rounds: 21, devyConfig: merged.devyConfig, c2cConfig: null }, 'separate')!
    expect(back.devyConfig).toMatchObject({ enabled: true, devyRounds: [] })
    expect(back.state).toEqual(separate.state)
  })

  it('no change when the mode is already the one asked for', () => {
    const { state } = planStartupDrafts({ format: 'devy', rounds: 21, devyConfig: NFL_DEVY, c2cConfig: null, collegeDraftRounds: 6, merged: false })
    expect(switchStartupDraftMode(state, { rounds: 21, devyConfig: null, c2cConfig: null }, 'separate')).toBeNull()
  })
})

describe('readStartupCollegeDraft', () => {
  it('reads a stored plan and refuses anything else', () => {
    expect(readStartupCollegeDraft({ startupCollegeDraft: { mode: 'separate', format: 'devy', collegeRounds: 6, status: 'pending' } }))
      .toEqual({ mode: 'separate', format: 'devy', collegeRounds: 6, mergedCollegeRounds: 0, status: 'pending' })
    for (const bad of [null, {}, { startupCollegeDraft: 'x' }, { startupCollegeDraft: { mode: 'both', format: 'devy' } }]) expect(readStartupCollegeDraft(bad)).toBeNull()
  })
})
