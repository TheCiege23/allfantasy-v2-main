import type { InsightType } from '@/lib/ai-simulation-integration/types'

/**
 * How `/api/chat/chimmy` reads a question before any model sees it: which of
 * five coarse intents it is, and whether answering it needs the asker's league.
 *
 * Lifted out of the route so it can be exercised directly. It used to be
 * module-private, and because importing the route in a test times out, every
 * test of it read the route's SOURCE and `eval`'d a regex copied out of it —
 * which checked one pattern at a time and never the function that combines them.
 * `__tests__/chimmy-eval/` now drives these with real questions.
 *
 * 🛑 THE INTENT IS NOT A LABEL. `trade`, `waiver` and `roster` each HARD-REQUIRE
 * league context (`requiresLeagueGrounding`), so a question misread into one of
 * them is refused with a 412 for anyone with no league selected — before any
 * answer path runs. A false positive here is a refusal, not a slightly worse
 * answer.
 */

export type PecrIntent = 'trade' | 'waiver' | 'roster' | 'draft' | 'general'

/*
 * 🛑 EVERY TERM HERE WAS AN UNBOUNDED SUBSTRING, AND PLAYER NAMES ARE FULL OF THEM.
 * `add` fired inside "Ladd McConkey", `deal` inside "ideal", `give` inside
 * "given", `receiv` inside "wide receiver", `pick` inside "George Pickens",
 * `rank` inside "Frank", `flex` inside "superflex", `bench` inside "benchmark",
 * `sit` inside "deposit". The first four landed in `trade`/`waiver`, so "Is Ladd
 * McConkey a WR1?" and "who is the best wide receiver this year?" were refused
 * as team-specific planning requests. Measured 2026-09-16 by running the
 * patterns over ordinary questions; nothing had ever tested the combined
 * function, only the patterns one at a time.
 *
 * Inflections are enumerated rather than globbed with `\w*`, for the reason the
 * orchestration classifier already records: `add\w*` matches "address".
 *
 * ⚠ `give` EXCLUDES "give me" / "give us". "What would you give for Puka?" is a
 * trade question; "give me your TE tiers" is a request, and it is one of the
 * commonest ways anybody opens a question at all.
 *
 * ⚠ "ACCEPT OR DECLINE: MY KELCE FOR HIS BOWERS?" READ AS `general` (eval gap, 2026-09-16): the
 * verdict vocabulary was missing, so a trade question reached the model with no league. Only the
 * PAIRED form is added — a bare `decline` is "is Kelce in decline?", a player question that would
 * then 412 for anyone without a league selected.
 */
const TRADE_INTENT =
  /\b(?:trade[sd]?|trading|swap(?:s|ped|ping)?|offer(?:s|ed|ing)?|counteroffers?|deals?|give(?!\s+(?:me|us)\b)|receive[sd]?|accept\s+or\s+(?:decline|reject))\b/i

/*
 * ⚠ `pickup` MATCHED ONLY THE CLOSED COMPOUND, so "who can I pick up?" — the
 * most natural way to ask this — fell through to the draft branch below on the
 * bare word `pick`, and intent `draft` does not force league grounding unless
 * the message also says "draft order" or "in MY league". The one question
 * `get_available_players` exists for could never reach it.
 *
 * Third time this exact shape has bitten: `hrs?` in the stat guard and bare
 * `start` in ROSTER_INTENT. The formal spelling was covered and the human one
 * was not.
 */
/*
 * ⚠ AND THE BIDDING VOCABULARY WAS MISSING TOO. "How much FAAB should I bid
 * on him?" and "should I claim him?" are the questions this branch exists for
 * — they are asking about waiver MECHANICS, the exact thing we cannot see and
 * must refuse honestly — and neither matched, so both fell through to
 * `general` and never even acquired league context. The refusal could not
 * fire because the question never reached the surface that would refuse.
 *
 * `claim` is deliberately narrow: bare `claim` also means "claim my team",
 * which is an import action, so it is scoped to a player pronoun.
 *
 * `free agency` is deliberately absent: it is the NFL's offseason signing
 * period, a real-world question, and this branch hard-requires a league.
 */
const WAIVER_INTENT =
  /\b(?:waivers?|wire|pick\s*ups?|picking\s+up|picked\s+up|drop(?:s|ped|ping)?|add(?:s|ed|ing)?|free.?agents?|faab|bids?|bidding)\b|\bclaim\s+(?:him|her|them)\b/i

/*
 * ⚠ `start` MADE "WHEN DOES THE SEASON START?" A ROSTER QUESTION, and a roster
 * intent hard-requires league context — so one of the most ordinary questions
 * anybody can ask came back as a 412 telling them to open a league. Measured
 * against production: "When does the college football season start?" 412'd.
 *
 * The word is meant as "start a player". It is also the ordinary English verb,
 * and it appears in "season start", "when do the playoffs start", "start of the
 * week". Requiring a lineup-shaped neighbour keeps the fantasy sense and drops
 * the calendar one. `sit` and `bench` need no such guard — they have no common
 * schedule meaning.
 *
 * ⚠ THE ONE PLACE A BARE `start` IS SAFE IS THE FIRST WORD, and it is also the
 * shortest way to ask: "Start Bijan or Gibbs?" matched nothing above and read as
 * `general`. A question that OPENS with the verb is an imperative about a player;
 * the calendar sense ("start time", "start date", "start of the season") is
 * excluded by name.
 */
