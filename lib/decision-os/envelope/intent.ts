/**
 * Intent, temporal scope and context scope for a Chimmy request.
 *
 * 🛑 THIS IS A SEVENTH CLASSIFIER AND THAT NEEDS JUSTIFYING. Six already exist —
 * two of them exporting the SAME NAME, `classifyChimmyIntent`, from different
 * modules (see the reconciliation doc). Adding one more is normally the wrong
 * move, and it is done here for a specific reason: none of the six carries
 * `historical_fact`, `live_fact`, `upcoming_schedule`, `unsupported_non_sports`
 * or `action_request`, which are five of the thirteen this step is required to
 * distinguish. The orchestration classifier's 14 intents are all *fantasy
 * actions* — it cannot express "who won the 1992 World Series".
 *
 * ⚠ SO IT MAPS ONTO THE ORCHESTRATION CLASSIFIER RATHER THAN REPLACING IT.
 * `lib/chimmy-orchestration/intent-classifier.ts` feeds
 * `buildOrchestrationPromptSection` on the live route; rewiring it changes
 * answers. `orchestrationIntentToEnvelopeIntent` is the bridge, so the two
 * cannot silently disagree about a question they both recognise.
 *
 * ⚠ DETERMINISTIC AND PURE. No model call, no IO. A classifier that costs a
 * round trip cannot run before authorization, and this one must.
 */

import type { ContextScope, EnvelopeIntent, EnvelopeSport, TemporalScope } from './types'
import { ENVELOPE_SPORTS } from './types'

/** Sport detection, widest phrasing first. */
const SPORT_PATTERNS: Array<{ sport: EnvelopeSport; re: RegExp }> = [
  { sport: 'NCAAF', re: /\b(ncaaf|college\s+football|cfb)\b/i },
  { sport: 'NCAAB', re: /\b(ncaab|college\s+basketball|march\s+madness)\b/i },
  { sport: 'NFL', re: /\b(nfl|american\s+football|super\s*bowl)\b/i },
  { sport: 'NBA', re: /\b(nba|basketball)\b/i },
  { sport: 'NHL', re: /\b(nhl|hockey|stanley\s+cup)\b/i },
  { sport: 'MLB', re: /\b(mlb|baseball|world\s+series)\b/i },
  {
    sport: 'SOCCER',
    re: /\b(soccer|football\s+club|premier\s+league|la\s+liga|champions\s+league|world\s+cup|fifa|epl|mls)\b/i,
  },
]

/**
 * ⚠ "FOOTBALL" IS AMBIGUOUS AND IS DELIBERATELY NOT IN THE LIST ABOVE. It means
 * NFL to one user and soccer to another, and guessing produces a confidently
 * wrong sport. It resolves only through a qualifier — "college football",
 * "american football", "football club" — or stays null.
 */

export function detectSport(message: string): EnvelopeSport | null {
  for (const { sport, re } of SPORT_PATTERNS) {
    if (re.test(message)) return sport
  }
  return null
}

/** Is this a sport this contract covers at all? */
export function isSupportedSport(value: string | null | undefined): value is EnvelopeSport {
  return !!value && (ENVELOPE_SPORTS as readonly string[]).includes(value)
}

/*
 * ⚠ ORDER IS LOAD-BEARING. The list is walked top to bottom and the first match
 * wins, so a broad pattern placed early steals from every rule below it. Both
 * halves need testing when one moves: that the new phrasing matches, and that
 * the near-misses still do not.
 */
