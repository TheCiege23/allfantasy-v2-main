import 'server-only'

import { prisma } from '@/lib/prisma'
import { ITERATIONS, loadOutlookInputs, type LeagueInput } from './seasonOutlook'
import {
  computeLeagueSim,
  leagueSimHash,
  readLeagueSims,
  writeLeagueSims,
  type LeagueSimResult,
} from './seasonOutlookSims'

/**
 * Season Outlook — re-run the leagues whose inputs changed, before anyone opens the page.
 *
 * The page is already correct without this: its summary key carries a fingerprint of the inputs, and
 * each league's stored run is checked against a hash of what it reads, so a visit after a sync
 * recomputes exactly the leagues that moved. What this adds is WHEN: a scored week, an import or a
 * transaction lands through a sync, and the next fire of `/api/cron/domain-os-refresh` re-runs those
 * leagues at the full iteration count, so the first visit after a Sunday is a reuse, not a cold run.
 *
 * ── 🛑 `WeeklyMatchup.updatedAt` MOVES WHEN NOTHING CHANGED ────────────────────────────────────
 * Measured on production 2026-09-17: 9,420 of 57,678 rows (238 of 247 leagues) had a new
 * `updatedAt` inside six hours, because the matchup cache rewrites a league's current season
 * wholesale. So a changed timestamp only makes a league a CANDIDATE. The input hash decides whether
 * anything is re-run, and a candidate whose hash still matches is only stamped `checkedAt` — without
 * that stamp it would look stale forever and take a slot on every fire.
 *
 * Postgres and arithmetic only: no provider call, no `lib/auth`. Bounded by league count and time on
 * top of the host route's shared budget; never throws. `CORE_OUTLOOK_PREWARM_DISABLED=true` stops it.
 */

const LEAGUES_PER_FIRE = 12
const BUDGET_MS = 30_000
/** How far back a changed matchup row makes its league a candidate. Several fires' worth. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000

export type OutlookPrewarmCounts = {
  /** Leagues with a matchup row written inside the lookback. */
  candidates: number
  /** Of those, the ones whose last check is older than their newest row. */
  due: number
  computed: number
  /** Due, but the inputs hashed the same — stamped as checked, nothing re-run. */
  unchanged: number
  /** Nothing to simulate (too few modelled teams, no rows once folded). */
  skipped: number
  deferred: number
  failed: number
  errors: string[]
}

export function emptyOutlookPrewarmCounts(): OutlookPrewarmCounts {
  return { candidates: 0, due: 0, computed: 0, unchanged: 0, skipped: 0, deferred: 0, failed: 0, errors: [] }
}

export async function runOutlookPrewarm(
  now: Date = new Date(),
  opts: { budget?: { exhausted(): boolean }; maxLeagues?: number; budgetMs?: number } = {},
): Promise<OutlookPrewarmCounts> {
  const out = emptyOutlookPrewarmCounts()
  if (String(process.env.CORE_OUTLOOK_PREWARM_DISABLED ?? '').toLowerCase() === 'true') return out
  const started = Date.now()
  const maxLeagues = opts.maxLeagues ?? LEAGUES_PER_FIRE
  const budgetMs = opts.budgetMs ?? BUDGET_MS

  try {
    const changed = await prisma.weeklyMatchup.groupBy({
      by: ['leagueId'],
      where: { updatedAt: { gt: new Date(now.getTime() - LOOKBACK_MS) } },
      _max: { updatedAt: true },
    })
    out.candidates = changed.length
    if (changed.length === 0) return out

    const stored = await readLeagueSims(changed.map((c) => c.leagueId), now)
    const lastChecked = (r: LeagueSimResult | undefined) =>
      r ? Date.parse(r.checkedAt ?? r.computedAt) : Number.NEGATIVE_INFINITY
    const due = changed
      .filter((c) => (c._max.updatedAt?.getTime() ?? 0) > lastChecked(stored.get(c.leagueId)))
      /* Oldest check first, so a busy Sunday drains in order rather than starving the tail. */
      .sort((a, b) => lastChecked(stored.get(a.leagueId)) - lastChecked(stored.get(b.leagueId)))
    out.due = due.length
    if (due.length === 0) return out

    let attempted = 0
    for (const c of due) {
      if (attempted >= maxLeagues || Date.now() - started > budgetMs || opts.budget?.exhausted()) break
      attempted += 1
      try {
        /*
         * One League row per provider league is enough — the run does not depend on whose row it is.
         * The newest season's row carries the settings the page would pass.
         */
        const row = await prisma.league.findFirst({
          where: { platformLeagueId: c.leagueId },
          orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
          select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true },
        })
        if (!row) {
          out.skipped += 1
          continue
        }
        const league: LeagueInput = {
          id: row.id,
          name: row.name,
          platform: String(row.platform),
          platformLeagueId: row.platformLeagueId,
          settings: row.settings,
        }
        const inputs = await loadOutlookInputs('', [league])
        const p = inputs?.prepared[0]
        if (!p) {
          out.skipped += 1
          continue
        }
        const held = stored.get(c.leagueId)
        const checkedAt = new Date().toISOString()
        if (held && held.hash === leagueSimHash(p.sim, p.seed) && held.iterations >= ITERATIONS) {
          await writeLeagueSims([[p.pid, { ...held, checkedAt }]], now)
          out.unchanged += 1
          continue
        }
        const result = computeLeagueSim(p.sim, p.seed, ITERATIONS, now)
        await writeLeagueSims([[p.pid, { ...result, checkedAt }]], now)
        out.computed += 1
      } catch (e) {
        out.failed += 1
        if (out.errors.length < 5) out.errors.push(`outlook_prewarm: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    out.deferred = due.length - attempted
  } catch (e) {
    out.failed += 1
    out.errors.push(`outlook_prewarm: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}
