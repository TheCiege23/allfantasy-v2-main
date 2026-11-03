// @vitest-environment node
/**
 * Survivor gaps (G2), the pure halves:
 *  - the original league's challenge kinds: first TD scorer, last score type, position leaders,
 *    the multi-prop sweep (tiers by number right) and the puzzle (first / fastest, exact match);
 *  - how each kind settles, sport by sport (gap 8: stored stats settle themselves, the rest are
 *    settled by the commissioner — and the kinds stay available);
 *  - per-phase prize rules with EN/ES refusals (gap 2), defaults = today's rules;
 *  - Chimmy's deterministic answers for the new kinds (never reading anyone's answer);
 *  - the weekly report's rewards line (gap 4) and the bilingual season preview (gap 5).
 */
import { describe, expect, it } from 'vitest'
import {
  answerKey,
  challengeSettlementSource,
  defaultPrizePhaseRules,
  normalizeAnswerText,
  planChallengePayouts,
  positionLeaderTruth,
  prizePhaseError,
  prizePhaseOf,
  readChallengeBuilderConfig,
  readPrizePhaseRules,
  scoreChallenge,
  validateChallengeAnswer,
  validateChallengeDraft,
  validatePrizePhaseRules,
  type ChallengeDraftContext,
  type ChallengeEntry,
} from '@/lib/survivor/survivorChallengeBuilderModel'
import { chimmyChallengeAnswer } from '@/lib/survivor/survivorChallengeChimmyModel'
import { countRewardsForWeek, rewardsWeeklyReportLine } from '@/lib/survivor/survivorRewardReport'
import { isThiefThisWeek, readThievesCannotStealFromEachOther } from '@/lib/survivor/survivorRewardModel'
import { buildSeasonPreview } from '@/lib/survivor/survivorSettingsScreen'
import { seasonPreviewMessages } from '@/lib/survivor/survivorSettingsScreenCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { answerSurvivorRules } from '@/lib/survivor/survivorRulesAnswers'

const NOW = new Date('2026-11-01T15:00:00Z')
const ctx = (over: Partial<ChallengeDraftContext> = {}): ChallengeDraftContext => ({ now: NOW, currentWeek: 9, merged: false, lang: 'en', faabWeeklyCap: 40, otherFaabThisWeek: 0, ...over })
const base = {
  title: 'Week 9', question: 'Call it.', scope: 'individual', week: 9, opensAt: '2026-11-01T10:00', locksAt: '2026-11-01T20:00',
  prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 20 }] }],
}
const draft = (over: Record<string, unknown>, c = ctx()) => {
  const r = validateChallengeDraft({ ...base, ...over }, c)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.draft.config
}
const code = (over: Record<string, unknown>, c = ctx()) => {
  const r = validateChallengeDraft({ ...base, ...over }, c)
  return r.ok ? null : r.error.code
}
const entry = (entrantId: string, answer: ChallengeEntry['submission']['answer'], at = '2026-11-01T16:00:00Z'): ChallengeEntry => ({ entrantId, submission: { answer, wager: null }, submittedAt: at })

describe('first TD scorer and last score type (settled by the commissioner)', () => {
  it('authors with the commissioner’s options (first TD) or the fixed score types (last score)', () => {
    const first = draft({ kind: 'first_td_scorer', options: ['Kelce', 'Allen', 'No touchdown'] })
    expect(first.options.map((o) => o.label)).toEqual(['Kelce', 'Allen', 'No touchdown'])
    expect(challengeSettlementSource(first)).toBe('manual')
    const last = draft({ kind: 'last_score_type' })
    expect(last.options.map((o) => o.id)).toEqual(['touchdown', 'field_goal', 'safety'])
    expect(challengeSettlementSource(last)).toBe('manual')
    expect(draft({ kind: 'last_score_type' }, ctx({ lang: 'es' })).options[1]!.label).toBe('Gol de campo')
    expect(code({ kind: 'first_td_scorer', options: ['Solo'] })).toBe('options')
  })

  it('scores right-or-wrong with a miss penalty', () => {
    const c = draft({ kind: 'last_score_type', missPenalty: { type: 'score_penalty', points: 5 } })
    const s = scoreChallenge(c, [entry('r1', { optionId: 'touchdown' }), entry('r2', { optionId: 'safety' })], { optionId: 'touchdown' })
    expect(s.correctIds).toEqual(['r1'])
    expect(s.wrongIds).toEqual(['r2'])
  })
})

