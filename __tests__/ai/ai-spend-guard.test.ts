import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertAiSpendAllowed,
  isAiSpendEnabled,
  isAiSpendDisabledError,
  AiSpendDisabledError,
} from '@/lib/ai/aiSpendGuard'

/**
 * PERMANENT exceptions — boundaries that must NEVER be guarded, with the reason.
 * Module scope because both the enumerated coverage block and the census below
 * consult it, and two copies would drift.
 *
 * Both are liveness probes: they answer "is this provider up", which cannot be
 * read from Postgres. GUARDING ONE WOULD MAKE IT LIE — with spend off it would
 * report a healthy provider as `down`, and a dashboard that shows an outage
 * because a billing switch is off is worse than no dashboard.
 */
const PERMANENT_EXCEPTIONS = [
  'lib/agents/workers/api-health-monitor.ts',
  // Already self-documented, with `db-first-exception: live provider health probe`
  // on each URL it probes.
  'lib/admin-dashboard/SystemHealthResolver.ts',
  /*
   * NOT a probe — a ROUTER, and excepted for a different reason. It only
   * chooses between clients that are themselves guarded, so guarding it would
   * refuse callers that inject or mock a client and would therefore never
   * have spent anything. The guard module's own docstring says so.
   */
  'lib/ai/providerRouter.ts',
  /*
   * HAND-RUN DIAGNOSTICS, added with the scripts/ root on 2026-08-28. Both really do
   * call a provider and both are deliberately unguarded, for the reason the health
   * probe already carries: a tool whose entire job is to find out whether a provider
   * answers cannot do that job with spend switched off. Guarding these would not save
   * money — nothing invokes them but a developer typing the command — it would only
   * make them report a provider outage when the truth is a billing switch.
   *
   * Neither is reachable from a request path; neither is in package.json or CI.
   * This is the same reasoning CLAUDE.md records for scripts/compare-player-apis.ts
   * under the DB-first rule: a comparison tool cannot compare without calling.
   */
  'scripts/ai-smoke.mjs',
  'scripts/x-news-probe.mjs',
]

/**
 * FLAGGED BY THE SCAN, NOT ACTUALLY A BOUNDARY — kept apart from PERMANENT_EXCEPTIONS
 * on purpose. Those are real provider calls we have decided not to guard; these do not
 * call a provider at all. Filing a heuristic false positive as a deliberate exception
 * would make the exception list mean two different things, and the next person could
 * not tell which entries represent real money.
 *
 * scripts/legacy-qa-report.mjs trips `provider key + outbound call` because it names
 * OPENAI_API_KEY and XAI_API_KEY in a required-secrets ARRAY and separately fetches
 * http://127.0.0.1:3000. It reads no value — `present: Boolean(process.env[key])` —
 * and sends nothing anywhere. That is an env checklist, not a spend path.
 */
const SCAN_FALSE_POSITIVES = ['scripts/legacy-qa-report.mjs']

const ENV = { ...process.env }
beforeEach(() => { delete process.env.AI_FEATURES_ENABLED; delete process.env.NEXT_PHASE })
afterEach(() => { process.env = { ...ENV } })

describe('AI spend guard — off by default', () => {
  it('refuses when the variable is UNSET', () => {
    // The whole point: an unset variable must mean "do not spend". A guard that defaults open
    // protects nothing on a fresh environment, which is exactly where money leaks.
    expect(isAiSpendEnabled()).toBe(false)
    expect(() => assertAiSpendAllowed('test')).toThrow(AiSpendDisabledError)
  })

  it.each(['false', 'FALSE', '0', '1', 'yes', 'TRUE', 'True', '', '  '])(
    'refuses for AI_FEATURES_ENABLED=%o',
    (v) => {
      process.env.AI_FEATURES_ENABLED = v
      expect(isAiSpendEnabled()).toBe(false)
      expect(() => assertAiSpendAllowed('test')).toThrow()
    },
  )

  it('allows ONLY the exact string "true"', () => {
    process.env.AI_FEATURES_ENABLED = 'true'
    expect(isAiSpendEnabled()).toBe(true)
    expect(() => assertAiSpendAllowed('test')).not.toThrow()
  })

  it('tolerates surrounding whitespace on the enabling value', () => {
    process.env.AI_FEATURES_ENABLED = '  true  '
    expect(isAiSpendEnabled()).toBe(true)
  })
})

