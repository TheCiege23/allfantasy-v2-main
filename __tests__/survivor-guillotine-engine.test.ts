import { describe, expect, it } from 'vitest'
import { buildSGSchedule, defaultSGConfig, parseSGLiveConfig } from '@/lib/survivor-guillotine/config'
import { gauntletPickCaptain, resolveSGPeriod, validateSGMatchups } from '@/lib/survivor-guillotine/competition'
import { parseSGPowerCommand, powersVisibleTo, reconcileSGPowerOwnership, sgPowerRevealMoment, validateSGPowerPlay } from '@/lib/survivor-guillotine/powers'
import { createSGWeeklyReward, seedSGDraftIdols } from '@/lib/survivor-guillotine/rewards'
import type { SGPeriod, SGPower, SGTeam } from '@/lib/survivor-guillotine/types'

const config = defaultSGConfig()
const team = (id: string, tribeId: string, points: number, extra: Partial<SGTeam> = {}): SGTeam => ({ id, tribeId, points, previousPoints: 50, ...extra })
const period = (mode: SGPeriod['mode'], count: number): SGPeriod => ({ period: 1, mode, teamsEntering: count, teamsLeaving: count - (mode === 'gauntlet' ? 2 : 1), chops: mode === 'gauntlet' ? 2 : 1, tribeImmunity: mode === 'match_play' || mode === 'tribe_champion' })
const power: SGPower = { id: 'hidden_1', kind: 'personal_immunity', binding: 'player', playerId: 'player_1', ownerId: 'owner', expiresAfterPeriod: 10, status: 'held', targetTeamId: null, revealed: false }

describe('live rules input', () => {
  it('accepts a complete validated season and rejects unknown or malformed fields', () => {
    expect(parseSGLiveConfig(defaultSGConfig('NBA', 17)).sport).toBe('NBA')
    expect(() => parseSGLiveConfig({ ...defaultSGConfig(), teamCount: '22' })).toThrow('teamCount')
    expect(() => parseSGLiveConfig({ ...defaultSGConfig(), mystery: true })).toThrow('Unknown rule')
    expect(() => parseSGLiveConfig({ ...defaultSGConfig(), enabledPowers: ['personal_immunity', 'unlisted'] })).toThrow('power pool')
  })
})

describe('confirmed football and NBA schedules', () => {
  it('takes 22 teams to a final three with the football merge in week 14', () => {
    const result = buildSGSchedule(config)
    expect(result.errors).toEqual([])
    expect(result.periods.map(row => row.teamsEntering)).toEqual([22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 10, 8, 6, 5, 4, 3])
    expect(result.periods[13].mode).toBe('merged')
    expect(result.periods[16].mode).toBe('final_three')
    expect(result.periods.filter(row => row.mode === 'gauntlet').every(row => !row.tribeImmunity)).toBe(true)
  })
  it('builds NBA phases backward from the selected championship instead of week 14', () => {
    const nba = { ...defaultSGConfig('NBA', 20), teamCount: 25 }
    const result = buildSGSchedule(nba)
    expect(result.errors).toEqual([])
    expect(result.periods.find(row => row.mode === 'merged')?.period).toBe(17)
    expect(result.periods.at(-1)?.teamsEntering).toBe(3)
  })
  it('accounts for an NBA break with no elimination', () => {
    const nba = { ...defaultSGConfig('NBA', 18), periodOverrides: { 8: 'off' as const } }
    const result = buildSGSchedule(nba)
    expect(result.errors).toEqual([])
    expect(result.periods[7].chops).toBe(0)
    expect(result.periods.at(-1)?.teamsEntering).toBe(3)
  })
  it('blocks impossible counts and odd Gauntlet tribes', () => {
    expect(buildSGSchedule({ ...config, teamCount: 21 }).errors.join(' ')).toContain('two equal tribes')
    expect(buildSGSchedule({ ...config, teamCount: 24 }).errors.join(' ')).toContain('5 finalists')
    expect(buildSGSchedule({ ...config, championshipPeriod: NaN }).periods).toEqual([])
    expect(buildSGSchedule({ ...config, tribeCount: 5 }).errors.length).toBeGreaterThan(0)
  })
  it('validates custom deadlines and keeps immunity available', () => {
    expect(buildSGSchedule({ ...config, immunityDeadline: 'custom' }).errors.length).toBeGreaterThan(0)
    expect(buildSGSchedule({ ...config, enabledPowers: [] }).errors.length).toBeGreaterThan(0)
    expect(buildSGSchedule({ ...config, nbaScoring: 'capped_games', nbaGameCap: 0 }).errors.length).toBeGreaterThan(0)
  })
  it('does not permit tribal play after the merge', () => {
    expect(buildSGSchedule({ ...config, periodOverrides: { 15: 'match_play' } }).errors.join(' ')).toContain('cannot resume')
  })
})

