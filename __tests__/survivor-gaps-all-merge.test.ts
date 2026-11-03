/**
 * Seams created by combining the Survivor gap branches (jury-island, challenges, governance, exile):
 * the side-game settings errors in the settings screen's bilingual { code, message } shape, and the
 * per-phase prize rules never restricting Exile's disadvantage reward types.
 */
import { describe, expect, it } from 'vitest'
import { settingsErrorMessages } from '@/lib/survivor/survivorSettingsScreenCopy'
import { sideGamePatchError, sideGameScreenErrors, validateSideGameScreenValues } from '@/lib/survivor/survivorSettingsScreen'
import { SURVIVOR_SIDE_GAME_DEFAULTS } from '@/lib/survivor/survivorSideGameSettings'
import {
  defaultPrizePhaseRules,
  prizePhaseError,
  prizeTypeOfRewardSpecType,
  PHASE_UNRESTRICTED_REWARD_TYPES,
} from '@/lib/survivor/survivorChallengeBuilderModel'
import { chimmyWeeklyReportBody } from '@/lib/survivor/chimmyWeeklyReport'

describe('side-game settings errors on the Survivor settings screen', () => {
  it('keeps the shared validator text in English, with a stable code', () => {
    expect(sideGameScreenErrors({ exileTokenFaabRate: 999 })).toEqual([
      { code: 'sideGameInvalid', message: 'That value for exileTokenFaabRate is not allowed.' },
    ])
    expect(validateSideGameScreenValues({ exileTokenFaabRate: 999 })).toEqual(['That value for exileTokenFaabRate is not allowed.'])
  })

  it('answers in Spanish, naming the setting rather than its key', () => {
    const [e] = sideGameScreenErrors({ exileTokenFaabRate: 999 }, SURVIVOR_SIDE_GAME_DEFAULTS, [], settingsErrorMessages.es)
    expect(e).toEqual({ code: 'sideGameInvalid', message: 'Ese valor para «cambio de fichas a FAAB del Exilio» no está permitido.' })
    const [locked] = sideGameScreenErrors({ survivorPoolTieRule: 'loss' }, SURVIVOR_SIDE_GAME_DEFAULTS, ['survivorPoolTieRule'], settingsErrorMessages.es)
    expect(locked).toEqual({ code: 'sideGameLocked', message: '«regla de empate del Pozo Survivor» se bloquea cuando empieza la temporada.' })
  })

  it('a rule error that names no key is a generic side-game rule error', () => {
    const en = sideGamePatchError({ error: 'Choose the division for the Survivor Pool division rule.', code: 'invalid' }, ['survivorPoolEnabled'])
    expect(en).toEqual({ code: 'sideGameRule', message: 'Choose the division for the Survivor Pool division rule.' })
    expect(sideGamePatchError({ error: 'x', code: 'invalid' }, [], settingsErrorMessages.es).message).toMatch(/juegos paralelos/)
  })
})

describe('per-phase prize rules and the Exile disadvantages', () => {
  it('never restrict a penalty or a disadvantage, in any phase', () => {
    const none = { pre_merge: [], post_merge: [], finale: [] }
    for (const t of PHASE_UNRESTRICTED_REWARD_TYPES) expect(prizeTypeOfRewardSpecType(t)).toBeNull()
    expect(PHASE_UNRESTRICTED_REWARD_TYPES).toEqual(expect.arrayContaining(['opponent_penalty', 'vote_taken', 'forced_bench']))
    // A real prize is still checked: an empty phase list refuses it.
    const steal = prizeTypeOfRewardSpecType('steal')
    expect(steal).toBe('steal')
    expect(prizePhaseError(steal!, 'post_merge', none, 'en')).not.toBeNull()
    expect(prizePhaseError(steal!, 'post_merge', defaultPrizePhaseRules(), 'en')).toBeNull()
  })
})

describe("Chimmy's weekly report carries both new lines", () => {
  it('side games, then rewards, then the finale last', () => {
    const rows = [{ name: 'Seat 1', state: 'active', voted: 1, exileTeam: null }]
    const body = chimmyWeeklyReportBody(9, rows, 'en', 'Side games: quiet.', 'Finale: 1 of 6 jury votes in.', 'Rewards: 1 paid this week.')
    expect(body.split('\n').slice(-3)).toEqual(['Side games: quiet.', 'Rewards: 1 paid this week.', 'Finale: 1 of 6 jury votes in.'])
    expect(chimmyWeeklyReportBody(9, [], 'en', null, 'Finale: x.', 'Rewards: y.')).toBe('Finale: x.\nRewards: y.')
  })
})

describe('Rewards Hub grant form covers the Exile disadvantages', () => {
  it('builds a spec for each, with the holder as chooser', async () => {
    const { grantDraftToSpec } = await import('@/components/survivor/SurvivorRewardsHubPanel')
    const base = { rosterId: 'r1', fromTribeId: '', toTribeId: '', amount: '4', basis: 'per_member' as const, what: 'faab' as const, targetRosterId: 'r2', samePositionOnly: true, powerType: 'extra_vote' as const, week: '5', deferToWeek: '', notes: '' }
    expect(grantDraftToSpec({ ...base, type: 'opponent_penalty' })).toEqual({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 4, targetRosterId: 'r2' })
    expect(grantDraftToSpec({ ...base, type: 'vote_taken', targetRosterId: '' })).toEqual({ type: 'vote_taken', chooserRosterId: 'r1', targetRosterId: null })
    expect(grantDraftToSpec({ ...base, type: 'forced_bench' })).toEqual({ type: 'forced_bench', chooserRosterId: 'r1', targetRosterId: 'r2' })
  })
})
