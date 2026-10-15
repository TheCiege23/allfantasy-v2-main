/**
 * Single source of truth for heuristic player-news categories used by
 * X/Grok ingestion and cron dispatch — keeps classification aligned.
 */

import { RELEASE_OF_INFORMATION_SOURCE } from '@/lib/news/releaseOfInformationPattern'

export type PlayerNewsCategory =
  | 'injury'
  | 'suspension'
  | 'trade'
  | 'signing'
  | 'release'
  | 'roster_move'
  | 'team_news'
  | 'player_news'
  | 'game_update'
  | 'coaching'

/**
 * 🛑 FIRST-MATCH-IN-TABLE-ORDER WAS THE CLASSIFIER, AND IT WAS WRONG THREE SEPARATE WAYS.
 *
 * The old implementation lower-cased the text, walked the categories in insertion order, and
 * returned the first one with any `String.includes` hit. Every defect below follows from that
 * one design, and REORDERING THE LISTS FIXES NONE OF THEM:
 *
 *  1. **`trade` sat above `signing` and both listed the bare word "deal".** So "signs a
 *     four-year deal", "agrees to a deal" and "reaches a deal" all classified as TRADE — and
 *     `playerNewsEligibility` then held them, because it holds trades until the wording
 *     confirms completion. An ordinary signing was mislabelled and then silently suppressed,
 *     for the phrasing reporters use most.
 *  2. **`includes` matched inside words.** `injury` is checked first and contains "back", so
 *     "Quarterback signs a four-year extension" was an INJURY. It also contains "IL", which
 *     lower-cases to `il` and sits inside "will", "until" and "available"; `release` contains
 *     "cut", inside "haircut" and "cutting".
 *  3. **Incidental history outranked the actual event.** "RB signs an extension; the knee is
 *     fully healed" hit `knee` in the first category examined and never reached `signs`.
 *
 * The replacement makes two distinctions the old one could not:
 *
 *   **Word boundary.** Keywords match at a leading `\b`. Anchored at the START only, because
 *   several entries are intentional PREFIXES — `relocat` catches relocate / relocation /
 *   relocating — and anchoring both ends would silently retire them.
 *
 *   **Evidence strength.** A keyword is either STRONG (it names the event: "signs", "traded",
 *   "suspended", "placed on IR") or WEAK (it merely accompanies one, or is ambiguous across
 *   categories: "deal", "knee", "cut", "acquired"). Every category is tested for a STRONG hit
 *   first, in table order; only if nothing strong matches anywhere does the weak pass run.
 *
 *   ⚠ THAT SECOND DISTINCTION IS THE ONE ORDERING CANNOT REPLACE. The body part and the
 *   transaction verb live in DIFFERENT categories, so under a single pass whichever list is
 *   examined first wins no matter how the lists are sorted — put `signing` first and
 *   "Questionable after re-signing" becomes a signing instead of an injury. Only ranking the
 *   evidence resolves both directions.
 *
 * ⚠ THIS CHANGES CLASSIFICATION FOR ROWS ALREADY IN `player_news`, AND NOTHING IS REWRITTEN.
 * The category is computed at read time and never stored, so no historical row is mutated — but
 * a row that classified as `trade` yesterday can classify as `signing` today and thereby become
 * notification-eligible. That is the intended repair; it is stated here rather than left to be
 * discovered.
 */
export type CategoryEvidence = {
  /** Names the event itself. A hit here decides the category. */
  strong: readonly string[]
  /** Accompanies the event, or is ambiguous across categories. Consulted only if nothing is strong. */
  weak: readonly string[]
  /**
   * Regex sources that DISQUALIFY this category even when a keyword matched.
   *
   * 🛑 SOME VERBS HAVE TWO MEANINGS AND NO KEYWORD LIST CAN SEPARATE THEM. "Released" is a
   * roster move and also what a club does with a statement; every earlier attempt to fix that
   * moved the word between `strong` and `weak`, which only changed which wrong answer it gave.
   * A disqualifier names the OTHER meaning explicitly, so the keyword can stay where it belongs.
   */
  disqualifiers?: readonly string[]
}

