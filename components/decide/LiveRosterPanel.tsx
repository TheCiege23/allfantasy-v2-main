'use client'

/**
 * LiveRosterPanel — mounts ABOVE the Roster/Team tab for Sleeper leagues: the
 * viewer's CURRENT roster straight from the live feed, draft-aware.
 *
 *  - During a live draft, players picked seconds ago appear immediately with a
 *    "✦ just drafted · pick 5.03" chip (and the panel polls every 20s).
 *  - Starters are slotted against the league's REAL starter shape (IDP +
 *    superflex slots included); open slots render as open, never hidden.
 *  - Dynasty/keeper leagues group the bench by position with rookie chips.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type LivePlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  rookie: boolean
  source: 'live' | 'drafted'
  draftedAt: string | null
}
type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; linked: false }
  | { supported: true; linked: true; inLeague: false }
  | {
      supported: true
      linked: true
      inLeague: true
      fetchedAt: string
      dynasty: boolean
      draftLive: boolean
      draftedCount: number
      starters: { slot: string; player: LivePlayer | null }[]
      bench: LivePlayer[]
      totalPlayers: number
      note: string | null
      error?: string
    }

const POLL_MS = 20_000

function Row({ p }: { p: LivePlayer }) {
  const src = sleeperPlayerHeadshot(p.playerId)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: '#1c2153', flex: 'none' }}
          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
        />
      ) : null}
      <span style={{ fontWeight: 650 }}>{p.name}</span>
      <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
        {p.position ?? ''}
        {p.team ? ` · ${p.team}` : ''}
      </span>
      {p.rookie ? <span className="bdx-sev info">R</span> : null}
      {p.source === 'drafted' ? (
        <span className="bdx-sev ok" title="From the in-progress draft — not yet merged into the platform roster feed.">
          ✦ just drafted{p.draftedAt ? ` · ${p.draftedAt}` : ''}
        </span>
      ) : null}
    </span>
  )
}

export function LiveRosterPanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchRoster = useCallback((silent: boolean) => {
    if (!silent) setLoading(true)
    void fetch(`/api/league/live-roster?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then(setData)
      .catch(() => {
        /* panel is additive — the tab below renders regardless */
      })
      .finally(() => setLoading(false))
  }, [leagueId])

  useEffect(() => {
    fetchRoster(false)
  }, [fetchRoster])

  const draftLive = data && data.supported && 'inLeague' in data && data.inLeague === true && data.draftLive
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (draftLive) {
      pollRef.current = setInterval(() => fetchRoster(true), POLL_MS)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [draftLive, fetchRoster])

  // Unsupported platform / unlinked / not in league → the tab below is the whole story.
  if (!loading && (!data || !data.supported || !('inLeague' in data) || data.inLeague !== true)) {
    return null
  }

  return (
    <div className="bdx" style={{ marginBottom: 14 }} data-testid="live-roster-panel">
      {loading || !data || !data.supported || !('inLeague' in data) || data.inLeague !== true ? (
        <div className="bdx-skel" style={{ height: 60 }} />
      ) : (
        <div className="bdx-panelbox">
          <h3>
            Current roster · live from Sleeper
            {data.draftLive ? (
              <span className="bdx-sev ok" style={{ marginLeft: 8 }}>
                ● draft in progress — {data.draftedCount} pick{data.draftedCount === 1 ? '' : 's'} merged live
              </span>
            ) : null}
          </h3>
          <div className="bdx-rows" style={{ marginBottom: 10 }}>
            {data.starters.map((s, i) => (
              <div className="bdx-row" key={`${s.slot}-${i}`} style={{ alignItems: 'center' }}>
                <span className="k" style={{ minWidth: 52 }}>{s.slot}</span>
                {s.player ? (
                  <Row p={s.player} />
                ) : (
                  <span className="bdx-sev warn">▲ open slot</span>
                )}
              </div>
            ))}
          </div>
          {data.bench.length > 0 ? (
            data.dynasty ? (
              // Dynasty: bench grouped by position, rookies flagged.
              (() => {
                const groups = new Map<string, LivePlayer[]>()
                for (const p of data.bench) {
                  const key = p.position ?? '—'
                  const list = groups.get(key) ?? []
                  list.push(p)
                  groups.set(key, list)
                }
                return [...groups.entries()].map(([pos, list]) => (
                  <div key={pos} style={{ marginBottom: 6 }}>
                    <div className="bdx-sub" style={{ marginBottom: 3 }}>{pos} depth</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {list.map((p) => (
                        <Row key={p.playerId} p={p} />
                      ))}
                    </div>
                  </div>
                ))
              })()
            ) : (
              <>
                <div className="bdx-sub" style={{ marginBottom: 3 }}>Bench</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {data.bench.map((p) => (
                    <Row key={p.playerId} p={p} />
                  ))}
                </div>
              </>
            )
          ) : null}
          {data.note ? (
            <div className="bdx-rail-empty" style={{ marginTop: 6 }}>{data.note}</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default LiveRosterPanel
