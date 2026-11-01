// @vitest-environment node
/**
 * The challenge builder's pure half: validation (server and screen share it), Eastern wall time,
 * scoring (closest with shared ties, closest without going over, right-or-wrong), the payout plan
 * (stable keys, tribe recipients, FAAB from the other tribes, wagers, miss penalties, deferral,
 * immunity) and the host's words in English and Spanish.
 */
import { describe, expect, it } from 'vitest'
import {
  choiceTruthFromNumber, clockStatus, describeChallengePrizes, easternWallTimeToUtc, editAfterAnswersError, faabPerWinner,
  challengeOpenLine, challengeResultLine, planChallengePayouts, readChallengeBuilderConfig, readChallengeFaabWeeklyCap, scoreChallenge,
  utcToEasternWallTime, validateChallengeAnswer, validateChallengeDraft, type ChallengeBuilderConfig, type ChallengeDraftContext, type ChallengeEntry,
} from '@/lib/survivor/survivorChallengeBuilderModel'

const NOW = new Date('2026-11-01T15:00:00Z')
const ctx = (over: Partial<ChallengeDraftContext> = {}): ChallengeDraftContext => ({ now: NOW, currentWeek: 9, merged: false, lang: 'en', faabWeeklyCap: 40, otherFaabThisWeek: 0, ...over })
const game = { sport: 'NFL', homeAbbr: 'KC', awayAbbr: 'BUF', homeLabel: 'Chiefs', awayLabel: 'Bills', kickoff: '2026-11-02T01:20:00Z' }
const base = {
  title: 'SNF total', question: 'Guess the combined score.', kind: 'game_total_closest', scope: 'tribe', week: 9,
  opensAt: '2026-11-01T10:00', locksAt: '2026-11-01T20:00', game,
  prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 20 }] }],
}
const valid = (over: Record<string, unknown> = {}, c = ctx()) => {
  const r = validateChallengeDraft({ ...base, ...over }, c)
  if (!r.ok) throw new Error(r.error.message)
  return r.draft
}
const errorCode = (over: Record<string, unknown>, c = ctx()) => {
  const r = validateChallengeDraft({ ...base, ...over }, c)
  return r.ok ? null : r.error.code
}

