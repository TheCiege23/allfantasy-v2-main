/**
 * CI guard for the legacy Sleeper-identity class.
 *
 * Every legacy route that takes a Sleeper username as REQUEST INPUT must resolve identity
 * through `requireLegacySleeperIdentity`, or be on the explicit allowlist below with a
 * stated reason. Without this, the class silently reopens the next time someone adds a
 * route that reads `body.sleeper_username` — which is exactly how it grew to 19 routes.
 *
 * Deliberately NOT matched by grepping for "requireAuth": `lib/api-auth` exports a
 * same-named `requireAuth(req)` and a `requireAuthOrOrigin(req)` that are not
 * authentication at all, so that grep marks the broken routes as protected.
 *
 * Shape follows `admin-api-protection`: collect ALL offenders and assert the list is
 * empty, plus a floor on the discovered count. Asserting inside the loop would abort on
 * the first offender and leave the rest of the surface unchecked — the antipattern that
 * made two other guards in this repo silently useless.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const LEGACY_DIR = join(ROOT, 'server', 'api-route-modules', 'legacy')
const HELPER = 'requireLegacySleeperIdentity'

/**
 * Routes allowed to read a username without the identity gate. Each needs a reason —
 * "it would break" is not one. Anything not listed here must use the helper.
 */
const PUBLIC_ALLOWLIST: Record<string, string> = {
  'guest-import/route.ts':
    'Entry point that CREATES the guest session. Requiring an identity here would make ' +
    'guest onboarding impossible — there is no session to require yet. Rate-limited, and ' +
    'it only ever writes rows for the username it was given.',
  'email-preferences/route.ts':
    'Email-capture / notification-preferences surface keyed on EMAIL, not on league data. ' +
    'Requiring a session breaks signing up for alerts before having an account. Different ' +
    'class from the roster/trade IDOR — but note it still allows lookup BY username, which ' +
    'is a narrower enumeration worth closing separately.',
  'import/route.ts':
    'The CLAIM entry point. It must accept an arbitrary Sleeper handle — that is how a ' +
    'handle gets linked to an account in the first place — and it is already gated by ' +
    'requireVerifiedUser() from @/lib/auth-guard (stronger than this helper). Ownership is ' +
    'enforced downstream by linkAfUserToLegacy, which 409s if another AppUser already ' +
    'claimed that LegacyUser.',
}

/**
 * Handlers inside an otherwise-gated file that legitimately need no gate, with the count
 * and the reason. Without this the per-handler check flags them forever and gets muted —
 * and a noisy guard is a disabled guard.
 *
 * This allowance exists because the per-handler check found a REAL miss: `share/engagement`
 * GET returned any user's history by name while its POST was already gated. Keeping the
 * check and exempting only the genuine cases preserves that value.
 */
const UNGATED_HANDLER_ALLOWANCE: Record<string, number> = {
  // GET takes no request argument at all — it returns static API usage documentation.
  'rankings/adaptive/route.ts': 1,
  // GET reads and DELETE clears the caller's OWN cookie via getUserSessionFromCookie().
  // Neither accepts a username, and both are origin-checked.
  'session/route.ts': 2,
  // GET is an admin listing gated on the `admin_session` cookie — a different, real gate.
  'trade/feedback/route.ts': 1,
}

/**
 * Username arriving from the caller — property access, destructuring, or a query param.
 *
 * The destructuring pattern matches `= body`, `= body ?? {}`, `= await req.json()` and so
 * on rather than only `= req`: an earlier version required `req` on the right-hand side
 * and silently missed `const { sleeper_username } = body ?? {}`, which is how
 * `guest-import` reads it. A missed pattern here is a route that skips the guard.
 */