describe('AI spend guard — error contract', () => {
  it('carries 402 and a stable code so callers map it to a payment state', () => {
    try {
      assertAiSpendAllowed('openai-route-client')
      throw new Error('should have thrown')
    } catch (e) {
      expect(isAiSpendDisabledError(e)).toBe(true)
      expect((e as AiSpendDisabledError).httpStatus).toBe(402)
      expect((e as AiSpendDisabledError).code).toBe('ai_spend_disabled')
      // The context must be named so an operator can tell WHICH boundary refused.
      expect((e as Error).message).toContain('openai-route-client')
      // And it must not read as a misconfiguration to whoever finds it in a log.
      expect((e as Error).message).toMatch(/deliberate/i)
    }
  })

  it('does not mistake an ordinary error for a spend refusal', () => {
    expect(isAiSpendDisabledError(new Error('network down'))).toBe(false)
    expect(isAiSpendDisabledError(null)).toBe(false)
  })
})

describe('AI spend guard — build phase', () => {
  it('does not throw during a production build', () => {
    // `next build` collects page data without the runtime env and may construct clients at module
    // scope. Throwing there would break the build while protecting nothing — no request is served.
    process.env.NEXT_PHASE = 'phase-production-build'
    expect(() => assertAiSpendAllowed('build')).not.toThrow()
  })
})

