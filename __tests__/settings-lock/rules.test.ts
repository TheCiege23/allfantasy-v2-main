import { describe, expect, it } from 'vitest'
import {
  SETTINGS_LOCK_KEY,
  UNLOCK_WINDOW_MS,
  changedPatchKeys,
  groupForSettingsKey,
  isGroupLocked,
  lockedGroupsFor,
  lockedMessage,
  readSettingsLock,
  resolveUnlockVotes,
  tallyUnlock,
  withSettingsLock,
  type SettingsLock,
  type UnlockVote,
} from '@/lib/league/settingsLock'

const NOW = new Date('2026-10-20T12:00:00Z')
const lock = (over: Partial<SettingsLock> = {}): SettingsLock => ({
  season: 2026, groups: ['scoring', 'trades'], lockedAt: NOW.toISOString(), lockedBy: 'comm', unlockedUntil: {}, votes: [], ...over,
})
const vote = (over: Partial<UnlockVote> = {}): UnlockVote => ({
  id: 'v1', group: 'scoring', reason: '', pollMessageId: 'm1', closesAt: '2026-10-22T12:00:00Z', status: 'voting',
  yes: null, no: null, proposedBy: 'comm', proposedAt: NOW.toISOString(), resolvedAt: null, ...over,
})

describe('settings lock (pure)', () => {
  it('a lock holds only for the season it was set in', () => {
    const s = withSettingsLock({ other: 1 }, lock())
    expect(s.other).toBe(1)
    expect(readSettingsLock(s, 2026)?.groups).toEqual(['scoring', 'trades'])
    expect(readSettingsLock(s, 2027)).toBeNull()
    expect(readSettingsLock({}, 2026)).toBeNull()
  })

  it('junk groups and votes are dropped; an empty lock with no history removes the key', () => {
    const s = { [SETTINGS_LOCK_KEY]: { season: 2026, groups: ['scoring', 'admin'], votes: [{ id: 'x' }, vote()] } }
    const read = readSettingsLock(s, 2026)!
    expect(read.groups).toEqual(['scoring'])
    expect(read.votes.map((v) => v.id)).toEqual(['v1'])
    expect(SETTINGS_LOCK_KEY in withSettingsLock(s, lock({ groups: [], votes: [] }))).toBe(false)
  })

  it('a passed vote holds a group open until its window ends, then it is locked again', () => {
    const l = lock({ unlockedUntil: { scoring: new Date(NOW.getTime() + 1000).toISOString() } })
    expect(isGroupLocked(l, 'scoring', NOW)).toBe(false)
    expect(isGroupLocked(l, 'scoring', new Date(NOW.getTime() + 2000))).toBe(true)
    expect(isGroupLocked(l, 'trades', NOW)).toBe(true)
    expect(isGroupLocked(l, 'waivers', NOW)).toBe(false)
    expect(isGroupLocked(null, 'scoring', NOW)).toBe(false)
  })

  it.each([
    ['tradeReviewHours', 'trades'], ['tradeDeadlineWeek', 'trades'], ['draftPickTrading', 'trades'], ['vetoThreshold', 'trades'],
    ['keeperCount', 'keepers'], ['keeperSlots', 'keepers'], ['keeper_min_cost_round', 'keepers'], ['keeperMissedDeadlineRule', 'keepers'],
    ['waiverSchedule', 'waivers'], ['waiverBudget', 'waivers'], ['dailyWaiverSchedule', 'waivers'], ['faabMinBid', 'waivers'],
    ['playoffTeams', 'playoffs'], ['playoffStartWeek', 'playoffs'], ['consolationBracket', 'playoffs'], ['championshipLength', 'playoffs'],
    ['scoringPresetId', 'scoring'], ['scoring_rules', 'scoring'], ['medianGame', 'scoring'], ['statCorrections', 'scoring'],
    ['rosterSize', 'rosters'], ['taxiSlots', 'rosters'], ['irSlots', 'rosters'], ['ir_slots', 'rosters'], ['lineupLockRule', 'rosters'],
    ['benchSlots', 'rosters'], ['rosterPositions', 'rosters'],
    ['draftType', null], ['draftOrderSlots', null], ['draft_rounds', null], ['rounds', null], ['pickTimerPreset', null],
    ['cpuAutoPick', null], ['timezone', null], ['name', null], ['leagueSize', null], ['publicStandings', null],
    ['status', null], ['firstName', null], ['description', null], ['language', null],
  ])('%s → %s', (key, group) => {
    expect(groupForSettingsKey(key)).toBe(group)
  })

  it('only keys whose value actually changes count — a re-sent section is not a change', () => {
    const stored: Record<string, unknown> = { tradeReviewHours: 24, medianGame: false, scoring_rules: { pass_td: 4 } }
    const current = (k: string) => stored[k]
    expect(changedPatchKeys({ leagueId: 'L', tradeReviewHours: 24, medianGame: false }, current)).toEqual([])
    expect(changedPatchKeys({ leagueId: 'L', tradeReviewHours: '24' }, current)).toEqual([]) // "24" vs 24 is the same
    expect(changedPatchKeys({ tradeReviewHours: 48 }, current)).toEqual(['tradeReviewHours'])
    expect(changedPatchKeys({ settingsMerge: { scoring_rules: { pass_td: 4 } } }, current)).toEqual([])
    expect(changedPatchKeys({ settingsMerge: { scoring_rules: { pass_td: 6 } } }, current)).toEqual(['scoring_rules'])
    // A key stored somewhere the patch cannot see counts as a change: a lock must not wave it through.
    expect(changedPatchKeys({ dailyWaiverSchedule: { enabled: true } }, current)).toEqual(['dailyWaiverSchedule'])
  })

  it('lockedGroupsFor names only locked groups the change touches', () => {
    expect(lockedGroupsFor(lock(), ['tradeReviewHours', 'timezone', 'waiverBudget'], NOW)).toEqual(['trades'])
    expect(lockedGroupsFor(lock(), ['scoringPresetId', 'tradeDeadlineWeek'], NOW)).toEqual(['scoring', 'trades'])
    expect(lockedGroupsFor(lock(), ['timezone'], NOW)).toEqual([])
    expect(lockedGroupsFor(null, ['tradeReviewHours'], NOW)).toEqual([])
  })

  it('a strict majority of votes cast passes; a tie or no votes fails', () => {
    expect(tallyUnlock(3, 2)).toBe('passed')
    expect(tallyUnlock(2, 2)).toBe('failed')
    expect(tallyUnlock(0, 0)).toBe('failed')
  })

  it('resolving: a closed poll decides; a passed vote opens its group for 72h; an open poll waits; a lost poll fails at its deadline', () => {
    const l = lock({ votes: [vote(), vote({ id: 'v2', group: 'trades', pollMessageId: 'm2' }), vote({ id: 'v3', pollMessageId: null, closesAt: '2026-10-19T00:00:00Z' })] })
    const polls: Record<string, { yes: number; no: number; closed: boolean }> = { m1: { yes: 5, no: 2, closed: true }, m2: { yes: 1, no: 0, closed: false } }
    const { lock: next, resolved } = resolveUnlockVotes(l, (v) => (v.pollMessageId ? polls[v.pollMessageId] ?? null : null), NOW)
    expect(resolved.map((v) => [v.id, v.status])).toEqual([['v1', 'passed'], ['v3', 'failed']])
    expect(next.unlockedUntil.scoring).toBe(new Date(NOW.getTime() + UNLOCK_WINDOW_MS).toISOString())
    expect(next.unlockedUntil.trades).toBeUndefined()
    expect(next.votes.find((v) => v.id === 'v2')?.status).toBe('voting')
    expect(isGroupLocked(next, 'scoring', NOW)).toBe(false)
  })

  it('the refusal names the locked areas', () => {
    expect(lockedMessage(['trades'])).toBe('Trades settings are locked for the season. A league vote can unlock them.')
    expect(lockedMessage(['scoring', 'trades', 'waivers'])).toMatch(/^Scoring, trades and waivers settings/)
  })
})
