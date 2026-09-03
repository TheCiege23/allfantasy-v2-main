/**
 * Post-deploy verification for the redirect class that broke silently on 2026-09-02.
 *
 * WHY THIS EXISTS
 * Every verification email, password-reset link, Yahoo connect and beta invite in production
 * redirected to `https://0.0.0.0:8080` -- the address the server BOUND to, not the host the
 * visitor reached. Next builds a route handler's `req.url` from `-H 0.0.0.0 -p 8080`, so anything
 * derived from it points at a host no browser can open. Nothing threw, nothing logged, no test
 * went red: the account was marked verified and the visitor got a connection error. It was found
 * by a user saying "the email doesn't work", not by us.
 *
 * __tests__/no-bind-address-origins.test.ts stops the SOURCE pattern coming back. This is the
 * other half -- it checks what production actually SERVES, because the same symptom can return
 * with no source change at all: a bad PUBLIC_SITE_URL, an edited start command, a Next upgrade
 * that changes attachRequestMeta. A source guard cannot see any of those.
 *
 * THREE RULES, each one a way a check like this lies:
 *
 *   1. VERIFY THE BUILD YOU MEANT TO VERIFY. Probing "the site" proves nothing about the commit
 *      you just pushed -- the old build answers every probe just as well. With --expect-sha this
 *      waits for /api/af-debug/sha to report that commit before asserting anything, and reports
 *      NOT_DEPLOYED if it never arrives. That outcome is not a technicality: on 2026-09-02
 *      auto-deploy was silently off, two commits sat unshipped for an hour, and every probe
 *      against the stale build passed.
 *
 *   2. AN UNREACHABLE SITE IS NOT A REGRESSION AND MUST NOT BE REPORTED AS ONE. A cold container
 *      here has taken 39s to answer /api/health while the cron loop saturated it. Probes retry,
 *      and a site that will not answer exits UNREACHABLE with its own message, never "the
 *      redirect regressed". A monitor that misreports its own failure as a production incident is
 *      worse than no monitor.
 *
 *   3. IT MUST BE ABLE TO GO RED. --self-test runs every assertion against synthetic responses
 *      carrying the real 2026-09-02 Location values and requires each to be caught. It runs
 *      before every live check, not only on demand. A check that has never failed is not
 *      evidence.
 *
 * WHAT COUNTS AS BROKEN: a Location whose host is unroutable from a browser. Relative is what the
 * code emits and is ideal, but an absolute URL at a canonical host is not a defect -- so the
 * assertion targets the actual harm rather than today's implementation choice.
 */

const BASE = (process.env.VERIFY_BASE_URL || 'https://allfantasy.ai').replace(/\/$/, '')
const CANONICAL_HOSTS = new Set(['allfantasy.ai', 'www.allfantasy.ai'])
const BOGUS = 'deploy-verify-not-a-real-token'

/**
 * Hosts that mean "every interface" to a server and nothing at all to a client.
 *
 * ⚠ Takes a HOSTNAME, never a host. `url.host` on an IPv6 literal is `[::]:8080`, and stripping
 * the brackets before the port leaves `::]:8080` -> `::]`, which matches nothing. The self-test
 * caught exactly that: `http://[::]:8080/login` was being rejected for the wrong reason, by the
 * canonical-host allowlist rather than by this function. `url.hostname` is already `[::]`, so
 * only the brackets need removing.
 */
function isUnroutableHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return h === '0.0.0.0' || h === '::' || h === '' || h === '0' || h === 'localhost' || h === '127.0.0.1'
}

/** A Location is acceptable if it is site-relative, or absolute at a canonical host. */
function judgeLocation(location) {
  if (!location) return { ok: false, kind: 'missing', why: 'no Location header on a redirect' }
  if (location.startsWith('/') && !location.startsWith('//')) return { ok: true, kind: 'relative' }

  let url
  try {
    url = new URL(location)
  } catch {
    return { ok: false, kind: 'unparseable', why: `unparseable Location: ${location}` }
  }
  if (isUnroutableHost(url.hostname)) {
    return { ok: false, kind: 'unroutable', why: `Location points at an unroutable host: ${url.host} -- the bind-address regression` }
  }
  if (!CANONICAL_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, kind: 'offsite', why: `Location leaves the site: ${url.host}` }
  }
  return { ok: true, kind: 'canonical' }
}

const PROBES = [
  { name: 'verify/email (the reported bug)', path: `/verify/email?token=${BOGUS}&returnTo=%2Fonboarding`, redirect: true },
  { name: 'api/auth/verify-email', path: `/api/auth/verify-email?token=${BOGUS}`, redirect: true },
  { name: 'api/auth/beta/claim', path: '/api/auth/beta/claim', redirect: true },
  { name: 'api/league/yahoo/callback', path: '/api/league/yahoo/callback', redirect: true },
  { name: 'api/league/yahoo-auth', path: '/api/league/yahoo-auth', redirect: true },
  { name: 'api/auth/logout (was a 500)', path: '/api/auth/logout', method: 'POST', redirect: true },
  { name: 'api/health', path: '/api/health', redirect: false },
]

class Unreachable extends Error {}

