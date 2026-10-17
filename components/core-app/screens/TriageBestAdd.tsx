'use client'

import { useEffect, useState } from 'react'

/**
 * "top add: Puka Nacua (WR, +6.1 pts)" — the best free agent for ONE league's hole, under the triage
 * card's "swap in …" line.
 *
 * ⚠ ON DEMAND, AND CAPPED, BECAUSE THE HOME MUST NOT FAN OUT. Answering "who is available" needs that
 * league's whole player pool, its rostered-elsewhere exclusion and this week's projections — ~6
 * queries per league in `loadWaiverBoard`. Doing that inside the home loader for every flagged
 * starter in 61 leagues is the fan-out that took production Postgres down once, which is why
 * `dash34` stays roster-only. So the card asks from the browser, for at most `BEST_ADD_AUTO_LIMIT`
 * leagues (the caller picks them), once per league per few minutes.
 *
 * The board already does the hard parts: the injured starter is priced at ZERO (`unavailable`), a
 * free agent whose game has kicked off or who is out/on bye is never offered, flex and superflex are
 * just slots to it, and `gain` is points added to YOUR best lineup — so a top row with no gain means
 * nobody on the wire beats what you already have, and the card says so.
 */

export const BEST_ADD_AUTO_LIMIT = 3
const CACHE_MS = 5 * 60_000

type BoardCandidate = { name: string; position: string | null; gain: number }
type Board = { state?: string; candidates?: BoardCandidate[] }

export type BestAdd =
  | { kind: 'add'; name: string; position: string | null; gain: number }
  | { kind: 'none' }

/** The board's answer reduced to what the card says; null when it cannot say anything honest. */
export function bestAddFrom(board: Board | null | undefined): BestAdd | null {
  if (!board || board.state !== 'ok' || !Array.isArray(board.candidates)) return null
  const top = board.candidates[0]
  if (!top || !(top.gain > 0)) return { kind: 'none' }
  return { kind: 'add', name: top.name, position: top.position, gain: top.gain }
}

export function bestAddText(add: BestAdd, es: boolean): string {
  if (add.kind === 'none') return es ? 'ningún agente libre mejora tu alineación' : 'no free agent beats your lineup'
  const pts = `+${add.gain.toFixed(1)} pts`
  const detail = add.position ? `${add.position}, ${pts}` : pts
  return es ? `mejor agente libre: ${add.name} (${detail})` : `top add: ${add.name} (${detail})`
}

// One answer per (league, injured player) for a few minutes: the shell re-renders this route every
// couple of minutes and on every return to the app, and none of that should re-price the wire.
const cache = new Map<string, { at: number; add: BestAdd | null }>()

export function TriageBestAdd({ leagueId, injuredId, es }: { leagueId: string; injuredId: string; es: boolean }) {
  const key = `${leagueId}|${injuredId}`
  const hit = cache.get(key)
  const fresh = hit && Date.now() - hit.at < CACHE_MS ? hit : null
  const [add, setAdd] = useState<BestAdd | null>(fresh?.add ?? null)

  useEffect(() => {
    if (fresh) return
    let live = true
    const url =
      `/api/idp/players?view=waiver-board&limit=1&leagueId=${encodeURIComponent(leagueId)}` +
      `&unavailable=${encodeURIComponent(injuredId)}`
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<Board>) : null))
      .then((board) => {
        const next = bestAddFrom(board)
        cache.set(key, { at: Date.now(), add: next })
        if (live) setAdd(next)
      })
      .catch(() => {
        /* the "Find free agents" link below is still there */
      })
    return () => {
      live = false
    }
    // `fresh` is derived from `key`; re-running on its identity would refetch a cached answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, leagueId, injuredId])

  if (!add) return null
  return (
    <span className="af-triage-bench af-triage-best-add" data-kind={add.kind}>
      {' · '}
      {bestAddText(add, es)}
    </span>
  )
}

export default TriageBestAdd