const CATEGORY_EVIDENCE: Record<PlayerNewsCategory, CategoryEvidence> = {
  injury: {
    strong: [
      'injury',
      'injured',
      'ruled out',
      'concussion',
      'questionable',
      'doubtful',
      'day-to-day',
      'day to day',
      'DNP',
      'did not practice',
    ],
    /*
     * ⚠ BODY PARTS ARE WEAK ON PURPOSE. They are the most common way a HISTORICAL injury is
     * referenced inside news about something else entirely — a signing, a role change, a
     * return from absence.
     *
     * 🛑 `'IL'`, `'IR'` AND `'back'` WERE HERE AND HAD TO COME OUT — the first two because this
     * rewrite made them DANGEROUS, the third because it was always wrong.
     *
     * The old classifier lower-cased the haystack and compared it against the raw uppercase
     * keyword, so `includes('IL')` and `includes('IR')` could never match — they were dead
     * entries. Adding the `i` flag resurrected them, and a leading-only `\b` means `\bIR`
     * matches any word STARTING "ir". Measured against both implementations:
     *
     *     "Kyrie Irving returns to the starting lineup"   old=player_news  new=injury
     *     "Illinois star declares for the draft"          old=player_news  new=injury
     *     "Ireland native joins the practice squad"       old=player_news  new=injury
     *
     * That is not a mislabel with cosmetic consequences. `injury` is in
     * `MATERIAL_ROSTER_CATEGORIES`, so it bypasses the impact gate and pushes at severity
     * `high`; and `lib/workers/x-news-ingestion.ts` calls `persistInjuryFromNews` on it, which
     * writes a REAL injury row for a healthy player. Two letters cannot carry that weight, and
     * `roster_move` already models the actual designation change ("placed on IR").
     *
     * `'back'` is the same failure without the acronym excuse: `\bback` matches "running back"
     * and "running backs", so any story about a back with no strong keyword became an injury.
     *
     * ⚠ NOTHING IS LOST BY REMOVING THEM. A real injury report says "injury", "injured",
     * "ruled out", "questionable" or "doubtful" — all strong, all above.
     */
    weak: ['hamstring', 'knee', 'ankle', 'shoulder', 'limited', 'out for'],
    /*
     * 🛑 "INJURED RESERVE" IS A ROSTER DESIGNATION, AND `injured` IS INSIDE IT.
     *
     * `injury` is examined before `roster_move`, so every spelled-out IR headline was an injury
     * — including movement OFF the list: "Team activates RB from injured reserve" wrote a fresh
     * injury row via `persistInjuryFromNews` for a player who had just been declared available.
     *
     * ⚠ THE COMMENT REMOVING `'IR'` FROM THIS LIST CLAIMED `roster_move` ALREADY MODELLED THIS.
     * It does — but only for the literal abbreviation, because the spelled-out form was being
     * captured here first. The claim was true of the table and false of the behaviour.
     *
     * This voids only the `injured` inside the phrase (see `hasSurvivingHit`), so "placed on
     * injured reserve after suffering a concussion" still classifies on `concussion`.
     */
    disqualifiers: [String.raw`\binjured\s+reserve\b`],
  },
  suspension: {
    strong: ['suspended', 'suspension', 'suspensions', 'banned'],
    /*
     * ⚠ `'PED'` REMOVED FOR THE SAME REASON AS `'IR'` — it was dead under the old comparison and
     * `\bPED` matches "Pederson" and "pedestrian" under the new one. A real suspension story
     * says "suspended" or "suspension".
     *
     * 🛑 AND A BARE `'conduct'` WAS THE IDENTICAL DEFECT TWO LINES LATER, WHICH IS WHY THE
     * ANCHORING CHANGE MATTERS MORE THAN EITHER DELETION. "Panthers conduct workouts for free
     * agent running backs" classified as `suspension` — a MATERIAL_ROSTER_CATEGORY, eligible
     * outright — and pushed "Suspension: <player>" to everyone rostering the named player. Note
     * end-anchoring does NOT save this one: "conduct" is a whole word there. The noun sense is
     * what carries the meaning, so the noun sense is what is named.
     */
    weak: ['personal conduct', 'conduct policy', 'exempt list'],
  },
  /*
   * Ordered above `trade`, but that order only breaks ties WITHIN one strength pass. The real
   * separation is that "deal" is WEAK here and ABSENT from `trade` — see below.
   */
  signing: {
    /*
     * 🛑 `'contract'` WAS STRONG HERE AND IT PUNCHED A HOLE THROUGH THE CONFIRMED-ONLY TRADE
     * RULE.
     *
     * `signing` is iterated before `trade`, so ANY trade story that mentioned a contract won
     * the strong pass — and `signing` is in `MATERIAL_ROSTER_CATEGORIES`, which is eligible
     * outright, so `isConfirmedTrade` and the hedge patterns never ran at all. Measured:
     *
     *     "Report: Jets could trade WR Garrett Wilson"
     *     "He has two years left on his rookie contract."
     *       → signing → { eligible: true, reason: 'material-roster-event' } → PUSHED
     *
     * Delete the word "contract" from that body and the identical story correctly returns
     * `unconfirmed-trade` and is held. Nearly every trade rumour mentions the contract.
     *
     * ⚠ WEAK IS THE RIGHT STRENGTH, NOT ABSENT. "Player and team finalize contract" with no
     * other vocabulary is still a signing, and the weak pass — which `signing` also leads —
     * still classifies it correctly. It simply can no longer outrank an explicit "trade".
     */
    /*
     * 🛑 `'agreed to terms'` REMOVED — it is listed VERBATIM in `playerNewsEligibility`'s
     * `TRADE_HEDGE_PATTERNS` as proof a trade is NOT done. Having it as strong `signing`
     * evidence, in a category iterated before `trade`, reopened the exact bypass demoting
     * `'contract'` was meant to close: "Jets and Browns agreed to terms on a trade sending WR
     * Garrett Wilson to Cleveland" classified as a signing, which is material-roster and
     * eligible outright, so `isConfirmedTrade` and the hedge list never ran. `'agrees'` stays —
     * it is the ordinary signing verb and carries no trade meaning on its own.
     */
    /*
     * 🛑 THE BARE STEMS `sign` AND `agree` WERE MISSING, AND THEY ARE THE FORM EVERY HEADLINE
     * USES. English agrees the verb with the plural team name: "Chiefs **sign** free-agent WR",
     * "Broncos and QB **agree** to terms". `\bsigns` does not match "sign". Both classified
     * `player_news`, both scored low impact, and both were `policy-skipped` — TERMINAL — so the
     * commonest transaction headline in the sport was silently unreachable.
     *
     * ⚠ THIS IS ONLY SAFE BECAUSE KEYWORDS ARE NOW END-ANCHORED. Under the old leading-only
     * `\b`, `sign` would have matched "signal", "signature" and "significant" — which is
     * presumably why nobody added it. The anchoring change is what makes the obvious entry
     * correct; adding it before that change would have been the `IR`/`PED` bug again.
     */
    strong: ['sign', 'signs', 'signed', 'signing', 'extension', 'extensions', 'agree', 'agrees'],
    /*
     * ⚠ `'agreed'` COVERS THE PAST TENSE THAT REMOVING `'agreed to terms'` LEFT UNCOVERED.
     * `\bagrees` does not match "agreed", so "Free agent CB agreed to terms with Denver" —
     * no "deal", no "contract", no "signs" — fell through to `player_news` and was ineligible.
     * WEAK, not strong: the trade-before-signing weak order below is what stops it re-opening
     * the bypass that removing the full phrase closed.
     */
    /*
     * ⚠ INFLECTIONS ENUMERATED, BECAUSE END-ANCHORING NO LONGER COVERS THEM FOR FREE — and that
     * is the trade the anchoring change makes deliberately. `\bdeal\b` is also what stops
     * "dealing with a hamstring injury" being read as a signing.
     */
    weak: [
      'deal', 'deals', 'contract', 'contracts', 'agreed',
      're-sign', 're-signs', 're-signed', 're-signing', 'resign', 'resigns', 'resigned',
    ],
  },
  trade: {
    /*
     * 🛑 "deal" IS DELIBERATELY ABSENT AND "acquired" IS DELIBERATELY WEAK.
     *
     * "deal" is the single most common way a SIGNING is written up, and listing it here is what
     * sent contract news down the confirmed-only trade path. "acquired" is genuine trade
     * vocabulary but proves nothing on its own — "reportedly acquired", "could be acquired" and
     * "hoping to acquire" all contain it — so it classifies only when nothing stronger is
     * present, and `playerNewsEligibility` still has to establish completion before anything is
     * sent.
     */
    strong: ['traded', 'trade', 'trades', 'trading', 'blockbuster', 'in exchange for'],
    weak: ['acquired', 'acquire', 'acquires', 'swap', 'swaps'],
  },
  release: {
    /*
     * ⚠ THE COMMENT HERE USED TO SAY "ALL THREE TENSES" AND IT WAS COUNTING THE WRONG THING. It
     * enumerated the tenses of one conjugation — released / releases / releasing — and missed
     * the BARE STEM, which is what a plural team name takes: "Broncos **release** veteran LB".
     * The file contradicted itself, because the disqualifier below already matched that form.
     * Same omission as `sign` above, same cause, found the same way.
     */
    strong: [
      'release', 'released', 'releases', 'releasing',
      'waive', 'waived', 'waives', 'designated for assignment', 'DFA',
    ],
    // `\bcut\b` — end-anchoring is what stops this matching "haircut" and "cutting".
    weak: ['cut', 'cuts'],
    /*
     * 🛑 "RELEASED A STATEMENT" IS NOT A ROSTER MOVE, AND `\breleased` MATCHED IT.
     *
     * `release` is in `MATERIAL_ROSTER_CATEGORIES`, so it is eligible outright regardless of
     * impact — "The team released a statement on the quarterback's status" pushed
     * "Released: <player>" to every manager rostering a player who had not been released.
     * "Released the injury report" and "released its depth chart" are the same shape.
     *
     * The object of the verb is what separates the two meanings, so that is what this names.
     */
    /*
     * 🛑 THE SHARED DEFINITION, BECAUSE THIS LIST WAS A SECOND IMPLEMENTATION AND IT DISAGREED.
     *
     * `playerNewsEligibility` strips the same boilerplate and covers BOTH word orders; this list
     * was written from the ACTIVE form only. So "… agree to a four-year deal" / "Terms were not
     * released." classified as `release` and pushed "Released: <player>" for a player who had
     * just re-signed — handled correctly in one module and incorrectly in the other, from one
     * sentence. `RELEASE_OF_INFORMATION_SOURCE` is now the only copy.
     */
    disqualifiers: [
      RELEASE_OF_INFORMATION_SOURCE,
      String.raw`\breleased\s+from\s+the\s+(?:injury report|reserve)\b`,
      /*
       * A club PUBLISHING a document. Kept local rather than pushed into the shared source,
       * which is specifically about not disclosing CONTRACT terms — "released its depth chart"
       * is not that rule, and merging the two would widen eligibility's negation strip for a
       * reason that has nothing to do with negation.
       */
      String.raw`\brelease(?:d|s|ing)?\s+(?:a\s+|an\s+|its\s+|their\s+|the\s+)?(?:\w+\s+){0,2}(?:report|depth chart|schedule|list|findings)\b`,
      String.raw`\bpress\s+release\b`,
      String.raw`\brelease\s+date\b`,
    ],
  },
  roster_move: {
    // `activates` etc. enumerated: the bare-stem headline form reaches this category too.
    strong: [
      'placed on IR',
      'injured reserve',
      'activate',
      'activated',
      'activates',
      'recall',
      'recalled',
      'promoted',
      'demoted',
      'roster move',
      'call-up',
      'called up',
      'sent down',
    ],
    weak: [],
  },
  team_news: {
    // `relocat*` is the one deliberate PREFIX in this table: relocate / relocation / relocating.
    strong: ['front office', 'ownership', 'relocat*'],
    weak: ['hire', 'hires', 'fired', 'fires'],
  },
  player_news: {
    strong: ['retirement', 'retire', 'retires', 'retired', 'comeback'],
    weak: ['return', 'returns'],
  },
  game_update: {
    strong: ['postponed', 'cancelled', 'canceled', 'delayed'],
    weak: ['weather'],
  },
  coaching: {
    strong: ['head coach', 'coaching change', 'coordinator'],
    weak: ['coaching'],
  },
}

