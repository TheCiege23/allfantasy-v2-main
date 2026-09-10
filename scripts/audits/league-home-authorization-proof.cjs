/**
 * Two-user browser proof for the `/core?league=` authorization gate.
 *
 * WHAT IT PROVES, with two real sessions against a real server:
 *   A — a member — still receives the complete league home.
 *   B — a signed-in NON-member — receives no league data at all.
 *   B's answer for someone else's league is indistinguishable from its answer
 *   for a league id that does not exist.
 *
 * 🛑 THE DEFECT THIS LOCKS DOWN. Before 2026-09-10 `getLeagueHomeData` was
 * `findUnique({ where: { id: leagueId } })` with no `userId` clause; `userId` was
 * used only after the league loaded, to find the viewer's own team. Measured on
 * this same harness: B — registered seconds earlier, with no `League.userId`, no
 * `RedraftLeagueMember`, no `Roster` and no claimed `LeagueTeam` — received
 * HTTP 200, the league home root, and the league's real name in the `<h1>`,
 * while `leagueNameForTitle` in the same route scoped correctly and withheld
 * that name from the `<title>`. One request, two answers, and the safe one lost.
 *
 * ⚠ THE STATUS CODE IS REPORTED, NOT ASSERTED, AND THE REASON IS MEASURED.
 * `app/core/[[...screen]]/loading.tsx` makes this route stream: Next sends the
 * shell with HTTP 200 before the page body runs, so a later `notFound()` renders
 * the not-found UI into an already-committed response and cannot change the
 * status. Verified both ways on this server — with `loading.tsx` moved aside the
 * same request returns a true **404**; with it restored, **200**. The body is the
 * not-found page either way and carries zero league data, which is the property
 * that matters for disclosure. Asserting 404 here would make this proof fail for
 * a framework reason while the security behaviour is correct, so it is surfaced
 * as a line of evidence for a human instead.
 *
 * SETUP — a server this script does NOT start, so the database it talks to is a
 * decision made outside it:
 *
 *   AF_NEXT_DIST_DIR=.next-dev-mobile-batch DEV_AUTH_BYPASS_ENABLED=true \
 *   node node_modules/next/dist/bin/next dev -p 3010 -H 127.0.0.1
 *
 *   node scripts/audits/league-home-authorization-proof.cjs
 */
const assert = require('assert/strict')
const path = require('path')
const root = path.resolve(__dirname, '../..').split(path.sep).join('/')
const playwright = require(root + '/node_modules/playwright')

const BASE = process.env.AF_PROOF_BASE_URL || 'http://127.0.0.1:3010'
const REPORT_ONLY = process.env.AF_PROOF_REPORT_ONLY === '1'
const MISSING_LEAGUE_ID = '00000000-0000-4000-8000-000000000000'

const failures = []
const notes = []
function check(condition, message) {
  if (condition) {
    notes.push('  ok   ' + message)
    return
  }
  if (REPORT_ONLY) {
    failures.push(message)
    notes.push('  FAIL ' + message)
  } else {
    assert.fail(message)
  }
}
function note(message) {
  notes.push('  note ' + message)
}

const stamp = Date.now()
const B = {
  username: `authzproof${stamp}`.slice(0, 20),
  email: `authz-proof-${stamp}@example.com`,
  password: `Authz!Proof${stamp}aA1`,
}

