import 'server-only'

import { prisma } from '@/lib/prisma'
import { ITERATIONS, loadOutlookInputs, type LeagueInput } from './seasonOutlook'
import {
  computeLeagueSim,
  leagueSimHash,
  readLeagueSimStamps,
  readLeagueSims,
  writeLeagueSimMarker,
  writeLeagueSims,
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
 * 🛑 THE SAME GOES FOR A LEAGUE THAT CANNOT BE RUN, AND THE FIRST RELEASE MISSED IT. A skipped or
 * failing league wrote nothing, sorted first as "never checked", and was retried on every fire —
 * 3 skipped then 5 in the first two production fires, with the cap already reached. Each outcome now
 * leaves a check time (`writeLeagueSimMarker`), and a failure never overwrites a good stored run.
 *
 * 🛑 AND A CHECK TIME ALONE IS NOT ENOUGH FOR A LEAGUE THAT CANNOT BE RUN, BECAUSE THE CANDIDATE
 * SIGNAL IS NOISE. A sync rewrites the league's matchup rows within the hour, the marker's stamp is
 * then older than the newest row, and the league is due all over again — so the 19:00Z run still
 * spent 5 of its 12 slots on leagues it had already marked. A marker therefore holds for
 * `MARKER_COOLDOWN_MS` whatever `updatedAt` says. Nothing is lost by waiting: the page computes a
 * league on demand, and a league that becomes runnable is picked up on the next fire after that.
 *
 * Postgres and arithmetic only: no provider call, no `lib/auth`. Bounded by league count and time on
 * top of the host route's shared budget; never throws. `CORE_OUTLOOK_PREWARM_DISABLED=true` stops it.
 */

const LEAGUES_PER_FIRE = 12
const BUDGET_MS = 30_000
/** How far back a changed matchup row makes its league a candidate. Several fires' worth. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000
/** How long a league it could not run is left alone, however often its rows are rewritten. */
const MARKER_COOLDOWN_MS = 24 * 60 * 60 * 1000

export type OutlookPrewarmCounts = {
  /** Leagues with a matchup row written inside the lookback. */
  candidates: number
  /** Of those, the ones whose last check is older than their newest row. */
  due: number
  /** Would have been due, but were marked unrunnable inside the cooldown — slots kept for real runs. */
  cooling: number
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
  return { candidates: 0, due: 0, cooling: 0, computed: 0, unchanged: 0, skipped: 0, deferred: 0, failed: 0, errors: [] }
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

    const ids = changed.map((c) => c.leagueId)
    const [stored, stamps] = await Promise.all([readLeagueSims(ids, now), readLeagueSimStamps(ids, now)])
    /* Markers count here: a league we could not run was still checked, and waits its turn like any other. */
    const lastChecked = (pid: string) => stamps.get(pid)?.at ?? Number.NEGATIVE_INFINITY
    const due = changed
      .filter((c) => {
        const stamp = stamps.get(c.leagueId)
        if ((c._max.updatedAt?.getTime() ?? 0) <= (stamp?.at ?? Number.NEGATIVE_INFINITY)) return false
        if (stamp?.marker && now.getTime() - stamp.at < MARKER_COOLDOWN_MS) {
          out.cooling += 1
          return false
        }
        return true
      })
      /* Oldest check first, so a busy Sunday drains in order rather than starving the tail. */
      .sort((a, b) => lastChecked(a.leagueId) - lastChecked(b.leagueId))
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
          await writeLeagueSimMarker(c.leagueId, 'unsimulated', now)
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
          await writeLeagueSimMarker(c.leagueId, 'unsimulated', now)
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
        /* Stamped as checked so it does not jump the queue again; a good stored run is kept, not replaced. */
        const held = stored.get(c.leagueId)
        if (held) await writeLeagueSims([[c.leagueId, { ...held, checkedAt: new Date().toISOString() }]], now)
        else await writeLeagueSimMarker(c.leagueId, 'failed', now)
      }
    }
    out.deferred = due.length - attempted
  } catch (e) {
    out.failed += 1
    out.errors.push(`outlook_prewarm: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}