/**
 * Compile once.
 *
 * 🛑 KEYWORDS ARE ANCHORED AT BOTH ENDS NOW, AND THE LEADING-ONLY `\b` THAT PRECEDED THIS WAS
 * THE SINGLE LARGEST SOURCE OF WRONG CATEGORIES IN THIS FILE.
 *
 * Every one of these was the same defect wearing a different word:
 *
 *     'IR'      -> "Kyrie **Ir**ving returns"          -> injury  -> a real injury row written
 *     'PED'     -> "**Ped**erson said"                 -> suspension
 *     'back'    -> "running **back** signs"            -> injury
 *     'cut'     -> "hair**cut**", "**cut**ting"        -> release
 *     'deal'    -> "**deal**ing with a hamstring"      -> signing
 *     'conduct' -> "Panthers **conduct** workouts"     -> suspension
 *
 * Each was found separately, patched separately by deleting that one entry, and the NEXT one
 * was already sitting in the table. Anchoring the end retires the class: a keyword now matches
 * the word, not a word that starts with it.
 *
 * ⚠ A TRAILING `*` KEEPS PREFIX SEMANTICS WHERE THEY ARE ACTUALLY WANTED. `relocat*` is
 * deliberately one entry covering relocate / relocation / relocating. Making prefix matching
 * OPT-IN rather than the default is the whole change: the dangerous form now has to be asked
 * for by name, in the table, where a reader can see it.
 *
 * ⚠ AND THE COST IS THAT INFLECTIONS MUST BE ENUMERATED. `\brelease\b` no longer matches
 * "releases"; that is why the tables above list the forms explicitly. Deleting one of those
 * entries silently loses that phrasing — which is the trade, and it is the right way round,
 * because a missing form under-notifies where a loose prefix fabricates events.
 *
 * Regex metacharacters are escaped: the table holds none today, but a future entry containing
 * `.` or `(` would otherwise become a wildcard rather than a literal.
 */
