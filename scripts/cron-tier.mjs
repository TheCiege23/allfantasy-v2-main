/**
 * Shared cron tier classification.
 *
 * WHY THIS EXISTS
 * Scheduling is split across two systems on purpose, and three consumers need to agree on
 * exactly where the line falls:
 *
 *   scripts/cron-dispatch.mjs         fires the SLOW tier from GitHub Actions
 *   scripts/cron-freshness-check.mjs  alerts when any tier stops writing rows
 *   scripts/cron-budget-check.mjs     fails a PR that adds a slow cron the workflow cannot fire
 *
 * If they disagree, a job silently belongs to neither scheduler. That is the failure this repo
 * just spent six days in, so the classification lives in ONE module.
 *
 * WHY SPLIT AT ALL
 * GitHub Actions schedules have a 5-minute floor and, in practice, queue behind the shared runner
 * pool -- routinely minutes late, occasionally skipped. Irrelevant to a nightly ingest, useless to
 * `live-score-tick` at every 2 minutes during a game.
 *
 * The split also buys fault isolation, which is the real reason. Before this, all 41 jobs shared
 * one point of failure: a billing event at the host took out every one of them at once, and
 * because nothing was still writing timestamps, nothing looked wrong for six days. With the slow
 * tier hosted elsewhere, a host outage can only ever take the fast tier -- the slow tier keeps
 * writing, and the freshness monitor can still see the gap.
 *
 * `vercel.json` stays the single source of truth for WHAT runs and HOW OFTEN. This module only
 * answers WHICH SCHEDULER should fire it.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Sub-hourly => FAST.
 *
 * Deliberately keyed on the MINUTE field only. `0 STAR/3 * * *` is every three hours -- a stepped
 * HOUR field -- and must stay slow; keying on "contains a step anywhere" would misfile it as fast
 * and hand it to a scheduler that cannot fire it accurately, for no benefit.
 */
export function isFastSchedule(schedule) {
  const minute = String(schedule).trim().split(/\s+/)[0]
  return minute === '*' || /^\*\/\d+$/.test(minute)
}

/**
 * Jobs deliberately NOT ported to the slow-tier workflow.
 *
 * Every entry needs a reason. An unexplained exclusion is indistinguishable from an oversight,
 * and this list is the only thing standing between "we chose not to run it" and "we forgot".
 * Deleting an entry is all it takes to re-enable the job.
 */
export const SLOW_TIER_EXCLUSIONS = {
  '/api/redraft/ai/power-rankings': {
    reason:
      'BROKEN BY CONSTRUCTION -- POST-only, and gated by requireAfSub() which needs a user ' +
      'session. A cron has neither, so a GET 405s and a POST 403s. This never worked on Vercel ' +
      'either; the scheduler outage did not break it. Fix the route before re-enabling.',
  },
  '/api/redraft/ai/weekly-recap': {
    reason: 'BROKEN BY CONSTRUCTION -- same as power-rankings: POST-only behind requireAfSub().',
  },
  '/api/guillotine/ai/storyline': {
    reason:
      'PRODUCT DIRECTION -- AI generation is on-demand and user-initiated only, never cron-seeded. ' +
      'The route would work (GET + requireCronAuth), but a scheduled generation spends a real ' +
      'token balance for output nobody asked for.',
  },
  '/api/brackets/world-cup/cron/sync': {
    reason:
      'RETIRED -- the 2026 final was 2026-07-19 and .github/workflows/wc-cron.yml already disabled ' +
      'its own schedule at the cutoff. Its provider jobs were removed in July because the ' +
      'API-Football plan does not cover the 2026 season.',
  },
}

export function readVercelCrons(cwd = process.cwd()) {
  const raw = fs.readFileSync(path.join(cwd, 'vercel.json'), 'utf8')
  const parsed = JSON.parse(raw)
  return (parsed.crons ?? [])
    .filter((c) => typeof c?.path === 'string' && typeof c?.schedule === 'string')
    .map((c) => ({ path: c.path, schedule: c.schedule }))
}

/**
 * Classifies every declared cron. Returns all buckets rather than just the one a caller wants, so
 * a consumer can REPORT what it is not handling instead of silently dropping it.
 */
export function classifyCrons(crons) {
  const fast = []
  const slow = []
  const excluded = []
  for (const c of crons) {
    // Keyed on the PATHNAME, not the declared path. Several crons carry query strings
    // (`/api/brackets/world-cup/cron/sync?job=all&provider=apifootball&...`), and a bare-path key
    // silently matches none of them -- which reads exactly like "nothing to exclude" rather than
    // "the key was wrong". Caught the first time this ran: 3 exclusions matched instead of 4.
    const exclusion = SLOW_TIER_EXCLUSIONS[c.path.split('?')[0]]
    if (isFastSchedule(c.schedule)) {
      fast.push(c)
    } else if (exclusion) {
      excluded.push({ ...c, reason: exclusion.reason })
    } else {
      slow.push(c)
    }
  }
  return { fast, slow, excluded, all: crons }
}

/** Distinct slow-tier schedules, sorted -- the exact set the workflow's `schedule:` block must carry. */
export function slowTierSchedules(crons) {
  return [...new Set(classifyCrons(crons).slow.map((c) => c.schedule))].sort()
}

/** Slow-tier jobs firing on one schedule. The dispatcher's lookup, keyed by `github.event.schedule`. */
export function slowTierJobsForSchedule(crons, schedule) {
  const wanted = String(schedule).trim()
  return classifyCrons(crons).slow.filter((c) => c.schedule.trim() === wanted)
}
