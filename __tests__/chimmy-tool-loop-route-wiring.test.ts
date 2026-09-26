import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getChimmyFeatureFlags } from '@/lib/chimmy-chat/feature-flags'
import {
  classifyPecrIntent,
  GLOBAL_SPORT_CONTEXT,
  IN_THEIR_OWN_LEAGUE,
  requiresLeagueGrounding,
  ROSTER_INTENT,
} from '@/lib/chimmy-chat/question-routing'

/**
 * The wiring contract, asserted against the route source.
 *
 * This is deliberately a source-shape test rather than a request test: driving
 * `/api/chat/chimmy` end to end needs a dozen mocks and times out on a loaded
 * machine, and the properties that matter here are structural — WHERE the loop
 * sits relative to the spend and PECR, and that failure falls through instead of
 * surfacing. Those are exactly the things a refactor would silently break.
 */
const ROUTE = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'),
  'utf8',
)

const idx = (needle: string) => ROUTE.indexOf(needle)

/*
 * The guard, not the import. `indexOf('runChimmyToolLoop')` finds the import at
 * the top of the file, which would make every "block between the loop and PECR"
 * assertion span the whole spend-error section instead.
 */
const LOOP_AT = idx('if (chimmyToolLoopEnabled)')
const PECR_AT = idx('const pecrResult = await runPECR')
const BLOCK = ROUTE.slice(LOOP_AT, PECR_AT)

/*
 * ⚠ THE DEFAULT IS THE WHOLE BEHAVIOUR HERE, AND NOTHING WATCHED IT.
 *
 * This loop shipped OFF and was turned ON by the user's decision on 2026-09-15.
 * A one-character edit reverts that with no test going red and no reviewer
 * necessarily noticing, which is how a deliberate product decision quietly
 * becomes dead code. So the default is asserted, in both directions — a test
 * that only checked the "on" state would pass with the env override deleted,
 * and one that only checked the override would pass with the default reverted.
 */
describe('tool loop default state', () => {
  const previous = process.env.CHIMMY_TOOL_LOOP_ENABLED

  afterEach(() => {
    if (previous === undefined) delete process.env.CHIMMY_TOOL_LOOP_ENABLED
    else process.env.CHIMMY_TOOL_LOOP_ENABLED = previous
  })

  it('is ON when nothing sets the variable', () => {
    delete process.env.CHIMMY_TOOL_LOOP_ENABLED
    delete process.env.NEXT_PUBLIC_CHIMMY_TOOL_LOOP_ENABLED
    expect(getChimmyFeatureFlags().toolLoop).toBe(true)
  })

  /*
   * The escape hatch matters more than the default: this is the control that
   * turns the loop off without deploying a code change, and it is what the
   * flag's own comment tells a reader to reach for if unit cost bites.
   */
  it('can still be turned off without a code change', () => {
    process.env.CHIMMY_TOOL_LOOP_ENABLED = '0'
    expect(getChimmyFeatureFlags().toolLoop).toBe(false)
    process.env.CHIMMY_TOOL_LOOP_ENABLED = 'false'
    expect(getChimmyFeatureFlags().toolLoop).toBe(false)
  })
})

