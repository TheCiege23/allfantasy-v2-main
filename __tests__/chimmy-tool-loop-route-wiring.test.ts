import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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
    expect(block).toMatch(/context:\s*\{\s*leagueId/)
    expect(block).toContain('userId')
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
 * The pattern is read out of the source because `requiresLeagueGrounding` is
 * module-private and importing this route in a test times out.
 */
describe('league grounding is not required for real-world competitions', () => {
  /*
   * No trailing newline in this matcher: the file is checked out CRLF, `.` does
   * not cross the \r, and anchoring on \n silently captured nothing — which
   * made the pattern fall back to a never-matching regex and the "does NOT
   * demand" cases pass for the wrong reason.
   */
  const match = ROUTE.match(/const inTheirOwnLeague = (\/.*\/)/)

  it('still uses a possessive-scoped pattern', () => {
    expect(match).not.toBeNull()
  })

  const pattern: RegExp = eval(match?.[1] ?? '/$^/')

  it.each([
    'who scored in the champions league last night?',
    'who won the premier league this year',
    'how many home runs in major league baseball yesterday',
    'who leads the national league in home runs',
  ])('does NOT demand a league for: %s', (question) => {
    expect(pattern.test(question)).toBe(false)
  })

  /* The phrasing the rule actually exists for must still be caught. */
  it.each([
    'should i trade josh allen in my dynasty league',
    'what is the draft order in my league',
    'who is the worst manager in our keeper league',
    'how many teams are in this league',
  ])('still demands a league for: %s', (question) => {
    expect(pattern.test(question)).toBe(true)
  })
})

describe('tool loop system prompt', () => {
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
  const match = ROUTE.match(/const ROSTER_INTENT = (\/.*\/i)/)

  it('keeps the intent pattern where the test can read it', () => {
    expect(match).not.toBeNull()
  })

  const pattern: RegExp = eval(match?.[1] ?? '/$^/')

  it.each([
    'when does the college football season start?',
    'when does the season start',
    'when do the playoffs start',
    'what time does the game start tonight',
  ])('does NOT demand a league for: %s', (q) => {
    expect(pattern.test(q)).toBe(false)
  })

  /* The fantasy sense must still be caught — that is what the rule is for. */
  it.each([
    'who should i start at flex?',
    'should i start josh allen',
    'start or sit mahomes',
    'do i start him over hurts',
    'look at my roster',
    'who do i bench this week',
  ])('still reads as roster: %s', (q) => {
    expect(pattern.test(q)).toBe(true)
  })

  /*
   * ⚠ THE ESCAPE HATCH LISTED ONLY ABBREVIATIONS. "college football" is how
   * people write NCAAF, and it was not global sport context — the same gap as
   * `hrs?` in the stat guard: formal spelling covered, human spelling not.
   */
  it('treats spelled-out sport names as global context', () => {
    const globals = ROUTE.match(/const hasGlobalSportContext = (\/.*\/)\.test/)
    expect(globals).not.toBeNull()
    const re: RegExp = eval(globals![1])
    for (const q of ['college football', 'premier league', 'major league baseball', 'basketball']) {
      expect(re.test(q), q).toBe(true)
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
  const waiverMatch = ROUTE.match(/\((\/waiver\|[^\n]*?\/i)\.test\(message\)\) return 'waiver'/)
  const draftMatch = ROUTE.match(/\((\/draft\|[^\n]*?\/i)\.test\(message\)\) return 'draft'/)

  it('keeps both patterns where the test can read them', () => {
    expect(waiverMatch).not.toBeNull()
    expect(draftMatch).not.toBeNull()
  })

  /** Mirrors classifyPecrIntent's order: waiver is checked before draft. */
  function classify(message: string): string {
    const waiver: RegExp = eval(waiverMatch?.[1] ?? '/$^/')
    const draft: RegExp = eval(draftMatch?.[1] ?? '/$^/')
    if (waiver.test(message)) return 'waiver'
    if (draft.test(message)) return 'draft'
    return 'general'
  }

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