describe('tribal competition and deterministic chopping', () => {
  it('lets a sitting manager get chopped despite not counting in the race', () => {
    const teams = [team('a', 'A', 100), team('b', 'B', 120), team('sitting', 'A', 10, { sitOut: true })]
    const result = resolveSGPeriod({ config, period: period('match_play', 3), teams, matchups: [{ team1: 'a', team2: 'b' }] })
    expect(result.immuneTribeId).toBe('B')
    expect(result.choppedTeamIds).toEqual(['sitting'])
  })
  it('requires valid sit-outs and one cross-tribe matchup per participating manager', () => {
    const teams = [team('a', 'A', 10, { sitOut: true, satOutLastPeriod: true }), team('b', 'A', 20), team('c', 'B', 30)]
    expect(validateSGMatchups(teams, [{ team1: 'b', team2: 'c' }]).join(' ')).toContain('consecutive')
    expect(validateSGMatchups(teams, [{ team1: 'a', team2: 'c' }]).length).toBeGreaterThan(0)
    expect(validateSGMatchups(teams, []).join(' ')).toContain('needs a matchup')
  })
  it('supports four tribes and chops across every unprotected tribe', () => {
    const teams = [team('a1', 'A', 100), team('a2', 'A', 90), team('b1', 'B', 60), team('b2', 'B', 40), team('c1', 'C', 50), team('c2', 'C', 45), team('d1', 'D', 55), team('d2', 'D', 10)]
    const result = resolveSGPeriod({ config, period: period('match_play', 8), teams, matchups: [{ team1: 'a1', team2: 'b1' }, { team1: 'a2', team2: 'c1' }, { team1: 'b2', team2: 'd1' }, { team1: 'c2', team2: 'd2' }] })
    expect(result.immuneTribeId).toBe('A')
    expect(result.choppedTeamIds).toEqual(['d2'])
  })
  it('passes the chop through consecutive immunity holders', () => {
    const teams = [team('a', 'A', 10), team('b', 'A', 20), team('c', 'A', 30, { champion: true }), team('d', 'B', 100, { champion: true })]
    const result = resolveSGPeriod({ config, period: period('tribe_champion', 4), teams, protectedTeamIds: ['a', 'b'] })
    expect(result.choppedTeamIds).toEqual(['c'])
    expect(result.savedTeamIds).toEqual(['a', 'b'])
  })
  it('chops one per equal Gauntlet tribe by default', () => {
    const teams = [team('a', 'A', 10), team('b', 'A', 11), team('c', 'B', 100), team('d', 'B', 110)]
    expect(resolveSGPeriod({ config, period: period('gauntlet', 4), teams }).choppedTeamIds).toEqual(['a', 'c'])
    expect(resolveSGPeriod({ config: { ...config, gauntletElimination: 'league_lowest_two' }, period: period('gauntlet', 4), teams }).choppedTeamIds).toEqual(['a', 'b'])
  })
  it('allows configured Gauntlet tribe immunity without cancelling either chop', () => {
    const teams = [team('a', 'A', 10), team('b', 'A', 20), team('c', 'B', 100), team('d', 'B', 110)]
    const enabled = { ...config, gauntletTribeImmunity: true }
    expect(resolveSGPeriod({ config: enabled, period: period('gauntlet', 4), teams }).status).toBe('commissioner_required')
    expect(resolveSGPeriod({ config: enabled, period: period('gauntlet', 4), teams, gauntletImmuneTribeId: 'A' }).choppedTeamIds).toEqual(['c', 'd'])
  })
  it('uses previous-week score, never season points, for an elimination tie', () => {
    const teams = [team('a', 'A', 10, { previousPoints: 80 }), team('b', 'A', 10, { previousPoints: 50 }), team('c', 'A', 90)]
    expect(resolveSGPeriod({ config, period: period('merged', 3), teams }).choppedTeamIds).toEqual(['b'])
  })
  it('requires commissioner resolution rather than inventing an unresolved tie', () => {
    const teams = [team('a', 'A', 10), team('b', 'A', 10), team('c', 'A', 90)]
    const result = resolveSGPeriod({ config, period: period('merged', 3), teams })
    expect(result.status).toBe('commissioner_required')
    expect(result.choppedTeamIds).toEqual([])
  })
  it('breaks a tied tribe contest using the screenshot lowest-weekly-score rule', () => {
    const teams = [team('a', 'A', 100, { champion: true }), team('b', 'A', 10), team('c', 'B', 100, { champion: true }), team('d', 'B', 20)]
    const result = resolveSGPeriod({ config, period: period('tribe_champion', 4), teams })
    expect(result.immuneTribeId).toBe('B')
    expect(result.choppedTeamIds).toEqual(['b'])
  })
  it('ranks the final three and disallows post-merge powers', () => {
    const teams = [team('a', 'A', 10), team('b', 'A', 30), team('c', 'A', 20)]
    expect(resolveSGPeriod({ config, period: period('final_three', 3), teams }).placements).toEqual(['b', 'c', 'a'])
    expect(resolveSGPeriod({ config, period: period('merged', 3), teams, protectedTeamIds: ['a'] }).status).toBe('commissioner_required')
  })
  it('fails the whole resolution when all eligible teams are protected', () => {
    const teams = [team('a', 'A', 10, { champion: true }), team('b', 'B', 20, { champion: true })]
    const result = resolveSGPeriod({ config, period: period('tribe_champion', 2), teams, protectedTeamIds: ['a'] })
    expect(result.status).toBe('commissioner_required')
    expect(result.choppedTeamIds).toEqual([])
  })
  it('defaults the captain draft to snake', () => {
    expect(Array.from({ length: 8 }, (_, index) => gauntletPickCaptain(index, config.gauntletDraft))).toEqual([0, 1, 1, 0, 0, 1, 1, 0])
    expect(gauntletPickCaptain(2, 'alternating')).toBe(0)
    expect(gauntletPickCaptain(0, 'commissioner')).toBeNull()
  })
})

