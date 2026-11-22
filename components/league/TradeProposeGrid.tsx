'use client'

import { useEffect, useMemo, useState } from 'react'
import { POSITION_COLORS } from '@/lib/league-labels/catalog'
import type { TradeableRoster } from '@/app/api/leagues/[leagueId]/trades/rosters/route'

/**
 * Sleeper's "Propose a Trade" grid on the Trades tab (owner's page review #9): one row per manager,
 * their players as position-coloured tiles, filters across the top.
 *
 * - Tap another manager's player → the trade window opens with that manager and player chosen.
 * - Your own tiles carry "Add to block" / "On block". On a Sleeper league that writes AllFantasy's
 *   trade block (POST/DELETE /api/core/player-card/watch, list 'trade-block'; the server proves the
 *   player is yours). Elsewhere the control is not offered.
 * - Everyone else's tiles carry the AF crest: the viewer's interest mark and, once the
 *   `league_trade_interests` table exists, how many managers marked the player (anonymous).
 *
 * Reads `/api/leagues/[leagueId]/trades/rosters`, the same read the trade window uses.
 */
type Filter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'IDP' | 'BLOCK'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' }, { id: 'QB', label: 'QB' }, { id: 'RB', label: 'RB' }, { id: 'WR', label: 'WR' },
  { id: 'TE', label: 'TE' }, { id: 'K', label: 'K' }, { id: 'DEF', label: 'DEF' }, { id: 'IDP', label: 'IDP' },
  { id: 'BLOCK', label: 'Trade block' },
]
const IDP = new Set(['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS', 'IDP'])
const isDef = (pos: string) => pos === 'DEF' || pos === 'DST'

const T = {
  text: 'var(--lsk-text, var(--text))',
  muted: 'var(--lsk-muted, var(--muted))',
  line: 'var(--lsk-line, var(--line2))',
  surface2: 'var(--lsk-surface2, var(--surface2))',
  strong: 'var(--lsk-accent-strong, var(--accent))',
}

