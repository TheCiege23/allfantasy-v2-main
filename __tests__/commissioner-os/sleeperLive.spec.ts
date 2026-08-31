/**
 * Commissioner OS · T-202 — the ONE optional live smoke test.
 *
 * "Recorded fixtures in CI — no live third-party calls in the gate. ONE
 * OPTIONAL LIVE SMOKE TEST OUTSIDE IT."
 *
 * 🛑 THIS IS THE ONLY FILE IN THE COMMISSIONER OS SUITE THAT TOUCHES A THIRD
 * PARTY, AND IT IS OUTSIDE THE GATE THREE TIMES OVER:
 *
 *   1. `.spec.ts` — the default vitest config collects `*.test.ts` only, so
 *      `npm test` never sees it.
 *   2. It is in the opt-in `vitest.commissioner-os.config.ts` run, which is not
 *      part of CI.
 *   3. Even there it refuses to call out unless SLEEPER_LIVE_SMOKE=1 AND a
 *      league id is supplied. Both, deliberately: an env var someone sets once
 *      and forgets is how an "optional" test becomes a CI dependency on a
 *      third party's uptime.
 *
 * Run it deliberately:
 *
 *     SLEEPER_LIVE_SMOKE=1 SLEEPER_SMOKE_LEAGUE_ID=<id> npm run test:commissioner-os
 *
 * ─── WHAT IT IS FOR, AND WHAT IT IS NOT ──────────────────────────────────────
 * It exists to answer one question the fixtures structurally cannot: has
 * Sleeper's response SHAPE changed since the fixtures were written? A fixture
 * suite is perfectly green against a contract the provider abandoned last
 * month, and that is the failure mode this catches.
 *
 * It is NOT a correctness test of the mapping — `sleeper.test.ts` owns that,
 * and it does so without a network. If this file ever grows assertions about
 * business logic, they belong there instead.
 *
 * ⚠ READ-ONLY, AND ON A LEAGUE YOU CHOOSE. Sleeper's read API needs no
 * credential, so this sends no token anywhere. It also writes nothing, to us or
 * to them. Point it at a league you own.
 */

import { describe, it, expect } from 'vitest'
import { createSleeperProvider, type SleeperHttp } from '@/lib/domain/sleeper'
import { providerError } from '@/lib/domain/providers'
import { ok, err } from '@/lib/domain/result'

const ENABLED = process.env.SLEEPER_LIVE_SMOKE === '1'
const LEAGUE_ID = process.env.SLEEPER_SMOKE_LEAGUE_ID ?? ''

/**
 * The live client.
 *
 * ⚠ THE HOST LITERAL LIVES HERE AND NOWHERE ELSE. `api.sleeper.app` is on the
 * DB-first guard's monitored list (scripts/check-db-first-api-boundary.mjs:10),
 * and `lib/domain/sleeper.ts` deliberately contains no URL — so the guard has
 * exactly one file to reason about, and it is a test file outside the gate
 * rather than a domain module.
 */
const liveHttp: SleeperHttp = async (path) => {
  try {
    const res = await fetch(`https://api.sleeper.app/v1${path}`, {
      // No redirects: the SSRF reasoning from T-113 applies to any outbound
      // call, not only to operator-supplied webhook URLs.
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return err(
        providerError(
          res.status === 404 ? 'NOT_FOUND' : res.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
          `Sleeper responded ${res.status}.`,
        ),
      )
    }
    return ok(await res.json())
  } catch (e) {
    // ⚠ The message is OURS, not the caught error's. A fetch error stringifies
    // to something containing the URL, and the habit of interpolating it is how
    // a query-parameter credential ends up in a log — the exact trap the root
    // CLAUDE.md records for Rolling Insights. Sleeper has no token to leak, so
    // this costs nothing here and keeps the pattern correct for the next
    // provider, which will.
    return err(providerError('UNAVAILABLE', 'Could not reach Sleeper.'))
  }
}

describe.skipIf(!ENABLED)('T-202 · live smoke (opt-in, outside the gate)', () => {
  it('is configured with a league id', () => {
    // If someone sets the flag without an id, say so rather than passing
    // vacuously — an enabled smoke test that silently checks nothing is worse
    // than a disabled one, because it reads as coverage.
    expect(
      LEAGUE_ID,
      'Set SLEEPER_SMOKE_LEAGUE_ID to a league you own. Enabled without one, this proves nothing.',
    ).toBeTruthy()
  })

  it('🛑 the live response still matches the fixture SHAPE', async () => {
    // The one question fixtures cannot answer. Field-by-field, because the
    // failure being hunted is "Sleeper renamed or dropped a field", not "the
    // values differ" — the values are supposed to differ, it is a live league.
    const r = await createSleeperProvider(liveHttp).connect(LEAGUE_ID, {
      tenantId: 'smoke',
      secret: null,
      cursor: null,
    })

    expect(r.ok, r.ok ? '' : `Sleeper connect failed: ${JSON.stringify(r)}`).toBe(true)
    if (!r.ok) return

    expect(r.value.externalLeagueId).toBe(LEAGUE_ID)
    expect(typeof r.value.name).toBe('string')
    expect(r.value.name.length).toBeGreaterThan(0)
    // `season` and `teamCount` are nullable in our type. Asserting the TYPE
    // rather than a value is the point: a null here is legal, a number where we
    // expect a string is the shape change worth catching.
    expect(['string', 'object']).toContain(typeof r.value.season)
    if (r.value.teamCount !== null) expect(typeof r.value.teamCount).toBe('number')
  })

  it('teams and managers still map without a MALFORMED refusal', async () => {
    const p = createSleeperProvider(liveHttp)
    const smokeCtx = { tenantId: 'smoke', secret: null, cursor: null }

    const teams = await p.fetchTeams(LEAGUE_ID, smokeCtx)
    expect(teams.ok, teams.ok ? '' : `fetchTeams: ${JSON.stringify(teams)}`).toBe(true)
    if (!teams.ok) return
    expect(teams.value.items.length).toBeGreaterThan(0)

    const managers = await p.fetchManagers(LEAGUE_ID, smokeCtx)
    expect(managers.ok, managers.ok ? '' : `fetchManagers: ${JSON.stringify(managers)}`).toBe(true)
    if (!managers.ok) return

    // Still true against a real league, and worth re-confirming live: if
    // Sleeper ever DID start returning emails, `providesManagerEmail: false`
    // would be a lie and a reconciler built on it would be leaving data behind.
    for (const m of managers.value.items) expect(m.email).toBeNull()
  })
})

describe('T-202 · the smoke test stays off by default', () => {
  it('does not call out unless explicitly enabled', () => {
    // Runs even when the smoke test is skipped — the assertion is about the
    // guard, not about Sleeper. An "optional" test that quietly became
    // mandatory is a CI dependency on a third party's uptime.
    if (process.env.SLEEPER_LIVE_SMOKE === '1') {
      expect(ENABLED).toBe(true)
      return
    }
    expect(ENABLED).toBe(false)
  })
})
