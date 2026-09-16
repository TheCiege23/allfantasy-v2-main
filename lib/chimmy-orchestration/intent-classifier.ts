import type { ChimmyOrchestrationIntent } from './types'

export type ChimmyIntentClassification = {
  intent: ChimmyOrchestrationIntent
  label: string
  confidence: number
}

const LABELS: Record<ChimmyOrchestrationIntent, string> = {
  trade: 'Trade analysis',
  waiver: 'Waiver / adds',
  start_sit: 'Start / sit decision',
  player_value: 'Player value / outlook',
  draft: 'Draft strategy',
  matchup: 'Matchup outlook',
  league_strength: 'League strength / standings',
  // These four belong to ChimmyOrchestrationIntent and were missing from this
  // record, so it failed to typecheck — a red that had been sitting on main.
  commissioner: 'Commissioner / league administration',
  bracket: 'Bracket / tournament',
  injury: 'Injury status',
  weather: 'Weather impact',
  manager_psychology: 'Manager behavior / psychology',
  story_recap: 'Story / recap / narrative',
  general: 'General fantasy help',
}

/**
 * Lightweight deterministic intent router for Chimmy orchestration.
 * Order: most specific patterns first.
 *
 * ── 🛑 EVERY TERM BELOW SITS INSIDE `\b(...)\b`, SO IT MATCHES THAT EXACT WORD AND NOTHING ELSE ──
 * `\bwaiver\b` does not match "waivers": after "waiver" comes "s", a word character, so there is no
 * boundary. The pattern is valid, the regex runs, nothing throws — the question routes to `general`
 * and gets a plausible answer. This has now been found three times in this one file (`psycholog`,
 * `manager\s*profil`, and a whole vocabulary of plurals), so state the rule once:
 *
 *   🛑 A STEM IS UNMATCHABLE UNLESS IT CARRIES ITS OWN INFLECTIONS. Write `waivers?`, `matchups?`,
 *      `power\s*rank(ing)?s?` — or `\w*` where the stem cannot collide with anything.
 *
 * ⚠ AND `\w*` IS THE DANGEROUS FORM, SO INFLECTIONS ARE ENUMERATED WHERE A STEM CAN COLLIDE.
 * `add\w*` matches "address" and "addition"; `sit\w*` matches "situation". Both would silently
 * route ordinary questions into the waiver and start/sit intents, which is the same class of bug
 * pointed the other way. So those are spelled out (`adds?`, `drops?`) and the start/sit stems are
 * deliberately left bare. `stream\w*` IS used, and is safe for a reason worth stating: `\bstream`
 * cannot match inside "downstream", because n→s is word-to-word with no boundary to anchor on.
 *
 * ⚠ THE BRANCHES ARE ORDERED, SO WIDENING AN EARLY ONE STEALS FROM EVERY LATER ONE. A change here
 * needs both halves tested — that the new phrasings match, and that the near-misses still do not.
 * `__tests__/chimmy-orchestration/intent-classifier-inflections.test.ts` holds both.
 *
 * ⚠ AND THIS IS NOT A SILENT INTERNAL DETAIL. `/api/chat/chimmy` feeds the result into
 * `buildOrchestrationPromptSection`, so a misrouted question tells the answering model it is
 * handling something else.
 */