function compile(keywords: readonly string[]): RegExp[] {
  return keywords.map((kw) => {
    const isPrefix = kw.endsWith('*')
    const literal = (isPrefix ? kw.slice(0, -1) : kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // `g` so `matchAll` can report POSITIONS — see `hasSurvivingHit`.
    return new RegExp(`\\b${literal}${isPrefix ? '' : '\\b'}`, 'gi')
  })
}

/** Disqualifiers are already regex sources, so they are compiled verbatim. */
function compileRaw(sources: readonly string[] | undefined): RegExp[] {
  return (sources ?? []).map((src) => new RegExp(src, 'gi'))
}

type CompiledEvidence = {
  category: PlayerNewsCategory
  strong: RegExp[]
  weak: RegExp[]
  disqualifiers: RegExp[]
}

const COMPILED: CompiledEvidence[] = Object.entries(CATEGORY_EVIDENCE).map(
  ([category, evidence]) => ({
    category: category as PlayerNewsCategory,
    strong: compile(evidence.strong),
    weak: compile(evidence.weak),
    disqualifiers: compileRaw(evidence.disqualifiers),
  }),
)

/**
 * The weak pass examines `trade` immediately before `signing`; everything else keeps table order.
 *
 * 🛑 THE PREVIOUS VERSION HOISTED `trade` TO THE FRONT AND THAT WAS TOO BLUNT.
 *
 * The tie that needed breaking is a narrow one: `signing.weak` holds `contract`/`deal` and
 * `trade.weak` holds `acquire`, and nearly every trade rumour mentions the contract — so in
 * table order the contract won and an unconfirmed rumour shipped as a signing. Fixing that by
 * putting `trade` above EVERYTHING made `\bacquire` outrank the injury vocabulary too:
 * "Vikings acquire depth as Jefferson is out for the season" became an unconfirmed trade — a
 * TERMINAL policy skip — instead of the injury it is.
 *
 * Moving `trade` to just above `signing` breaks the tie it was meant to break and disturbs
 * nothing else. `injury` and `suspension` still outrank both, which is correct: an injury
 * mentioned in a transaction headline is the more actionable fact.
 */
const WEAK_PASS: CompiledEvidence[] = (() => {
  const rest = COMPILED.filter((e) => e.category !== 'trade')
  const trade = COMPILED.find((e) => e.category === 'trade')
  if (!trade) return rest
  const at = rest.findIndex((e) => e.category === 'signing')
  if (at < 0) return [...rest, trade]
  return [...rest.slice(0, at), trade, ...rest.slice(at)]
})()

type Span = readonly [number, number]

/** Where each disqualifier matched, so a hit can be tested against the clause it sits in. */
function disqualifiedSpans(patterns: RegExp[], text: string): Span[] {
  const spans: Span[] = []
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (typeof m.index === 'number') spans.push([m.index, m.index + m[0].length])
    }
  }
  return spans
}