/** The AF crest: filled when the viewer wants the player; the number is how many managers do. */
export function Crest({ on, count = 0 }: { on: boolean; count?: number }) {
  return (
    <span className="relative inline-flex h-[24px] w-[22px] items-center justify-center">
      <svg width="22" height="24" viewBox="0 0 56 64" aria-hidden="true">
        <path d="M28 2 L53 11 V32 C53 47 42 57 28 62 C14 57 3 47 3 32 V11 Z" fill={on ? 'var(--lsk-accent-strong, #d4a24c)' : 'rgba(255,255,255,.75)'} stroke="#0b0f17" strokeWidth="4" />
      </svg>
      {count > 0 ? (
        // The filled crest uses the skin's accent, so the number takes the skin's matching ink —
        // in light mode that accent is dark and a fixed dark number disappears into it.
        <span className="absolute inset-0 flex items-center justify-center pt-px text-[11px] font-black leading-none tracking-tight" style={{ color: on ? 'var(--lsk-accent-ink, #0b0f17)' : '#0b0f17' }}>
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </span>
  )
}

export function TradeProposeGrid({
  leagueId,
  platform,
  tradeBlockPlayerIds,
  watched,
  onToggleWatch,
  interestCounts = {},
  onProposeFor,
  onBlockChanged,
}: {
  leagueId: string
  platform: string | null | undefined
  /** Players on the trade block (the Trades tab's panel read). */
  tradeBlockPlayerIds: ReadonlySet<string>
  /** The viewer's own interest marks. */
  watched: ReadonlySet<string>
  onToggleWatch: (playerId: string) => void
  /** Anonymous count of managers who marked each player (empty until the interest table exists). */
  interestCounts?: Record<string, number>
  /** Open the trade window with this manager and player chosen. */
  onProposeFor: (rosterId: string, playerId: string) => void
  /** A block change was saved; the Trades tab re-reads its panel. */
  onBlockChanged: () => void
}) {
  const [rosters, setRosters] = useState<TradeableRoster[] | null>(null)
  const [viewerRosterId, setViewerRosterId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [blockOverride, setBlockOverride] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState('')
  const canEditBlock = String(platform ?? '').toLowerCase() === 'sleeper'

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/rosters`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { rosters?: TradeableRoster[]; viewerRosterId?: string | null; viewerTeamRosterId?: string | null }) => {
        if (cancelled) return
        setRosters(Array.isArray(data.rosters) ? data.rosters : [])
        setViewerRosterId(data.viewerTeamRosterId ?? data.viewerRosterId ?? null)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const onBlock = (id: string) => blockOverride[id] ?? tradeBlockPlayerIds.has(id)

  const ordered = useMemo(() => {
    if (!rosters) return []
    const mine = rosters.filter((r) => r.rosterId === viewerRosterId)
    return [...mine, ...rosters.filter((r) => r.rosterId !== viewerRosterId)]
  }, [rosters, viewerRosterId])

  const keep = (pos: string, id: string) => {
    const p = pos.toUpperCase()
    if (filter === 'ALL') return true
    if (filter === 'BLOCK') return onBlock(id)
    if (filter === 'IDP') return IDP.has(p)
    if (filter === 'DEF') return isDef(p)
    return p === filter
  }

  async function setBlock(playerId: string, next: boolean) {
    setPending((s) => ({ ...s, [playerId]: true }))
    const res = await fetch('/api/core/player-card/watch', {
      method: next ? 'POST' : 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, sleeperId: playerId, list: 'trade-block' }),
    }).catch(() => null)
    setPending((s) => ({ ...s, [playerId]: false }))
    if (res?.ok) {
      setBlockOverride((s) => ({ ...s, [playerId]: next }))
      setNotice(next ? 'Added to your trade block' : 'Taken off your trade block')
      onBlockChanged()
    } else {
      setNotice('Could not update your trade block')
    }
    setTimeout(() => setNotice(''), 2500)
  }

  if (failed) return null
  return (
    <section className="flex flex-col gap-3" aria-labelledby="propose-grid-title" data-testid="trade-propose-grid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="propose-grid-title" className="m-0 text-[20px] font-extrabold" style={{ color: T.text }}>Propose a trade</h2>
          <p className="m-0 text-[13px]" style={{ color: T.muted }}>Tap a player to trade for them. Tap the crest to mark a player you want.</p>
        </div>
        <div role="group" aria-label="Filter players" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="min-h-[32px] rounded-full border px-3 text-[11px] font-extrabold uppercase tracking-wide"
              style={filter === f.id ? { background: T.text, color: 'var(--lsk-bg, var(--bg))', borderColor: T.text } : { background: T.surface2, color: T.muted, borderColor: T.line }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rosters == null ? (
        <div className="h-24 animate-pulse rounded-xl" style={{ background: T.surface2 }} />
      ) : (
        ordered.map((r) => {
          const mine = r.rosterId === viewerRosterId
          const players = r.players.filter((p) => keep(String(p.position ?? ''), p.id))
          return (
            <div key={r.rosterId} className="grid items-start gap-3 border-t pt-3" style={{ gridTemplateColumns: '88px minmax(0,1fr)', borderColor: T.line }}>
              <span className="pt-1 text-[12px] font-bold leading-tight" style={{ color: T.text }}>
                {mine ? `${r.ownerName ?? 'You'} (you)` : r.ownerName ?? 'Manager'}
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {players.length === 0 ? <span className="self-center text-[13px]" style={{ color: T.muted }}>No players</span> : null}
                {players.map((p) => {
                  const pos = String(p.position ?? '').toUpperCase()
                  const c = POSITION_COLORS[IDP.has(pos) && !POSITION_COLORS[pos] ? 'IDP' : pos] ?? { fill: '#8a8fa8', text: '#0b0d14' }
                  const blocked = onBlock(p.id)
                  return (
                    <div
                      key={p.id}
                      className="flex w-[148px] shrink-0 flex-col justify-between overflow-hidden rounded-lg"
                      style={{ background: c.fill, color: c.text, boxShadow: blocked ? `0 0 0 2px ${T.strong}` : undefined }}
                      data-testid="propose-grid-tile"
                    >
                      <div className="flex items-start justify-between gap-1 px-2 pb-1.5 pt-2">
                        {mine ? (
                          <span className="min-w-0">
                            <span className="block text-[11px] font-extrabold">{pos || '—'} · {p.team ?? 'FA'}</span>
                            <span className="block truncate text-[13px] font-extrabold">{p.name}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onProposeFor(r.rosterId, p.id)}
                            className="min-w-0 text-left"
                            aria-label={`Propose a trade for ${p.name}`}
                            style={{ color: c.text }}
                          >
                            <span className="block text-[11px] font-extrabold">{pos || '—'} · {p.team ?? 'FA'}</span>
                            <span className="block truncate text-[13px] font-extrabold">{p.name}</span>
                          </button>
                        )}
                        {!mine ? (
                          <button
                            type="button"
                            onClick={() => onToggleWatch(p.id)}
                            aria-pressed={watched.has(p.id)}
                            aria-label={`${watched.has(p.id) ? 'Remove interest in' : 'Mark interest in'} ${p.name}${interestCounts[p.id] ? `, ${interestCounts[p.id]} interested` : ''}`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center"
                            data-testid="propose-grid-crest"
                          >
                            <Crest on={watched.has(p.id)} count={interestCounts[p.id] ?? 0} />
                          </button>
                        ) : null}
                      </div>
                      {mine && canEditBlock ? (
                        <button
                          type="button"
                          disabled={pending[p.id]}
                          onClick={() => void setBlock(p.id, !blocked)}
                          aria-pressed={blocked}
                          className="min-h-[28px] w-full text-[11px] font-extrabold disabled:opacity-60"
                          style={blocked ? { background: '#0b0f17', color: c.fill } : { background: 'rgba(11,15,23,.22)', color: c.text }}
                          data-testid="propose-grid-block"
                        >
                          {pending[p.id] ? 'Saving…' : blocked ? '✓ On block' : '+ Add to block'}
                        </button>
                      ) : !mine && blocked ? (
                        <span className="px-2 py-1 text-[11px] font-extrabold" style={{ background: 'rgba(11,15,23,.85)', color: c.fill }}>Trade block</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
      {notice ? <p role="status" className="m-0 text-[13px] font-semibold" style={{ color: T.text }}>{notice}</p> : null}
    </section>
  )
}
