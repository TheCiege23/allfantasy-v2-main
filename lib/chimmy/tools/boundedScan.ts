/**
 * Run work over a list under a WALL-CLOCK budget, reporting exactly what was not done.
 *
 * ⚠ WHY NOT A FIXED CAP. The cross-league injury scan took the first 40 leagues in list order
 * and reported the rest as a count: "24 further league(s) were not scanned". A count names no
 * league, so the answer could not say WHICH rosters went unchecked, and the cap was a guess at
 * a time limit rather than one. A Chimmy tool has no per-call timeout of its own — only the
 * loop's 75s ceiling, shared with up to four model turns — so the honest bound is time.
 *
 * Four outcomes per item, never collapsed:
 *   - done       the work finished (its own result may still say "unreadable")
 *   - timedOut   started, but did not finish within `perItemTimeoutMs` — its late result is ignored
 *   - failed     the work threw (it is expected to turn its own failures into a result; this is
 *                the backstop, so one bad item cannot take the whole scan down)
 *   - notStarted the budget ran out before it was reached
 *
 * PURE apart from the injected clock and the work itself; results keep input order.
 */

import { findCollidingNames, resolveTileName } from '@/lib/core-app/leagueNameCollision'

export interface BoundedScanOptions {
  concurrency: number
  /** No NEW item starts once this much time has passed. */
  budgetMs: number
  /** An item still running after this long is reported timedOut. */
  perItemTimeoutMs: number
  now?: () => number
}

export interface BoundedScanResult<T, R> {
  done: Array<{ item: T; result: R }>
  timedOut: T[]
  failed: T[]
  notStarted: T[]
}

const TIMED_OUT = Symbol('timedOut')
const FAILED = Symbol('failed')

export async function scanWithinBudget<T, R>(
  items: readonly T[],
  opts: BoundedScanOptions,
  work: (item: T) => Promise<R>,
): Promise<BoundedScanResult<T, R>> {
  const now = opts.now ?? Date.now
  const deadline = now() + opts.budgetMs
  const outcome: Array<{ kind: 'done'; result: R } | { kind: 'timedOut' } | { kind: 'failed' } | { kind: 'notStarted' }> = items.map(() => ({
    kind: 'notStarted' as const,
  }))
  let next = 0

  async function worker(): Promise<void> {
    while (next < items.length) {
      if (now() >= deadline) return
      const i = next++
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), opts.perItemTimeoutMs)
      })
      const settled = await Promise.race([work(items[i]!).catch(() => FAILED), timeout])
      if (timer) clearTimeout(timer)
      outcome[i] =
        settled === TIMED_OUT ? { kind: 'timedOut' } : settled === FAILED ? { kind: 'failed' } : { kind: 'done', result: settled as R }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, items.length)) }, () => worker()))

  const result: BoundedScanResult<T, R> = { done: [], timedOut: [], failed: [], notStarted: [] }
  outcome.forEach((o, i) => {
    const item = items[i]!
    if (o.kind === 'done') result.done.push({ item, result: o.result })
    else if (o.kind === 'timedOut') result.timedOut.push(item)
    else if (o.kind === 'failed') result.failed.push(item)
    else result.notStarted.push(item)
  })
  return result
}

/**
 * Said beside every league list a tool hands the model.
 *
 * ⚠ LISTING THE NAMES WAS NOT ENOUGH. After the 6-name cap was lifted (#1509), a 2026-09-28 answer
 * about 8 unsynced leagues still wrote "KBI Commish Chat, Guillotine League 26 (2), NFL, and four
 * TheCiege26 redraft leagues" — a paraphrase naming 7 of 8 and hiding which ones. A user cannot act
 * on "four redraft leagues"; they can act on four names.
 */
export const NAME_EVERY_LEAGUE =
  'When you mention these leagues, name every one exactly as listed (and give any "+N more" count as stated) — never group them ("four redraft leagues") or shorten the list with "including".'

/**
 * Give leagues that share a name a distinct label: "Name · 1a2b" (the last four of the league id).
 *
 * ⚠ THE APP'S OWN RULE, NOT A SECOND ONE. `resolveTileName` (lib/core-app/leagueNameCollision.ts,
 * the league tile's rule) defines the suffix for colliding names; this applies it to the lists
 * Chimmy's tools hand the model.
 * Measured 2026-09-28: TheCiege26 has two "TheCiege26's 8-Team NFL Redraft League" and four
 * "TheCiege26's 12-Team NFL Redraft League", so even with every league named (#1515) the list could
 * not tell the user WHICH ones. Only colliding names change; a suffix on a unique name is noise.
 */
export function withDistinctLeagueNames<T extends { id: string; name: string }>(leagues: readonly T[]): T[] {
  const colliding = findCollidingNames(leagues.map((l) => ({ name: l.name, nickname: null })))
  if (colliding.size === 0) return [...leagues]
  return leagues.map((l) =>
    colliding.has(l.name) ? { ...l, name: resolveTileName({ id: l.id, name: l.name, nickname: null }, colliding).text } : l,
  )
}

/** "A, B, C (+4 more)" — names up to `max`, then counts the rest. */
export function nameList(names: readonly string[], max = 12): string {
  const shown = names.slice(0, max)
  return names.length > shown.length ? `${shown.join(', ')} (+${names.length - shown.length} more)` : shown.join(', ')
}
