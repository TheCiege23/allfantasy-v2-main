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