export const ROSTER_INTENT =
  /\b(?:roster(?:s|ed|ing)?|line-?ups?|sit|sitting|bench(?:ed|ing)?|flex)\b|\bstarts?\s+(?:him|her|them|over|instead)\b|\b(?:who|should\s+i|do\s+i|would\s+you|who\s+to)\s+start\b|\bstart\s*\/?\s*sit\b|^\s*(?:start|sit)\s+(?!(?:of|in|on|at|date|dates|time|times)\b)\w/i

const DRAFT_INTENT = /\b(?:draft\w*|picks?|picked|picking|adps?|tier(?:s|ed)?|rank\w*)\b/i

export function classifyPecrIntent(message: string): PecrIntent {
  if (TRADE_INTENT.test(message)) return 'trade'
  if (WAIVER_INTENT.test(message)) return 'waiver'
  if (ROSTER_INTENT.test(message)) return 'roster'
  if (DRAFT_INTENT.test(message)) return 'draft'
  return 'general'
}

/*
 * ⚠ THIS LISTED ONLY THE ABBREVIATIONS, so "college football" — the way people
 * actually write NCAAF — was not global sport context and the escape hatch
 * never fired for it. Same gap as `hrs?` in the stat guard: the formal
 * spelling was covered and the human one was not. Spelled-out league and sport
 * names added.
 *
 * ⚠ AND IT CURRENTLY DECIDES NOTHING. It is consulted only after every branch
 * that can return `true` has already run, and the fallthrough below it returns
 * `false` either way. Kept because it states the intended rule; do not read its
 * presence as evidence that a sport name ever overrides one of those branches.
 */
export const GLOBAL_SPORT_CONTEXT =
  /\b(nfl|nba|mlb|nhl|ncaaf|ncaab|soccer|world\s+cup|champions\s+league|premier\s+league|major\s+league|college\s+(?:football|basketball)|football|basketball|baseball|hockey|fifa|ncaa)\b/

/*
 * ⚠ `in\s+.+\s+league` USED TO 412 EVERY QUESTION ABOUT A REAL COMPETITION.
 * It was written for "in my dynasty league", but `.+` happily spans "the
 * champions", so "who scored in the Champions League last night?" was
 * rejected as a team-specific planning request. Premier League, Major League
 * Baseball and "best team in the league this year" all failed the same way.
 *
 * The `GLOBAL_SPORT_CONTEXT` escape hatch DOES list `champions league` — it
 * just sits underneath this branch and never got the chance. Rather than
 * reorder (which would drop grounding from "draft order in my NFL league",
 * since that reads as global too), the pattern now requires the POSSESSIVE it
 * always meant: my / our / this. No competition on earth is called "my
 * league", so this keeps every real one out while still catching the phrasing
 * the rule exists for.
 */
export const IN_THEIR_OWN_LEAGUE = /\bin\s+(?:my|our|this)\s+[\w\s]*league\b/

export function requiresLeagueGrounding(args: {
  message: string
  intent: string
  source?: string
  teamId?: string
  insightType?: InsightType
}): boolean {
  const message = args.message.toLowerCase()
  const source = String(args.source ?? '').toLowerCase()
  const hasGlobalSportContext = GLOBAL_SPORT_CONTEXT.test(message)

  if (args.teamId) return true
  if (args.insightType === 'trade' || args.insightType === 'waiver' || args.insightType === 'dynasty') {
    return true
  }
  if (source.includes('trade') || source.includes('waiver') || source.includes('lineup')) {
    return true
  }
  /*
   * ⚠ "HOW DOES THE WAIVER PRIORITY RESET WORK ON SLEEPER?" WAS REFUSED FOR WANT OF A LEAGUE (eval
   * gap, 2026-09-16). Any `waiver` or `trade` word forced grounding, even in a question about how a
   * PLATFORM works. A how-does-it-work question with nobody's team in it is help, not advice — so it
   * is released here, before the intent and vocabulary rules below. Anything personal ("my", "our",
   * "I", "we") keeps the old behaviour: "how does waiver priority work if I drop him?" is about
   * their league.
   */
  if (/\bhow\s+(?:does|do|is|are)\b[^?]*\bworks?\b/.test(message) && !/\b(?:my|our|i|me|we|us)\b/.test(message)) {
    return false
  }
  if (['trade', 'waiver', 'roster'].includes(args.intent)) return true
  if (args.intent === 'draft' && (/\b(draft order|draft time|my\s+draft|our\s+draft)\b/.test(message) || IN_THEIR_OWN_LEAGUE.test(message))) {
    return true
  }
  if (/\b(draft order|draft time|waiver|trade)\b/.test(message) || IN_THEIR_OWN_LEAGUE.test(message)) {
    return true
  }
  /*
   * ⚠ "WHO IS MY OPPONENT THIS WEEK?" NEEDED NO LEAGUE. It has no trade, waiver
   * or roster vocabulary, so it classified `general` and reached the model with
   * nothing to answer from — the one thing it asks about is the league. Same
   * for "what are my league's scoring settings?". Bare `my league` stays out:
   * "how do I import my league?" is a help question, and forcing grounding on
   * it asks a multi-league user which league they mean before explaining how.
   *
   * ⚠ `next season` IS GONE (eval gap, 2026-09-16): "who are the best dynasty rookies for next
   * season?" is a ranking question with nothing league-specific in it, and it was refused for want of
   * a league. A season is a time, not a team.
   */
  if (/\b(my team|my roster|my lineup|our team|future|for my team|my\s+(?:opponent|matchup)s?|my\s+league['’]s)\b/.test(message)) {
    return true
  }

  // Global sports Q&A (schedule/scores/standings/historic facts) should not hard-require
  // a league context, even when terms like "draft" are present (e.g. "when is the NFL draft?").
  if (hasGlobalSportContext) return false

  return false
}
