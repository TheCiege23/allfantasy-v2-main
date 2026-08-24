/**
 * Scheduled NFL player-headshot backfill cron — source-level contract
 * lock.
 *
 * Pins the cron's invariants so a future refactor can't silently regress:
 *
 *   1. Auth — delegates to the shared cron auth helper, preserving fallback
 *      secrets and manual trigger headers.
 *   2. Provider order — owned by `lib/player-assets/resolvePlayerHeadshot.ts`.
 *      The cron uses `createBatchPlayerHeadshotResolver` (not its own
 *      provider chain), so the order is whatever the resolver enforces
 *      for the sport. For NFL: TheSportsDB → ClearSports → Sleeper. We
 *      assert the docstring + import contract here.
 *   3. URL validity — invalid candidates (data-URI placeholders,
 *      team-logo paths, non-HTTP) are rejected via `isValidHeadshotUrl`.
 *   4. Skip-valid contract — rows with an existing valid `imageUrl` are
 *      skipped unless `force=1`.
 *   5. Dry-run default — `apply=0` (default) returns `wouldUpdate` counts
 *      without writing. `apply=1` performs `prisma.sportsPlayer.update`.
 *   6. Pagination — `limit` defaults to 100, capped at 500. Rows are
 *      ordered by `imageUrl` ascending with NULLS FIRST, then `updatedAt`
 *      ascending so the cron rotates through the universe naturally.
 *   7. Structured response — JSON summary includes per-source / per-
 *      confidence counters, sample updated/no-match rows, and run
 *      duration. Cron observability lives in this response.
 *   8. Vercel cron schedule — `vercel.json` entry runs daily at 5:15 UTC
 *      with `?sport=NFL&apply=1&limit=200`.
 *   9. Phase 1 scope — writes `imageUrl` only. The route does NOT write
 *      `imageSource` / `imageLastCheckedAt` / `imageConfidence` / etc.
 *      Phase 2 follow-up will add those fields via a Prisma migration.
 *
 * Static-source assertions only — does not invoke React, Prisma, or the
 * provider chain. Per-row resolver behavior is already covered by
 * existing tests under `__tests__/` for `resolvePlayerHeadshot` itself.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Cron route exists at the canonical path', () => {
  it('app/api/cron/backfill-player-headshots/route.ts is present', () => {
    expect(() =>
      read('app/api/cron/backfill-player-headshots/route.ts'),
    ).not.toThrow()
  })

  it('exports a GET handler (Vercel cron uses GET)', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).toMatch(/export async function GET\(/)
  })

  it('forces dynamic rendering so the cron always evaluates fresh', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
  })

  it('runs on Node (provider keys + Prisma require Node runtime)', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).toMatch(/export const runtime = 'nodejs'/)
  })

  it('declares an extended maxDuration so a 200-row batch can complete', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).toMatch(/export const maxDuration = \d+/)
  })
})

describe('Auth contract', () => {
  const src = read('app/api/cron/backfill-player-headshots/route.ts')

  it('delegates to the shared cron auth helper', () => {
    expect(src).toMatch(/import \{ requireCronAuth \} from '@\/app\/api\/cron\/_auth'/)
    expect(src).toMatch(/if \(!requireCronAuth\(req\)\) \{/)
  })

  it('returns 401 when cron auth fails', () => {
    expect(src).toMatch(
      /if \(!requireCronAuth\(req\)\) \{[\s\S]+?return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/,
    )
  })
})

describe('Provider order delegates to resolvePlayerHeadshot (TheSportsDB → ClearSports → Sleeper for NFL)', () => {
  it('cron imports the canonical batch resolver, not its own provider chain', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).toMatch(
      /import \{[\s\S]+?createBatchPlayerHeadshotResolver[\s\S]+?\} from '@\/lib\/player-assets\/resolvePlayerHeadshot'/,
    )
  })

  it('does NOT call clearSports/sportsdb/sleeper directly (must go through the resolver)', () => {
    const src = read('app/api/cron/backfill-player-headshots/route.ts')
    expect(src).not.toMatch(/from '@\/lib\/clear-sports/)
    expect(src).not.toMatch(/from '@\/lib\/workers\/providers\/thesportsdb'/)
    expect(src).not.toMatch(/from '@\/lib\/workers\/providers\/sleeper-chain'/)
    expect(src).not.toMatch(/sleeperHeadshotUrl/)
  })

  it('resolver itself documents provider order TheSportsDB → ClearSports → Sleeper for NFL', () => {
    const src = read('lib/player-assets/resolvePlayerHeadshot.ts')
    expect(src).toMatch(
      /NFL: TheSportsDB -> ClearSports -> Sleeper/,
    )
  })
})

describe('URL validity + skip-valid contract', () => {
  const src = read('app/api/cron/backfill-player-headshots/route.ts')

  it('uses isValidHeadshotUrl to reject placeholders/team-logos/data-URIs', () => {
    expect(src).toMatch(
      /import \{[\s\S]+?isValidHeadshotUrl[\s\S]+?\} from '@\/lib\/player-assets\/resolvePlayerHeadshot'/,
    )
    expect(src).toMatch(/!force && isValidHeadshotUrl\(row\.imageUrl\)/)
  })

  it('skips a row when the resolver returned the same valid URL already on the record (idempotent)', () => {
    expect(src).toMatch(
      /if \(!force && row\.imageUrl && row\.imageUrl === newUrl\)/,
    )
  })

  it('refuses to write a result that fails isValidHeadshotUrl (no team-logo writes)', () => {
    expect(src).toMatch(/!newUrl \|\| !isValidHeadshotUrl\(newUrl\)/)
  })
})

describe('Apply / dry-run / force semantics', () => {
  const src = read('app/api/cron/backfill-player-headshots/route.ts')

  it('apply defaults to false; query param `apply=1` enables writes', () => {
    expect(src).toMatch(/const apply = url\.searchParams\.get\('apply'\) === '1'/)
  })

  it('force defaults to false; query param `force=1` overwrites valid URLs', () => {
    expect(src).toMatch(/const force = url\.searchParams\.get\('force'\) === '1'/)
  })

  it('dry-run path increments wouldUpdate without calling prisma.sportsPlayer.update', () => {
    expect(src).toMatch(
      /if \(apply\) \{[\s\S]+?prisma\.sportsPlayer\.update[\s\S]+?\} else \{[\s\S]+?summary\.wouldUpdate \+= 1/,
    )
  })

  it('apply path calls prisma.sportsPlayer.update with the resolved imageUrl only', () => {
    // Phase 1 scope: only `imageUrl` is written. No `imageSource` /
    // `imageLastCheckedAt` / `imageConfidence` writes yet (Phase 2).
    expect(src).toMatch(
      /prisma\.sportsPlayer\.update\(\{\s*where: \{ id: row\.id \},\s*data: \{ imageUrl: newUrl \},?\s*\}\)/,
    )
    expect(src).not.toMatch(/imageSource:/)
    expect(src).not.toMatch(/imageLastCheckedAt:/)
    expect(src).not.toMatch(/imageConfidence:/)
  })
})

describe('Pagination + ordering', () => {
  const src = read('app/api/cron/backfill-player-headshots/route.ts')

  it('default limit is 100, max is 500', () => {
    expect(src).toMatch(/const DEFAULT_LIMIT = 100/)
    expect(src).toMatch(/const MAX_LIMIT = 500/)
    expect(src).toMatch(/Math\.min\(MAX_LIMIT, rawLimit\)/)
  })

  it('orders by imageUrl asc nulls first then updatedAt asc so missing-image rows go first', () => {
    expect(src).toMatch(
      /orderBy: \[\{ imageUrl: \{ sort: 'asc', nulls: 'first' \} \}, \{ updatedAt: 'asc' \}\]/,
    )
  })

  it('default mode scans null and known invalid imageUrl patterns', () => {
    expect(src).toMatch(/\{ imageUrl: \{ startsWith: 'data:' \} \}/)
    expect(src).toMatch(/\{ imageUrl: \{ contains: '\/teamLogos\/', mode: 'insensitive' \} \}/)
    expect(src).toMatch(
      /\{ imageUrl: \{ not: \{ startsWith: 'http', mode: 'insensitive' \} \} \}/,
    )
  })

  it('force mode broadens the WHERE filter to include rows with existing imageUrl', () => {
    expect(src).toMatch(
      /OR: force[\s\S]+?\[\{ imageUrl: null \}, \{ imageUrl: \{ not: null \} \}\][\s\S]+?\[\s*\{ imageUrl: null \},[\s\S]+?\{ imageUrl: \{ startsWith: 'data:' \} \},[\s\S]+?\{ imageUrl: \{ contains: '\/teamLogos\/', mode: 'insensitive' \} \},[\s\S]+?\{ imageUrl: \{ not: \{ startsWith: 'http', mode: 'insensitive' \} \} \},[\s\S]+?\]/,
    )
  })
})

describe('Structured response + observability', () => {
  const src = read('app/api/cron/backfill-player-headshots/route.ts')

  it('returns ok + summary object', () => {
    expect(src).toMatch(/return NextResponse\.json\(\{ ok: true, summary \}\)/)
  })

  it('summary includes per-source counters for all four HeadshotProvider values', () => {
    expect(src).toMatch(
      /bySource: \{ sleeper: 0, clearsports: 0, sportsdb: 0, none: 0 \}/,
    )
  })

  it('summary includes per-confidence counters for all four HeadshotConfidence values', () => {
    expect(src).toMatch(
      /byConfidence: \{ exact: 0, name_team_position: 0, name_only: 0, none: 0 \}/,
    )
  })

  it('summary tracks providerErrors so transient failures show up in cron history', () => {
    expect(src).toMatch(/providerErrors: 0/)
    expect(src).toMatch(/summary\.providerErrors \+= 1/)
  })

  it('summary captures durationMs for run-time tracking', () => {
    expect(src).toMatch(/summary\.durationMs = Date\.now\(\) - startedAt/)
  })

  it('summary samples up to 25 updated rows + 25 no-match rows for spot-check observability', () => {
    expect(src).toMatch(/sampleUpdated\.length < 25/)
    expect(src).toMatch(/sampleNoMatch\.length < 25/)
  })
})

describe('Vercel cron schedule', () => {
  const src = read('cron-schedule.json')

  it('vercel.json includes the new cron at /api/cron/backfill-player-headshots', () => {
    expect(src).toMatch(/\/api\/cron\/backfill-player-headshots/)
  })

  it('schedule is daily at 5:15 UTC (low-traffic window)', () => {
    expect(src).toMatch(/"schedule":\s*"15 5 \* \* \*"/)
  })

  it('cron path passes sport=NFL, apply=1, and a sane limit', () => {
    expect(src).toMatch(
      /\/api\/cron\/backfill-player-headshots\?sport=NFL&apply=1&limit=\d+/,
    )
  })
})

describe('Existing system invariants preserved', () => {
  it('resolvePlayerHeadshot still exposes the canonical entry points the cron depends on', () => {
    const src = read('lib/player-assets/resolvePlayerHeadshot.ts')
    expect(src).toMatch(
      /export async function createBatchPlayerHeadshotResolver/,
    )
    expect(src).toMatch(/export function isValidHeadshotUrl/)
    expect(src).toMatch(/export type HeadshotProvider/)
    expect(src).toMatch(/export type HeadshotConfidence/)
  })

  it('classifyAvatarSource (used by isValidHeadshotUrl) still rejects data-URIs and team-logos', () => {
    const src = read('lib/draft-room/classify-avatar-source.ts')
    expect(src).toMatch(/if \(trimmed\.startsWith\('data:'\)\) return 'synthesized'/)
    expect(src).toMatch(
      /if \(\/\\\/teamLogos\?\\\/\/i\.test\(trimmed\)\) return 'team_logo_badge_only'/,
    )
  })

  it('SportsPlayer schema still has imageUrl + sleeperId fields the cron reads/writes', () => {
    const src = read('prisma/schema.prisma')
    expect(src).toMatch(/model SportsPlayer \{[\s\S]+?imageUrl\s+String\?[\s\S]+?sleeperId\s+String\?/)
  })
})
