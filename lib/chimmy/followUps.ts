/**
 * The next questions worth asking, after an answer — deterministic, no model call.
 *
 * ⚠ ONLY QUESTIONS CHIMMY CAN ACTUALLY ANSWER. A chip is a promise: tapping it and getting "I can't
 * see that" teaches the user the chips are decoration. Every suggestion here maps to a tool in
 * `chimmyTools.ts` that computes it from the user's own league.
 *
 * ⚠ THEY FILL THE COMPOSER, THEY DO NOT SEND. Sending spends tokens, and a tap is not consent to
 * spend — the same rule the drawer's quick prompts already follow.
 *
 * Pure, so the route and the tests share one table.
 */

export const MAX_FOLLOW_UPS = 3

type Suggestion = { text: string; /** Tools whose answer this question would repeat. */ repeats: readonly string[] }

const LINEUP: Suggestion = { text: 'Set my best lineup for this week', repeats: ['optimize_my_lineup'] }
const MATCHUP: Suggestion = { text: 'How does my matchup look this week?', repeats: ['get_my_matchup'] }
const PLAYOFFS: Suggestion = { text: 'What are my playoff odds?', repeats: ['get_playoff_outlook'] }
const RAISE_ODDS: Suggestion = { text: 'What moves would raise my playoff odds?', repeats: [] }
const PICKUP: Suggestion = {
  text: 'Who is the best pickup for my weakest spot?',
  repeats: ['get_available_players', 'evaluate_waiver_move'],
}
const COUNTER: Suggestion = { text: 'What counter-offer would make this trade better for me?', repeats: [] }
const ROOT_FOR: Suggestion = { text: 'Who should I root against this week?', repeats: [] }
const INJURIES: Suggestion = { text: "Who's hurt on my teams?", repeats: ['get_my_injuries'] }
const FIND_TRADE: Suggestion = { text: 'Find me a trade that fills my weakest spot', repeats: ['find_trade_ideas'] }
const GRADE_IDEA: Suggestion = { text: 'Grade the first trade idea for my lineup', repeats: ['evaluate_trade'] }

const ACROSS_ODDS: Suggestion = { text: 'How are my playoff odds across all my leagues?', repeats: ['get_playoff_outlook'] }
const ACROSS_CLOSE: Suggestion = { text: 'Which of my matchups are coin flips this week?', repeats: ['get_my_matchup'] }

/** After each tool, what an analyst would ask next — most useful first. */
const AFTER: Record<string, readonly Suggestion[]> = {
  optimize_my_lineup: [MATCHUP, PICKUP, PLAYOFFS],
  compare_start_options: [LINEUP, MATCHUP, PICKUP],
  evaluate_trade: [COUNTER, FIND_TRADE, LINEUP],
  find_trade_ideas: [GRADE_IDEA, LINEUP, PLAYOFFS],
  get_league_trade_activity: [COUNTER, LINEUP, PLAYOFFS],
  get_league_trade_history: [FIND_TRADE, LINEUP, PLAYOFFS],
  get_player_value: [COUNTER, LINEUP, PLAYOFFS],
  evaluate_waiver_move: [LINEUP, MATCHUP, PLAYOFFS],
  get_available_players: [LINEUP, MATCHUP, PLAYOFFS],
  get_playoff_outlook: [RAISE_ODDS, ROOT_FOR, LINEUP],
  get_my_matchup: [LINEUP, PLAYOFFS, INJURIES],
  get_my_injuries: [LINEUP, PICKUP, MATCHUP],
  get_my_roster: [LINEUP, FIND_TRADE, PICKUP],
  get_league_standings: [PLAYOFFS, MATCHUP, LINEUP],
}

const DEFAULT_SCOPED: readonly Suggestion[] = [LINEUP, PLAYOFFS, MATCHUP]
const DEFAULT_GLOBAL: readonly Suggestion[] = [ACROSS_ODDS, ACROSS_CLOSE, INJURIES]

/**
 * Up to three follow-ups for an answer that used `toolsUsed`.
 *
 * The LAST analyst tool decides the table (it is what the answer was about); a question that would
 * simply re-run a tool already used in this answer is dropped.
 */
export function suggestChimmyFollowUps(args: { toolsUsed: readonly string[]; leagueScoped: boolean }): string[] {
  const used = new Set(args.toolsUsed)
  const driver = [...args.toolsUsed].reverse().find((t) => AFTER[t])
  const candidates = driver ? AFTER[driver]! : args.leagueScoped ? DEFAULT_SCOPED : DEFAULT_GLOBAL
  /*
   * Without a league in scope, a league-only question ("set my lineup") cannot be answered until one
   * is picked — so the cross-league questions stand in for the scoped ones.
   */
  const pool = args.leagueScoped
    ? candidates
    : candidates.map((s) => (s === PLAYOFFS ? ACROSS_ODDS : s === MATCHUP ? ACROSS_CLOSE : s)).filter(
        (s) =>
          s !== LINEUP && s !== PICKUP && s !== COUNTER && s !== RAISE_ODDS && s !== ROOT_FOR && s !== FIND_TRADE && s !== GRADE_IDEA,
      )
  const out: string[] = []
  for (const s of [...pool, ...(args.leagueScoped ? DEFAULT_SCOPED : DEFAULT_GLOBAL)]) {
    if (out.length >= MAX_FOLLOW_UPS) break
    if (s.repeats.some((t) => used.has(t))) continue
    if (!out.includes(s.text)) out.push(s.text)
  }
  return out
}

/** Client-side guard: only short strings survive, at most three. */
export function readFollowUps(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 120)
    .slice(0, MAX_FOLLOW_UPS)
  return out.length ? out : null
}
