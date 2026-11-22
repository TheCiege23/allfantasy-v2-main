import { describe, expect, it } from 'vitest'
import {
  SURVIVOR_GOVERNANCE_DEFAULTS,
  lockedGovernanceKeys,
  mergeSurvivorGovernanceIntoSettings,
  readScheduledSwap,
  readSurvivorGovernanceSettings,
  scheduledSwapForWeek,
  validateSurvivorGovernancePatch,
  type SurvivorGovernanceContext,
} from '@/lib/survivor/survivorGovernanceSettings'

const preSeason: SurvivorGovernanceContext = { currentWeek: 0, firstWeek: 1, tribesLocked: false, mergeWeek: 8, primarySwapWeek: 4 }
const midSeason: SurvivorGovernanceContext = { currentWeek: 5, firstWeek: 1, tribesLocked: true, mergeWeek: 9, primarySwapWeek: 4 }

describe('reading governance settings', () => {
  it('defaults keep every existing league unchanged', () => {
    expect(readSurvivorGovernanceSettings({})).toEqual(SURVIVOR_GOVERNANCE_DEFAULTS)
    expect(readSurvivorGovernanceSettings(null)).toEqual(SURVIVOR_GOVERNANCE_DEFAULTS)
    const d = SURVIVOR_GOVERNANCE_DEFAULTS
    expect([d.alliancesEnabled, d.tradeRulesEnabled, d.tribeEmojiInNames, d.strikeAutoRemove, d.weekOneScoringStartDay, d.tribeSplit, d.swapSchedule.length]).toEqual([false, false, false, false, null, 'none', 0])
  })

  it('drops invalid values and duplicate swap weeks, keeps valid ones sorted', () => {
    const settings = readSurvivorGovernanceSettings({ survivorGovernance: {
      allianceMaxSize: 99, strikeLimit: 3, crossTribeCloseTime: '25:00', crossTribeTrades: 'banned',
      swapSchedule: [{ week: 7, mode: 'return_to_original' }, { week: 5, mode: 'resize', tribeCount: 3 }, { week: 5, mode: 'random_shuffle' }, { week: 6, mode: 'resize' }, 'junk'],
      experienceOverrides: { u1: 'veteran', u2: 'pro' },
    } })
    expect(settings.allianceMaxSize).toBe(4)
    expect(settings.strikeLimit).toBe(3)
    expect(settings.crossTribeCloseTime).toBe('19:00')
    expect(settings.crossTribeTrades).toBe('banned')
    expect(settings.swapSchedule).toEqual([{ week: 5, mode: 'resize', tribeCount: 3 }, { week: 7, mode: 'return_to_original' }])
    expect(settings.experienceOverrides).toEqual({ u1: 'veteran' })
    expect(scheduledSwapForWeek(settings, 7)?.mode).toBe('return_to_original')
    expect(scheduledSwapForWeek(settings, 6)).toBeNull()
  })

  it('normalises a custom pattern and refuses a one-tribe pattern', () => {
    expect(readScheduledSwap({ week: 4, mode: 'custom_pattern', pattern: 'a b, c' })).toEqual({ week: 4, mode: 'custom_pattern', pattern: 'ABC', order: 'season_points' })
    expect(readScheduledSwap({ week: 4, mode: 'custom_pattern', pattern: 'AAAA' })).toBeNull()
    expect(readScheduledSwap({ week: 4, mode: 'custom_pattern', pattern: 'AXB' })).toBeNull()
  })

  it('merges into League.settings under one key without touching the rest', () => {
    const merged = mergeSurvivorGovernanceIntoSettings({ tribeCount: 2 }, { ...SURVIVOR_GOVERNANCE_DEFAULTS, alliancesEnabled: true })
    expect(merged.tribeCount).toBe(2)
    expect(readSurvivorGovernanceSettings(merged).alliancesEnabled).toBe(true)
  })
})

describe('validating a commissioner patch', () => {
  const current = SURVIVOR_GOVERNANCE_DEFAULTS

  it('accepts a full set of valid changes', () => {
    const result = validateSurvivorGovernancePatch({
      alliancesEnabled: true, allianceMaxSize: 3, tradeRulesEnabled: true, crossTribeTrades: 'window', crossTribeCloseDay: 'Thursday', crossTribeCloseTime: '20:15',
      weeklyTradeFreezeEnabled: true, weeklyTradeFreezeDay: 'Saturday', weeklyTradeFreezeTime: '23:59', tribeSplit: 'rooks_vs_vets', weekOneScoringStartDay: 'Saturday',
      swapSchedule: [{ week: 3, mode: 'resize', tribeCount: 3 }, { week: 6, mode: 'return_to_original' }], strikeLimit: 2, strikeAutoRemove: true, tribeEmojiInNames: true,
    }, current, preSeason)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.next.swapSchedule.map((s) => s.week)).toEqual([3, 6])
  })

  it('refuses unknown keys, bad values and empty patches', () => {
    expect(validateSurvivorGovernancePatch({}, current, preSeason)).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateSurvivorGovernancePatch({ hackTheVote: true }, current, preSeason)).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateSurvivorGovernancePatch({ alliancesEnabled: 'yes' }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ allianceMaxSize: 1 }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ strikeLimit: 9 }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ crossTribeTrades: 'sometimes' }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ crossTribeCloseTime: '7pm' }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ weekOneScoringStartDay: 'Funday' }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 3, mode: 'resize' }] }, current, preSeason)).toMatchObject({ ok: false })
  })

  it('swap weeks: after the first week, before the merge, not on the setup screen swap, one per week', () => {
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 1, mode: 'random_shuffle' }] }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 8, mode: 'random_shuffle' }] }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 4, mode: 'random_shuffle' }] }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 3, mode: 'random_shuffle' }, { week: 3, mode: 'resize', tribeCount: 3 }] }, current, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 6, mode: 'random_shuffle' }] }, current, { ...preSeason, merged: true })).toMatchObject({ ok: false })
  })

  it('a played week’s swap can be neither changed nor removed, but later weeks can', () => {
    const withHistory = { ...current, swapSchedule: [{ week: 3, mode: 'resize' as const, tribeCount: 3 }] }
    expect(validateSurvivorGovernancePatch({ swapSchedule: [] }, withHistory, midSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 3, mode: 'random_shuffle' }] }, withHistory, midSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ swapSchedule: [{ week: 2, mode: 'random_shuffle' }, { week: 3, mode: 'resize', tribeCount: 3 }] }, withHistory, midSeason)).toMatchObject({ ok: false })
    const ok = validateSurvivorGovernancePatch({ swapSchedule: [{ week: 3, mode: 'resize', tribeCount: 3 }, { week: 7, mode: 'return_to_original' }] }, withHistory, midSeason)
    expect(ok.ok).toBe(true)
  })

  it('locks the tribe split once tribes exist and the week-1 window once week 1 is over', () => {
    expect(lockedGovernanceKeys(preSeason)).toEqual([])
    expect(lockedGovernanceKeys(midSeason)).toEqual(['tribeSplit', 'weekOneScoringStartDay'])
    expect(validateSurvivorGovernancePatch({ tribeSplit: 'rooks_vs_vets' }, current, midSeason)).toMatchObject({ ok: false, code: 'locked' })
    expect(validateSurvivorGovernancePatch({ weekOneScoringStartDay: 'Sunday' }, current, midSeason)).toMatchObject({ ok: false, code: 'locked' })
    // Re-sending the saved value is not a change.
    expect(validateSurvivorGovernancePatch({ tribeSplit: 'none', alliancesEnabled: true }, current, midSeason).ok).toBe(true)
  })
})