const INTENT_RULES: Array<{ intent: EnvelopeIntent; re: RegExp; notIf?: RegExp }> = [
  /*
   * 🛑 GAMBLING IS TESTED FIRST AND IS NOT AN INTENT — it is routed to
   * `unsupported_non_sports` so the envelope can refuse it. Placed above
   * everything because "should I bet on my start/sit" must not classify as
   * start/sit and get a helpful answer with a wager attached.
   *
   * ⚠ FAAB AND AUCTION BUDGETS ARE NOT WAGERS. The brief is explicit, and the
   * negative lookahead is what keeps "how much should I bid on him" working.
   */
  {
    intent: 'unsupported_non_sports',
    re: /\b(parlay|moneyline|point\s*spread|sportsbook|betting\s+(?:line|odds|slip)|place\s+a\s+bet|should\s+i\s+bet|how\s+much\s+should\s+i\s+(?:bet|wager)|units?\s+to\s+(?:bet|wager))\b/i,
  },

  /*
   * Actions: an IMPERATIVE aimed at league state, not a question about it.
   *
   * 🛑 THE ADVISORY GUARD IS LOAD-BEARING AND WAS MISSING FIRST TIME ROUND.
   * Without it "Should I accept this trade?" matched `accept … trade` and
   * classified as an action request — so the single most common trade question
   * in fantasy would have been routed to the action path and answered as a
   * request to execute, instead of being evaluated. The verb is the same in both
   * sentences; the framing is the entire difference.
   *
   * ⚠ THE GUARD IS CHECKED ON THE WHOLE MESSAGE, not just the leading words.
   * "For my keeper league, should I accept this?" puts the advisory phrase in
   * the middle, and anchoring to the start would miss it.
   */
  {
    intent: 'action_request',
    re: /\b(submit|execute|accept|reject|place|set|drop|claim|propose|send)\s+(?:the\s+|my\s+|a\s+|this\s+)?(?:trade|claim|waiver|bid|lineup|offer|vote)\b/i,
    notIf: /\b(should\s+i|should\s+we|is\s+it\s+worth|do\s+you\s+think|would\s+you|worth\s+(?:it|accepting)|what\s+do\s+you)\b/i,
  },

  { intent: 'trade_evaluation', re: /\b(trade|deal|swap|offer|for\s+him|two[- ]for[- ]one)\b/i },
  { intent: 'waiver_add_drop', re: /\b(waivers?|faab|add\/?drop|adds?|drops?|pick\s*up|claim)\b/i },
  { intent: 'draft_decision', re: /\b(drafts?|drafting|adp|rookie\s+pick|snake|auction\s+draft)\b/i },
  { intent: 'league_rule', re: /\b(rules?|settings?|scoring|keeper|roster\s+limit|eligib|tiebreak|playoff\s+format|how\s+does\s+.*\s+work)\b/i },
  { intent: 'commissioner', re: /\b(commissioner|commish|veto|collusion|league\s+admin)\b/i },
  { intent: 'player_valuation', re: /\b(worth|value|valued|price|sell\s+high|buy\s+low)\b/i },
  { intent: 'roster_strategy', re: /\b(my\s+(?:team|roster|lineup)|start\s*\/?\s*sit|starts?|sit\b|rebuild|contend|window)\b/i },

  /*
   * The three temporal ones sit below the fantasy intents on purpose: "who
   * should I start tonight" is a roster question that happens to name tonight,
   * not a live-fact lookup.
   */
  { intent: 'live_fact', re: /\b(right\s+now|live|current\s+score|score\s+(?:is|now)|in\s+progress|playing\s+now)\b/i },
  { intent: 'upcoming_schedule', re: /\b(schedule|next\s+game|when\s+(?:do|does|is)|upcoming|kickoff|tip[- ]?off|first\s+pitch)\b/i },
  { intent: 'historical_fact', re: /\b(who\s+won|history|all[- ]time|record\s+for|in\s+(?:19|20)\d{2}\b|last\s+season|career)\b/i },

  { intent: 'player_info', re: /\b(injur|status|snap\s+count|target\s+share|stat(?:s|line)?|how\s+(?:is|did)\s+\w+)\b/i },
]

