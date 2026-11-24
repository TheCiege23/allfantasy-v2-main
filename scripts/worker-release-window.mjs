#!/usr/bin/env node
/**
 * Should a SCHEDULED worker-release attempt advance the worker? Used by
 * .github/workflows/worker-release.yml; prints one line starting "run:" or "skip:".
 *
 *   node scripts/worker-release-window.mjs --now 2026-11-24T13:21:00Z --last-success 2026-11-23T23:17:31Z
 *
 * The worker redeploys on every advance and the swap kills in-flight cron requests, so it advances
 * once a day, in the quiet window (13:00-16:30 UTC: after the daily slow-tier jobs, before any US
 * league plays). GitHub starts schedules late -- 4h28m late on 2026-11-22 -- so there are three
 * attempts an hour apart, and:
 *   - an attempt outside the window skips (the next morning catches up), and
 *   - an attempt within BACKUP_GAP_H of an earlier successful run skips (a backup, already done).
 * Manual dispatches never come here; they have their own cooldown in the workflow.
 */

export const WINDOW_START_MIN = 13 * 60 // 13:00 UTC
export const WINDOW_END_MIN = 16 * 60 + 30 // 16:30 UTC, exclusive
export const BACKUP_GAP_H = 3

/** @returns {{ run: boolean, line: string }} */
export function decideScheduledAdvance(now, lastSuccess) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    // Not a verdict: an unreadable clock must not deploy into a game, and must be visible.
    return { run: false, line: 'skip: could not read the current time' }
  }
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes()
  const hhmm = now.toISOString().slice(11, 16)
  if (minute < WINDOW_START_MIN || minute >= WINDOW_END_MIN) {
    return { run: false, line: `skip: started at ${hhmm} UTC, outside the 13:00-16:30 UTC window; tomorrow's attempt will advance` }
  }
  if (lastSuccess instanceof Date && !Number.isNaN(lastSuccess.getTime())) {
    const ageH = (now.getTime() - lastSuccess.getTime()) / 3_600_000
    if (ageH >= 0 && ageH < BACKUP_GAP_H) {
      return { run: false, line: `skip: an earlier run already succeeded at ${lastSuccess.toISOString().slice(11, 16)} UTC (${ageH.toFixed(1)}h ago)` }
    }
  }
  return { run: true, line: `run: ${hhmm} UTC is inside the window and nothing has advanced in the last ${BACKUP_GAP_H}h` }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (invokedDirectly) {
  const now = new Date(arg('--now') ?? new Date().toISOString())
  const rawLast = arg('--last-success')
  const last = rawLast && rawLast !== 'none' ? new Date(rawLast) : null
  console.log(decideScheduledAdvance(now, last).line)
}
