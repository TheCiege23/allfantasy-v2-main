// @vitest-environment node
/**
 * Decision OS challenge signals ("locks in 2h and you haven't answered", "you won") and Chimmy's
 * deterministic answers for the seats it runs.
 */
import { describe, expect, it } from 'vitest'
import { deriveSurvivorChallengeSignals } from '@/lib/decision-os/survivorChallengeSignals'
import { chimmyChallengeAnswer, median, nudgeChimmyAnswer } from '@/lib/survivor/survivorChallengeChimmyModel'
import type { ChallengeBuilderConfig } from '@/lib/survivor/survivorChallengeBuilderModel'

const NOW = new Date('2026-11-01T18:00:00Z')
const c = (over: Record<string, unknown> = {}) => ({ challengeId: 'c1', title: 'SNF total', status: 'open', locksAt: '2026-11-01T19:30:00Z', answered: false, scope: 'individual' as const, myResult: null, week: 9, prizeText: '$20 FAAB', ...over })

describe('deriveSurvivorChallengeSignals', () => {
  it('nudges an unanswered challenge: high inside 2h, medium inside a day, nothing otherwise', () => {
    const [urgent] = deriveSurvivorChallengeSignals([{ leagueId: 'L', currentWeek: 9, challenges: [c()] }], NOW)
    expect(urgent).toMatchObject({ id: 'survivor_challenge_due:L:c1', type: 'survivor_challenge_due', severity: 'high', source: 'survivor' })
    expect(urgent!.title).toBe('Challenge "SNF total" locks in 2h and you haven\'t answered')
    expect(deriveSurvivorChallengeSignals([{ leagueId: 'L', currentWeek: 9, challenges: [c({ locksAt: '2026-11-02T10:00:00Z' })] }], NOW)[0]?.severity).toBe('medium')
    expect(deriveSurvivorChallengeSignals([{ leagueId: 'L', currentWeek: 9, challenges: [c({ answered: true }), c({ locksAt: '2026-11-05T00:00:00Z' }), c({ status: 'locked' })] }], NOW)).toEqual([])
  })

  it('says "your tribe" for a tribe challenge, in Spanish when the league is', () => {
    const [s] = deriveSurvivorChallengeSignals([{ leagueId: 'L', currentWeek: 9, language: 'es', challenges: [c({ scope: 'tribe' })] }], NOW)
    expect(s!.title).toMatch(/tu tribu no ha respondido/)
  })

  it('reports a fresh win only', () => {
    const won = deriveSurvivorChallengeSignals([{ leagueId: 'L', currentWeek: 9, challenges: [c({ status: 'complete', myResult: 'won' }), c({ challengeId: 'old', status: 'complete', myResult: 'won', week: 5 })] }], NOW)
    expect(won.map((s) => s.id)).toEqual(['survivor_challenge_won:L:c1'])
  })
})

const cfg = (over: Partial<ChallengeBuilderConfig>): ChallengeBuilderConfig => ({
  builder: 1, kind: 'pick_winner', scope: 'individual', question: '', options: [], game: { sport: 'NFL', homeAbbr: 'KC', awayAbbr: 'BUF', homeLabel: 'Chiefs', awayLabel: 'Bills', kickoff: '2026-11-02T01:20:00Z' },
  player: null, line: null, prizes: [], deferWeeks: 0, missPenalty: null, wager: null, uniqueAnswers: false, sealed: false, allOverRule: 'closest_overall',
  opensAt: '', locksAt: '', ...over,
})

describe('chimmyChallengeAnswer', () => {
  it('picks the better stored record, home on a tie', () => {
    expect(chimmyChallengeAnswer(cfg({}), { records: new Map([['BUF', { wins: 6, losses: 1 }], ['KC', { wins: 4, losses: 3 }]]) }, 's')?.answer).toEqual({ optionId: 'BUF' })
    expect(chimmyChallengeAnswer(cfg({}), {}, 's')?.answer).toEqual({ optionId: 'KC' })
  })

  it('estimates totals from stored finals (median), shading down without going over', () => {
    expect(median([40, 50, 44])).toBe(44)
    expect(chimmyChallengeAnswer(cfg({ kind: 'game_total_closest' }), { recentTotals: [40, 50, 44] }, 's')?.answer).toEqual({ value: 44 })
    expect(chimmyChallengeAnswer(cfg({ kind: 'closest_without_going_over' }), { recentTotals: [40, 50, 44] }, 's')?.answer).toEqual({ value: 41 })
    expect(chimmyChallengeAnswer(cfg({ kind: 'game_total_closest' }), {}, 's')?.answer).toEqual({ value: 44 })
    expect(chimmyChallengeAnswer(cfg({ kind: 'game_total_over_under', line: 47.5 }), { recentTotals: [50, 52] }, 's')?.answer).toEqual({ optionId: 'over' })
  })

  it('player props from the player’s stored weeks; stakes the minimum; sits out a custom number', () => {
    const player = { playerId: 'p', playerName: 'P', sport: 'NFL', season: 2026, statWeek: 9, stat: 'total_td' as const }
    expect(chimmyChallengeAnswer(cfg({ kind: 'anytime_td', player, game: null }), { playerValues: [1, 0, 2, 0] }, 's')?.answer).toEqual({ optionId: 'yes' })
    expect(chimmyChallengeAnswer(cfg({ kind: 'anytime_td', player, game: null }), { playerValues: [0, 0, 1] }, 's')?.answer).toEqual({ optionId: 'no' })
    expect(chimmyChallengeAnswer(cfg({ wager: { currency: 'points', min: 5, max: 50, winMultiplier: 1, lossFraction: 1 } }), {}, 's')?.wager).toBe(5)
    expect(chimmyChallengeAnswer(cfg({ kind: 'custom_number' }), {}, 's')).toBeNull()
    const choice = cfg({ kind: 'custom_choice', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }], game: null })
    expect(chimmyChallengeAnswer(choice, {}, 'seed-1')).toEqual(chimmyChallengeAnswer(choice, {}, 'seed-1'))
  })

  it('nudges a taken number +1, −1, +2…', () => {
    const base = { answer: { value: 44 }, wager: null }
    const conf = cfg({ kind: 'game_total_closest' })
    expect([1, 2, 3].map((i) => nudgeChimmyAnswer(conf, base, i)?.answer)).toEqual([{ value: 45 }, { value: 43 }, { value: 46 }])
    expect(nudgeChimmyAnswer(cfg({}), { answer: { optionId: 'KC' }, wager: null }, 1)).toBeNull()
  })
})
