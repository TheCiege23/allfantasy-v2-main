/**
 * POST /api/core/sync — one batch of the "Sync now" button in the /core shell.
 *
 * Re-runs the SAME per-league resync the Settings → League Imports rows offer
 * (POST /api/leagues/import/resync), so a user can bring every connected league
 * current from wherever they are in /core rather than opening a row at a time.
 *
 * ⚠ THIS ENDPOINT SYNCS A BATCH, NOT NECESSARILY EVERYTHING — THE CLIENT LOOPS.
 * A serverless function has a hard 300s ceiling and a resync is a full provider
 * fetch + normalization + persist, so an account with 50+ leagues cannot finish
 * in one invocation no matter how the work is arranged. Rather than truncate at
 * a fixed count and call it done, each call works until its time budget is spent
 * and returns `remaining` — the keys it did not reach. The caller posts those
 * back and the loop continues until `remaining` is empty. Every league gets
 * synced; it just takes several round trips, and the progress line says so.
 *
 * ⚠ THE RESYNCABLE SET IS READ FROM THE SAME SOURCE AS THAT PANEL
 * (`getDashboardLeagueListForUser`, which is what GET /api/league/list serves)
 * and filtered by the same three tests. A league the panel refuses to resync
 * must not become resyncable just because the button is somewhere else — the
 * exclusion exists because a career-board snapshot carries a platformLeagueId
 * with no live native backing, and resyncing one materializes a native league
 * out of what the user sees as read-only history.
 *
 * ⚠ INCREMENTAL, NOT A REBUILD — AND THE TWO PATHS DIFFER, SO IT SAYS WHICH RAN.
 * A connected Sleeper league goes straight to the durable collector
 * (`manualRefreshConnectedSleeperLeague`), which resumes from the per-scope
 * checkpoints in `LeagueSyncState` and never refetches an immutable completed
 * scope. Its `force: true` bypasses the CADENCE due-check only — it does not
 * discard checkpoints, so this ingests what changed rather than rebuilding the
 * league. That path is reported as `mode: 'incremental'`.
 *
 * ⚠ THE FULL IMPORT PIPELINE IS THE FALLBACK, NOT THE DEFAULT, AND IT IS NOT
 * INCREMENTAL. `resyncImportedLeague` re-fetches and re-normalizes the whole
 * league; it runs only where there is no durable collector to resume (ESPN,
 * Fantrax, MFL, Fleaflicker) or where a Sleeper league has no native record to
 * authorize against — i.e. nothing to be incremental *from*. Reported as
 * `mode: 'full'` rather than quietly presented as the same operation.
 *
 * ⚠ STATELESS BY DESIGN. `only` is a filter over the candidate set recomputed
 * from the database on every call, never a client-supplied work list — a caller
 * cannot name a league it does not own, or one the filters above exclude, by
 * putting a key in the body. The worst a bad `only` can do is sync nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import {
  collectResyncCandidates,
  type ResyncCandidate,
} from '@/lib/core-app/resyncableLeagues'
import { manualRefreshConnectedSleeperLeague } from '@/lib/fantasy-os/sync/collector'
import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'
import type { ImportProvider } from '@/lib/league-import/types'

export const dynamic = 'force-dynamic'
/* Each league is a provider round-trip; the platform ceiling is the real bound. */
export const maxDuration = 300

/**
 * Stop STARTING new leagues once this much of the request is gone. Well under
 * `maxDuration` because the league already in flight still has to finish and
 * the response still has to be written — a budget that runs to the ceiling
 * returns a timeout instead of the `remaining` list the loop needs to continue.
 */
const TIME_BUDGET_MS = 200_000