async function signInDevBypass(ctx) {
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`, { timeout: 120000 })).json()
  const r = await ctx.request.post(`${BASE}/api/auth/callback/dev-bypass`, {
    form: { csrfToken, callbackUrl: `${BASE}/core`, json: 'true' },
    timeout: 120000,
  })
  if (!r.ok()) throw new Error(`dev-bypass sign-in failed ${r.status()}`)
}

async function registerAndSignIn(ctx, who) {
  const reg = await ctx.request.post(`${BASE}/api/auth/register`, {
    headers: { 'x-allfantasy-e2e': '1' },
    data: {
      username: who.username,
      email: who.email,
      password: who.password,
      displayName: who.username,
      ageConfirmed: true,
      verificationMethod: 'EMAIL',
      timezone: 'America/New_York',
      preferredLanguage: 'en',
      avatarPreset: 'crest',
      disclaimerAgreed: true,
      termsAgreed: true,
    },
    timeout: 120000,
  })
  if (!reg.ok()) throw new Error(`register failed ${reg.status()}`)

  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`, { timeout: 120000 })).json()
  /* ⚠ The credentials provider's field is `login`. Sending email/username/identifier returns a flat 401. */
  const r = await ctx.request.post(`${BASE}/api/auth/callback/credentials?json=true`, {
    form: { csrfToken, login: who.email, password: who.password, callbackUrl: `${BASE}/core`, json: 'true' },
    timeout: 120000,
  })
  if (!r.ok()) throw new Error(`credentials sign-in failed ${r.status()}`)
  const cookies = await ctx.cookies()
  if (!cookies.some((c) => c.name.includes('next-auth.session-token'))) {
    throw new Error('sign-in produced no session cookie')
  }
}

function inspect(html, leagueName) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]{0,120}?)<\/h1>/) || [])[1]
  return {
    bytes: html.length,
    leagueHomeRoot: html.includes('af-lh'),
    leagueNameHits: leagueName ? html.split(leagueName).length - 1 : 0,
    h1: h1 ? h1.replace(/<[^>]*>/g, '').trim().slice(0, 80) : null,
    notFoundPage: html.includes('404'),
    signedOut: html.includes('Welcome back') || html.includes('Sign in to your leagues'),
    title: (html.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || null,
  }
}

async function fetchCore(ctx, leagueId) {
  const res = await ctx.request.get(`${BASE}/core?league=${leagueId}`, { timeout: 120000 })
  return { status: res.status(), html: await res.text() }
}

