/**
 * Commissioner OS · the ratchet that pays for `@default("allfantasy")`.
 *
 * `League.tenantId` carries a `@default`, which makes it OPTIONAL in the
 * generated create inputs. That was a deliberate trade (see the comment on the
 * field in prisma/schema.prisma): without it, 46 pre-tenancy call sites throw
 * PrismaClientValidationError at runtime, and `ignoreBuildErrors: true` means
 * the build ships green first.
 *
 * The cost of that trade is precisely the thing the schema comment always
 * feared: **a future insert silently landing in the bootstrap tenant.** A
 * required field would have caught it with a compile error. A default cannot.
 *
 * 🛑 SO THIS TEST IS THE REPLACEMENT MECHANISM, NOT A STYLE CHECK. It fails when
 * a NEW `prisma.league.create/upsert/createMany` appears outside `lib/domain/`.
 * That is the exact moment of risk, caught at the moment of risk — which is
 * better than the required field was, because the required field only ever
 * forced someone to type the same constant the default already supplies.
 *
 * 🛑 AND IT IS THE **ONLY** GATE. NO TYPECHECKER WILL EVER BACK IT UP.
 * With `@default("allfantasy")` on the field, `tenantId` is OPTIONAL in the
 * generated create inputs by construction — `tenantId?: string`. An omission is
 * therefore not a type error and never will be. There is no "tsc will catch the
 * bad ones" safety net behind this test. If it is deleted or its number bumped,
 * nothing anywhere reports a league write that silently lands in the bootstrap
 * tenant.
 *
 * ⚠ TWO TRAPS FOR ANYONE RE-MEASURING THAT, BOTH HIT ON 2026-08-31:
 *
 *   1. A repo-wide `tsc` was run and reported ZERO errors at all 46 sites, and
 *      was read as "tsc structurally cannot see this". The reason was simpler
 *      and the distinction matters: `node_modules/.prisma/client` was STALE —
 *      generated from a schema with no `Tenant` model at all, so `tenantId` was
 *      not in its types under any setting. The run could not have flagged those
 *      sites whatever the schema said. Re-generate before concluding anything
 *      from a Prisma-typed check; the copied schema is at
 *      `node_modules/.prisma/client/schema.prisma` and is the thing to look at.
 *   2. Even against a FRESH client, 5 of the 21 app/lib sites reach Prisma
 *      through `(prisma as any)` — app/api/league/create/route.ts,
 *      lib/league-import/ImportedLeagueCommitService.ts, lib/league-sync-core.ts,
 *      lib/sleeper-sync.ts, lib/survivor/importEngine.ts. An `as any` defeats the
 *      check regardless of whether the field is required.
 *
 * So the conclusion "this test is the only gate" is correct, but neither trap
 * above is the reason — (1) is a stale artifact and (2) covers only 5 of 46. The
 * real reason is the first paragraph: the default makes omission legal.
 *
 * ⚠ IT RATCHETS DOWN, NEVER UP. Removing call sites is always allowed and
 * lowers the bar. Adding one fails, and the fix is NOT to bump the number:
 * write the league through `lib/domain/`, where tenantId comes from
 * ActorContext instead of from a default.
 *
 * ⚠ `lib/domain/` IS EXEMPT BY DESIGN. Invariant 2 ("one write path") says
 * mutations go through the domain layer, which carries a real tenant on every
 * call. Exempting it is what makes the ratchet a push toward the right place
 * rather than a blanket freeze on writing leagues.
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/**
 * The high-water mark, measured 2026-08-31.
 *
 * 21 in app/ + lib/, 25 in scripts/. Scripts are counted too: a seed script that
 * silently lands rows in the bootstrap tenant is how a "we have two tenants now"
 * migration discovers it has bad data.
 */
const MAX_LEAGUE_WRITE_SITES_OUTSIDE_DOMAIN = 46

/**
 * `git grep` rather than a manual walk: it respects .gitignore and never
 * descends node_modules.
 *
 * ⚠ `--untracked` IS LOAD-BEARING. Plain `git grep` searches only TRACKED files,
 * so a newly written call site would be invisible to this ratchet until someone
 * staged it — i.e. the guard would pass at exactly the moment the author could
 * still cheaply act on it, and only fail later for someone else.
 */
function leagueWriteSites(): string[] {
  const out = execFileSync(
    'git',
    [
      'grep',
      '--untracked',
      '-nE',
      String.raw`\.league\.(create|upsert|createMany)\b`,
      '--',
      'app',
      'lib',
      'scripts',
      // Tests may construct leagues freely — they are not a production write path,
      // and several exist precisely to exercise these shapes.
      ':(exclude)**/__tests__/**',
      ':(exclude)**/*.test.ts',
      ':(exclude)**/*.spec.ts',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // lib/domain/ is the one write path that carries a real tenant.
    .filter((l) => !l.startsWith('lib/domain/'))
}

describe('League write sites outside lib/domain (tenantId default ratchet)', () => {
  it('does not grow', () => {
    const sites = leagueWriteSites()

    expect(
      sites.length,
      [
        `Found ${sites.length} league write sites outside lib/domain/, high-water mark is ${MAX_LEAGUE_WRITE_SITES_OUTSIDE_DOMAIN}.`,
        '',
        'League.tenantId has @default("allfantasy"), so a create that omits it does NOT',
        'fail — it silently lands in the bootstrap tenant, and RLS cannot catch that',
        'because the row is legitimately readable by that tenant.',
        '',
        'Do not raise this number. Write the league through lib/domain/, where tenantId',
        'comes from ActorContext. If you genuinely removed sites, lower it.',
        '',
        ...sites.map((s) => `  ${s}`),
      ].join('\n'),
    ).toBeLessThanOrEqual(MAX_LEAGUE_WRITE_SITES_OUTSIDE_DOMAIN)
  })

  it('the ratchet can actually see a call site', () => {
    // ⚠ POSITIVE CONTROL. A grep that silently matches nothing — a renamed model,
    // a changed delimiter, git grep exiting 1 on no-match — would make the
    // assertion above pass forever while enforcing nothing. This repo has shipped
    // that failure often enough to warrant the check: a guard that has never once
    // gone red is not evidence.
    const sites = leagueWriteSites()
    expect(sites.length).toBeGreaterThan(0)
    expect(sites.some((s) => s.startsWith('app/') || s.startsWith('lib/'))).toBe(true)
  })

  it('schema.prisma and the ratchet agree about why this exists', () => {
    // If someone removes the @default, this ratchet is no longer load-bearing and
    // its comment becomes a lie. Pin the two together so they move as a pair.
    const schema = execFileSync('git', ['show', 'HEAD:prisma/schema.prisma'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const hasDefault = /tenantId\s+String\s+@default\("allfantasy"\)/.test(schema)

    // Read from HEAD rather than disk so a half-finished working tree does not
    // fail the suite for everyone sharing this checkout.
    if (!hasDefault) {
      // The default is gone. Either tenancy is real now and every site passes a
      // tenant, or someone removed it without doing the other two steps in
      // migrations-pending/…t101b. Say which, loudly.
      expect(
        leagueWriteSites().length,
        'League.tenantId no longer has @default, so every league write site must pass tenantId explicitly. Sites outside lib/domain still exist.',
      ).toBe(0)
    }
  })
})