const INPUT_PATTERNS: RegExp[] = [
  /body\s*\.\s*sleeper_username/,
  /body\s*\?\.\s*sleeper_username/,
  /\{[^}]*\bsleeper_username\b[^}]*\}\s*=/s,
  /searchParams\s*\.\s*get\(\s*['"]sleeper_username['"]/,
  /searchParams\s*\.\s*get\(\s*['"]username['"]/,
]

function walk(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** Strip comments so a commented-out gate cannot satisfy the match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('legacy routes taking a Sleeper username must resolve identity server-side', () => {
  const files = walk(LEGACY_DIR)
  const inScope = files.filter((f) => {
    const code = stripComments(readFileSync(f, 'utf8'))
    return INPUT_PATTERNS.some((re) => re.test(code))
  })

  it('found the legacy route surface at all (guards against a moved directory)', () => {
    // An empty walk yields zero offenders, which is indistinguishable from a clean repo.
    expect(files.length, `no route.ts files under ${relative(ROOT, LEGACY_DIR)} — the walk is broken`)
      .toBeGreaterThan(20)
    expect(inScope.length, 'no legacy route appears to take a username as input — the input patterns have drifted')
      .toBeGreaterThan(5)
  })

  it('every username-taking legacy route uses the shared identity gate or is explicitly allowlisted', () => {
    const offenders: string[] = []
    for (const file of inScope) {
      const rel = relative(LEGACY_DIR, file).replace(/\\/g, '/')
      if (rel in PUBLIC_ALLOWLIST) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      /*
       * Require an actual CALL and an actual check of its result — not merely the
       * identifier appearing somewhere. An earlier version tested `code.includes(HELPER)`,
       * which the leftover `import { requireLegacySleeperIdentity }` line satisfies on its
       * own: a route could import the gate, never call it, and still pass. Negative-control
       * caught that. `stripComments` above additionally stops a commented-out call from
       * counting.
       */
      const gateCalls = (code.match(new RegExp(`${HELPER}\\s*\\(`, 'g')) || []).length
      const checksResult = /\.ok\b/.test(code) && /return\s+\w+\.response/.test(code)
      /*
       * Count gates against exported request handlers. File-granularity alone is not
       * enough: a module exporting both GET and POST where only one is gated would pass a
       * mere "does this file mention the helper" check — negative-control demonstrated
       * exactly that on trades/check. Every exported handler needs its own gate.
       */
      const handlers = (code.match(/export\s+(const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g) || []).length
      const exempt = UNGATED_HANDLER_ALLOWANCE[rel] ?? 0
      if (gateCalls === 0 || !checksResult) offenders.push(rel)
      else if (handlers - exempt > gateCalls) {
        offenders.push(`${rel} (${handlers} handlers, ${exempt} exempt, only ${gateCalls} gate call(s))`)
      }
    }
    expect(
      offenders.sort(),
      `these legacy routes read a caller-supplied Sleeper username without ${HELPER}, so they ` +
        `serve whoever the caller names:\n  ${offenders.join('\n  ')}\n` +
        `Fix: route identity through lib/legacy/${HELPER}.ts, or add an entry to ` +
        `PUBLIC_ALLOWLIST in this file WITH a reason.`,
    ).toEqual([])
  })

  it('the allowlist has no stale entries', () => {
    // A stale entry silently exempts a route that no longer exists — or worse, one that was
    // renamed and now bypasses the guard under a new path.
    const inScopeRel = new Set(inScope.map((f) => relative(LEGACY_DIR, f).replace(/\\/g, '/')))
    const stale = Object.keys(PUBLIC_ALLOWLIST).filter((k) => !inScopeRel.has(k))
    expect(stale, `allowlisted routes that no longer take a username as input: ${stale.join(', ')}`).toEqual([])
  })

  it('no username-taking legacy route gates on requireAuthOrOrigin', () => {
    /*
     * `requireAuthOrOrigin` returns {authenticated:true, user:null} on a spoofable header,
     * so it authenticates nobody. Cookie *plumbing* imports (setUserSessionCookie etc.)
     * are fine — it is the auth-shaped functions that must not be used as gates.
     *
     * SCOPED to username-taking routes, which is what this sweep closed. A further ~15
     * legacy routes that do NOT take a username still gate on this helper: they are not
     * username-IDOR-able, but they are not authenticated either. That is a real, separate
     * finding — tightening this assertion to all `files` is the follow-up that forces it.
     */
    const offenders: string[] = []
    for (const file of inScope) {
      const code = stripComments(readFileSync(file, 'utf8'))
      const rel = relative(LEGACY_DIR, file).replace(/\\/g, '/')
      if (/requireAuthOrOrigin\s*\(/.test(code)) offenders.push(`${rel} (requireAuthOrOrigin)`)
    }
    expect(
      offenders.sort(),
      `these username-taking legacy routes gate on requireAuthOrOrigin, which authenticates nobody:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