;(async () => {
  const browser = await playwright.chromium.launch()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  let seeded = null

  try {
    await signInDevBypass(ctxA)
    const seedRes = await ctxA.request.post(`${BASE}/api/e2e/decision-os-proof-league`, {
      headers: { 'x-allfantasy-e2e': '1', 'content-type': 'application/json' },
      data: { team: 'KC', season: 2093, week: 1 },
      timeout: 180000,
    })
    seeded = await seedRes.json()
    if (!seedRes.ok()) throw new Error(`seed failed ${seedRes.status()}`)
    note(`seeded league ${seeded.leagueId}`)

    // ── A: a member, and the league's owner ──────────────────────────────
    const a = await fetchCore(ctxA, seeded.leagueId)
    const aSeen = inspect(a.html, null)
    const leagueName = aSeen.h1
    check(a.status === 200, `A (member) gets HTTP 200 (saw ${a.status})`)
    check(aSeen.leagueHomeRoot, 'A still receives the league home root (.af-lh)')
    check(
      Boolean(leagueName) && leagueName.length > 3,
      `A still receives the league name in the <h1> (saw "${leagueName}")`,
    )
    check(!aSeen.signedOut, 'A was not bounced to sign-in')

    // ── B: signed in, member of nothing ──────────────────────────────────
    await registerAndSignIn(ctxB, B)
    const bOwn = await fetchCore(ctxB, '')
    check(!inspect(bOwn.html).signedOut, "B has a working session of its own")

    /*
     * ⚠ WARM BOTH PATHS BEFORE MEASURING. On a dev server the first render of a
     * route for a given session is larger than every subsequent one, and
     * comparing a cold response against a warm one manufactured a 333-byte
     * "difference" between missing and unauthorized that does not exist.
     */
    for (let i = 0; i < 2; i += 1) {
      await fetchCore(ctxB, seeded.leagueId)
      await fetchCore(ctxB, MISSING_LEAGUE_ID)
    }

    const bOther = await fetchCore(ctxB, seeded.leagueId)
    const bSeen = inspect(bOther.html, leagueName)

    check(!bSeen.leagueHomeRoot, "B does NOT receive the league home root (.af-lh)")
    check(
      bSeen.leagueNameHits === 0,
      `B sees ZERO occurrences of A's league name (saw ${bSeen.leagueNameHits})`,
    )
    check(bSeen.h1 === null || bSeen.h1 !== leagueName, `B does not get the league name in an <h1>`)
    check(bSeen.notFoundPage, 'B is shown the not-found page')
    check(!bSeen.signedOut, 'B was refused as a non-member, not bounced to sign-in')

    // ── Missing vs unauthorized must be indistinguishable ────────────────
    const bMissing = await fetchCore(ctxB, MISSING_LEAGUE_ID)
    const mSeen = inspect(bMissing.html, leagueName)
    check(
      bMissing.status === bOther.status,
      `missing and unauthorized return the same status (${bMissing.status} vs ${bOther.status})`,
    )
    check(
      mSeen.notFoundPage === bSeen.notFoundPage && mSeen.leagueHomeRoot === bSeen.leagueHomeRoot,
      'missing and unauthorized render the same page shape',
    )
    check(mSeen.title === bSeen.title, `missing and unauthorized share a <title> ("${mSeen.title}")`)

    /*
     * 🛑 THE STRONGEST FORM OF THIS ASSERTION: BYTE EQUALITY, NOT "SIMILAR SIZE".
     *
     * Two things are normalised out first, and both are things the requester
     * already has:
     *   - `?v=<timestamp>`, the dev server's asset cache-buster, which changes
     *     between any two requests and has nothing to do with leagues.
     *   - the league id itself, which Next echoes into the router payload
     *     (`urlParts`) straight from the URL the caller typed.
     *
     * ⚠ AN EARLIER VERSION COMPARED SIZES WITH A ±200-BYTE TOLERANCE AND FAILED
     * AT 333 BYTES, WHICH LOOKED LIKE A SIZE SIDE CHANNEL. It was not: measuring
     * both URLs twice each showed 32033 bytes every time, gap 0 — the 333 came
     * from comparing a cold first render against a warm one. A tolerance band
     * would have hidden a real difference just as easily as it invented this
     * one, so the comparison is now exact and the warm-up below removes the
     * artifact instead of widening the band.
     */
    const scrub = (html, leagueId) =>
      html.replace(/\?v=\d+/g, '?v=X').split(leagueId).join('<LEAGUE_ID>')
    const missingScrubbed = scrub(bMissing.html, MISSING_LEAGUE_ID)
    const otherScrubbed = scrub(bOther.html, seeded.leagueId)

    note(
      `raw bytes  missing=${bMissing.html.length}  unauthorized=${bOther.html.length}` +
        `   id echoes  missing=${bMissing.html.split(MISSING_LEAGUE_ID).length - 1}` +
        ` unauthorized=${bOther.html.split(seeded.leagueId).length - 1}`,
    )
    check(
      missingScrubbed === otherScrubbed,
      `missing and unauthorized are byte-identical once the caller's own id and the dev cache-buster are removed ` +
        `(${missingScrubbed.length} vs ${otherScrubbed.length} chars)`,
    )

    /*
     * ⚠ REPORTED, NOT ASSERTED — see the header. `loading.tsx` streams the shell
     * with 200 before the page body runs, so `notFound()` cannot set the status.
     * Measured on this server: 404 with loading.tsx moved aside, 200 with it in
     * place. The body carries no league data either way.
     */
    note(`HTTP status for a refused league: ${bOther.status} (200 expected while loading.tsx streams the route)`)
    note(`A bytes=${aSeen.bytes}  B(other)=${bSeen.bytes}  B(missing)=${mSeen.bytes}`)
  } finally {
    if (seeded && seeded.leagueId) {
      const del = await ctxA.request
        .delete(`${BASE}/api/e2e/decision-os-proof-league`, {
          headers: { 'x-allfantasy-e2e': '1', 'content-type': 'application/json' },
          data: seeded,
          timeout: 120000,
        })
        .catch((e) => ({ status: () => `threw: ${e.message}` }))
      note(`cleanup DELETE -> ${typeof del.status === 'function' ? del.status() : del}`)
    }
    note(`AppUser ${B.email} has no delete endpoint and remains on the test DB`)
    console.log(notes.join('\n'))
    await browser.close()
  }

  if (failures.length) {
    console.error(`\n${failures.length} FAILURES:`)
    for (const f of failures) console.error('  - ' + f)
    process.exit(1)
  }
  console.log('\nAll authorization checks passed.')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