export function classifyChimmyIntent(
  message: string,
  recentUserSnippet?: string
): ChimmyIntentClassification {
  const text = `${recentUserSnippet ?? ''}\n${message}`.toLowerCase()

  const score = (intent: ChimmyOrchestrationIntent, weight: number): ChimmyIntentClassification => ({
    intent,
    label: LABELS[intent],
    confidence: Math.min(0.97, 0.55 + weight * 0.12),
  })

  /*
   * The two guards below read the CURRENT question only. `text` carries the previous user turn
   * too, and "who should I start?" one turn ago must not turn "when does the season start?" into
   * a lineup decision now.
   */
  const current = message.toLowerCase()

  /*
   * 🛑 "WHAT TIME DOES THE CHIEFS GAME START TONIGHT?" WAS A START/SIT DECISION. Both start_sit
   * branches match a bare `start`, and that label is rendered into the prompt, so the answering
   * model was told it was handling a lineup call for a question about a kickoff time. Same bug the
   * PECR classifier had and fixed with a lineup-shaped neighbour; here a calendar question with
   * no lineup cue skips the start_sit branches entirely. Found by `__tests__/chimmy-eval/`.
   */
  const calendarStart =
    /\b(when|what\s+time|what\s+day|what\s+date|how\s+long\s+until)\b|\bstart\s+(?:time|date)s?\b/.test(current) &&
    !/\b(sit|bench|flex|lineups?|line\s*ups?)\b|\bstart(?:ing)?\s+(?:him|her|them)\b|\b(?:who|should\s+i|do\s+i)\s+start\b/.test(
      current
    )

  /*
   * ⚠ "HOW DOES SUPERFLEX SCORING WORK?" WAS ALSO START/SIT (`superflex` is lineup vocabulary),
   * and "how many points is a sack worth?" was a player valuation (`worth`). A question about how
   * a rule or format works is neither. It is answered as general help, after the commissioner
   * branch so that "how do I change the playoff format?" still reaches the commissioner.
   */
  const asksHowRulesWork =
    /\b(how\s+(?:does|do|is|are)|what\s+(?:is|are|does)|explain)\b[^?]*\b(scoring|works?|means?|settings?|format)\b/.test(
      current
    ) || /\bhow\s+many\s+points\b/.test(current)

  if (
    /\b(recaps?|storylines?|narratives?|tell the story|week\s*\d+\s*recaps?|hall of fame|social\s*clips?|captions?)\b/.test(text)
  ) {
    return score('story_recap', 3)
  }
  if (
    // Stems carry \w* because the closing \b otherwise makes them unmatchable:
    // `\bpsycholog\b` cannot match "psychology" (g and y are both word chars, so
    // there is no boundary between them). That was true of the original pattern,
    // which means this intent never fired for the single most obvious word
    // someone would use for it — and it failed silently, as a plausible general
    // answer rather than an error.
    /\b(psycholog\w*|tilt\w*|toxic|collusion|bad\s*managers?|behavio\w*|trash\s*talk|mind\s*game\w*|manager\s*profil\w*|tendenc\w*)\b/.test(
      text
    ) ||
    // Questions about a PERSON rather than an asset: "how does Stavros draft",
    // "what kind of trader is he". Without these they fell through to the
    // generic draft/trade branches, which answer about players instead of about
    // the manager being asked about.
    /\bhow\s+does\s+\w+\s+(draft|trade)\b/.test(text) ||
    /\bwhat\s+kind\s+of\s+(manager|drafter|trader)\b/.test(text)
  ) {
    return score('manager_psychology', 3)
  }
  if (
    // ⚠ `power\s*rank` could not reach "power rankings", which is how the question is normally asked.
    /\b(weakest\s*teams?|strongest\s*teams?|league\s*strength|who\s*to\s*fear|power\s*rank(ing)?s?|standings\s*overview|playoff\s*picture)\b/.test(
      text
    )
  ) {
    return score('league_strength', 2.5)
  }
  /*
   * 🛑 `commissioner` WAS IN THE TYPE AND IN `LABELS` AND NO BRANCH EVER RETURNED IT. "Should I veto
   * this trade as commissioner?" routed to trade, and `deriveWantFromIntent`'s
   * `commissionerHealthDecision: intent === 'commissioner'` could never be true from this route.
   * Collusion stays with manager_psychology above — its own test pins that.
   */
  if (
    /\b(commissioners?|commish|veto(?:es|ed|ing)?|league\s+(?:rules?|dues|constitution|bylaws)|rules?\s+changes?|change\s+(?:the\s+)?rules?|playoff\s+format|dues)\b/.test(
      text
    ) ||
    /*
     * ⚠ "WHEN IS THE TRADE DEADLINE IN MY LEAGUE?" LOADED THE TRADE PROMPT (eval gap, 2026-09-16) —
     * `trade` below won, so a calendar question about a league setting got a trade verdict. Only
     * the WHEN form is taken here: "should I trade X before the deadline?" is still a trade
     * question, and this branch runs before the trade one.
     */
    /\b(?:when|what\s+(?:week|day|date))\b[^?]*\bdeadlines?\b/.test(current)
  ) {
    return score('commissioner', 3)
  }
  if (asksHowRulesWork) {
    return { intent: 'general', label: LABELS.general, confidence: 0.62 }
  }
  if (
    /*
     * 🛑 `oppone` WAS DEAD VOCABULARY — no input could ever match it, because any continuation of
     * "oppone" is a word character and the closing \b has nothing to anchor on. So this branch
     * could only ever fire on its OTHER terms, and every "who is my opponent" question fell
     * through to start/sit or general.
     *
     * ⚠ FIXING IT CHANGES ROUTING, DELIBERATELY. matchup is ordered above start_sit, so
     * "who should I start against my opponent" now lands here. That is what the guard below was
     * written for: it excludes an explicit "start X or sit Y" and would be pointless if opponent
     * questions were never meant to reach this branch. Both halves are pinned in the test file.
     */
    /\b(matchups?|opponents?|spreads?|vegas|game\s*totals?|pace|implied|who\s*do\s*i\s*play\s*against)\b/.test(text) &&
    !/\bstart\b.*\bor\b.*\b(sit|bench)\b/.test(text)
  ) {
    return score('matchup', 2.5)
  }
  if (
    /\b(mock\s*drafts?|draft\s*picks?|rookie\s*class(es)?|adp|sleeper\s*picks?|draft\s*strateg(y|ies)|when\s*to\s*draft)\b/.test(text) ||
    /*
     * ⚠ THE DRAFT VERB ITSELF WAS MISSING. "Who should I draft at 1.03?" and "who should I pick in
     * round 3 of my draft?" routed to general. `pick` refuses a following `up`, because this branch
     * sits above waiver and "who should I pick up?" is the most common waiver question there is.
     */
    /\b(?:should|do|would|could)\s+i\s+(?:draft|pick(?!\s*ups?\b))\b|\bwho\s+to\s+(?:draft|pick(?!\s*ups?\b))\b/.test(text) ||
    /\b(?:my|our)\s+(?:league['’]?s\s+)?draft\b|\bdraft\s+tiers?\b/.test(text) ||
    // "What round should I take a kicker in?" — held-out miss; the round is the draft signal.
    /\bwhat\s+round\s+(?:should|do|would|could|to)\b/.test(text)
  ) {
    return score('draft', 3)
  }
  if (
    // ⚠ The bare stems stay bare on purpose — `sit\w*` would match "situation". See the header.
    !calendarStart &&
    /\b(start|sit|flex|superflex|who\s*do\s*i\s*start|bench|lineups?|line\s*ups?|this\s*week)\b/.test(text) &&
    /\b(or|vs\.?|versus|between|pick\s*(one|between))\b/.test(text)
  ) {
    return score('start_sit', 3.5)
  }
  /*
   * `bench(?:ed|ing)?` rather than `bench\s*him`: "who do I bench this week?" routed to general.
   * ⚠ `superflex` is NOT here any more, only in the paired branch above. On its own it names a
   * league format far more often than a lineup slot — "is Caleb Williams a top-12 QB in
   * superflex?" was a start/sit decision (held-out miss). "Superflex: Mahomes or Allen?" still
   * reaches start_sit through the `or` above.
   */
  if (!calendarStart && /\b(start|sit|flex|lineups?|bench(?:ed|ing)?|start\s*him)\b/.test(text)) {
    return score('start_sit', 2)
  }
  /*
   * 🛑 THE REPORTED BUG. `\bwaiver\b` cannot match "waivers" — the plural is how the question is
   * actually asked, so "who should I claim off waivers this week?" routed to `general` and the
   * answering model was told it was handling general fantasy help.
   *
   * ⚠ `adds?` AND `drops?` RATHER THAN `add\w*` / `drop\w*`: the `\w*` forms match "address",
   * "addition" and "dropout", which would pull ordinary questions into this branch. The stems here
   * are common English words, so their inflections are enumerated rather than globbed.
   */
  /*
   * ⚠ HELD-OUT MISSES, 2026-09-16. `bids?` / `bidding` were in the PECR waiver branch and not here,
   * so "how much should I bid on Bucky Irving?" was general. And `stream\w*` is safe inside a word
   * but not in "where can I stream the Bills game?", which is about watching, not a free agent —
   * so streaming a GAME is excluded, reading the current question only.
   */
  const streamsAGame =
    /\b(?:where|how)\s+(?:can\s+i|do\s+i|to)\s+(?:stream|watch)\b|\bstream(?:ing)?\s+(?:the\s+)?(?:\w+\s+)?(?:game|match)\b/.test(
      current
    )
  if (
    /\b(waivers?|wire|faab|free\s*agents?|pick(ed)?\s*up|pickups?|adds?|adding|drops?|dropping|dropped|bids?|bidding)\b/.test(text) ||
    (!streamsAGame && /\bstream\w*/.test(text))
  ) {
    return score('waiver', 3)
  }
  if (
    /*
     * ⚠ "IS TRAVIS KELCE IN DECLINE?" LOADED THE TRADE PROMPT (found 2026-09-16 by a boundary question
     * added with the eval-gap fixes): a bare `decline` is the verb here but the noun there. The noun
     * sense — "in decline", "on the decline", "a decline" — is excluded by what precedes it.
     */
    /\b(trades?|trading|traded|offers?|counter|accept|(?<!\b(?:in|the|a)\s)decline|deals?|swaps?|send|receive)\b/.test(text) ||
    // "What would you give for Puka?" — the question a trade asks most plainly, and it had no term here.
    /\bwould\s+(?:you|i)\s+give\b|\bgive\s+(?:up\s+)?for\b/.test(text)
  ) {
    return score('trade', 3)
  }
  if (
    /\b(values?|worth|ros|rest\s*of\s*season|outlooks?|sell\s*high|buy\s*low|tiers?|rank\s*him)\b/.test(text)
  ) {
    return score('player_value', 2.5)
  }
  /*
   * Devy and rookie questions are draft questions — the player is on a board, not a lineup. Placed
   * LAST so a trade or value question that happens to name a devy or rookie keeps its own intent.
   */
  if (/\b(devy|rookies?)\b/.test(text)) {
    return score('draft', 2.5)
  }

  return {
    intent: 'general',
    label: LABELS.general,
    confidence: 0.62,
  }
}
