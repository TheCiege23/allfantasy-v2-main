'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { coreTriageMessages } from '@/lib/core-app/messages/coreTriage'
import { messagesFor } from '@/lib/i18n/messages'

/**
 * "Add Puka Nacua (WR, +6.1 pts) in Guillotine League 26" — the triage card's free-agent button, upgraded
 * in place from "Find free agents in …" once the best free agent for that league's hole is known, and
 * deep-linked to the Waivers screen with him highlighted (`?player=`, priced the same way via `&out=`).
 * It is a button rather than text inside the league chip because the chip is itself a link.
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

type BoardCandidate = { sleeperId?: string | null; name: string; position: string | null; gain: number }
type Board = { state?: string; candidates?: BoardCandidate[] }

export type BestAdd =
  | { kind: 'add'; sleeperId: string | null; name: string; position: string | null; gain: number }
  | { kind: 'none' }

/** The board's answer reduced to what the card says; null when it cannot say anything honest. */
export function bestAddFrom(board: Board | null | undefined): BestAdd | null {
  if (!board || board.state !== 'ok' || !Array.isArray(board.candidates)) return null
  const top = board.candidates[0]
  if (!top || !(top.gain > 0)) return { kind: 'none' }
  return { kind: 'add', sleeperId: top.sleeperId ?? null, name: top.name, position: top.position, gain: top.gain }
}

/** The button's words: the add itself, nobody worth adding, or the plain search it started as. */
export function bestAddCtaText(add: BestAdd | null, leagueName: string, es: boolean): string {
  const m = messagesFor(coreTriageMessages, es ? 'es' : 'en')
  if (!add) return m.bestAddSearch(leagueName)
  if (add.kind === 'none') {
    return m.bestAddNone(leagueName)
  }
  const pts = `+${add.gain.toFixed(1)} pts`
  const detail = add.position ? `${add.position}, ${pts}` : pts
  return m.bestAddAdd(add.name, detail, leagueName)
}

/** The Waivers deep link: that league, the player highlighted, priced with the injured starter at zero. */
export function bestAddHref(baseHref: string, add: BestAdd | null, injuredId: string | null): string {
  if (!add || add.kind !== 'add' || !add.sleeperId) return baseHref
  const join = baseHref.includes('?') ? '&' : '?'
  const out = injuredId ? `&out=${encodeURIComponent(injuredId)}` : ''
  return `${baseHref}${join}player=${encodeURIComponent(add.sleeperId)}${out}`
}

// One answer per (league, injured player) for a few minutes: the shell re-renders this route every
// couple of minutes and on every return to the app, and none of that should re-price the wire.
const cache = new Map<string, { at: number; add: BestAdd | null }>()

export function TriageFreeAgentCta({
  leagueId,
  leagueName,
  baseHref,
  injuredId,
  auto,
  es,
}: {
  leagueId: string
  leagueName: string
  /** `/core/waivers?league=…` — where the button goes until (and unless) a best add is known. */
  baseHref: string
  /** Sleeper id of the injured starter; null outside the NFL. */
  injuredId: string | null
  /** One of the capped few that may ask (see BEST_ADD_AUTO_LIMIT). */
  auto: boolean
  es: boolean
}) {
  const key = `${leagueId}|${injuredId ?? ''}`
  const hit = cache.get(key)
  const fresh = hit && Date.now() - hit.at < CACHE_MS ? hit : null
  const [add, setAdd] = useState<BestAdd | null>(fresh?.add ?? null)

  useEffect(() => {
    if (!auto || !injuredId || fresh) return
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
        /* the button stays the plain search it started as */
      })
    return () => {
      live = false
    }
    // `fresh` is derived from `key`; re-running on its identity would refetch a cached answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, leagueId, injuredId, auto])

  return (
    <Link
      className="af-triage-cta"
      data-kind={add?.kind ?? 'search'}
      href={bestAddHref(baseHref, add, injuredId)}
      onClick={() => sendProductAnalyticsBeacon('product.triage.free_agent_clicked', { kind: add?.kind ?? 'search' })}
    >
      {bestAddCtaText(add, leagueName, es)}
    </Link>
  )
}

export default TriageFreeAgentCta
