import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')

interface VercelCronEntry {
  path: string
  schedule: string
}

function loadCrons(): VercelCronEntry[] {
  const raw = readFileSync(join(root, 'vercel.json'), 'utf8')
  const parsed = JSON.parse(raw) as { crons?: VercelCronEntry[] }
  return parsed.crons ?? []
}

function routeFileFor(cronPath: string): string {
  const pathOnly = cronPath.split('?')[0]
  return join(root, 'app', ...pathOnly.split('/').filter(Boolean), 'route.ts')
}

// Phase 39: real production `vercel logs` inspection showed multiple scheduled
// cron paths returning live 404s. Root cause confirmed here — vercel.json's
// cron schedule is not kept in sync with route deletions, so Vercel keeps
// invoking routes that no longer exist, on schedule, indefinitely, with no
// alerting anywhere in the stack surfacing it (see
// docs/os/FANTASY_OS_DEPLOYMENT_REALITY_AUDIT_PHASE39.md). Removing these
// entries from vercel.json is a live production cron-scheduler change and is
// out of scope for this phase without explicit authorization, so this test
// does not fix the drift — it freezes the currently-known-missing set and
// fails if the drift gets worse, catching future route deletions that forget
// to also update vercel.json.
const KNOWN_MISSING_CRON_ROUTES = [
  '/api/cron/ai-adp',
  '/api/cron/autocoach-pregame',
  '/api/cron/autocoach-status-scan',
  '/api/cron/backfill-player-headshots',
  '/api/cron/c2c-live-scores',
  '/api/cron/check-transfer-portal',
  '/api/cron/chimmy-alerts',
  '/api/cron/daily-cache-refresh',
  '/api/cron/data-freshness',
  '/api/cron/dynasty-cutdown',
  '/api/cron/gameday-preload',
  '/api/cron/health-check',
  '/api/cron/import-college-stats',
  '/api/cron/import-draft-grades',
  '/api/cron/import-espn-injuries',
  '/api/cron/import-images',
  '/api/cron/import-projections',
  '/api/cron/import-rankings',
  '/api/cron/import-sync',
  '/api/cron/integrity-collusion',
  '/api/cron/integrity-tanking',
  '/api/cron/keeper-deadline',
  '/api/cron/score-lock',
  '/api/cron/sync-playoff-brackets',
  '/api/cron/sync-sleeper-players',
  '/api/cron/waiver-precompute',
  '/api/cron/waiver-processing',
  '/api/cron/weekly-engine',
  '/api/cron/zombie-weekly-update',
].sort()

describe('vercel.json cron entries must reference routes that exist on disk', () => {
  const crons = loadCrons()

  it('vercel.json has cron entries to check', () => {
    expect(crons.length).toBeGreaterThan(0)
  })

  it('has no MORE missing cron routes than the known, disclosed set (Phase 39 baseline)', () => {
    const missing = crons
      .map((c) => c.path.split('?')[0])
      .filter((path, index, all) => all.indexOf(path) === index)
      .filter((path) => !existsSync(routeFileFor(path)))
      .sort()

    const newlyMissing = missing.filter((p) => !KNOWN_MISSING_CRON_ROUTES.includes(p))

    expect(
      newlyMissing,
      `${newlyMissing.length} NEW cron path(s) in vercel.json have no matching route file ` +
        `(beyond the ${KNOWN_MISSING_CRON_ROUTES.length} already known and disclosed — see ` +
        `docs/os/FANTASY_OS_DEPLOYMENT_REALITY_AUDIT_PHASE39.md). A route was likely deleted ` +
        `without removing its cron entry from vercel.json:\n` +
        newlyMissing.map((p) => `  - ${p}`).join('\n')
    ).toEqual([])
  })

  it('previously-missing cron routes that get restored should be removed from the known-missing list', () => {
    const restored = KNOWN_MISSING_CRON_ROUTES.filter((p) => existsSync(routeFileFor(p)))
    expect(
      restored,
      `These cron routes now exist on disk again — remove them from KNOWN_MISSING_CRON_ROUTES ` +
        `in this test:\n` + restored.map((p) => `  - ${p}`).join('\n')
    ).toEqual([])
  })
})
