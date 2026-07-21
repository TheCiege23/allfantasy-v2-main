/**
 * Regression guard for the anonymous ESPN guest funnel on /af-legacy.
 *
 * Before this, the ESPN tab POSTed a handler gated by `requireVerifiedUser`, so every
 * anonymous visitor got 401 and no import was ever persisted (91 visits -> 0 imports). This
 * test pins the contract that fixed it, so a future refactor can't silently reintroduce the
 * login wall or the non-persisting behaviour.
 *
 * These are STATIC source assertions (no DB / no ESPN fetch) on purpose: they stay fast and
 * deterministic in CI, matching the style of `legacy-routes-identity-guard`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/** Strip comments so a commented-out line can never satisfy a match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const ESPN_ROUTE = 'server/api-route-modules/legacy/espn-import/route.ts'
const WORKER_ROUTE = 'server/api-route-modules/legacy/worker/run/route.ts'
const ESPN_STEP = 'lib/legacy-espn-import.ts'

describe('anonymous ESPN guest import contract', () => {
  it('espn-import route does NOT require a verified user (guest funnel is anonymous by design)', () => {
    const code = stripComments(read(ESPN_ROUTE))
    expect(code).not.toMatch(/requireVerifiedUser/)
    expect(code).not.toMatch(/\brequireAuth\b/)
  })

  it('espn-import route mints the guest session cookie so status/profile can find the import', () => {
    const code = stripComments(read(ESPN_ROUTE))
    expect(code).toMatch(/signGuestSessionToken/)
    expect(code).toMatch(/GUEST_SESSION_COOKIE_NAME/)
    expect(code).toMatch(/\.cookies\.set\(/)
  })

  it('espn-import route persists a queued LegacyImportJob (it is no longer ephemeral)', () => {
    const code = stripComments(read(ESPN_ROUTE))
    expect(code).toMatch(/legacyImportJob\.create/)
    expect(code).toMatch(/status:\s*['"]queued['"]/)
    // Synthetic identity must carry the collision-proof `espn:` prefix the worker routes on.
    expect(code).toMatch(/espn:\$\{leagueId\}/)
  })

  it('espn-import route is bot-hardened like guest-import (honeypot + fill-time)', () => {
    const code = stripComments(read(ESPN_ROUTE))
    expect(code).toMatch(/website/)
    expect(code).toMatch(/form_rendered_at/)
  })

  it('worker routes espn jobs to the ESPN step by the espn: identity prefix, Sleeper otherwise', () => {
    const code = stripComments(read(WORKER_ROUTE))
    expect(code).toMatch(/runLegacyEspnImportStep/)
    expect(code).toMatch(/runLegacyImportStep/)
    expect(code).toMatch(/startsWith\(ESPN_IDENTITY_PREFIX\)/)
  })

  it('ESPN step persists the Legacy* tables the report reads (not the modern League tables)', () => {
    const code = stripComments(read(ESPN_STEP))
    expect(code).toMatch(/legacyLeague\.upsert/)
    expect(code).toMatch(/legacyRoster\.upsert/)
    expect(code).toMatch(/legacySeasonSummary\.upsert/)
    // Must NOT reach for the modern importer's AppUser-scoped persist path.
    expect(code).not.toMatch(/persistImportedLeagueFromNormalization/)
    expect(code).not.toMatch(/prisma\.league\./)
  })
})