describe('tool loop wiring', () => {
  it('is gated on the feature flag', () => {
    expect(ROUTE).toContain('getChimmyFeatureFlags().toolLoop')
    expect(idx('if (chimmyToolLoopEnabled)')).toBeGreaterThan(-1)
  })

  /*
   * The loop costs provider calls. Running it before the spend is settled would
   * let an unpaid message buy several of them.
   */
  it('runs AFTER the token spend', () => {
    expect(idx('spendTokensForRule')).toBeLessThan(LOOP_AT)
  })

  /*
   * It is an ALTERNATIVE to the push path, not an addition — running both would
   * be two paid provider journeys for one charged message.
   */
  it('runs BEFORE PECR, and returns instead of it', () => {
    expect(LOOP_AT).toBeLessThan(PECR_AT)

    /* The early return sits between them. */
    expect(BLOCK).toContain('return NextResponse.json')
    expect(BLOCK).toContain("source: 'chimmy_tool_loop'")
  })

  /*
   * Silent fallback is the whole point: a flag-on failure must look like the
   * ordinary answer path, never like an error the reader has to interpret.
   */
  it('falls through silently on any failure', () => {
    const block = BLOCK

    /* Errors are swallowed rather than surfaced... */
    expect(block).toContain('.catch(() => null)')
    /* ...and the early return happens ONLY when there is text. */
    expect(block).toMatch(/if \(loop\?\.text\)/)
    /* Nothing in the block returns an error status. */
    expect(block).not.toMatch(/status:\s*5\d\d/)
    expect(block).not.toContain('CHIMMY_GENERIC_ERROR_MESSAGE')
  })

  it('reports what was actually spent, not a flat estimate', () => {
    const block = BLOCK
    expect(block).toContain('tokenSpend')
    expect(block).toContain('tokenPreview.tokenCost')
  })

  it('surfaces which tools the model chose', () => {
    const block = BLOCK
    expect(block).toContain('toolsUsed')
  })

  /* The league must come from the session, never from the model. */
  it('passes session identifiers as the tool context', () => {
    const block = BLOCK
    expect(block).toMatch(/const toolContext = \{\s*leagueId/)
    expect(block).toMatch(/context:\s*toolContext\b/)
    expect(block).toContain('userId')
  })

  /*
   * 🛑 THE MEMBERSHIP-PROVEN ID, NOT THE REQUEST FIELD. The assertion above passed for the bug it
   * sits beside: `context: { leagueId: leagueId ?? null, … }` handed the client's raw form field to
   * `get_league_standings` and `get_head_to_head`, neither of which checks membership, so any
   * signed-in caller could read another league by sending its id (fixed in #932). The behavioural
   * pin is `__tests__/chimmy-unproven-league-id-readers.test.ts`; this one names the line.
   */
  it('binds the tool context to the authorized league, never the requested one', () => {
    /*
     * The context is built in a variable now (the loop mutates it and the route reads it back), so
     * the invariant is asserted on that initialiser — and the loop must be handed exactly that object.
     */
    const context = BLOCK.match(/const toolContext = \{[^}]*\}/)?.[0] ?? ''
    expect(context).toMatch(/leagueId:\s*leagueSnapshot\?\.id\s*\?\?\s*null/)
    expect(context).not.toMatch(/leagueId:\s*(?:leagueId|requestedLeagueId)\b/)
    expect(context).not.toMatch(/formData/)
    // Exactly one tool context in the block, so the checks above cannot be satisfied by a decoy.
    expect(BLOCK.match(/const toolContext = \{/g)).toHaveLength(1)
    expect(BLOCK.match(/context:\s*/g)).toHaveLength(1)
    expect(BLOCK).toMatch(/context:\s*toolContext\b/)
  })

  /*
   * 🛑 THE LOOP'S ANSWER SAYS WHICH LEAGUE IT WAS ABOUT (user report, 2026-09-16). Without this the
   * drawer never learned the league the route resolved or the model found by name, and the next
   * question went out unscoped. Read from the SAME object the loop mutated, after the loop.
   */
  it('reports the bound league in meta.leagueGrounding, read back from the tool context', () => {
    const afterLoop = BLOCK.slice(BLOCK.indexOf('if (loop?.text)'))
    expect(afterLoop).toContain('const boundLeagueId = toolContext.leagueId')
    expect(afterLoop).toMatch(/leagueGrounding:\s*boundLeague/)
    expect(afterLoop).toContain("reason: 'no_league_selected'")
    // Never the raw request field.
    expect(afterLoop).not.toMatch(/boundLeagueId\s*=\s*(?:leagueId|requestedLeagueId)\b/)
  })
})

/*
 * The live-search fallback bills like every other answer.
 *
 * ⚠ IT SHIPPED FREE. The block sits ABOVE the spend, so a web search — the most
 * expensive call we make — cost the platform real money and the reader nothing.
 * With open signup that is an uncapped spend path, and it was only caught by
 * reading `tokenSpend: null` off a live response.
 */
describe('live search fallback charges for what it costs', () => {
  const FALLBACK_AT = idx('liveSearchFallback')
  const DETERMINISTIC_RETURN_AT = idx('const deterministicAnswer = deterministic.text')
  const BLOCK = ROUTE.slice(FALLBACK_AT, DETERMINISTIC_RETURN_AT)

  it('spends against the same rule as a normal chat message', () => {
    expect(BLOCK).toContain('spendTokensForRule')
    expect(BLOCK).toContain("ruleCode: 'ai_chimmy_chat_message'")
  })

  /* Never buy a provider call we cannot bill for. */
  it('checks affordability BEFORE running the search', () => {
    expect(BLOCK.indexOf('previewSpend')).toBeLessThan(BLOCK.indexOf('answerSportsQuestionFromSearch'))
    expect(BLOCK).toContain('canSpend')
    expect(BLOCK).toContain('confirmTokenSpend')
  })

  /*
   * ⚠ You pay for an ANSWER, never for us admitting we have none. One refusal's
   * own copy already promises an unavailable-data answer "should not charge
   * tokens", so charging before knowing the search worked would make the app
   * contradict itself.
   */
  it('charges only after a sourced answer exists', () => {
    expect(BLOCK.indexOf('if (searched)')).toBeLessThan(BLOCK.indexOf('spendTokensForRule'))
  })

  it('reports the real ledger rather than a null spend', () => {
    expect(BLOCK).toContain('balanceAfter')
    expect(BLOCK).toContain('ledgerId')
  })

  /* A failed charge must not also swallow the answer we already paid for. */
  it('still returns the answer if the charge races and fails', () => {
    expect(BLOCK).toMatch(/spendTokensForRule[\s\S]*?\.catch\(\(\) => null\)/)
  })
})

/*
 * ⚠ THIS GATE 412'd EVERY QUESTION ABOUT A REAL COMPETITION. `in\s+.+\s+league`
 * was written for "in my dynasty league", but `.+` spans "the champions", so
 * "who scored in the Champions League last night?" was rejected as a
 * team-specific planning request before any answer path ran. Caught by asking
 * the deployed endpoint; the control was the same call with different wording,
 * which returned 200.
 *
 * These used to `eval` a regex copied out of the route's source, because the
 * gate was module-private and importing the route in a test times out. It now
 * lives in `lib/chimmy-chat/question-routing.ts`, so they drive the real
 * function — the pattern AND the gate that combines it with everything else.
 * The wider question set is `__tests__/chimmy-eval/`.
 */
describe('league grounding is not required for real-world competitions', () => {
  const gate = (q: string) => requiresLeagueGrounding({ message: q, intent: classifyPecrIntent(q) })

  it.each([
    'who scored in the champions league last night?',
    'who won the premier league this year',
    'how many home runs in major league baseball yesterday',
    'who leads the national league in home runs',
  ])('does NOT demand a league for: %s', (question) => {
    expect(IN_THEIR_OWN_LEAGUE.test(question)).toBe(false)
    expect(gate(question)).toBe(false)
  })

  /* The phrasing the rule actually exists for must still be caught. */
  it.each([
    'should i trade josh allen in my dynasty league',
    'what is the draft order in my league',
    'who is the worst manager in our keeper league',
    'how many teams are in this league',
  ])('still demands a league for: %s', (question) => {
    expect(IN_THEIR_OWN_LEAGUE.test(question)).toBe(true)
    expect(gate(question)).toBe(true)
  })

  it('and the route no longer carries a private copy that could drift', () => {
    expect(ROUTE).not.toMatch(/function requiresLeagueGrounding|function classifyPecrIntent|const ROSTER_INTENT/)
    expect(ROUTE).toMatch(/import \{ classifyPecrIntent, requiresLeagueGrounding \} from '@\/lib\/chimmy-chat\/question-routing'/)
  })
})

/*
 * ⚠ THE SPECIALIST AGENT FOLLOWS THE ORCHESTRATION INTENT. Every route suite mocks
 * `@/lib/agents/pipeline`, so none of them would notice the call site going back to classifying
 * a joined string on its own — which is how the agent and the intent label disagreed for 53 of 71
 * questions in `__tests__/chimmy-eval/`. Asserted on the source for that reason.
 */
describe('the specialist agent is chosen from the orchestration intent', () => {
  it('passes the already-computed intent, not a joined string', () => {
    expect(ROUTE).toMatch(
      /inferAgentFromMessage\(message, \{\s*intent: chimmyOrchestrationClassification\.intent,/,
    )
    expect(ROUTE).not.toMatch(/inferAgentFromMessage\(\s*\[message/)
  })

  it('computes that intent before choosing the agent', () => {
    const classified = ROUTE.indexOf('const chimmyOrchestrationClassification = classifyChimmyIntent(')
    const chosen = ROUTE.indexOf('const specialistAgent = inferAgentFromMessage(')
    expect(classified).toBeGreaterThan(-1)
    expect(chosen).toBeGreaterThan(classified)
  })
})

describe('tool loop system prompt', () => {
  /*
   * Owner's call 2026-09-24: smart, fun and informational. One voice for both paths — the tool loop
   * and the orchestration fallback read the same block — and the user's saved preferences, which
   * only the fallback used to see, now reach the path that answers first.
   */
  it('speaks in the shared Chimmy voice and hands the loop the user\'s saved style', () => {
    const start = idx('const CHIMMY_TOOL_LOOP_SYSTEM_PROMPT')
    expect(ROUTE.slice(start, start + 80)).toMatch(/const CHIMMY_TOOL_LOOP_SYSTEM_PROMPT = \[\s*\n\s*CHIMMY_IDENTITY,/)
    expect(ROUTE).toMatch(/\]\.join\(' '\) \+[\s\S]{0,900}?'\\n\\n' \+\s*\n\s*getChimmyPromptStyleBlock\(\)/)
    expect(ROUTE).not.toContain('the calm, analytical fantasy sports assistant')
    expect(ROUTE).toMatch(/systemPrompt: CHIMMY_TOOL_LOOP_SYSTEM_PROMPT,[\s\S]{0,1200}?clockLine: userTemporalContext\.promptLine,[\s\S]{0,900}?styleLine: \[\s*\n\s*personalizationDirectives,/)
    expect(ROUTE).toContain('groundingLine: decisionOsGrounding && leagueSnapshot')
  })

  /*
   * Chimmy's track record (2026-09-24): its record reaches the loop per user, so "how good are your
   * picks?" is answered from graded calls — and the start/sit calls the loop makes are collected and
   * recorded, so the record grows from chat and not only from the comparison screen.
   */
  it('hands the loop its graded track record, and records the start/sit calls the answer made', () => {
    expect(ROUTE).toMatch(
      /styleLine: \[\s*\n\s*personalizationDirectives,\s*\n\s*renderTrackRecordPromptLine\(chimmyTrackRecordFor\(await readAdviceLearningSnapshot\(\), userId \?\? null\)\),/,
    )
    /* `actionCards` (2026-09-25) collects the confirm cards the propose tools build; see below. */
    expect(ROUTE).toMatch(/const toolContext = \{ leagueId: leagueSnapshot\?\.id \?\? null, userId: userId \?\? null, startCalls: \[\] as ChatStartCall\[\], actionCards: \[\] as ChimmyActionCard\[\] \}/)
    const record = idx('await recordChatStartSitAdvice({ userId, calls: toolContext.startCalls, answer: loopText })')
    expect(record).toBeGreaterThan(-1)
    /* Recorded before the answer is returned, against the text the user is about to see. */
    const answered = ROUTE.indexOf("source: 'chimmy_tool_loop'")
    expect(answered).toBeGreaterThan(record)
  })

  /*
   * When the model fetches its own context, nothing upstream can guarantee the
   * context is there — so the do-not-invent rule has to travel with the tools.
   */
  it('carries the same refusal discipline as the push path', () => {
    const start = idx('const CHIMMY_TOOL_LOOP_SYSTEM_PROMPT')
    expect(start).toBeGreaterThan(-1)
    const prompt = ROUTE.slice(start, start + 1200)

    expect(prompt).toMatch(/NEVER invent/i)
    expect(prompt).toMatch(/no data/i)
    expect(prompt).toMatch(/do not fall back on general knowledge/i)
  })

  /* An empty live feed is "no games polled", not a scoreline of zero. */
  it('spells out the empty-feed trap', () => {
    const start = idx('const CHIMMY_TOOL_LOOP_SYSTEM_PROMPT')
    const prompt = ROUTE.slice(start, start + 1200)
    expect(prompt).toMatch(/NOT that nobody scored/i)
  })
})

/*
 * ⚠ "WHEN DOES THE SEASON START?" WAS A ROSTER QUESTION. `classifyPecrIntent`
 * matched a bare `start`, a roster intent hard-requires league context, and so
 * one of the most ordinary questions anybody can ask came back as a 412 telling
 * them to open a league. Measured against production: "When does the college
 * football season start?" returned 412.
 *
 * The word is meant as "start a player" and is also the ordinary English verb.
 */
describe('calendar "start" is not lineup "start"', () => {
  const pattern = ROSTER_INTENT

  it.each([
    'when does the college football season start?',
    'when does the season start',
    'when do the playoffs start',
    'what time does the game start tonight',
    'start time for the super bowl?',
    'start of the season is when?',
  ])('does NOT demand a league for: %s', (q) => {
    expect(pattern.test(q)).toBe(false)
    expect(requiresLeagueGrounding({ message: q, intent: classifyPecrIntent(q) })).toBe(false)
  })

  /* The fantasy sense must still be caught — that is what the rule is for. */
  it.each([
    'who should i start at flex?',
    'should i start josh allen',
    'start or sit mahomes',
    'do i start him over hurts',
    'look at my roster',
    'who do i bench this week',
    /* The imperative opener, which read as `general` until 2026-09-16. */
    'start bijan or gibbs?',
    'sit kelce this week?',
  ])('still reads as roster: %s', (q) => {
    expect(pattern.test(q)).toBe(true)
  })

  /*
   * ⚠ BARE SUBSTRINGS MATCHED INSIDE OTHER WORDS. `flex` fired in "superflex",
   * `bench` in "benchmark", `sit` in "deposit" — and a roster intent
   * hard-requires a league, so "how does superflex scoring work?" was refused.
   */
  it.each([
    'how does superflex scoring work?',
    'is he a flexible player?',
    'what is a good benchmark for a qb?',
    'is there a deposit to join?',
  ])('does not read a longer word as roster: %s', (q) => {
    expect(pattern.test(q)).toBe(false)
  })

  /*
   * ⚠ THE ESCAPE HATCH LISTED ONLY ABBREVIATIONS. "college football" is how
   * people write NCAAF, and it was not global sport context — the same gap as
   * `hrs?` in the stat guard: formal spelling covered, human spelling not.
   */
  it('treats spelled-out sport names as global context', () => {
    for (const q of ['college football', 'premier league', 'major league baseball', 'basketball']) {
      expect(GLOBAL_SPORT_CONTEXT.test(q), q).toBe(true)
    }
  })
})

/*
 * ⚠ "WHO CAN I PICK UP?" WAS A DRAFT QUESTION. The waiver branch matched only
 * the closed compound `pickup`, so the open form fell through to the draft
 * branch on the bare word `pick` — and intent `draft` does not force league
 * grounding unless the message also says "draft order" or "in MY league". The
 * one question `get_available_players` exists to answer could never reach it.
 *
 * Third instance of this shape after `hrs?` in the stat guard and bare `start`
 * above: the formal spelling was covered and the human one was not.
 */
describe('a pickup question is a waiver question', () => {
  const classify = classifyPecrIntent

  it.each([
    'who can i pick up in the zombie league?',
    'who should i pick up',
    'best pick up this week',
    'anyone worth adding in the zombie league?',
    'who is available on waivers?',
    'best free agent available?',
  ])('routes to waiver: %s', (q) => {
    expect(classify(q)).toBe('waiver')
  })

  /*
   * ⚠ AND THE DRAFT SENSE MUST SURVIVE. `pick` still belongs to draft — widening
   * the waiver branch to a bare `pick` would have swallowed every draft question
   * and demanded a league for "when is the NFL draft".
   */
  it.each([
    'what pick am i in the draft',
    'who should i draft at 1.03',
    'what is his adp',
  ])('still reads as draft: %s', (q) => {
    expect(classify(q)).toBe('draft')
  })

  /*
   * ⚠ INTENT `waiver` HARD-REQUIRES A LEAGUE, so anything swept in here that is
   * NOT about the user's team comes back as a 412. This is why `available` was
   * left out of the pattern: it adds nothing the other words miss, and it would
   * have caught "what features are available?".
   */
  it('leaves a bare availability question out of the waiver branch', () => {
    expect(classify('what features are available?')).toBe('general')
  })
})

/*
 * ⚠ FOURTH INSTANCE OF THE SAME SHAPE, and the most consequential. The waiver
 * branch knew "waiver" and "pick up" but not the BIDDING vocabulary — so "how
 * much FAAB should I bid on him?" and "should I claim him?" classified as
 * `general`, never acquired league context, and never reached the surface whose
 * whole job is to refuse them.
 *
 * That matters more than the earlier gaps. `waiver_claims` holds 0 rows, so a
 * FAAB question is precisely the one we must answer with "we cannot see that".
 * The refusal could not fire because the question never got there.
 *
 * Prior instances: `hrs?` in the stat guard, bare `start` in ROSTER_INTENT, and
 * the closed compound `pickup`.
 */
describe('the bidding vocabulary reaches the waiver branch', () => {
  const classify = classifyPecrIntent

  it.each([
    'how much FAAB should I bid on Bauer Sharp?',
    'what should I bid on him?',
    'should I claim him?',
    'what is my FAAB budget?',
  ])('routes to waiver: %s', (q) => {
    expect(classify(q)).toBe('waiver')
  })

  /*
   * ⚠ `claim` IS DELIBERATELY NARROW. Bare `claim` also means "claim my team",
   * which is an import action on a different surface — and intent `waiver` hard
   * requires a league, so sweeping it in would 412 people trying to claim.
   */
  it('leaves team-claiming out of the waiver branch', () => {
    expect(classify('how do I claim my team?')).toBe('general')
    expect(classify('I need to claim my team in KBFL')).toBe('general')
  })

  /* Word boundaries: `bid` must not fire inside another word. */
  it('does not match bid inside a longer word', () => {
    expect(classify('what is the forbidden zone')).toBe('general')
  })

  /* And the draft sense still survives, as it did through the pickup fix. */
  it.each(['when is the NFL draft', 'what pick am i', 'who should i draft at 1.03'])(
    'still reads as draft: %s',
    (q) => {
      expect(classify(q)).toBe('draft')
    },
  )
})