describe('secret powers and player ownership', () => {
  const play = { power, managerId: 'owner', period: 1, mergePeriod: 14, now: '2026-10-13T10:00:00Z', deadline: '2026-10-13T11:00:00Z', ceremonyStarted: false, rosterPlayerIds: ['player_1'] }
  it('hides held and sealed powers from other managers and participating commissioners', () => {
    expect(powersVisibleTo([power, { ...power, id: 'sealed', status: 'sealed' }], 'commissioner')).toEqual([])
    expect(powersVisibleTo([power], 'owner')).toHaveLength(1)
    expect(powersVisibleTo([{ ...power, status: 'used', revealed: true }], 'other')).toHaveLength(1)
    expect(powersVisibleTo([{ ...power, revealed: true }], 'other')).toEqual([])
    expect(powersVisibleTo([{ ...power, ownerId: '' }], '')).toEqual([])
  })
  it('seeds distinct draft players with exactly one guaranteed personal immunity idol', () => {
    const records = seedSGDraftIdols({ playerIds: ['a', 'b', 'c', 'd'], count: 3, allowedKinds: config.enabledPowers, expiresAfterPeriod: 10, pick: () => 0 })
    expect(records.filter(row => row.kind === 'personal_immunity')).toHaveLength(1)
    expect(new Set(records.map(row => row.playerId)).size).toBe(3)
    expect(records.every(row => !row.ownerId && !row.revealed && row.binding === 'player')).toBe(true)
    expect(powersVisibleTo(records, 'commissioner')).toEqual([])
  })
  it('rejects impossible draft seeding and creates only private manager rewards', () => {
    expect(() => seedSGDraftIdols({ playerIds: ['a', 'a'], count: 2, allowedKinds: config.enabledPowers, expiresAfterPeriod: 10 })).toThrow()
    const reward = createSGWeeklyReward({ managerId: 'winner', allowedKinds: ['faab_bonus'], expiresAfterPeriod: 10 })
    expect(reward.kind).toBe('faab_bonus')
    expect(reward.binding).toBe('manager')
    expect(powersVisibleTo([reward], 'winner')).toHaveLength(1)
    expect(powersVisibleTo([reward], 'commissioner')).toEqual([])
  })
  it('transfers a player-bound idol but loses a chopped managers weekly reward', () => {
    const result = reconcileSGPowerOwnership({ powers: [power, { ...power, id: 'reward', binding: 'manager', playerId: null }], playerOwnerById: { player_1: 'new_owner' }, eliminatedManagerIds: ['owner'], period: 2, mergePeriod: 14 })
    expect(result).toHaveLength(1)
    expect(result[0].ownerId).toBe('new_owner')
  })
  it('preserves an unused player idol on waivers for its next owner', () => {
    const waiver = reconcileSGPowerOwnership({ powers: [power], playerOwnerById: {}, eliminatedManagerIds: ['owner'], period: 2, mergePeriod: 14 })
    expect(waiver[0].ownerId).toBe('')
    expect(powersVisibleTo(waiver, 'owner')).toEqual([])
    const claimed = reconcileSGPowerOwnership({ powers: waiver, playerOwnerById: { player_1: 'next' }, eliminatedManagerIds: [], period: 3, mergePeriod: 14 })
    expect(claimed[0].ownerId).toBe('next')
  })
  it('expires unused powers before merge and retains used powers as history', () => {
    const result = reconcileSGPowerOwnership({ powers: [power, { ...power, id: 'spent', status: 'used', revealed: true }], playerOwnerById: {}, eliminatedManagerIds: [], period: 14, mergePeriod: 14 })
    expect(result.map(row => row.id)).toEqual(['spent'])
  })
  it('accepts attached players on any roster slot and checks deadlines and ceremony start', () => {
    expect(validateSGPowerPlay(play)).toBeNull()
    expect(validateSGPowerPlay({ ...play, managerId: 'other' })).toContain('do not own')
    expect(validateSGPowerPlay({ ...play, rosterPlayerIds: [] })).toContain('roster')
    expect(validateSGPowerPlay({ ...play, now: play.deadline })).toContain('deadline')
    expect(validateSGPowerPlay({ ...play, ceremonyStarted: true })).toContain('ceremony')
  })
  it('blocks locked steals and requires a valid drop from a full roster', () => {
    const steal = { ...play, power: { ...power, kind: 'steal_player' as const } }
    expect(validateSGPowerPlay({ ...steal, targetPlayerLocked: true })).toContain('unlocked')
    expect(validateSGPowerPlay({ ...steal, targetPlayerLocked: false, rosterFull: true })).toContain('drop')
    expect(validateSGPowerPlay({ ...steal, targetPlayerLocked: false, rosterFull: true, dropPlayerId: 'player_1' })).toBeNull()
  })
  it('parses private Chimmy power commands and distinguishes reveal moments', () => {
    expect(parseSGPowerCommand('@Chimmy use idol hidden_1')).toEqual({ powerId: 'hidden_1', targetId: null })
    expect(parseSGPowerCommand('@Chimmy play token swap_1 on manager_2')?.targetId).toBe('manager_2')
    expect(parseSGPowerCommand('use idol hidden_1')).toBeNull()
    expect(sgPowerRevealMoment('personal_immunity')).toBe('chop')
    expect(sgPowerRevealMoment('steal_player')).toBe('execution')
  })
})