/**
 * Does this category have at least one keyword hit that is NOT inside a disqualified clause?
 *
 * 🛑 A DISQUALIFIER VOIDS THE CLAUSE THAT CARRIES THE OTHER MEANING — NOT THE DOCUMENT.
 *
 * The previous version tested keywords and disqualifiers against the same string and skipped
 * the category if BOTH matched anywhere. On the headline+body passes that meant one incidental
 * phrase in the body voided the category for the whole story:
 *
 *     headline: "Broncos release veteran LB"
 *     body:     "… the team released a statement thanking him for his service."
 *
 * — boilerplate on essentially every release story. `release` was voided, the item fell through
 * to `player_news`, and a genuine roster move was ruled ineligible and stamped TERMINAL. The
 * disqualifier was doing the opposite of its job: it exists so the keyword can stay in the
 * table, and instead it deleted the true hit along with the false one.
 *
 * Comparing POSITIONS is what separates them. "released a statement" is a disqualified span;
 * "release veteran LB" is not, so the category survives on the second hit.
 */
function hasSurvivingHit(keywords: RegExp[], text: string, spans: Span[]): boolean {
  for (const re of keywords) {
    for (const m of text.matchAll(re)) {
      if (typeof m.index !== 'number') continue
      const [start, end] = [m.index, m.index + m[0].length]
      if (!spans.some(([s, e]) => start >= s && end <= e)) return true
    }
  }
  return false
}