describe('AI spend guard — provider boundary coverage', () => {
  const repo = process.cwd()
  const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8')

  /**
   * Boundaries wired to the guard. Moving a module from UNGUARDED to here is the intended direction.
   *
   * These are the points where a request actually LEAVES for a provider — deliberately not
   * `providerRouter`, which only chooses between them. Guarding the router would have refused
   * callers that inject or mock a client and therefore never would have spent anything, while
   * leaving anyone who calls a client directly unguarded.
   */
  const GUARDED = [
    'lib/openai-client.ts',
    'lib/xai-client.ts',
    'lib/deepseek-client.ts',
    'lib/ai/openai-route-client.ts',
    'lib/decision-os/three-brain/orchestrator.ts',
    // A ROUTE can be a provider boundary too, and this list used to assume they
    // could not be. improve-trade builds two OpenAI SDK clients and fetches
    // api.x.ai directly, all inside the handler, so nothing under lib/ ever saw
    // those calls. It is unauthenticated and rate-limited only by IP
    // (5/60s), and MAX_TOOL_TURNS lets one request drive several model calls.
    'app/api/instant/improve-trade/route.ts',
    // The other three inline-provider routes, guarded 2026-08-27.
    // start-sit/chimmy has NO session check and NO rate limit, so the spend
    // switch is the only thing between an anonymous caller and a paid call.
    'app/api/chat/chimmy/route.ts',
    'app/api/start-sit/chimmy/route.ts',
    'app/api/waiver-ai/grok/route.ts',
    // Moved off the ratchet 2026-08-27. Reached from 18 route files, the widest
    // surface on that list at the time.
    'lib/ai/league-settings-ai/claude.ts',
    // Moved off the ratchet 2026-08-27. Its sibling orchestrator.ts was
    // already guarded, so the two halves of three-brain disagreed.
    'lib/decision-os/three-brain/anthropicClient.ts',
    /*
     * Guarded 2026-08-27, but read this before treating the -1 as progress:
     * NOTHING CALLS THIS FILE. Zero callers by module path, relative path,
     * dynamic import, or any exported name; the only other mention in the repo
     * was its own ratchet entry. Guarding it removed no live spend — it is
     * insurance against someone wiring up a DALL-E path that was never
     * metered. Deleting the file would be the stronger fix.
     */
    'lib/ai/imageGenerator.ts',
    /*
     * Two providers in one module: it imports the GUARDED xai-client and also
     * builds its own OpenAI client. Ask what a file CONSTRUCTS, never what it
     * imports — a census on imports marks this one covered and moves on.
     *
     * Guarded 2026-08-27, then reverted the same day by 2c959164c, an
     * unrelated draft-HQ commit that carried a stale copy of this file and of
     * lib/ai-gm-intelligence.ts. Restored here.
     */
    'lib/ai-gm-intelligence.ts',
    /*
     * THE RATCHET DOES NOT DROP FOR THIS ONE: it was in neither list. Found by
     * scanning for provider access. Its caller app/api/chat/chimmy/route.ts was
     * already guarded — on getVisionClient(), a different client — so the route
     * read as protected while a tool-loop turn still reached xAI unmetered.
     */
    'lib/chimmy/tools/chimmyToolLoop.ts',
    /*
     * Both guarded 2026-08-27. Each holds THREE providers: deepseekChat via
     * the guarded @/lib/deepseek-client, plus an OpenAI and a Grok client
     * built in the file and metered by nothing. Both were mis-read as
     * covered by a census that asked what they import rather than what they
     * construct — the same mistake ai-gm-intelligence hid behind.
     */
    'lib/fantasy-coach/CoachEvaluationAI.ts',
    'lib/simulation-engine/MatchupSimulationInsightAI.ts',
    /*
     * The remainder of the ratchet, cleared 2026-08-27. Guard FORM per file is
     * dictated by that file's existing contract, never by preference:
     * a factory that already throws without a key gets assertAiSpendAllowed;
     * one that returns null or [] gets isAiSpendEnabled and returns the same.
     * A refusal therefore behaves exactly like an unconfigured provider,
     * which every caller already handles.
     */
    'lib/ai/working-memory.ts',
    'lib/autocoach/status-sources/XGrokAdapter.ts',
    'lib/brackets/intelligence/ai-narrator.ts',
    'lib/brand-social/draftWithClaude.ts',
    'lib/draft/ai-claude.ts',
    'lib/fantasy-news-aggregator/NewsSummarizerAI.ts',
    'lib/guillotine/ai/GuillotineAIService.ts',
    'lib/integrity/CollusionDetectionEngine.ts',
    'lib/integrity/TankingDetectionEngine.ts',
    'lib/salary-cap/ai/SalaryCapAIService.ts',
    'lib/smart-trade-recommendations.ts',
    'lib/social-sharing/GrokShareCopyService.ts',
    'lib/survivor/ai/SurvivorAIService.ts',
    'lib/trade-engine/ai-layer.ts',
    'lib/zombie/ai/ZombieAIService.ts',
    // Found by the census scan below rather than by any list — it was on no
    // ratchet and in no GUARDED entry. That find is why the scan exists.
    'lib/social-clips-grok/GrokSocialContentService.ts',
    // Also found by the census, and only once it learned to spot a boundary
    // that resolves its base URL from config instead of a literal.
    'lib/ai-external/grok.ts',
  ]

  /**
   * ⚠ THIS RATCHET ONLY WATCHES `lib/`, so a route that calls a provider inline
   * is invisible to it — neither guarded nor counted as debt. Four such routes
   * existed and were found by census rather than by this list; all four are now
   * in GUARDED above.
   *
   * The blind spot itself is NOT fixed. A new route that constructs a client in
   * its own handler would still be invisible here. Closing that means scanning
   * for provider access rather than enumerating lib/ paths, which is the census
   * at the bottom of this file — and it has to walk `server/` as well as
   * `app/api`, because this repo serves route handlers out of both trees.
   */

  /**
   * Known-unguarded provider boundaries — a RATCHET, not an allowlist. Each still spends money on
   * its own. The list must only ever shrink; adding to it means a new unguarded spend path shipped.
   *
   * EMPTY as of 2026-08-27. Every boundary this list ever named is now guarded.
   * Keep the list and the bound: an empty ratchet is the assertion that no NEW
   * unguarded path has shipped, which is the only thing it was ever really for.
   */
  const UNGUARDED_RATCHET: string[] = []

  /**
   * PERMANENT exception, not debt. lib/agents/workers/api-health-monitor.ts probes whether a
   * provider is UP, which is the one job that cannot be answered from Postgres — the same
   * standing exception CLAUDE.md records for SystemHealthResolver.
   *
   * ⚠ GUARDING IT WOULD MAKE IT LIE. With spend off it would report every provider as `down`,
   * when the provider is fine and we simply are not buying. A health dashboard that reports an
   * outage because a billing switch is off is worse than no dashboard. It is listed here so it
   * reads as a decision rather than as something the sweep missed.
   */

  /*
   * Either form counts as wired to the guard, and the choice is forced by the
   * boundary's own contract rather than preference:
   *   assertAiSpendAllowed - throws; correct where a missing key already throws.
   *   isAiSpendEnabled     - returns false; correct where the caller returns a
   *                          null/degraded value instead, as getVisionClient in
   *                          chat/chimmy does. Making that one throw to satisfy
   *                          a regex would turn a graceful fallback into a 500.
   */
  it.each(GUARDED)('%s is wired to the spend guard', (file) => {
    expect(read(file)).toMatch(/assertAiSpendAllowed\(|isAiSpendEnabled\(/)
  })

  it('the unguarded ratchet has not grown', () => {
    // If this fails high, an unguarded provider boundary was added. If it fails low, someone
    // guarded one — lower the number, that is the point.
    expect(UNGUARDED_RATCHET.length).toBeLessThanOrEqual(0)
  })

  it('every ratchet entry still exists (stale entries hide real coverage)', () => {
    const missing = UNGUARDED_RATCHET.filter((f) => !fs.existsSync(path.join(repo, f)))
    expect(missing).toEqual([])
  })

  it('the permanent exception is deliberately NOT guarded', () => {
    // Asserted, not assumed: if someone "helpfully" guards the health probe, this
    // fails and tells them why instead of letting the dashboard start lying.
    for (const file of PERMANENT_EXCEPTIONS) {
      expect(fs.existsSync(path.join(repo, file))).toBe(true)
      expect(read(file)).not.toMatch(/assertAiSpendAllowed\(|isAiSpendEnabled\(/)
    }
  })
})

/*
 * A CENSUS, NOT A LIST.
 *
 * Everything above enumerates paths, which means it can only ever be a FLOOR:
 * a boundary nobody added is invisible, neither guarded nor counted as debt.
 * Three classes were found that way in one session — four app/api routes
 * constructing clients inside their handlers, a lib module omitted outright,
 * and three modules importing a GUARDED client while building an unguarded one
 * of their own.
 *
 * This scans instead. It walks the source and asks what each file CONSTRUCTS,
 * so a new provider boundary fails on the commit that adds it rather than
 * whenever someone next runs a manual sweep.
 */
describe('AI spend guard — provider boundary census', () => {
  const repo = process.cwd()

  /*
   * ⚠ THIS REPO HAS ROUTE HANDLERS IN TWO TREES. `app/api/legacy/[...path]/route.ts`
   * is a dispatcher that lazily imports modules under `server/api-route-modules/`,
   * so those handlers are live request paths that no `app/api/**` sweep can see.
   *
   * `server/` was missed on the first pass and cost real coverage: two legacy
   * routes — ai-coach (OpenAI) and share (xAI) — were calling a provider inline,
   * unguarded, reachable by any gated caller. The same blind spot had already hidden
   * an api.sleeper.com caller from the DB-first census, which is what prompted
   * looking here at all. Adding a root is cheap; assuming a tree is not routed is not.
   */
  const ROOTS = ['lib', 'app/api', 'server', 'scripts']
  const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'build', '__tests__', '__mocks__'])

  /** Constructing a provider SDK is a boundary on its own. */
  const SDK_CONSTRUCT = /\bnew\s+(OpenAI|Anthropic)\s*\(/
  /** A provider host is only a boundary when the file also makes a call — config files name hosts too. */
  const PROVIDER_HOST =
    /https?:\/\/api\.(openai|anthropic|x\.ai|deepseek|groq)\.com|generativelanguage\.googleapis\.com|openrouter\.ai/
  const MAKES_CALL = /\bfetch\s*\(|\.chat\.completions\.create\s*\(|\.messages\.create\s*\(/
  /*
   * Third signal, and the one that matters most. A boundary can resolve its base
   * URL from config and construct nothing — lib/xai-client.ts does exactly that,
   * and the first two signals are blind to it despite it being one of the most
   * used clients in the codebase. Reading a provider API key and then making a
   * call is the shape that catches those. It found lib/ai-external/grok.ts,
   * which every path-based and literal-based sweep had missed.
   */
  const PROVIDER_KEY_ENV = /\b(OPENAI|ANTHROPIC|XAI|GROK|DEEPSEEK)_API_KEY\b/

  /** Either form counts — see the note on GUARDED for why both exist. */
  const IS_WIRED = /assertAiSpendAllowed\(|isAiSpendEnabled\(/

  function walk(dir: string, out: string[] = []): string[] {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(p, out)
      } else if (/\.(tsx?|mjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        /*
         * ⚠ .mjs AND .js ARE IN SCOPE, and adding the scripts/ root without them
         * would have been worse than not adding it: both real provider boundaries
         * under scripts/ are .mjs (ai-smoke, x-news-probe), so a .tsx?-only walk
         * would have reported a clean new root and manufactured confidence.
         *
         * Cheap elsewhere — no .mjs/.js under lib, app or server touches a provider,
         * so this widens the net without widening the noise.
         */
        out.push(p)
      }
    }
    return out
  }

  function findBoundaries() {
    const found: Array<{ file: string; why: string; wired: boolean }> = []
    for (const root of ROOTS) {
      for (const abs of walk(path.join(repo, root))) {
        const file = path.relative(repo, abs).split(path.sep).join('/')
        const src = fs.readFileSync(abs, 'utf8')
        const call = MAKES_CALL.test(src)
        const sdk = SDK_CONSTRUCT.test(src)
        const hostCall = PROVIDER_HOST.test(src) && call
        const keyCall = PROVIDER_KEY_ENV.test(src) && call
        if (!sdk && !hostCall && !keyCall) continue
        const why = sdk
          ? 'constructs an SDK client'
          : hostCall
            ? 'provider host + outbound call'
            : 'provider API key + outbound call'
        found.push({ file, why, wired: IS_WIRED.test(src) })
      }
    }
    return found
  }

  it('finds boundaries at all (a scan that finds nothing always passes)', () => {
    // Guards the guard: a broken walk or a typo in the patterns would make every
    // assertion below vacuously true.
    const found = findBoundaries()
    expect(found.length).toBeGreaterThan(20)
    // xai-client is the canary ON PURPOSE: it constructs nothing and names no
    // host, so it is visible only to the third signal. If someone simplifies the
    // patterns back to "SDK or literal host", this fails rather than quietly
    // shrinking the census.
    expect(found.some((f) => f.file === 'lib/xai-client.ts')).toBe(true)
    expect(found.some((f) => f.file === 'lib/openai-client.ts')).toBe(true)
    // One canary per ROOT, so dropping a root fails here rather than quietly
    // shrinking the census to the trees someone happened to remember.
    expect(found.some((f) => f.file.startsWith('app/api/'))).toBe(true)
    expect(found.some((f) => f.file.startsWith('server/'))).toBe(true)
    expect(found.some((f) => f.file.startsWith('scripts/'))).toBe(true)

    /*
     * The canaries above catch a root that yields nothing; they CANNOT catch a root
     * deleted from ROOTS, because the checks are written per-root and would simply
     * stop running. That case has to be pinned against a literal.
     */
    expect(
      ROOTS,
      'a source tree was dropped from the census — see the note on ROOTS before changing this',
    ).toEqual(['lib', 'app/api', 'server', 'scripts'])
  })

  it('every provider boundary is wired to the spend guard, or a declared exception', () => {
    const unaccounted = findBoundaries()
      .filter((f) => !f.wired)
      .filter((f) => !PERMANENT_EXCEPTIONS.includes(f.file))
      .filter((f) => !SCAN_FALSE_POSITIVES.includes(f.file))
    expect(
      unaccounted.map((f) => `${f.file} (${f.why})`),
      'A new provider boundary shipped unguarded. Wire it to lib/ai/aiSpendGuard, ' +
        'matching the guard form to the function contract: throw where a missing key ' +
        'already throws, return null/[] where the caller expects a degraded value. ' +
        'If it is a liveness probe, add it to PERMANENT_EXCEPTIONS with the reason.',
    ).toEqual([])
  })

  it('every declared exception is still a real, still-unguarded boundary', () => {
    // A stale exception is worse than none: it silently excuses a file that has
    // moved on, or one that someone has since guarded.
    const found = findBoundaries()
    for (const exc of PERMANENT_EXCEPTIONS) {
      const hit = found.find((f) => f.file === exc)
      expect(hit, `${exc} is declared an exception but the scan no longer sees it as a boundary`).toBeTruthy()
      expect(hit!.wired, `${exc} is now guarded — remove it from PERMANENT_EXCEPTIONS`).toBe(false)
    }
  })

  it('every declared false positive is still only a false positive', () => {
    /*
     * The dismissal is pinned to its REASON, not taken on trust. Each of these is
     * flagged solely by the key-name signal, so it must name no provider host and
     * construct no SDK client. The day one of them grows a real provider call, this
     * fails and the file has to be re-argued instead of coasting on a stale note.
     */
    for (const file of SCAN_FALSE_POSITIVES) {
      const abs = path.join(repo, file)
      expect(fs.existsSync(abs), `${file} no longer exists — remove it`).toBe(true)
      const src = fs.readFileSync(abs, 'utf8')
      expect(SDK_CONSTRUCT.test(src), `${file} now constructs a provider client`).toBe(false)
      expect(PROVIDER_HOST.test(src), `${file} now names a provider host`).toBe(false)
    }
  })
})
