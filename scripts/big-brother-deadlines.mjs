// Scheduled calls contain no browser credentials and log aggregate counts only.
const { APP_URL, CRON_SECRET, DRY_RUN } = process.env
if (!APP_URL || !CRON_SECRET) throw new Error('APP_URL and CRON_SECRET must be configured')
const base = new URL(APP_URL)
if (base.protocol !== 'https:') throw new Error('Cron origin must use HTTPS')
const health = await fetch(new URL('/api/af-debug/sha', base), { signal: AbortSignal.timeout(30000) })
if (!health.ok) throw new Error(`Deployment health returned HTTP ${health.status}`)
const deployed = await health.json()
if (!deployed.ok || !deployed.sha) throw new Error('Deployment has no verified build marker')
// Capability gating allows unrelated main commits while preventing pre-repair execution.
if (deployed.capabilities?.bigBrotherDeadlines !== 1) {
  console.log('Deadline repair has not deployed; processing will retry on the next scheduled run.')
  process.exit(0)
}
for (const job of ['automation', 'reminders', 'stat-correction']) {
  const url = new URL(`/api/big-brother/cron/${job}`, base)
  if (DRY_RUN === '1') url.searchParams.set('dryRun', '1')
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` }, redirect: 'error', signal: AbortSignal.timeout(65000) })
  if (!response.ok) throw new Error(`${job} returned HTTP ${response.status}`)
  const result = await response.json()
  console.log(JSON.stringify({ job, dryRun: DRY_RUN === '1', processed: result.processed, skipped: result.skipped, remindersScheduled: result.remindersScheduled, leaguesNoted: result.leaguesNoted, errorCount: result.errors?.length ?? 0 }))
  if (!result.ok) throw new Error(`${job} reported errors; inspect the application audit trail`)
}
