'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Star, X } from 'lucide-react'
import { toast } from 'sonner'
import type { UserLeague } from '@/app/dashboard/types'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'
import { PlayerHeadshot } from '@/components/league/PlayerHeadshot'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { waiverPositionMatches } from '@/lib/waiver-wire/SportWaiverResolver'
import {
  isImmediateAddAllowedToday,
  onWaiversUntilLabel,
  phaseMoveBlockReason,
  playerWaiverHoldUntil,
  type DailyPolicySnapshot,
} from '@/lib/waiver-wire/immediate-add-policy'
import type { WaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-policy'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'
import { fmt1, signed, waiverTrendByPlayer } from '@/lib/league/native/nativeScreenModels'
import { Card, InjuryFlag, PosPill, ScreenHead, Segmented } from './NativeScreenParts'

/**
 * Players & waivers — handoff §3, `Waivers.png` / `MobileWaivers.png`.
 *
 * Every read and write is the existing waiver wire's (`/api/waiver-wire/leagues/[id]/*`), and a
 * claim still goes through `WaiverClaimDrawer` — the same drop picker and FAAB validation as the
 * full waiver page. Whether a player can be added now or must be claimed is decided by the same
 * `isImmediateAddAllowedToday` policy; processing order, bids and tiebreaks stay on the server.
 */
type Settings = {
  sport?: string | null
  waiverType?: string
  processingDayOfWeek?: number | null
  faabBudget?: number | null
  tiebreakRule?: string | null
  instantFaAfterClear?: boolean
  dailyPolicy?: DailyPolicySnapshot | null
  phasePolicy?: WaiverPhasePolicy | null
}
type Claim = { id: string; addPlayerId: string; dropPlayerId: string | null; faabBid: number | null; priorityOrder: number; status: string }
type Tx = { id: string; addPlayerId: string; dropPlayerId: string | null; faabSpent: number | null; processedAt: string; roster?: { id: string } | null }
type Tab = 'available' | 'watchlist' | 'trending' | 'claims'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SPORT_POSITIONS: Record<string, string[]> = {
  NFL: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  NCAAF: ['QB', 'RB', 'WR', 'TE', 'K'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NCAAB: ['G', 'F', 'C'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
  SOCCER: ['GKP', 'DEF', 'MID', 'FWD'],
}

function rosteredPct(p: UnifiedPlayerWireDto): number | null {
  const r = p as unknown as Record<string, unknown>
  const unified = (p.product?.unified ?? {}) as unknown as Record<string, unknown>
  for (const k of ['ownershipPercent', 'rosteredPercent', 'rosterPercent']) {
    const v = Number(r[k] ?? unified[k])
    if (Number.isFinite(v)) return v
  }
  return null
}

export function NativeWaiversScreen({ league }: { league: UserLeague }) {
  const id = encodeURIComponent(league.id)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [players, setPlayers] = useState<UnifiedPlayerWireDto[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [history, setHistory] = useState<Tx[]>([])
  const [roster, setRoster] = useState<{ id: string | null; ids: string[]; names: Array<{ id: string; name: string | null }>; faab: number | null; priority: number | null; capacity: number | null }>({ id: null, ids: [], names: [], faab: null, priority: null, capacity: null })
  const [watch, setWatch] = useState<string[]>([])
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('available')
  const [pos, setPos] = useState('ALL')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query)
  const [drawer, setDrawer] = useState<{ player: UnifiedPlayerWireDto; immediate: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [bidDrafts, setBidDrafts] = useState<Record<string, string>>({})

  const applyRoster = useCallback((r: Record<string, unknown>) => {
    const raw = r.roster as unknown
    const list = Array.isArray(raw) ? raw : ((raw as { players?: unknown[] } | null)?.players ?? [])
    const names = (list as unknown[])
      .map((p) => {
        const o = (typeof p === 'object' && p ? p : {}) as Record<string, unknown>
        const pid = typeof p === 'string' ? p : String(o.id ?? o.player_id ?? '')
        const name = o.name ?? o.displayName
        return { id: pid, name: name != null ? String(name) : null }
      })
      .filter((x) => x.id)
    const unified = Array.isArray(r.unifiedRoster) ? (r.unifiedRoster as UnifiedPlayerWireDto[]) : []
    const nameById = new Map(unified.map((u) => [u.id, u.name]))
    const slotLimits = r.slotLimits as Record<string, number> | null | undefined
    const cap = slotLimits ? Object.values(slotLimits).reduce((s, v) => s + (Number(v) || 0), 0) : 0
    setRoster({
      id: typeof r.rosterId === 'string' ? r.rosterId : null,
      ids: getRosterPlayerIds(raw),
      names: names.map((n) => ({ id: n.id, name: n.name ?? nameById.get(n.id) ?? null })),
      faab: typeof r.faabRemaining === 'number' ? r.faabRemaining : null,
      priority: typeof r.waiverPriority === 'number' ? r.waiverPriority : null,
      capacity: cap > 0 ? cap : null,
    })
  }, [])

  const refreshMine = useCallback(async () => {
    const [c, h, r] = await Promise.all([
      fetch(`/api/waiver-wire/leagues/${id}/claims`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/api/waiver-wire/leagues/${id}/claims?type=history&limit=30`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/api/league/roster?leagueId=${id}`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ])
    if (c) setClaims(Array.isArray(c.claims) ? c.claims : [])
    if (h) setHistory(Array.isArray(h.transactions) ? h.transactions : [])
    if (r) applyRoster(r)
  }, [id, applyRoster])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, p, st, w] = await Promise.all([
        fetch(`/api/waiver-wire/leagues/${id}/settings`, { cache: 'no-store' }),
        fetch(`/api/waiver-wire/leagues/${id}/players?limit=200`, { cache: 'no-store' }),
        fetch(`/api/waiver-wire/leagues/${id}/state`, { cache: 'no-store' }),
        fetch(`/api/waiver-wire/leagues/${id}/watchlist`, { credentials: 'include', cache: 'no-store' }),
      ])
      const sj = await s.json().catch(() => null)
      const pj = await p.json().catch(() => null)
      const stj = await st.json().catch(() => null)
      const wj = await w.json().catch(() => null)
      setSettings(s.ok ? sj : null)
      setPlayers(p.ok && Array.isArray(pj?.players) ? pj.players : [])
      if (!p.ok) setError('We could not load the player pool.')
      const nr = stj?.state?.nextRunAt
      setNextRunAt(typeof nr === 'string' ? nr : null)
      setWatch(w.ok && Array.isArray(wj?.playerIds) ? wj.playerIds.map(String) : [])
      await refreshMine()
    } catch {
      setError('We could not load the waiver wire.')
    } finally {
      setLoading(false)
    }
  }, [id, refreshMine])

  useEffect(() => {
    void load()
  }, [load])

  const faabMode = String(settings?.waiverType ?? '').toLowerCase() === 'faab'
  const immediate = isImmediateAddAllowedToday(settings)
  // The season phase (offseason / playoffs rules): why moves are limited, and whether none are open.
  const phaseReason = phaseMoveBlockReason(settings)
  const movesClosed = Boolean(settings?.phasePolicy?.code && !settings.phasePolicy.claimsAllowed && !settings.phasePolicy.immediateAddsAllowed)
  const trend = useMemo(() => waiverTrendByPlayer(history, claims), [history, claims])
  const claimedIds = useMemo(() => new Set(claims.map((c) => c.addPlayerId)), [claims])
  const positions = useMemo(() => {
    const known = SPORT_POSITIONS[String(settings?.sport ?? league.sport ?? 'NFL').toUpperCase()]
    if (known) return known
    return Array.from(new Set(players.map((p) => String(p.position ?? '').toUpperCase()).filter(Boolean))).slice(0, 8)
  }, [settings?.sport, league.sport, players])
  const nameOf = useCallback(
    (pid: string | null) => {
      if (!pid) return null
      return players.find((p) => p.id === pid)?.name ?? roster.names.find((n) => n.id === pid)?.name ?? null
    },
    [players, roster.names],
  )

  const list = useMemo(() => {
    let rows = players
    if (tab === 'watchlist') rows = rows.filter((p) => watch.includes(p.id))
    if (tab === 'claims') rows = rows.filter((p) => claimedIds.has(p.id))
    if (pos !== 'ALL') rows = rows.filter((p) => waiverPositionMatches(p.position, pos))
    const needle = q.trim().toLowerCase()
    if (needle) rows = rows.filter((p) => p.name.toLowerCase().includes(needle) || String(p.team ?? '').toLowerCase().includes(needle))
    if (tab === 'trending') rows = [...rows].sort((a, b) => (trend.get(b.id) ?? 0) - (trend.get(a.id) ?? 0))
    else rows = [...rows].sort((a, b) => (Number(b.projectedPoints ?? -1) || -1) - (Number(a.projectedPoints ?? -1) || -1))
    return rows.slice(0, 120)
  }, [players, tab, watch, claimedIds, pos, q, trend])
  // The waiver wire's own display adapter: canonical photo / crest, and the season stat line.
  const shown = useMemo(() => list.map((p) => ({ p, a: adaptWaiverWirePlayer(p) })), [list])

  const toggleWatch = (pid: string) => {
    const was = watch.includes(pid)
    setWatch((w) => (was ? w.filter((x) => x !== pid) : [...w, pid]))
    void fetch(`/api/waiver-wire/leagues/${id}/watchlist`, {
      method: was ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: pid, sport: settings?.sport ?? null }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        const d = await r.json().catch(() => null)
        if (d && Array.isArray(d.playerIds)) setWatch(d.playerIds.map(String))
      })
      .catch(() => {
        setWatch((w) => (was ? [...w, pid] : w.filter((x) => x !== pid)))
        toast.error('Could not update your watchlist.')
      })
  }

  const addDrop = async (player: UnifiedPlayerWireDto, dropPlayerId: string | null) => {
    setBusy(player.id)
    try {
      const res = await fetch(`/api/waiver-wire/leagues/${id}/add-drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addPlayerId: player.id, dropPlayerId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        setDrawer(null)
        toast.success(dropPlayerId ? `Added ${player.name} and dropped a player.` : `Added ${player.name}.`, { description: j?.writeAuthority?.copy?.detail || undefined })
        await refreshMine()
        setPlayers((ps) => ps.filter((p) => p.id !== player.id))
        invalidateIntelligence({ leagueId: league.id, reason: 'waiver_add_drop' })
        return
      }
      if (j?.code === 'WAIVER_REQUIRED') {
        setDrawer({ player, immediate: false })
        toast.message('This player must be claimed through waivers.')
        return
      }
      if (j?.code === 'DROP_REQUIRED') {
        setDrawer({ player, immediate: true })
        toast.message('Your roster is full — choose a player to drop.')
        return
      }
      toast.error(j?.error ?? 'Could not complete add/drop.')
    } catch {
      toast.error('Could not complete add/drop.')
    } finally {
      setBusy(null)
    }
  }

  const submitClaim = async (player: UnifiedPlayerWireDto, opts: { dropPlayerId: string | null; faabBid: number | null; priorityOrder: number | null }) => {
    setBusy(player.id)
    try {
      const res = await fetch(`/api/waiver-wire/leagues/${id}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addPlayerId: player.id, ...opts }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j?.error ?? 'Failed to submit waiver claim')
        return
      }
      toast.success(j?.writeAuthority?.copy?.title ?? 'Claim submitted', { description: j?.writeAuthority?.copy?.detail || undefined })
      setDrawer(null)
      await refreshMine()
      invalidateIntelligence({ leagueId: league.id, reason: 'waiver_claim' })
    } finally {
      setBusy(null)
    }
  }

  const onAdd = (player: UnifiedPlayerWireDto) => {
    // A player still on waivers after a drop needs a claim even when free agents are instant adds.
    if (!immediate || playerWaiverHoldUntil(player, settings)) return setDrawer({ player, immediate: false })
    const open = roster.capacity == null ? true : roster.ids.length < roster.capacity
    if (open) void addDrop(player, null)
    else setDrawer({ player, immediate: true })
  }

  const patchClaim = async (claimId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/waiver-wire/leagues/${id}/claims/${claimId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j?.error ?? 'Failed to update waiver claim')
    }
    await refreshMine()
  }
  const cancelClaim = async (claimId: string) => {
    const res = await fetch(`/api/waiver-wire/leagues/${id}/claims/${claimId}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j?.error ?? 'Failed to cancel waiver claim')
    }
    await refreshMine()
  }

  const runLabel = nextRunAt
    ? new Date(nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : settings?.processingDayOfWeek != null
      ? DAYS[settings.processingDayOfWeek] ?? null
      : null
  const waiverDay = nextRunAt ? DAYS[new Date(nextRunAt).getDay()] : settings?.processingDayOfWeek != null ? DAYS[settings.processingDayOfWeek] : null
  const totalBid = claims.reduce((s, c) => s + (Number(c.faabBid) || 0), 0)
  const mine = history.filter((t) => roster.id && t.roster?.id === roster.id).slice(0, 4)
  const lastRunOthers = history.filter((t) => !(roster.id && t.roster?.id === roster.id)).length

  return (
    <div className="nls" data-testid="native-waivers-screen">
      <ScreenHead eyebrow={`${league.name} · Players`} title="Players & waivers">
        {runLabel ? <span className="nls-chip">Waivers run {runLabel}</span> : null}
        {faabMode && roster.faab != null ? <span className="nls-chip" data-tone="accent">FAAB ${roster.faab} left</span> : null}
        {roster.priority != null ? <span className="nls-chip">Priority {roster.priority} of {league.teamCount}</span> : null}
      </ScreenHead>

      <div className="nls-toolbar">
        <Segmented label="Player list" value={tab} onChange={setTab} options={[{ id: 'available', label: 'Available' }, { id: 'watchlist', label: 'Watchlist' }, { id: 'trending', label: 'Trending' }, { id: 'claims', label: 'My claims' }]} />
        <Segmented label="Position" value={pos} onChange={setPos} options={[{ id: 'ALL', label: 'ALL' }, ...positions.map((p) => ({ id: p, label: p }))]} />
        <input className="nls-search" type="search" placeholder="Search players" aria-label="Search players" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {phaseReason ? (
        <p className="nls-muted" role="status" data-testid="native-waivers-phase-reason">{phaseReason}</p>
      ) : null}

      <div className="nls-cols">
        <section className="nls-card nls-card-flush" aria-label="Players" aria-busy={loading}>
          {loading && !players.length ? (
            <p className="nls-empty" role="status">Loading players…</p>
          ) : list.length ? (
            <table className="nls-table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" data-hide="phone">Rost%</th>
                  <th scope="col">{league.currentWeek ? `Wk ${league.currentWeek} proj` : 'Proj'}</th>
                  <th scope="col" data-hide="phone">AF trend</th>
                  <th scope="col" data-align="left" data-hide="phone">Status</th>
                  <th scope="col"><span className="nls-sr">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ p, a }) => {
                  const t = trend.get(p.id) ?? 0
                  const pct = rosteredPct(p)
                  const claimed = claimedIds.has(p.id)
                  const holdUntil = playerWaiverHoldUntil(p, settings)
                  const rowImmediate = immediate && !holdUntil
                  return (
                    <tr key={p.id}>
                      <td data-align="left">
                        <div className="nls-pcell">
                          <PlayerHeadshot playerId={p.id} playerName={p.name} headshotUrl={a.displayHeadshotUrl} position={p.position} team={p.team} sport={p.sport || league.sport} size={36} />
                          <PosPill label={p.position} />
                          <div className="nls-player">
                            <strong>{p.name}<InjuryFlag status={p.injuryStatus} /></strong>
                            <small>
                              {a.displayTeamLogoUrl ? <FallbackImg src={a.displayTeamLogoUrl} alt="" width={14} height={14} className="nls-team-logo" fallback={null} data-testid="waiver-team-logo" /> : null}
                              {p.team ?? 'FA'}{a.displayByeWeek ? ` · Bye ${a.displayByeWeek}` : ''}
                            </small>
                            {a.seasonStatsSummary.length ? <small data-stats>{a.seasonStatsSummary.join(' · ')}</small> : null}
                            {holdUntil ? <small data-hold data-testid={`native-waivers-hold-${p.id}`}>{onWaiversUntilLabel(holdUntil)}</small> : null}
                          </div>
                          <button type="button" className="nls-iconbtn" aria-pressed={watch.includes(p.id)} aria-label={watch.includes(p.id) ? `Remove ${p.name} from watchlist` : `Watch ${p.name}`} onClick={() => toggleWatch(p.id)} data-watch>
                            <Star size={16} aria-hidden fill={watch.includes(p.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </td>
                      <td data-hide="phone">{pct != null ? `${Math.round(pct)}%` : '—'}</td>
                      <td>{fmt1(p.projectedPoints)}</td>
                      <td data-hide="phone" data-pts={t > 0 ? 'good' : t < 0 ? 'bad' : 'neutral'}>{signed(t)}</td>
                      <td data-align="left" data-hide="phone">
                        {rowImmediate ? <span className="nls-chip" data-tone="good">Free agent</span> : <span className="nls-chip" data-tone="warn">Waivers{waiverDay ? ` · ${waiverDay}` : ''}</span>}
                      </td>
                      <td>
                        {claimed ? (
                          <button type="button" className="nls-btn" data-size="sm" onClick={() => setTab('claims')}>Claimed</button>
                        ) : (
                          <button type="button" className="nls-btn" data-size="sm" data-variant="primary" disabled={busy === p.id || movesClosed} title={movesClosed ? phaseReason ?? undefined : undefined} onClick={() => onAdd(p)}>
                            {rowImmediate ? 'Add' : 'Claim'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="nls-empty">{tab === 'watchlist' ? 'Star a player to keep him on your watchlist.' : tab === 'claims' ? 'You have no pending claims.' : 'No available players match these filters.'}</p>
          )}
        </section>

        <aside className="nls-aside" aria-label="Your claims">
          <Card label="Your claims" right={faabMode && totalBid > 0 ? <span className="nls-mono">${totalBid} bid</span> : undefined}>
            {claims.length ? (
              <ol className="nls-claims">
                {[...claims].sort((a, b) => a.priorityOrder - b.priorityOrder).map((c, i) => {
                  const addName = nameOf(c.addPlayerId) ?? 'Player'
                  const dropName = nameOf(c.dropPlayerId)
                  const draft = bidDrafts[c.id] ?? (c.faabBid != null ? String(c.faabBid) : '')
                  return (
                    <li key={c.id} className="nls-claim">
                      <span className="nls-claim-order">{i + 1}</span>
                      <div>
                        <strong>Add {addName}</strong>
                        <small>{dropName ? `Drop ${dropName}` : c.dropPlayerId ? 'Drop a rostered player' : 'No drop'}</small>
                      </div>
                      <button type="button" className="nls-iconbtn" aria-label={`Cancel claim for ${addName}`} onClick={() => void cancelClaim(c.id)}>
                        <X size={16} aria-hidden />
                      </button>
                      {faabMode ? (
                        <div className="nls-bid">
                          <label htmlFor={`bid-${c.id}`}>BID</label>
                          <input
                            id={`bid-${c.id}`}
                            inputMode="numeric"
                            value={draft ? `$${draft.replace(/^\$/, '')}` : ''}
                            placeholder="$0"
                            onChange={(e) => setBidDrafts((d) => ({ ...d, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                            onBlur={() => {
                              const n = Number(bidDrafts[c.id])
                              if (bidDrafts[c.id] != null && Number.isFinite(n) && n !== c.faabBid) void patchClaim(c.id, { faabBid: n })
                            }}
                          />
                          {roster.faab != null ? <span>of ${roster.faab}</span> : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p>No pending claims. {immediate ? 'Free agents can be added right away.' : 'Claim a player to queue him for the next waiver run.'}</p>
            )}
            <p className="nls-muted nls-fineprint">
              {faabMode
                ? `Highest bid wins; ties go to ${settings?.tiebreakRule ? settings.tiebreakRule.replace(/_/g, ' ') : 'waiver priority'}. Claims run in the order shown.`
                : 'Claims run by waiver priority, in the order shown.'}
            </p>
          </Card>
          {history.length ? (
            <Card label={`Last waiver run${history[0]?.processedAt ? ` · ${DAYS[new Date(history[0].processedAt).getDay()]}` : ''}`}>
              <ul className="nls-feed">
                {mine.map((t) => (
                  <li key={t.id}>You added <b>{nameOf(t.addPlayerId) ?? 'a player'}</b>{t.faabSpent != null ? ` · $${t.faabSpent}` : ''}</li>
                ))}
                {lastRunOthers ? <li>{lastRunOthers} {lastRunOthers === 1 ? 'move' : 'moves'} by other managers</li> : null}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>

      <WaiverClaimDrawer
        open={drawer != null}
        onClose={() => setDrawer(null)}
        player={drawer ? { id: drawer.player.id, name: drawer.player.name, position: drawer.player.position, team: drawer.player.team } : null}
        faabMode={drawer?.immediate ? false : faabMode}
        faabRemaining={roster.faab}
        hasOpenRosterSpot={drawer?.immediate ? false : roster.capacity == null || roster.ids.length < roster.capacity}
        rosterPlayerIds={roster.ids}
        rosterPlayers={roster.names}
        onSubmit={async (opts) => {
          if (!drawer) return
          if (drawer.immediate) await addDrop(drawer.player, opts.dropPlayerId)
          else await submitClaim(drawer.player, opts)
        }}
      />
    </div>
  )
}
