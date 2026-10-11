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
  writeLeagueSimCheck,
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
        out[await refreshLeagueOutlook(c.leagueId, stored.get(c.leagueId), now)] += 1
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

/**
 * Re-run one provider league's outlook if its inputs changed. `held` is what is stored under the
 * provider id the caller looked up. Throws on a failed read or run; the caller decides what to keep.
 *
 * One League row per provider league is enough — the run does not depend on whose row it is. The
 * newest season's row carries the settings the page would pass.
 */
async function refreshLeagueOutlook(
  leagueId: string,
  held: LeagueSimResult | undefined,
  now: Date,
): Promise<'computed' | 'unchanged' | 'skipped'> {
  const row = await prisma.league.findFirst({
    where: { platformLeagueId: leagueId },
    orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true },
  })
  if (!row) {
    await writeLeagueSimMarker(leagueId, 'unsimulated', now)
    return 'skipped'
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
    await writeLeagueSimMarker(leagueId, 'unsimulated', now)
    return 'skipped'
  }
  const current = p.pid === leagueId ? held : (await readLeagueSims([p.pid], now)).get(p.pid)
  const checkedAt = new Date().toISOString()
  if (current && current.hash === leagueSimHash(p.sim, p.seed) && current.iterations >= ITERATIONS) {
    await writeLeagueSims([[p.pid, { ...current, checkedAt }]], now)
    if (p.pid !== leagueId) await writeLeagueSimCheck(leagueId, now)
    return 'unchanged'
  }
  const result = computeLeagueSim(p.sim, p.seed, ITERATIONS, now)
  await writeLeagueSims([[p.pid, { ...result, checkedAt }]], now)
  if (p.pid !== leagueId) await writeLeagueSimCheck(leagueId, now)
  return 'computed'
}

/* ── Live re-run ──────────────────────────────────────────────────────────────────────────────── */

const LIVE_LEAGUES_PER_PASS = 8
const LIVE_BUDGET_MS = 20_000

export type LiveOutlookCounts = { considered: number; computed: number; unchanged: number; skipped: number; deferred: number; failed: number }

/**
 * Season Outlook — re-run the leagues whose live board the live tick just rewrote.
 *
 * 🛑 THE SCHEDULED PRE-COMPUTE CANNOT KEEP UP WITH A SUNDAY, MEASURED. Its signal is
 * `WeeklyMatchup.updatedAt`, which the matchup cache rewrites for nearly every league, so on
 * 2026-10-11 every `/api/cron/domain-os-refresh` fire saw ~400 leagues due and ran 12, oldest check
 * first: a league's odds came round about once every 17 hours, never inside a game. HailShiva's
 * stored run was 17:13 while its board had moved at 17:25 and 17:41.
 *
 * So the live points pass hands over the leagues it just synced, and this re-runs them — but only
 * when the inputs hash changed, which during a game is the board itself (`leagueSimHash` carries each
 * live game's points and the share of each lineup still to play). Stalest stored run first, at most
 * eight leagues and 20 s a pass; what is left waits for the next pass two minutes later, and the page
 * still computes any league on demand. A league whose hash matches is stamped as checked, which also
 * takes it out of the scheduled pre-compute's queue.
 *
 * Postgres and arithmetic only, never throws. `CORE_OUTLOOK_LIVE_RERUN_DISABLED=true` (or the
 * pre-compute's own switch) turns it off.
 */
export async function rerunLiveOutlooks(
  leagueIds: readonly string[],
  now: Date = new Date(),
  opts: { maxLeagues?: number; budgetMs?: number; clock?: () => number } = {},
): Promise<LiveOutlookCounts> {
  const out: LiveOutlookCounts = { considered: 0, computed: 0, unchanged: 0, skipped: 0, deferred: 0, failed: 0 }
  const off = (v: string | undefined) => String(v ?? '').toLowerCase() === 'true'
  if (off(process.env.CORE_OUTLOOK_LIVE_RERUN_DISABLED) || off(process.env.CORE_OUTLOOK_PREWARM_DISABLED)) return out
  const ids = [...new Set(leagueIds.filter(Boolean))]
  out.considered = ids.length
  if (ids.length === 0) return out
  const clock = opts.clock ?? Date.now
  const deadline = clock() + (opts.budgetMs ?? LIVE_BUDGET_MS)
  const maxLeagues = opts.maxLeagues ?? LIVE_LEAGUES_PER_PASS

  try {
    const stamps = await readLeagueSimStamps(ids, now)
    const lastChecked = (id: string) => stamps.get(id)?.at ?? Number.NEGATIVE_INFINITY
    const order = ids.slice().sort((a, b) => lastChecked(a) - lastChecked(b))
    const stored = await readLeagueSims(ids, now)
    let attempted = 0
    for (const id of order) {
      if (attempted >= maxLeagues || clock() > deadline) break
      attempted += 1
      try {
        out[await refreshLeagueOutlook(id, stored.get(id), now)] += 1
      } catch {
        // A failed league keeps its stored run; the next pass tries again.
        out.failed += 1
      }
    }
    out.deferred = order.length - attempted
  } catch {
    out.failed += 1
  }
  return out
}
