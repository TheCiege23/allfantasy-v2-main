'use client'

import { useEffect, useState } from 'react'

import { groundingFreshness } from '@/lib/chimmy/groundingFreshness'

/**
 * "Read from <league> · synced 12 min ago" under a grounded Chimmy answer, with a Refresh when the
 * data is stale.
 *
 * ⚠ REFRESH SYNCS THE LEAGUE; IT DOES NOT RE-ASK. Re-asking is a new answer and spends one of the
 * user's daily answers, and a tap on "Refresh" is not consent to that — the same rule the follow-up
 * chips follow (they fill the composer, they do not send). So after a refresh the line says the data
 * is current and invites the user to ask again.
 *
 * The refresh is the Player Finder's own path (POST /api/core/players/refresh-lineups) narrowed to
 * this league; the server only ever refreshes leagues the caller holds a claimed team in.
 */

type RefreshState = 'idle' | 'refreshing' | 'done' | 'busy' | 'failed'

export function ChimmyGroundingLine(props: {
  leagueId: string | null
  leagueName: string | null
  lastSyncedAt: string | null
  /** Only the newest answer offers a refresh; an old answer's line is history. */
  offerRefresh: boolean
}) {
  // One clock read per render is enough; the label is minute-grained.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [state, setState] = useState<RefreshState>('idle')

  const fresh = groundingFreshness(props.lastSyncedAt, now)
  const canRefresh = props.offerRefresh && fresh.stale && !!props.leagueId

  async function refresh() {
    if (!props.leagueId || state === 'refreshing') return
    setState('refreshing')
    try {
      const res = await fetch('/api/core/players/refresh-lineups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leagueId: props.leagueId }),
      })
      if (res.status === 429) return setState('busy')
      const body = (await res.json().catch(() => null)) as { refreshed?: number; busy?: number } | null
      if (!res.ok || !body) return setState('failed')
      setState(body.refreshed ? 'done' : body.busy ? 'busy' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <p className="af-cm-grounding" data-grounded="true" data-stale={fresh.stale && state !== 'done' ? 'true' : undefined}>
      Read from {props.leagueName ?? 'your league'} · {fresh.label}
      {props.lastSyncedAt ? (
        <span className="af-cm-grounding-exact"> ({new Date(props.lastSyncedAt).toLocaleString()})</span>
      ) : null}
      {canRefresh && state === 'idle' ? (
        <>
          {' · '}
          <button type="button" className="af-cm-grounding-refresh" onClick={refresh}>
            Refresh league data
          </button>
        </>
      ) : null}
      {state === 'refreshing' ? <span className="af-cm-grounding-note" role="status"> · refreshing…</span> : null}
      {state === 'done' ? (
        <span className="af-cm-grounding-note" role="status"> · refreshed — ask again to use the new data</span>
      ) : null}
      {state === 'busy' ? (
        <span className="af-cm-grounding-note" role="status"> · a refresh is already running — try again in a minute</span>
      ) : null}
      {state === 'failed' ? (
        <span className="af-cm-grounding-note" role="status"> · couldn&apos;t refresh this league right now</span>
      ) : null}
    </p>
  )
}