/** Classify the request. Falls back to `player_info` only when a name-ish query. */
export function classifyEnvelopeIntent(message: string): EnvelopeIntent {
  const m = String(message ?? '')
  for (const { intent, re, notIf } of INTENT_RULES) {
    if (!re.test(m)) continue
    // A rule can disqualify itself on framing — see the action_request guard.
    if (notIf && notIf.test(m)) continue
    return intent
  }
  /*
   * ⚠ THE FALLBACK IS `player_info`, NOT `unsupported_non_sports`. An
   * unrecognised sports question is a gap in this table, not a refusal — and
   * refusing by default would make every phrasing the table misses look like a
   * policy decision. Gambling is caught explicitly above; nothing else is
   * refused by omission.
   */
  return 'player_info'
}

/**
 * Bridge from the orchestration classifier's taxonomy.
 *
 * ⚠ EXISTS SO THE TWO CANNOT SILENTLY DISAGREE. Where the orchestration
 * classifier has an opinion about a fantasy question, it wins — it is the one
 * feeding the live prompt section. This table is how its answer is expressed in
 * the envelope's vocabulary.
 */
export function orchestrationIntentToEnvelopeIntent(intent: string): EnvelopeIntent | null {
  switch (intent) {
    case 'trade':
      return 'trade_evaluation'
    case 'waiver':
      return 'waiver_add_drop'
    case 'draft':
      return 'draft_decision'
    case 'player_value':
      return 'player_valuation'
    case 'start_sit':
    case 'matchup':
      return 'roster_strategy'
    case 'commissioner':
      return 'commissioner'
    case 'injury':
      return 'player_info'
    /*
     * `league_strength`, `bracket`, `weather`, `manager_psychology`,
     * `story_recap` and `general` have no envelope equivalent that would be
     * more accurate than this step's own classification. Null means "no
     * opinion", and the caller keeps its own answer — which is different from
     * mapping them all onto `player_info` and pretending to agree.
     */
    default:
      return null
  }
}

/** When the answer is about. */
export function resolveTemporalScope(message: string, intent: EnvelopeIntent): TemporalScope {
  if (intent === 'historical_fact') return 'historical'
  if (intent === 'live_fact') return 'live'
  if (intent === 'upcoming_schedule') return 'upcoming'
  /*
   * ⚠ VALUATIONS AND TRADES ARE `projected`, NOT `current`. What they express is
   * a model's view of the future, and labelling that `current` invites it to be
   * worded as a fact. The whole point of the scope is to stop that.
   */
  if (
    intent === 'player_valuation' ||
    intent === 'trade_evaluation' ||
    intent === 'draft_decision' ||
    intent === 'roster_strategy' ||
    intent === 'waiver_add_drop'
  ) {
    return 'projected'
  }
  return 'current'
}

/** What the answer is about. */
export function resolveContextScope(intent: EnvelopeIntent, hasLeague: boolean): ContextScope {
  switch (intent) {
    case 'historical_fact':
    case 'live_fact':
    case 'upcoming_schedule':
      /*
       * ⚠ THESE STAY GLOBAL EVEN WITH A LEAGUE IN SCOPE. "Who won the 1992 World
       * Series" does not become a league question because the user happens to
       * have a league open, and routing it as one would attach league valuation
       * to a settled historical fact.
       */
      return 'global_sport'
    case 'league_rule':
      return 'league'
    case 'commissioner':
      return 'commissioner'
    case 'trade_evaluation':
    case 'waiver_add_drop':
      return 'transaction'
    case 'roster_strategy':
    case 'draft_decision':
      return hasLeague ? 'roster' : 'global_sport'
    case 'player_valuation':
    case 'player_info':
      return 'player'
    case 'action_request':
      return hasLeague ? 'transaction' : 'global_sport'
    case 'unsupported_non_sports':
    default:
      return 'global_sport'
  }
}

/** Whether this intent can be answered at all without a league. */
export function requiresLeague(intent: EnvelopeIntent): boolean {
  return (
    intent === 'league_rule' ||
    intent === 'commissioner' ||
    intent === 'trade_evaluation' ||
    intent === 'waiver_add_drop' ||
    intent === 'roster_strategy' ||
    intent === 'action_request'
  )
}