describe('position leaders (settles from PlayerWeeklyScore)', () => {
  const players = [{ playerId: 'p1', label: 'Mahomes' }, { playerId: 'p2', label: 'Allen' }, { playerId: 'p3', label: 'Hurts' }]
  const pos = { sport: 'NFL', season: 2026, statWeek: 9, position: 'qb' }

  it('authors with a position and option players, and settles itself', () => {
    const c = draft({ kind: 'position_leader', options: players, position: pos })
    expect(c.position).toEqual({ sport: 'NFL', season: 2026, statWeek: 9, position: 'QB' })
    expect(c.options.map((o) => o.playerId)).toEqual(['p1', 'p2', 'p3'])
    expect(challengeSettlementSource(c)).toBe('position_leader')
    expect(code({ kind: 'position_leader', options: players })).toBe('position')
    expect(code({ kind: 'position_leader', options: ['Mahomes', 'Allen'], position: pos })).toBe('position')
  })

  it('the top stored score is right; a tie makes every tied option right', () => {
    const c = draft({ kind: 'position_leader', options: players, position: pos })
    const truth = positionLeaderTruth(c.options, new Map([['p1', 22], ['p2', 31.5], ['p3', 31.5]]))!
    expect(truth).toEqual({ optionId: 'o2', tiedOptionIds: ['o3'] })
    const s = scoreChallenge(c, [entry('r1', { optionId: 'o1' }), entry('r2', { optionId: 'o2' }), entry('r3', { optionId: 'o3' })], truth)
    expect(s.correctIds).toEqual(['r2', 'r3'])
    expect(positionLeaderTruth(c.options, new Map())).toBeNull()
  })
})

describe('sweep (all props must hit; optional tiers by number right)', () => {
  const props = [
    { question: 'Chiefs win?', options: ['Yes', 'No'] },
    { question: 'Over 44.5?', options: ['Over', 'Under'] },
    { question: 'Kelce TD?', options: ['Yes', 'No'] },
  ]

  it('only a perfect card pays without tiers; tiers pay 3/3, 2/3…', () => {
    const flat = draft({ kind: 'sweep', props })
    expect(flat.props!.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(challengeSettlementSource(flat)).toBe('manual')
    expect(code({ kind: 'sweep', props, prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 20 }] }, { place: 2, rewards: [{ type: 'score_bonus', points: 5 }] }] })).toBe('sweepPlaces')
    const tiered = draft({ kind: 'sweep', props, sweepTiered: true, prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 30 }] }, { place: 2, rewards: [{ type: 'score_bonus', points: 10 }] }] })
    const truth = { picks: { p1: 'o1', p2: 'o2', p3: 'o1' } }
    const entries = [
      entry('perfect', { picks: { p1: 'o1', p2: 'o2', p3: 'o1' } }),
      entry('oneMiss', { picks: { p1: 'o1', p2: 'o1', p3: 'o1' } }),
      entry('twoMiss', { picks: { p1: 'o2', p2: 'o1', p3: 'o1' } }),
    ]
    expect(scoreChallenge(flat, entries, truth).places).toEqual([{ place: 1, entrantIds: ['perfect'] }])
    const s = scoreChallenge(tiered, entries, truth)
    expect(s.places).toEqual([{ place: 1, entrantIds: ['perfect'] }, { place: 2, entrantIds: ['oneMiss'] }, { place: 3, entrantIds: ['twoMiss'] }])
    expect(s.correctIds).toEqual(['perfect'])
    expect(s.wrongIds).toEqual(['oneMiss', 'twoMiss'])
    // Only places with a prize pay: place 3 has none.
    const paid = planChallengePayouts(tiered, s, entries, { challengeId: 'c', week: 9, round: 0, recipients: new Map(entries.map((e) => [e.entrantId, [e.entrantId]])) })
    expect(paid.map((p) => p.entrantId)).toEqual(['perfect', 'oneMiss'])
  })

  it('needs a pick on every prop, and refuses a bad prop list', () => {
    const c = draft({ kind: 'sweep', props })
    expect(validateChallengeAnswer(c, { picks: { p1: 'o1', p2: 'o1' } }, 'en').ok).toBe(false)
    expect(validateChallengeAnswer(c, { picks: { p1: 'o1', p2: 'o1', p3: 'o2' } }, 'en')).toEqual({ ok: true, submission: { answer: { picks: { p1: 'o1', p2: 'o1', p3: 'o2' } }, wager: null } })
    expect(code({ kind: 'sweep', props: [props[0]] })).toBe('sweep')
    expect(code({ kind: 'sweep', props: [{ question: '', options: ['a', 'b'] }, props[1]] })).toBe('sweep')
  })
})