describe('Eastern wall time', () => {
  it('converts both ways across daylight saving', () => {
    // EDT (UTC-4) before Nov 1 2026 02:00, EST (UTC-5) after.
    expect(easternWallTimeToUtc('2026-10-31T20:00')!.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(easternWallTimeToUtc('2026-11-02T20:00')!.toISOString()).toBe('2026-11-03T01:00:00.000Z')
    expect(utcToEasternWallTime('2026-11-03T01:00:00.000Z')).toBe('2026-11-02T20:00')
    expect(easternWallTimeToUtc('not a time')).toBeNull()
    expect(easternWallTimeToUtc('2026-13-01T10:00')).toBeNull()
  })
})

describe('validateChallengeDraft', () => {
  it('accepts the original league’s tribe game-total challenge and stores UTC instants', () => {
    const d = valid({ uniqueAnswers: true })
    expect(d.config).toMatchObject({ kind: 'game_total_closest', scope: 'tribe', uniqueAnswers: true, opensAt: '2026-11-01T15:00:00.000Z', locksAt: '2026-11-02T01:00:00.000Z' })
    expect(d.faabPerWinner).toBe(20)
  })

  it('refuses every bad field with its own reason', () => {
    expect(errorCode({ title: '' })).toBe('title')
    expect(errorCode({ question: 'x'.repeat(1001) })).toBe('question')
    expect(errorCode({ kind: 'coin_flip' })).toBe('kind')
    expect(errorCode({ scope: 'everyone' })).toBe('scope')
    expect(errorCode({ scope: 'tribe' }, ctx({ merged: true }))).toBe('tribeAfterMerge')
    expect(errorCode({ week: 3 })).toBe('week')
    expect(errorCode({ locksAt: '2026-11-01T09:00' })).toBe('times')
    expect(errorCode({ opensAt: '2026-10-30T09:00', locksAt: '2026-10-31T09:00' })).toBe('lockPast')
    expect(errorCode({ game: null })).toBe('game')
    expect(errorCode({ locksAt: '2026-11-01T23:00' })).toBe('gameLock')
    expect(errorCode({ prizes: [] })).toBe('prizes')
    expect(errorCode({ prizes: [{ place: 6, rewards: [{ type: 'faab_grant', amount: 1 }] }] })).toBe('prizes')
    expect(errorCode({ prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 0 }] }] })).toBe('reward')
    expect(errorCode({ scope: 'individual', prizes: [{ place: 1, rewards: [{ type: 'faab_transfer', amount: 50 }] }] })).toBe('transferScope')
    expect(errorCode({ prizes: [{ place: 1, rewards: [{ type: 'immunity' }] }] })).toBe('immunityScope')
    expect(errorCode({ deferWeeks: 9 })).toBe('defer')
    expect(errorCode({ missPenalty: { type: 'score_penalty', points: 20 } })).toBe('penalty')
    expect(errorCode({ wager: { currency: 'points', min: 5, max: 50 } })).toBe('wagerKind')
  })

  it('enforces the weekly challenge FAAB cap, $40 by default and set by the commissioner', () => {
    expect(errorCode({ prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 50 }] }] })).toBe('faabCap')
    expect(errorCode({ prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 30 }] }] }, ctx({ otherFaabThisWeek: 15 }))).toBe('faabCap')
    expect(errorCode({ prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 50 }] }] }, ctx({ faabWeeklyCap: 100 }))).toBeNull()
    expect(readChallengeFaabWeeklyCap(null)).toBe(40)
    expect(readChallengeFaabWeeklyCap({ survivorChallengeFaabWeeklyCap: 100 })).toBe(100)
    expect(readChallengeFaabWeeklyCap({ survivorChallengeFaabWeeklyCap: 0 })).toBe(40)
    expect(faabPerWinner([{ place: 1, rewards: [{ type: 'faab_grant', amount: 10 }, { type: 'faab_grant', amount: 5 }] }, { place: 2, rewards: [{ type: 'faab_grant', amount: 12 }] }])).toBe(15)
  })

  it('builds options for O/U, anytime TD and pick-the-winner; other sports keep the kinds (settled by hand where nothing is stored)', () => {
    expect(valid({ kind: 'pick_winner', scope: 'individual' }).config.options.map((o) => o.id)).toEqual(['BUF', 'KC'])
    expect(valid({ kind: 'game_total_over_under', line: 47.5 }).config.options.map((o) => o.id)).toEqual(['over', 'under'])
    expect(errorCode({ kind: 'game_total_over_under' })).toBe('line')
    const player = { playerId: 'p1', playerName: 'Josh Allen', sport: 'NFL', season: 2026, statWeek: 9 }
    expect(valid({ kind: 'anytime_td', scope: 'individual', player }).config.player?.stat).toBe('total_td')
    // Gap 8: no longer refused — an NBA anytime TD / rush-yards prop is kept and settled by the commissioner.
    expect(errorCode({ kind: 'anytime_td', scope: 'individual', player: { ...player, sport: 'NBA' } })).toBeNull()
    expect(errorCode({ kind: 'player_stat_over_under', scope: 'individual', line: 20, player: { ...player, sport: 'NBA', stat: 'rush_yds' } })).toBeNull()
    // A sport's own stat only on that sport.
    expect(errorCode({ kind: 'player_stat_over_under', scope: 'individual', line: 20, player: { ...player, sport: 'NFL', stat: 'reb' } })).toBe('player')
    expect(errorCode({ kind: 'player_stat_over_under', line: 20, player: { ...player, sport: 'NBA', stat: 'fantasy_points' } })).toBeNull()
    expect(errorCode({ kind: 'custom_choice', options: ['A', 'a'] })).toBe('options')
    expect(errorCode({ kind: 'pick_winner', prizes: [{ place: 2, rewards: [{ type: 'score_bonus', points: 5 }] }] })).toBe('choicePlaces')
  })

  it('speaks Spanish when the league does', () => {
    const r = validateChallengeDraft({ ...base, title: '' }, ctx({ lang: 'es' }))
    expect(r.ok ? '' : r.error.message).toMatch(/Ponle un título/)
  })

  it('once answers are in, only words, prizes and a later lock may change', () => {
    const prev = valid().config
    expect(editAfterAnswersError(prev, { ...prev, prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 50 }] }] }, 'en')).toBeNull()
    expect(editAfterAnswersError(prev, { ...prev, uniqueAnswers: true }, 'en')?.code).toBe('answered')
    expect(editAfterAnswersError(prev, { ...prev, locksAt: '2026-11-01T18:00:00.000Z' }, 'en')?.code).toBe('answered')
  })
})

describe('answers', () => {
  it('validates numbers, options and stakes', () => {
    const cfg = valid().config
    expect(validateChallengeAnswer(cfg, { value: '47' }, 'en')).toEqual({ ok: true, submission: { answer: { value: 47 }, wager: null } })
    expect(validateChallengeAnswer(cfg, { value: -3 }, 'en').ok).toBe(false)
    const ou = valid({ kind: 'game_total_over_under', line: 47.5, wager: { currency: 'faab', min: 5, max: 20 } }).config
    expect(validateChallengeAnswer(ou, { optionId: 'over', wager: 10 }, 'en').ok).toBe(true)
    expect(validateChallengeAnswer(ou, { optionId: 'over', wager: 25 }, 'en').ok).toBe(false)
    expect(validateChallengeAnswer(ou, { optionId: 'sideways', wager: 10 }, 'es')).toEqual({ ok: false, error: 'Elige una de las opciones.' })
  })
})