async function probe({ path, method = 'GET' }, attempt = 1) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    return { status: res.status, location: res.headers.get('location') }
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 5000))
      return probe({ path, method }, attempt + 1)
    }
    throw new Unreachable(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function waitForSha(expected, budgetMs = 15 * 60_000) {
  const deadline = Date.now() + budgetMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/af-debug/sha`, { signal: AbortSignal.timeout(20_000) })
      const body = await res.json()
      last = typeof body?.sha === 'string' ? body.sha : null
      if (last && last.startsWith(expected.slice(0, 9))) return { deployed: true, sha: last }
    } catch {
      // A cold or restarting container is expected while a deploy lands. Keep waiting.
    }
    await new Promise((r) => setTimeout(r, 30_000))
  }
  return { deployed: false, sha: last }
}

function selfTest() {
  /*
   * ⚠ EACH CASE PINS THE *REASON*, NOT JUST THE VERDICT, AND THAT IS THE WHOLE POINT.
   *
   * The first version of this self-test asserted only `ok === false`. It passed with
   * isUnroutableHost() deliberately disabled -- because a `0.0.0.0` host is ALSO rejected by
   * the canonical-host allowlist one line below, so the bad Location was still caught, just by
   * the wrong branch. A mutation control that cannot tell which branch fired is not a control:
   * it would have gone on reporting green with the bind-address detector dead.
   *
   * Same lesson as reading a typecheck delta by error code rather than by count. Assert on the
   * discriminator, never on the scalar.
   */
  const mustFail = [
    // The literal values production served on 2026-09-02.
    ['https://0.0.0.0:8080/verify?error=INVALID_LINK&returnTo=%2Fonboarding', 'unroutable'],
    ['https://0.0.0.0:8080/login', 'unroutable'],
    ['https://0.0.0.0:8080/signup?beta=1', 'unroutable'],
    ['http://[::]:8080/login', 'unroutable'],
    ['https://evil.example.com/login', 'offsite'],
    [null, 'missing'],
  ]
  const mustPass = [
    ['/verify?error=INVALID_LINK&returnTo=%2Fonboarding', 'relative'],
    ['/login?callbackUrl=%2Fapi%2Fleague%2Fyahoo-auth', 'relative'],
    ['https://allfantasy.ai/verify/email?token=x', 'canonical'],
    ['https://www.allfantasy.ai/verify', 'canonical'],
  ]

  let bad = 0
  for (const [loc, expectedKind] of mustFail) {
    const v = judgeLocation(loc)
    if (v.ok) {
      console.error(`  SELF-TEST FAILED: accepted a bad Location: ${loc}`)
      bad++
    } else if (v.kind !== expectedKind) {
      console.error(`  SELF-TEST FAILED: ${loc} was rejected as '${v.kind}', expected '${expectedKind}'`)
      console.error('    Caught by the wrong branch -- the intended detector may be dead.')
      bad++
    }
  }
  for (const [loc, expectedKind] of mustPass) {
    const v = judgeLocation(loc)
    if (!v.ok) {
      console.error(`  SELF-TEST FAILED: rejected a good Location: ${loc} (${v.why})`)
      bad++
    } else if (v.kind !== expectedKind) {
      console.error(`  SELF-TEST FAILED: ${loc} accepted as '${v.kind}', expected '${expectedKind}'`)
      bad++
    }
  }

  if (bad === 0) {
    console.log(`  self-test ok -- ${mustFail.length} bad Locations caught, ${mustPass.length} good ones accepted`)
    return true
  }
  console.error(`  self-test FAILED with ${bad} problem(s) -- the assertions cannot be trusted`)
  return false
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

  console.log(`Verifying ${BASE}`)

  const shaArg = args.find((a) => a.startsWith('--expect-sha='))
  if (shaArg) {
    const expected = shaArg.slice('--expect-sha='.length).trim()
    console.log(`Waiting for the deploy of ${expected.slice(0, 9)} ...`)
    const { deployed, sha } = await waitForSha(expected)
    if (!deployed) {
      console.error(`\nNOT_DEPLOYED -- after 15 min /api/af-debug/sha still reports ${sha ?? 'nothing'}, not ${expected.slice(0, 9)}.`)
      console.error('   The push did not reach production, so nothing below would have tested it.')
      console.error('   Check that auto-deploy is enabled on the Railway service: it was silently off on')
      console.error('   2026-09-02 and two commits sat unshipped for an hour while probes kept passing.')
      process.exit(2)
    }
    console.log(`  deployed: ${sha.slice(0, 9)}`)
  }

  // Rule 3: prove the assertions can fail before trusting them to pass.
  if (!selfTest()) process.exit(1)

  const failures = []
  for (const p of PROBES) {
    let r
    try {
      r = await probe(p)
    } catch (err) {
      if (err instanceof Unreachable) {
        console.error(`\nUNREACHABLE -- ${err.message}`)
        console.error('   The site did not answer after 3 attempts. This is NOT a redirect regression;')
        console.error('   it is a reachability or capacity problem and must be read as one.')
        process.exit(3)
      }
      throw err
    }

    if (r.status >= 500) {
      failures.push(`${p.name}: HTTP ${r.status} where a ${p.redirect ? 'redirect' : '200'} belongs`)
      console.log(`  FAIL  ${p.name}  ${r.status}`)
      continue
    }

    if (!p.redirect) {
      console.log(`  ok    ${p.name}  ${r.status}`)
      continue
    }

    const verdict = judgeLocation(r.location)
    if (!verdict.ok) {
      failures.push(`${p.name}: ${verdict.why}`)
      console.log(`  FAIL  ${p.name}  ${r.status}  ${r.location ?? '(no Location)'}`)
      continue
    }
    console.log(`  ok    ${p.name}  ${r.status}  ${r.location}`)
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} REGRESSION(S):`)
    for (const f of failures) console.error(`   - ${f}`)
    console.error('\nThe fix lives in lib/http/relative-redirect.ts and lib/http/served-origin.ts.')
    process.exit(1)
  }

  console.log(`\nAll ${PROBES.length} probes passed.`)
}

main().catch((err) => {
  console.error('verify-deployed-redirects crashed:', err)
  process.exit(1)
})
