/* Railway cron service: use the app's private URL and a CRON_SECRET reference. */
const base = String(process.env.BRACKET_SYNC_URL ?? "").replace(/\/$/, "")
const secret = String(process.env.CRON_SECRET ?? "").trim()
if (!base || !secret) throw new Error("BRACKET_SYNC_URL and CRON_SECRET are required")

const now = new Date()
const year = now.getUTCFullYear()
const jobs = [
  { sport: "ncaaf", season: now.getUTCMonth() === 0 ? year - 1 : year },
  { sport: "nba_cup", season: year },
]
let failed = false
for (const job of jobs) {
  try {
    const response = await fetch(`${base}/api/cron/season-bracket-results`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ ...job, apply: true }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Bracket worker HTTP ${response.status}`)
    const result = await response.json()
    const outcomes = (result.rows ?? []).reduce((counts, row) => {
      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1
      return counts
    }, {})
    console.log(JSON.stringify({ job, applied: result.applied, outcomes }))
    if ((result.rows ?? []).some((row) => /^(team-mismatch|start-time-mismatch|not-cfp-postseason|wrong-cup-season|not-nba-cup-event|invalid-final-score)$/.test(row.outcome))) {
      failed = true
    }
  } catch (error) {
    failed = true
    console.error(`Bracket result sync failed for ${job.sport}:`, error instanceof Error ? error.message : String(error))
  }
}
if (failed) process.exitCode = 1