type LeagueOutcome = {
  key: string
  id: string
  name: string
  platform: string
  /** `locked` is a peer refresh already in flight — not a failure of this press. */
  status: 'synced' | 'locked' | 'failed'
  /**
   * Which path ran. Surfaced because they are genuinely different operations —
   * `incremental` resumed from checkpoints, `full` re-read the whole league —
   * and collapsing them would hide a league quietly taking the expensive path
   * on every press.
   */
  mode: 'incremental' | 'full'
  error?: string
}

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as { only?: unknown }
  const onlyRaw = body?.only
  const only =
    Array.isArray(onlyRaw) && onlyRaw.length > 0
      ? new Set(onlyRaw.filter((k): k is string => typeof k === 'string'))
      : null

  const all = await collectResyncCandidates(auth.userId)
  if (!all) {
    return NextResponse.json(
      { ok: false, error: 'We could not read your leagues just now.' },
      { status: 503 },
    )
  }

  const queue = only ? all.filter((c) => only.has(c.key)) : all

  const startedAt = Date.now()
  const results: LeagueOutcome[] = []
  const done = new Set<string>()

  /*
   * ⚠ PARALLEL ACROSS PLATFORMS, STRICTLY SERIAL WITHIN ONE.
   *
   * The leagues are grouped by provider and the groups run concurrently, so a
   * manager with Sleeper + ESPN + Fantrax leagues finishes in roughly the time
   * of their largest single platform rather than the sum of all three. Inside a
   * group it stays one-at-a-time on purpose: those calls hit ONE vendor under
   * ONE user's credentials, and firing a dozen at once is how a rate limiter
   * turns a slow sync into a failed one. Concurrency here is bounded by the
   * number of distinct platforms a person actually has — a handful — not by a
   * tuning constant that can drift out of step with any vendor's limits.
   */
  const groups = new Map<ImportProvider, ResyncCandidate[]>()
  for (const c of queue) {
    const g = groups.get(c.provider)
    if (g) g.push(c)
    else groups.set(c.provider, [c])
  }

  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      for (const candidate of group) {
        /*
         * Checked BEFORE each league rather than after, so a league is never
         * started that the response cannot wait for. The first league in every
         * group always clears this (the budget cannot be spent at t=0), which
         * is what guarantees each round makes progress and the client loop
         * terminates instead of posting the same `remaining` list forever.
         */
        if (Date.now() - startedAt > TIME_BUDGET_MS) return

        const base = {
          key: candidate.key,
          id: String(candidate.row.id ?? candidate.sourceId),
          name: candidate.row.name || 'Untitled league',
          platform: String(candidate.provider),
        }

        done.add(candidate.key)

        /*
         * ⚠ INCREMENTAL FIRST. A connected Sleeper league with a native record
         * resumes from its `LeagueSyncState` checkpoints — immutable completed
         * scopes are not refetched, and nothing is rebuilt. No `fetchNormalized`
         * is passed on purpose: the collector's own loader is lazy and memoized,
         * so a scope that does not need to run costs no provider call at all.
         * Handing it a pre-fetched payload (which is what the import pipeline
         * does) forces the whole-league read this path exists to avoid.
         */
        const nativeLeagueId =
          typeof candidate.row.navigationLeagueId === 'string' ? candidate.row.navigationLeagueId : ''

        if (candidate.provider === 'sleeper' && nativeLeagueId) {
          const out = await manualRefreshConnectedSleeperLeague({
            userId: auth.userId,
            leagueId: nativeLeagueId,
          }).catch(() => null)

          if (!out) {
            results.push({ ...base, mode: 'incremental', status: 'failed', error: 'The sync did not complete.' })
            continue
          }
          if (!out.ok) {
            results.push({ ...base, mode: 'incremental', status: 'failed', error: out.error })
            continue
          }

          /*
           * Same honesty rule as the per-league route: freshness advances ONLY on
           * a fully completed run, so anything else is reported as what it is.
           * ⚠ `executed: false` here means "not due", which cannot happen on this
           * path (force bypasses the cadence gate) — but it is still not a sync,
           * so it must not be counted as one.
           */
          const sync = out.sync
          if (sync.status === 'locked') {
            results.push({ ...base, mode: 'incremental', status: 'locked' })
          } else if (sync.executed && sync.status === 'completed' && sync.advancedFreshness) {
            results.push({ ...base, mode: 'incremental', status: 'synced' })
          } else {
            results.push({
              ...base,
              mode: 'incremental',
              status: 'failed',
              error: 'The existing league data was preserved, but the sync did not complete.',
            })
          }
          continue
        }

        /*
         * ⚠ FALLBACK ONLY — THIS ONE IS A FULL RE-READ. There is no durable
         * collector for these providers to resume from, so there is no delta to
         * ingest and the whole league is re-fetched and re-normalized. It is
         * labelled `full` rather than presented as the same operation.
         */
        const out = await resyncImportedLeague({
          userId: auth.userId,
          provider: candidate.provider,
          sourceId: candidate.sourceId,
        }).catch(() => ({ ok: false as const, error: 'The resync did not complete.' }))

        if (!out.ok) {
          results.push({ ...base, mode: 'full', status: 'failed', error: out.error })
          continue
        }

        const refresh = out.refresh
        if (refresh === null) {
          results.push({ ...base, mode: 'full', status: 'synced' })
        } else if (refresh.kind === 'auth') {
          results.push({ ...base, mode: 'full', status: 'failed', error: refresh.error })
        } else if (refresh.status === 'locked') {
          results.push({ ...base, mode: 'full', status: 'locked' })
        } else if (refresh.status === 'completed' && refresh.advancedFreshness && refresh.executed) {
          results.push({ ...base, mode: 'full', status: 'synced' })
        } else {
          results.push({
            ...base,
            mode: 'full',
            status: 'failed',
            error: 'The existing league data was preserved, but the refresh did not complete.',
          })
        }
      }
    }),
  )

  /*
   * What this round did not reach. A `locked` or `failed` league is NOT in here
   * — it was attempted and got an answer, and re-attempting it inside the same
   * press would spin on a lock that a peer run still holds.
   */
  const remaining = queue.filter((c) => !done.has(c.key)).map((c) => c.key)

  return NextResponse.json({
    ok: true,
    /** Every resyncable league on the account — the denominator for progress. */
    totalCandidates: all.length,
    /** Attempted in THIS round. */
    attempted: results.length,
    synced: results.filter((r) => r.status === 'synced').length,
    /* Split so a league silently taking the expensive path every press is visible. */
    incremental: results.filter((r) => r.mode === 'incremental').length,
    fullReread: results.filter((r) => r.mode === 'full').length,
    locked: results.filter((r) => r.status === 'locked').length,
    failed: results.filter((r) => r.status === 'failed').length,
    remaining,
    results,
  })
}
