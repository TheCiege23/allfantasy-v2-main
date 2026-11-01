/**
 * Chimmy's answers to commissioner challenges, for the seats it runs. Pure and deterministic: the
 * same stored facts always give the same answer, and Chimmy never reads anyone else's answer (it
 * learns an answer is taken only the way a manager does — the submit refuses it, and it nudges).
 *
 *  - Pick the winner: the team with the better stored record this season (finals in `SportsGame`);
 *    a tie goes to the home team.
 *  - A game total (closest, over/under): the median of recent stored final totals involving either
 *    team, or the sport's typical total when nothing is stored. Closest without going over shades
 *    the estimate down 5% so it is less likely to go over.
 *  - A player over/under: the player's stored average for that stat this season against the line.
 *    Anytime TD: "yes" when the player scored in at least half their stored weeks.
 *  - A custom multiple choice: a stable pick from the challenge and seat ids (no favourite exists).
 *    A custom number: Chimmy sits it out — there is nothing stored to base a number on.
 *  - A wager: the minimum stake. Chimmy plays safe with a seat it does not own.
 */

import { challengeInputKind, type ChallengeBuilderConfig, type ChallengeSubmission } from './survivorChallengeBuilderModel'

export const CHIMMY_TYPICAL_TOTAL: Record<string, number> = { NFL: 44, NCAAF: 52, NBA: 226, NCAAB: 142, NHL: 6, MLB: 9, SOCCER: 3 }

export type ChimmyChallengeFacts = {
  /** Stored wins/losses this season, keyed by team abbreviation. */
  records?: ReadonlyMap<string, { wins: number; losses: number }>
  /** Recent stored final totals (home + away) for games involving either team. */
  recentTotals?: readonly number[]
  /** The player's stored values for the stat, one per week. */
  playerValues?: readonly number[]
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

function stableIndex(seed: string, n: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return Math.abs(h) % Math.max(1, n)
}

const winPct = (r?: { wins: number; losses: number }) => (r && r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0.5)

/** Chimmy's answer, or null when it sits this one out. `seed` = challenge id + seat roster id. */
export function chimmyChallengeAnswer(config: ChallengeBuilderConfig, facts: ChimmyChallengeFacts, seed: string): ChallengeSubmission | null {
  const wager = config.wager ? config.wager.min : null
  const sport = config.game?.sport ?? config.player?.sport ?? 'NFL'
  const estimate = () => Math.round(median(facts.recentTotals ?? []) ?? CHIMMY_TYPICAL_TOTAL[sport] ?? 40)
  switch (config.kind) {
    case 'pick_winner': {
      if (!config.game) return null
      const home = winPct(facts.records?.get(config.game.homeAbbr))
      const away = winPct(facts.records?.get(config.game.awayAbbr))
      return { answer: { optionId: away > home ? config.game.awayAbbr : config.game.homeAbbr }, wager }
    }
    case 'game_total_closest':
      return { answer: { value: estimate() }, wager }
    case 'closest_without_going_over':
      return { answer: { value: Math.max(0, Math.floor(estimate() * 0.95)) }, wager }
    case 'game_total_over_under':
      if (config.line == null) return null
      return { answer: { optionId: estimate() > config.line ? 'over' : 'under' }, wager }
    case 'player_stat_over_under': {
      if (config.line == null) return null
      const avg = median(facts.playerValues ?? [])
      if (avg == null) return { answer: { optionId: 'under' }, wager }
      return { answer: { optionId: avg > config.line ? 'over' : 'under' }, wager }
    }
    case 'anytime_td': {
      const weeks = facts.playerValues ?? []
      const scored = weeks.filter((n) => n > 0).length
      return { answer: { optionId: weeks.length && scored * 2 >= weeks.length ? 'yes' : 'no' }, wager }
    }
    case 'custom_choice':
      return config.options.length ? { answer: { optionId: config.options[stableIndex(seed, config.options.length)]!.id }, wager } : null
    case 'custom_number':
      return null
  }
}

/** The next answer to try when Chimmy's was taken (uniqueness rule): +1, −1, +2, −2… for numbers. */
export function nudgeChimmyAnswer(config: ChallengeBuilderConfig, base: ChallengeSubmission, attempt: number): ChallengeSubmission | null {
  if (challengeInputKind(config.kind) !== 'number' || !('value' in base.answer)) return null
  const step = Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1)
  const value = base.answer.value + step
  return value >= 0 ? { answer: { value }, wager: base.wager } : null
}