const entry = (entrantId: string, answer: ChallengeEntry['submission']['answer'], at = '2026-11-01T16:00:00Z', wager: number | null = null): ChallengeEntry => ({ entrantId, submission: { answer, wager }, submittedAt: at })

describe('scoreChallenge', () => {
  it('closest: dense places, and a tie blesses both', () => {
    const cfg = valid().config
    const s = scoreChallenge(cfg, [entry('t1', { value: 44 }), entry('t2', { value: 50 }), entry('t3', { value: 52 }), entry('t4', { value: 60 })], { value: 51 })
    expect(s.places).toEqual([{ place: 1, entrantIds: ['t2', 't3'] }, { place: 2, entrantIds: ['t1'] }, { place: 3, entrantIds: ['t4'] }])
  })

  it('closest without going over: over is out while anyone is under; all over follows the rule', () => {
    const cfg = valid({ kind: 'closest_without_going_over', scope: 'individual', game: null }).config
    const s = scoreChallenge(cfg, [entry('a', { value: 40 }), entry('b', { value: 46 }), entry('c', { value: 44 })], { value: 45 })
    expect(s.places.map((p) => p.entrantIds)).toEqual([['c'], ['a']])
    const allOver = scoreChallenge(cfg, [entry('a', { value: 50 }), entry('b', { value: 47 })], { value: 45 })
    expect(allOver.places[0]?.entrantIds).toEqual(['b'])
    const noWinner = scoreChallenge({ ...cfg, allOverRule: 'no_winner' }, [entry('a', { value: 50 })], { value: 45 })
    expect(noWinner.places).toEqual([])
    // Equal guesses: the earliest submission wins (original league).
    const tie = scoreChallenge(cfg, [entry('late', { value: 44 }, '2026-11-01T18:00:00Z'), entry('early', { value: 44 }, '2026-11-01T16:00:00Z')], { value: 45 })
    expect(tie.places[0]?.entrantIds).toEqual(['early'])
  })

  it('right-or-wrong: everyone right shares first; push is void', () => {
    const cfg = valid({ kind: 'game_total_over_under', line: 47.5 }).config
    const s = scoreChallenge(cfg, [entry('t1', { optionId: 'over' }), entry('t2', { optionId: 'under' }), entry('t3', { optionId: 'over' })], { optionId: 'over' })
    expect(s).toMatchObject({ correctIds: ['t1', 't3'], wrongIds: ['t2'], places: [{ place: 1, entrantIds: ['t1', 't3'] }] })
    expect(choiceTruthFromNumber('game_total_over_under', 47.5, 47.5)).toBe('void')
    expect(choiceTruthFromNumber('game_total_over_under', 50, 47.5)).toEqual({ optionId: 'over' })
    expect(choiceTruthFromNumber('anytime_td', 1, null)).toEqual({ optionId: 'yes' })
    expect(choiceTruthFromNumber('anytime_td', 0, null)).toEqual({ optionId: 'no' })
  })
})