describe('puzzle (first or fastest correct; exact match or by hand)', () => {
  it('authors, hides the answer from no-one but the reader of the config, and settles by exact match', () => {
    const c = draft({ kind: 'puzzle', puzzle: { answer: 'Tom Brady', mode: 'fastest', settle: 'exact' }, prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 10 }] }, { place: 2, rewards: [{ type: 'faab_grant', amount: 5 }] }] })
    expect(c.puzzle).toEqual({ answer: 'Tom Brady', mode: 'fastest', settle: 'exact' })
    expect(challengeSettlementSource(c)).toBe('exact_answer')
    expect(challengeSettlementSource({ ...c, puzzle: { ...c.puzzle!, settle: 'manual' } })).toBe('manual')
    expect(readChallengeBuilderConfig({ ...c, builder: 1 })!.puzzle).toEqual(c.puzzle)
    const s = scoreChallenge(c, [
      entry('late', { text: 'tom brady' }, '2026-11-01T17:00:00Z'),
      entry('early', { text: '  Tom   BRADY! ' }, '2026-11-01T16:00:00Z'),
      entry('wrong', { text: 'Peyton' }, '2026-11-01T15:30:00Z'),
    ], { text: 'Tom Brady' })
    expect(s.places).toEqual([{ place: 1, entrantIds: ['early'] }, { place: 2, entrantIds: ['late'] }])
    expect(s.wrongIds).toEqual(['wrong'])
  })

  it('first correct pays one place; no wagers or penalties; a typed answer is required', () => {
    expect(code({ kind: 'puzzle', puzzle: { answer: 'x', mode: 'first_correct' }, prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 5 }] }, { place: 2, rewards: [{ type: 'score_bonus', points: 5 }] }] })).toBe('puzzlePlaces')
    expect(code({ kind: 'puzzle', puzzle: { answer: '' } })).toBe('puzzle')
    expect(code({ kind: 'puzzle', puzzle: { answer: 'x' }, missPenalty: { type: 'score_penalty', points: 5 } })).toBe('penalty')
    const c = draft({ kind: 'puzzle', puzzle: { answer: 'Señor' } })
    expect(validateChallengeAnswer(c, { text: '' }, 'es')).toEqual({ ok: false, error: 'Escribe tu respuesta (hasta 200 caracteres).' })
    expect(normalizeAnswerText('Señor!')).toBe('senor')
    expect(answerKey({ text: 'Señor ' })).toBe(answerKey({ text: 'senor' }))
  })
})

describe('anytime TD and player props for every sport (gap 8)', () => {
  const player = { playerId: 'p', playerName: 'X', season: 2026, statWeek: 9 }
  it('settles itself where the sport stores the stat, and by the commissioner where it does not', () => {
    expect(challengeSettlementSource(draft({ kind: 'anytime_td', player: { ...player, sport: 'NFL' } }))).toBe('player_stat')
    expect(challengeSettlementSource(draft({ kind: 'anytime_td', player: { ...player, sport: 'NHL' } }))).toBe('player_stat')
    expect(challengeSettlementSource(draft({ kind: 'anytime_td', player: { ...player, sport: 'NCAAFB' } }))).toBe('player_stat')
    expect(challengeSettlementSource(draft({ kind: 'anytime_td', player: { ...player, sport: 'NBA' } }))).toBe('manual')
    expect(challengeSettlementSource(draft({ kind: 'player_stat_over_under', line: 25.5, player: { ...player, sport: 'NBA', stat: 'pts' } }))).toBe('player_stat')
    expect(challengeSettlementSource(draft({ kind: 'player_stat_over_under', line: 25.5, player: { ...player, sport: 'NBA', stat: 'rush_yds' } }))).toBe('manual')
    expect(challengeSettlementSource(draft({ kind: 'player_stat_over_under', line: 0.5, player: { ...player, sport: 'MLB', stat: 'hr' } }))).toBe('player_stat')
  })
})

