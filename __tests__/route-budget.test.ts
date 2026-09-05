/*
 * ⚠ THE ROUTE BUDGET IS RETIRED (2026-09-05). The filename is kept because several notes
 * reference it; the budget assertions are gone.
 *
 * Production moved to Railway on 2026-09-02. Railway's service has `buildCommand: null`, so it
 * runs `npm run build` → plain `next build`. `scripts/vercel-next-build.cjs` — the script that
 * held `filesToKeep` and excluded ~218 files to stay under Vercel's hard 2048-route ceiling — is
 * reachable only via `vercel-build`, `build:clean` and `build:no-lint`, none of which Railway runs.
 * Nothing excludes routes and nothing counts them, so these were deleted:
 *
 *   - 'The keep-list parse itself'                          (parsed filesToKeep out of the build script)
 *   - 'Every scheduled cron survives the production build'  (asserted crons were keep-listed)
 *   - 'build-excluded routes have no active fetch callers'  (nothing is build-excluded now)
 *   - 'production-adjusted signals must stay GREEN'         (the 1900/2020 route limits)
 *
 * The cron safety net was NOT simply deleted — it was re-expressed for the current architecture.
 * Crons now fire from GitHub Actions against the deployed app, so a cron scheduled without a route
 * on disk still 404s on every fire, silently, forever. That check lives below and no longer depends
 * on any Vercel file.
 *
 * The cron COUNT ceiling is a separate, still-live check: scripts/cron-budget-check.mjs, run by
 * .github/workflows/cron-budget.yml. Do not fold that in here.
 *
 * Everything else below is platform-independent and was kept: deleted routes staying deleted, the
 * devy-board wiring, and admin gating on the customer dashboard.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}
function exists(rel: string): boolean {
  return existsSync(resolve(root, rel))
}

describe('Every scheduled cron has a route on disk', () => {
  /*
   * This has gone wrong three separate times under Vercel — the original 13 sports-data crons
   * (#284) and two in-flight branches that scheduled a cron the build then dropped. The Vercel
   * cause (exclusion from the build) is gone, but the FAILURE is not: a cron declared in
   * cron-schedule.json whose route does not exist is invoked on schedule and 404s every time.
   * Nothing else asserts that the schedule and the filesystem agree.
   */
  const readCrons = (): { path: string }[] => {
    // The registry moved out of vercel.json (Hobby refused a sub-daily declaration); vercel.json
    // remains only as the pre-extraction fallback.
    for (const file of ['cron-schedule.json', 'vercel.json']) {
      try {
        const parsed = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
          crons?: { path: string }[]
        }
        if (parsed.crons?.length) return parsed.crons
      } catch {
        /* try the next candidate */
      }
    }
    return []
  }

  it('every /api/cron/* path in the registry resolves to a route file', () => {
    const scheduled = readCrons()
      .map((c) => c.path.split('?')[0]!)
      .filter((p) => p.startsWith('/api/cron/'))

    // Collect every offender then assert the list is empty — asserting inside the loop would abort
    // on the first miss and hide the rest.
    const missing = scheduled.filter((p) => !exists(`app${p}/route.ts`))

    expect(missing).toEqual([])
    // Floor: an empty registry must never read as a pass. This is what caught the move out of
    // vercel.json, and it is the only thing standing between a parse change and a vacuous green.
    expect(scheduled.length).toBeGreaterThan(0)
  })
})