describe('planChallengePayouts', () => {
  const recipients = new Map([['t1', ['r2', 'r1']], ['t2', ['r3', 'r4']], ['t3', ['r5']]])

  it('pays every member of a winning tribe, with stable keys that include the round', () => {
    const cfg = valid().config
    const score = scoreChallenge(cfg, [entry('t1', { value: 50 }), entry('t2', { value: 30 })], { value: 51 })
    const plan = planChallengePayouts(cfg, score, [], { challengeId: 'c1', week: 9, round: 0, recipients, activeTribeIds: ['t1', 't2', 't3'] })
    expect(plan.map((p) => p.key)).toEqual(['cb:c1:r0:p1:0:r1', 'cb:c1:r0:p1:0:r2'])
    expect(plan.every((p) => p.kind === 'reward' && p.spec.type === 'faab_grant' && p.spec.amount === 20)).toBe(true)
    const again = planChallengePayouts(cfg, score, [], { challengeId: 'c1', week: 9, round: 1, recipients, activeTribeIds: ['t1', 't2', 't3'] })
    expect(again[0]!.key).toBe('cb:c1:r1:p1:0:r1')
  })

  it('takes FAAB from every tribe that did not place, defers when asked', () => {
    const cfg = valid({ deferWeeks: 1, prizes: [{ place: 1, rewards: [{ type: 'faab_transfer', amount: 50 }] }] }).config
    const score = { places: [{ place: 1, entrantIds: ['t1'] }], correctIds: ['t1'], wrongIds: [], ranked: [] }
    const plan = planChallengePayouts(cfg, score, [], { challengeId: 'c1', week: 9, round: 0, recipients, activeTribeIds: ['t1', 't2', 't3'] })
    expect(plan.map((p) => (p.kind === 'reward' ? p.spec : null))).toEqual([
      { type: 'faab_transfer', fromTribeId: 't2', toTribeId: 't1', amount: 50, basis: 'per_member' },
      { type: 'faab_transfer', fromTribeId: 't3', toTribeId: 't1', amount: 50, basis: 'per_member' },
    ])
    expect(plan.every((p) => p.kind === 'reward' && p.deferToWeek === 10)).toBe(true)
  })

  it('wagers win or lose, misses cost, and immunity is planned per roster', () => {
    const cfg = valid({ kind: 'pick_winner', scope: 'individual', wager: { currency: 'points', min: 5, max: 50, winMultiplier: 1.5, lossFraction: 0.5 }, missPenalty: { type: 'faab_penalty', amount: 5 }, prizes: [{ place: 1, rewards: [{ type: 'immunity' }] }] }).config
    const entries = [entry('ra', { optionId: 'KC' }, undefined, 20), entry('rb', { optionId: 'BUF' }, undefined, 10)]
    const score = scoreChallenge(cfg, entries, { optionId: 'KC' })
    const plan = planChallengePayouts(cfg, score, entries, { challengeId: 'c', week: 9, round: 0, recipients: new Map([['ra', ['ra']], ['rb', ['rb']]]) })
    expect(plan).toEqual([
      { key: 'cb:c:r0:p1:0:ra:imm', kind: 'immunity', entrantId: 'ra', place: 1, reason: 'prize', rosterId: 'ra' },
      expect.objectContaining({ reason: 'wager_win', spec: { type: 'score_bonus', rosterId: 'ra', points: 30 } }),
      expect.objectContaining({ reason: 'wager_loss', spec: { type: 'score_penalty', rosterId: 'rb', points: 5 } }),
      expect.objectContaining({ reason: 'miss', spec: { type: 'faab_penalty', rosterId: 'rb', amount: 5 } }),
    ])
  })

  it('a choice prize becomes the reward API’s choice (points on a tribemate, a steal)', () => {
    const cfg = valid({ kind: 'pick_winner', scope: 'individual', prizes: [{ place: 1, rewards: [{ type: 'tribemate_points', points: 100 }, { type: 'steal', what: 'faab', amount: 20 }] }] }).config
    const score = { places: [{ place: 1, entrantIds: ['ra'] }], correctIds: ['ra'], wrongIds: [], ranked: [] }
    const plan = planChallengePayouts(cfg, score, [], { challengeId: 'c', week: 9, round: 0, recipients: new Map([['ra', ['ra']]]) })
    expect(plan.map((p) => (p.kind === 'reward' ? p.spec : null))).toEqual([
      { type: 'tribemate_points', chooserRosterId: 'ra', points: 100 },
      { type: 'steal', thiefRosterId: 'ra', what: 'faab', amount: 20 },
    ])
  })
})

describe('words', () => {
  it('describes prizes and host lines in both languages, and keeps sealed immunity sealed', () => {
    const cfg = valid({ deferWeeks: 1 }).config
    expect(describeChallengePrizes(cfg, 'en', 9)).toBe('$20 FAAB per player (pays in week 10)')
    expect(describeChallengePrizes(cfg, 'es', 9)).toBe('$20 de FAAB por jugador (se paga en la semana 10)')
    expect(challengeOpenLine({ title: 'SNF', config: cfg, week: 9, lang: 'es' })).toMatch(/^🔥 Nuevo reto: SNF\. Una respuesta por tribu.*ET\. Premio:/)
    const sealed = challengeResultLine({ title: 'Finale', truthLabel: '45', winnerNames: ['Ana'], voided: false, sealedImmunity: true, lang: 'en' })
    expect(sealed).not.toMatch(/Ana/)
    expect(challengeResultLine({ title: 'Finale', truthLabel: '45', winnerNames: ['Ana'], voided: false, sealedImmunity: false, lang: 'en' })).toMatch(/Winners: Ana/)
  })

  it('reads stored configs back and computes the clock status', () => {
    const cfg = valid().config
    expect(readChallengeBuilderConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg as ChallengeBuilderConfig)
    expect(readChallengeBuilderConfig({ kind: 'x' })).toBeNull()
    expect(clockStatus('scheduled', cfg.opensAt, cfg.locksAt, new Date('2026-11-01T13:00:00Z'))).toBe('scheduled')
    expect(clockStatus('scheduled', cfg.opensAt, cfg.locksAt, new Date('2026-11-01T15:00:00Z'))).toBe('open')
    expect(clockStatus('open', cfg.opensAt, cfg.locksAt, new Date('2026-11-02T02:00:00Z'))).toBe('locked')
    expect(clockStatus('complete', cfg.opensAt, cfg.locksAt, NOW)).toBe('complete')
  })
})