describe('per-phase prize rules (gap 2)', () => {
  it('defaults are today’s rules: every type before the merge; no tribe FAAB transfer after it', () => {
    const d = defaultPrizePhaseRules()
    expect(d.pre_merge).toContain('faab_transfer')
    expect(d.post_merge).not.toContain('faab_transfer')
    expect(d.finale).toContain('immunity')
    expect(readPrizePhaseRules({})).toEqual(d)
    expect(readPrizePhaseRules({ survivorPrizePhaseRules: 'junk' })).toEqual(d)
    expect(prizePhaseOf('pre_merge', false)).toBe('pre_merge')
    expect(prizePhaseOf('jury', true)).toBe('post_merge')
    expect(prizePhaseOf('finale', true)).toBe('finale')
  })

  it('validates the commissioner’s rules and refuses a tribe prize after the merge', () => {
    expect(validatePrizePhaseRules({ post_merge: ['faab_transfer'] }, 'en').ok).toBe(false)
    expect(validatePrizePhaseRules({ finale: ['nonsense'] }, 'es')).toMatchObject({ ok: false, error: { code: 'phaseRules' } })
    const ok = validatePrizePhaseRules({ finale: ['immunity', 'score_bonus'] }, 'en')
    expect(ok.ok && ok.rules.finale).toEqual(['score_bonus', 'immunity'])
  })

  it('a challenge prize outside the phase rules is refused with a clear EN/ES reason; immunity stays individual', () => {
    const rules = { ...defaultPrizePhaseRules(), post_merge: ['score_bonus' as const] }
    const err = code({ kind: 'custom_choice', options: ['A', 'B'], prizes: [{ place: 1, rewards: [{ type: 'steal', what: 'faab', amount: 5 }] }] }, ctx({ merged: true, prizePhaseRules: rules }))
    expect(err).toBe('phaseType')
    expect(prizePhaseError('steal', 'post_merge', rules, 'en')!.message).toBe('A steal cannot be given as a prize after the merge (league prize rules).')
    expect(prizePhaseError('steal', 'post_merge', rules, 'es')!.message).toBe('Un robo no se puede dar como premio después de la fusión (reglas de premios de la liga).')
    expect(prizePhaseError('score_bonus', 'post_merge', rules, 'en')).toBeNull()
    expect(code({ kind: 'custom_choice', scope: 'tribe', options: ['A', 'B'], prizes: [{ place: 1, rewards: [{ type: 'immunity' }] }] })).toBe('immunityScope')
    // Defaults change nothing for an ordinary challenge.
    expect(code({ kind: 'custom_choice', options: ['A', 'B'], prizes: [{ place: 1, rewards: [{ type: 'steal', what: 'faab', amount: 5 }] }] }, ctx({ merged: true }))).toBeNull()
  })
})

describe('Chimmy answers the new kinds deterministically, without reading answers', () => {
  it('first TD: stable pick; last score: touchdown; position: best stored median; sweep: a pick per prop; puzzle: sits out', () => {
    const first = draft({ kind: 'first_td_scorer', options: ['A', 'B', 'C'] })
    const a1 = chimmyChallengeAnswer(first, {}, 'c1:r1')
    expect(a1).toEqual(chimmyChallengeAnswer(first, {}, 'c1:r1'))
    expect(chimmyChallengeAnswer(draft({ kind: 'last_score_type' }), {}, 's')).toEqual({ answer: { optionId: 'touchdown' }, wager: null })
    const pos = draft({ kind: 'position_leader', options: [{ playerId: 'p1', label: 'A' }, { playerId: 'p2', label: 'B' }], position: { sport: 'NFL', season: 2026, statWeek: 9, position: 'QB' } })
    expect(chimmyChallengeAnswer(pos, { optionValues: new Map([['p1', [10, 12]], ['p2', [25, 30]]]) }, 's')).toEqual({ answer: { optionId: 'o2' }, wager: null })
    const sweep = draft({ kind: 'sweep', props: [{ question: 'a?', options: ['y', 'n'] }, { question: 'b?', options: ['y', 'n'] }] })
    const s = chimmyChallengeAnswer(sweep, {}, 'seed')!
    expect(Object.keys((s.answer as { picks: Record<string, string> }).picks)).toEqual(['p1', 'p2'])
    expect(validateChallengeAnswer(sweep, s.answer, 'en').ok).toBe(true)
    expect(chimmyChallengeAnswer(draft({ kind: 'puzzle', puzzle: { answer: 'secret' } }), {}, 's')).toBeNull()
  })
})

describe('weekly report rewards line (gap 4)', () => {
  const rec = (status: string, week: number, applyWeek = week) => ({ status, week, applyWeek }) as never
  it('counts paid this week, pending choices and reversals — EN and ES, counts only', () => {
    const rows = [rec('applied', 6), rec('available', 6), rec('deferred', 5, 7), rec('applied', 5, 6), rec('awaiting_choice', 4), rec('reversed', 6), rec('applied', 5)]
    expect(countRewardsForWeek(rows, 6)).toEqual({ paid: 3, pending: 1, reversed: 1 })
    expect(rewardsWeeklyReportLine(rows, 6, 'en')).toBe('Rewards: 3 paid this week, 1 choice pending, 1 reversed. You can choose for a manager in the Commissioner Hub → Rewards.')
    expect(rewardsWeeklyReportLine(rows, 6, 'es')).toMatch(/^Recompensas: 3 pagadas esta semana, 1 elección pendiente, 1 anulada\./)
    expect(rewardsWeeklyReportLine([], 6)).toBeNull()
  })
})