function matchIn(entries: CompiledEvidence[], text: string, which: 'strong' | 'weak') {
  for (const entry of entries) {
    const spans = entry.disqualifiers.length > 0 ? disqualifiedSpans(entry.disqualifiers, text) : []
    if (hasSurvivingHit(entry[which], text, spans)) return entry.category
  }
  return null
}

/**
 * 🛑 THE HEADLINE IS THE EVENT; THE BODY IS CONTEXT. THAT ORDERING IS THE FIX.
 *
 * Classifying over headline+body as one blob is what let background detail outrank the thing
 * the story is actually about, and it produced the same bug repeatedly in different costumes:
 *
 *   "WR and team finalize contract" / "the shoulder that ended his 2025 is fully healed"
 *       → `\bshoulder` in the BODY beat `contract` in the HEADLINE → injury → and
 *         `x-news-ingestion` wrote a real injury row for a healthy player.
 *
 * Every previous attempt moved a keyword between `strong` and `weak` or reordered the table,
 * which cannot fix it: the body term and the headline term are in different categories, so
 * whichever is examined first wins regardless of how the lists are sorted.
 *
 * Four passes — the HEADLINE is exhausted before the body is consulted at all:
 *   1. strong evidence in the HEADLINE      — the event, named in the place it is named
 *   2. weak evidence in the HEADLINE
 *   3. strong evidence anywhere             — headlines are sometimes bare ("Roster update")
 *   4. weak evidence anywhere
 *
 * 🛑 PASSES 2 AND 3 WERE THE OTHER WAY ROUND AND THE REWRITE DID NOT ACHIEVE WHAT IT WAS
 * WRITTEN FOR. With strong-anywhere ahead of weak-in-headline, a strong body word still beat a
 * weak headline word — so the exact case this whole ordering exists for came back:
 *
 *     headline: "WR and team finalize contract"        (`contract` — WEAK signing evidence)
 *     body:     "The shoulder injury that ended his 2025 season is fully healed."
 *                                                      (`injury` — STRONG injury evidence)
 *       -> pass 1 finds nothing strong in the headline
 *       -> old pass 2 found `injury` in the BODY  -> injury
 *       -> `x-news-ingestion` wrote a real InjuryReportRecord for a healthy, just-signed player
 *
 * The headline-first claim only ever held while the body's injury vocabulary was WEAK; any of
 * `injury`, `ruled out`, `concussion`, `questionable`, `doubtful` reproduced the original bug
 * exactly. "Rank strength first, location second" and "the headline is the event" are different
 * rules, and the passes implemented the first while the doc-comment described the second.
 *
 * ⚠ THIS DOES NOT MAKE THE BODY IRRELEVANT, and it must not: a bare headline over a detailed
 * body is common, which is why passes 3 and 4 exist. The body decides only when the headline
 * carries no evidence at all.
 *
 * ⚠ AND THE TRADE IS REAL, NOT FREE. "Jets make a deal" over a body reporting a concussion now
 * classifies as `signing`, where it used to classify as `injury`. That follows from the stated
 * rule — the headline says what the story is about — and it is the direction that does not
 * fabricate medical records.
 */
export function classifyPlayerNewsCategory(
  headline: string,
  body: string | null,
): PlayerNewsCategory {
  const head = headline ?? ''
  const full = `${head} ${body ?? ''}`

  return (
    matchIn(COMPILED, head, 'strong') ??
    matchIn(WEAK_PASS, head, 'weak') ??
    matchIn(COMPILED, full, 'strong') ??
    matchIn(WEAK_PASS, full, 'weak') ??
    'player_news'
  )
}

/**
 * Exported so a test — or anything that needs to explain a classification — can read the same
 * table the classifier compiled from. Not used by `classifyPlayerNewsCategory` itself.
 */
export function playerNewsCategoryEvidence(): Record<PlayerNewsCategory, CategoryEvidence> {
  return CATEGORY_EVIDENCE
}