describe('Deleted routes must stay gone', () => {
  it('app/api/ai/context/route.ts is removed from disk', () => {
    expect(exists('app/api/ai/context/route.ts')).toBe(false)
  })

  it('no active fetch of /api/ai/context in app/', () => {
    // Guard: if someone re-adds a caller without re-adding the route they'll get a 404.
    const suspects = [
      'app/dashboard/page.tsx',
      'app/dashboard/DashboardShell.tsx',
    ]
    for (const rel of suspects) {
      if (!exists(rel)) continue
      const src = read(rel)
      expect(src, `${rel} should not reference /api/ai/context`).not.toContain('/api/ai/context')
    }
  })

  /*
   * 🛑 `app/api/devy/board` WAS A SECOND DEVY BOARD THAT COULD NOT HAVE WORKED, AND THE
   * TEMPTING FIX WAS THE WRONG ONE. It looked like it merely needed pointing at
   * `buildDevyValueBoard`. Three things say otherwise:
   *
   *   - It exported POST only. Its ONLY five references were hand-run stress scripts, all
   *     calling GET, so every "test" of it measured a 405.
   *   - It queried `prisma.player` for `league='NCAA' AND devyEligible=true`. Every devy
   *     writer in the repo — devy-classifier, devy-classification, CollegePlayerSeedService,
   *     rightsWriter — targets `prisma.devyPlayer`. Nothing has ever set that predicate on
   *     `Player`, so the query could only ever return an empty board.
   *   - The real board already existed and was already correct.
   *
   * Wiring the value board into it would have pointed a surface at a table nothing populates
   * — the failure CLAUDE.md records for `ingestCFBDStats` — and left two implementations to
   * keep in sync. So it was deleted, the way `app/api/start-sit/weather.route.js` was.
   *
   * ⚠ Note the reason is duplication and a dead query, NOT the retired route budget.
   */
  it('app/api/devy/board/route.ts is removed from disk', () => {
    expect(exists('app/api/devy/board/route.ts')).toBe(false)
  })

  it('the surviving devy board is the one that prices through buildDevyValueBoard', () => {
    const rel = 'server/api-route-modules/legacy/devy-board/route.ts'
    /* Positive control: if this route ever moves, the assertion below guards nothing. */
    expect(exists(rel), `${rel} is the devy board; update this test if it moved`).toBe(true)

    const src = read(rel)

    /*
     * ⚠ WORD-BOUNDARIED, BECAUSE `toContain` IS A SUBSTRING TEST AND THAT IS NOT ENOUGH.
     * The first version of this assertion was `toContain('buildDevyValueBoard')`. Renaming
     * the symbol to `buildDevyValueBoardXX` — i.e. breaking the wiring outright — still
     * contained the substring, so the mutation passed and the guard was decorative. It also
     * would have been satisfied by a COMMENT merely mentioning the name.
     */
    expect(src, 'the devy board must import buildDevyValueBoard').toMatch(
      /import\s*\{[^}]*\bbuildDevyValueBoard\b[^}]*\}\s*from\s*['"]@\/lib\/devy\/devyValueBoard['"]/,
    )
    expect(src, 'the devy board must actually call buildDevyValueBoard').toMatch(
      /\bbuildDevyValueBoard\s*\(/,
    )
    /* And it must read the table the devy writers actually populate. */
    expect(src, 'the devy board must read DevyPlayer, not Player').toMatch(/\bprisma\.devyPlayer\b/)
  })
})

describe('Admin AI monitor — gating and wiring', () => {
  const dashPage = read('app/dashboard/page.tsx')

  it('does not render admin monitors on the customer dashboard', () => {
    expect(dashPage).not.toContain("from '@/lib/adminAuth'")
    expect(dashPage).not.toContain("from '@/lib/ai/aiUsageMonitor'")
    expect(dashPage).not.toContain("from '@/components/admin/AiUsageMonitorPanel'")
    expect(dashPage).not.toContain('AI Ops Monitor')
    expect(dashPage).not.toContain('adminReport')
  })
})

// ── Dead routes deleted in cleanup must stay deleted ──────────────────────────

describe('Dead routes deleted in cleanup must stay gone', () => {
  // Kept after the budget was retired: these were deleted for being dead, not for costing budget.
  const DELETED = [
    'app/api/ai/orchestrate/route.ts',
    'app/api/ai/intelligence/context/route.ts',
    'app/api/ai/memory/quality/feedback/route.ts',
    'app/api/ai/ai-gm-analyze/route.ts',
    'app/api/ai/generate-image/route.ts',
  ]
  for (const route of DELETED) {
    it(`${route} does not exist`, () => {
      expect(exists(route), `${route} was re-created — it was deleted as dead code`).toBe(false)
    })
  }
})

// ── World Cup chat consolidation stays consolidated ───────────────────────────

describe('World Cup chat stays consolidated', () => {
  // Originally a budget measure; kept because the consolidated route is the shipped design and
  // re-adding these would fork the implementation, not because routes are scarce.
  const CONSOLIDATED = 'app/api/brackets/world-cup/[challengeId]/chat/route.ts'
  const OLD_FEATURE_ROUTES = [
    'app/api/brackets/world-cup/[challengeId]/chat/gifs/route.ts',
    'app/api/brackets/world-cup/[challengeId]/chat/upload-image/route.ts',
    'app/api/brackets/world-cup/[challengeId]/notification-preferences/route.ts',
    'app/api/brackets/world-cup/[challengeId]/chat/[messageId]/poll-vote/route.ts',
  ]

  it('consolidated chat route exists', () => {
    expect(exists(CONSOLIDATED)).toBe(true)
  })

  for (const route of OLD_FEATURE_ROUTES) {
    it(`old feature route is absent: ${route}`, () => {
      expect(exists(route), `${route} was re-created — use ?action= dispatch instead`).toBe(false)
    })
  }
})