describe('thieves rule helpers (gap 6)', () => {
  it('is off unless the league turns it on; a reversed steal does not count', () => {
    expect(readThievesCannotStealFromEachOther({})).toBe(false)
    expect(readThievesCannotStealFromEachOther({ survivorThievesCannotStealFromEachOther: true })).toBe(true)
    const steal = (rewardId: string, holder: string, status: string, week = 6) => ({ rewardId, type: 'steal', status, week, applyWeek: week, holderRosterIds: [holder] }) as never
    expect(isThiefThisWeek([steal('s1', 'a', 'applied')], 'a', 6)).toBe(true)
    expect(isThiefThisWeek([steal('s1', 'a', 'awaiting_choice')], 'a', 6)).toBe(true)
    expect(isThiefThisWeek([steal('s1', 'a', 'reversed')], 'a', 6)).toBe(false)
    expect(isThiefThisWeek([steal('s1', 'a', 'applied', 5)], 'a', 6)).toBe(false)
    expect(isThiefThisWeek([steal('s1', 'a', 'applied')], 'a', 6, 's1')).toBe(false)
  })
})

describe('Chimmy rules answers know the new reward rules', () => {
  it('mentions post-merge tribe prizes and the thieves rule only when on', () => {
    const base = { sport: 'NFL', settings: {} as never, plan: null, prizes: { winningTribeFaabPerPlayer: 50, topScorerReward: 'none', topScorerAmount: 0, topScorerPowerType: 'extra_vote', tribeTieBreakPosition: 'none', payInTribeWeeksAfterMerge: true } as const }
    const on = answerSurvivorRules('prizes', { ...base, rewardRules: { thievesCannotStealFromEachOther: true } })
    expect(on).toMatch(/also paid in any week where tribes compete/)
    expect(on).toMatch(/Thieves cannot steal from each other/)
    const off = answerSurvivorRules('prizes', { ...base, prizes: { ...base.prizes, payInTribeWeeksAfterMerge: false } })
    expect(off).not.toMatch(/Thieves|where tribes compete/)
    expect(answerSurvivorRules('prizes', { ...base, language: 'es', rewardRules: { thievesCannotStealFromEachOther: true } })).toMatch(/Los ladrones no se roban entre sí/)
  })
})

describe('season preview in Spanish (gap 5)', () => {
  it('builds the whole summary and note in the reader’s language', () => {
    const form = {
      tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_rocks',
      idolCount: 7, hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
      swapEnabled: false, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 8, mergeActivePlayerCount: 7, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true, spectatorPageEnabled: false,
      coCommissionerMode: 'disabled', mergeNamingMode: 'commissioner', juryEnabled: true, tribeChatsEnabled: true, exileHarshTokenLoss: false, houseRules: '',
      winningTribeFaabPerPlayer: 100, topScorerReward: 'faab', topScorerAmount: 50, topScorerPowerType: 'extra_vote', tribeTieBreakPosition: 'none',
      realGameEnabled: true, realGamePerWeek: 2, realGamePrizeType: 'faab', realGamePrizeAmount: 5, challengeFaabWeeklyCap: 40,
      payInTribeWeeksAfterMerge: true, thievesCannotStealFromEachOther: true, prizePhaseRules: defaultPrizePhaseRules(),
    } as const
    const c = { managers: 12, firstWeek: 1, lastWeek: 13 }
    const en = buildSeasonPreview(form as never, c)
    expect(en.summary).toContain('Weekly tribe prize: $100 FAAB per player, $50 more for its top scorer, also in post-merge weeks when tribes compete')
    expect(en.summary).toContain('Thieves cannot steal from each other in the same week')
    const es = buildSeasonPreview(form as never, c, messagesFor(seasonPreviewMessages, 'es'))
    expect(es.summary[0]).toBe('2 tribus de 6, formadas al azar')
    expect(es.summary).toContain('Premio semanal de tribu: $100 de FAAB por jugador, $50 más para su máximo anotador, también en semanas posteriores a la fusión en que compiten tribus')
    expect(es.summary).toContain('Sin intercambio, fusión en la semana 8')
    expect(es.note).toBe('Cada semana un mánager se va a casa. Con 12 mánagers y 13 semanas hay sitio para 3 finalistas más los regresos del Exilio.')
    expect(es.summary.join(' ')).not.toMatch(/tribes of|Weekly tribe prize|managers left/)
  })
})
