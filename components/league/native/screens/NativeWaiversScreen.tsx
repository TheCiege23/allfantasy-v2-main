'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Star, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import type { UserLeague } from '@/app/dashboard/types'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'
import { PlayerHeadshot } from '@/components/league/PlayerHeadshot'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { waiverPositionMatches } from '@/lib/waiver-wire/SportWaiverResolver'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useNhlProspectSearch } from '@/components/waiver-wire/useNhlProspectSearch'
import {
  isNhlProspectWireRow,
  mergeProspectSearchRows,
  parseNhlProspectListMeta,
  placeProspectsAfterPlayers,
  type NhlProspectListMeta,
} from '@/lib/waiver-wire/prospectFreeAgentDisplay'
import { confirmLineupWarning, isLineupWarningResponse } from '@/lib/waiver-wire/lineup-warning-prompt'
import {
  claimProcessesAfterDate,
  isImmediateAddAllowedToday,
  onWaiversUntilLabel,
  phaseMoveBlockReason,
  playerWaiverHoldUntil,
  type DailyPolicySnapshot,
} from '@/lib/waiver-wire/immediate-add-policy'
import type { WaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-policy'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { positionIsRosterable, rosterablePositions } from '@/lib/waiver-wire/rosterablePositions'
import { PLAYERS_TABS, leagueScopeRows, rosteredByLabel, tabUsesLeagueScope, type PlayersTab } from '@/lib/waiver-wire/playersListTabs'
import { ProposeTradeModal } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'
import { fmt1, signed, waiverTrendByPlayer } from '@/lib/league/native/nativeScreenModels'
import { Card, InjuryFlag, PlayerAvatar, PlayerNameButton, PosPill, ScreenHead, Segmented, useNativePlayerCard } from './NativeScreenParts'
import { claimStatusLabel, faabMeter, waiverClaimTypeLabel } from '@/lib/league-media/redraftScreens'
import { RedraftScreen, RedraftWaiverHeader, useRedraftScreen } from './RedraftScreenParts'

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
  /** Write Authority (lib/league/write-authority.ts): `shadow` on an imported league, where claims stay inside AllFantasy. */
  writeAuthority?: { shadow?: boolean; sourceLabel?: string | null } | null
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
type Tab = PlayersTab
/** What the players route adds to a row: last week's points, and (league scope) who holds him. */
type WireRow = UnifiedPlayerWireDto & { lastWeekPoints?: number | null; rosteredBy?: { mine: boolean; team: string | null; rosterId?: string | null } | null }

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

/**
 * A player the feed marks inactive or retired (the "INA" flag) is not someone to add. He is left
 * out of the browsing lists and still found by a name search, on the watchlist and in "My claims".
 */
export function isInactiveWirePlayer(p: { injuryStatus?: string | null }): boolean {
  return /^(ina|inactive|retired|ret|non[- ]?football injury list|suspended)$/i.test(String(p.injuryStatus ?? '').trim())
}

/** "RUSH YDS 766" as a labelled figure. A line with no space is shown as a figure with no label. */
export function splitStatLine(line: string): { label: string; value: string } {
  const text = line.trim()
  const cut = text.lastIndexOf(' ')
  return cut > 0 ? { label: text.slice(0, cut), value: text.slice(cut + 1) } : { label: '', value: text }
}

/** "@ DAL · Thu 4:30 PM", "Bye week", or null when the week's game is not on file. */
export function wireGameLine(opponent: string | null, homeAway: string | null | undefined, kickoffIso: string | null): string | null {
  if (!opponent) return null
  if (opponent.toUpperCase() === 'BYE') return 'Bye week'
  const versus = `${String(homeAway ?? '').toLowerCase() === 'away' ? '@' : 'vs'} ${opponent}`
  const kickoff = kickoffIso ? new Date(kickoffIso) : null
  if (!kickoff || !Number.isFinite(kickoff.getTime())) return versus
  return `${versus} · ${kickoff.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
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
  // NHL dynasty only: Fantrax prospects that exist vs. those the list carries (null elsewhere).
  const [prospectMeta, setProspectMeta] = useState<NhlProspectListMeta | null>(null)
  // Rostered players too, for Search / Leaders / Trade. Read the first time one of those tabs opens.
  const [leaguePlayers, setLeaguePlayers] = useState<WireRow[] | null>(null)
  const [leagueLoading, setLeagueLoading] = useState(false)
  // The last completed week the server scored (NFL), or null when the list carries no such figure.
  const [lastWeek, setLastWeek] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // The trade builder, opened on the rostered player whose Trade button was tapped.
  const [tradeFor, setTradeFor] = useState<{ playerId: string; rosterId: string | null } | null>(null)
  const [claims, setClaims] = useState<Claim[]>([])
  const [history, setHistory] = useState<Tx[]>([])
  const [roster, setRoster] = useState<{ id: string | null; ids: string[]; names: Array<{ id: string; name: string | null }>; faab: number | null; priority: number | null; capacity: number | null; starterPositions: string[] | null }>({ id: null, ids: [], names: [], faab: null, priority: null, capacity: null, starterPositions: null })
  const [watch, setWatch] = useState<string[]>([])
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  /** "Wed 3:00 AM PT" — when waivers clear in the league's own zone (the state route's label). */
  const [leagueClearLabel, setLeagueClearLabel] = useState<string | null>(null)
  /** The league turned on conditional claims (AF Commissioner waiver extra) — from the state route. */
  const [conditionalClaims, setConditionalClaims] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('available')
  const [pos, setPos] = useState('ALL')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query)
  const [drawer, setDrawer] = useState<{ player: UnifiedPlayerWireDto; immediate: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [bidDrafts, setBidDrafts] = useState<Record<string, string>>({})
  /*
   * The player card's hand-off (lib/core-app/playerCardActions.ts): `?drop=<id>` names the player the
   * manager chose to drop, `?add=<id>` a free agent to add, `?q=` his name for the search box. A drop
   * is never made from here on its own — it rides along with the add or claim the manager picks next,
   * through the same add/drop and claim routes and every rule they carry.
   */
  const params = useSearchParams()
  const [handoffDrop, setHandoffDrop] = useState<string | null>(null)
  const [handoffAdd, setHandoffAdd] = useState<string | null>(null)
  const handoffKey = params?.toString() ?? ''
  useEffect(() => {
    const drop = params?.get('drop')?.trim() || null
    const add = params?.get('add')?.trim() || null
    const q0 = params?.get('q')?.trim() || ''
    setHandoffDrop(drop)
    setHandoffAdd(add)
    if (q0) setQuery(q0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey])

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
      starterPositions: Array.isArray(r.starterAllowedPositions) ? (r.starterAllowedPositions as unknown[]).filter((x): x is string => typeof x === 'string') : null,
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
      setProspectMeta(p.ok ? parseNhlProspectListMeta(pj?.nhlProspects) : null)
      setLastWeek(p.ok && typeof pj?.lastWeek === 'number' ? pj.lastWeek : null)
      setLeaguePlayers(null)
      if (!p.ok) setError('We could not load the player pool.')
      const nr = stj?.state?.nextRunAt
      setNextRunAt(typeof nr === 'string' ? nr : null)
      const lcl = stj?.settings?.leagueClearLabel
      setLeagueClearLabel(typeof lcl === 'string' && lcl ? lcl : null)
      setConditionalClaims(stj?.settings?.conditionalClaims === true)
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

  // Search, Leaders and Trade list rostered players too: one extra read, the first time one opens.
  useEffect(() => {
    if (!tabUsesLeagueScope(tab) || leaguePlayers || leagueLoading) return
    let cancelled = false
    setLeagueLoading(true)
    fetch(`/api/waiver-wire/leagues/${id}/players?limit=200&scope=league`, { cache: 'no-store' })
      .then((x) => (x.ok ? x.json() : null))
      .catch(() => null)
      .then((j) => {
        if (cancelled) return
        // A failed read falls back to the free agents already on screen, never an empty tab.
        setLeaguePlayers(Array.isArray(j?.players) ? (j.players as WireRow[]) : (players as WireRow[]))
        setLeagueLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id, leaguePlayers])

  useEffect(() => {
    if (tab === 'search') searchRef.current?.focus()
  }, [tab])

  const faabMode = String(settings?.waiverType ?? '').toLowerCase() === 'faab'
  // Redraft (lib/league-media/redraftIdentity.ts): claim type + FAAB budget header and claim states.
  const rd = useRedraftScreen(league)
  const immediate = isImmediateAddAllowedToday(settings)
  // The season phase (offseason / playoffs rules): why moves are limited, and whether none are open.
  const phaseReason = phaseMoveBlockReason(settings)
  const movesClosed = !settings || Boolean(settings.phasePolicy?.code && !settings.phasePolicy.claimsAllowed && !settings.phasePolicy.immediateAddsAllowed)
  const trend = useMemo(() => waiverTrendByPlayer(history, claims), [history, claims])
  const claimedIds = useMemo(() => new Set(claims.map((c) => c.addPlayerId)), [claims])
  const rosterable = useMemo(() => rosterablePositions(roster.starterPositions), [roster.starterPositions])
  const positions = useMemo(() => {
    const known = SPORT_POSITIONS[String(settings?.sport ?? league.sport ?? 'NFL').toUpperCase()]
    // Only the positions this league has a slot for: no K or DEF filter in a league that starts neither.
    if (known) {
      const startable = rosterable ? known.filter((position) => positionIsRosterable(position, rosterable)) : known
      // None matching means the league spells its positions some way this list does not know: offer them all.
      return startable.length > 0 ? startable : known
    }
    return Array.from(new Set(players.map((p) => String(p.position ?? '').toUpperCase()).filter(Boolean))).slice(0, 8)
  }, [settings?.sport, league.sport, players, rosterable])
  const { language, t: tr, tInterpolate } = useOptionalLanguage()
  const openCard = useNativePlayerCard(settings?.sport ?? league.sport)
  // NHL dynasty: a name search also asks the server for prospects beyond the ones the list carries.
  const prospectSearchRows = useNhlProspectSearch<UnifiedPlayerWireDto>(league.id, prospectMeta, q)
  const allPlayers = useMemo(() => mergeProspectSearchRows(players, prospectSearchRows), [players, prospectSearchRows])
  const nameOf = useCallback(
    (pid: string | null) => {
      if (!pid) return null
      return players.find((p) => p.id === pid)?.name ?? roster.names.find((n) => n.id === pid)?.name ?? null
    },
    [players, roster.names],
  )
  // A claimed / added player's face and club for the claims and last-run lists, from the same adapter as the wire rows.
  const mediaOf = useCallback(
    (pid: string | null) => {
      const p = pid ? players.find((x) => x.id === pid) : undefined
      if (!p) return null
      const a = adaptWaiverWirePlayer(p)
      return { headshotUrl: a.displayHeadshotUrl ?? null, teamLogoUrl: a.displayTeamLogoUrl ?? null, team: p.team ?? null }
    },
    [players],
  )
  const waiverSport = settings?.sport ?? league.sport

  const list = useMemo(() => {
    if (tabUsesLeagueScope(tab)) {
      const source = (leaguePlayers ?? (allPlayers as WireRow[])).filter((p) => pos === 'ALL' || waiverPositionMatches(p.position, pos))
      return leagueScopeRows(tab, source, q, lastWeek != null).slice(0, 120)
    }
    let rows = allPlayers
    if (tab === 'watchlist') rows = rows.filter((p) => watch.includes(p.id))
    if (tab === 'claims') rows = rows.filter((p) => claimedIds.has(p.id))
    if (pos !== 'ALL') rows = rows.filter((p) => waiverPositionMatches(p.position, pos))
    const needle = q.trim().toLowerCase()
    if (!needle && (tab === 'available' || tab === 'trending')) rows = rows.filter((p) => !isInactiveWirePlayer(p))
    // A player at a position the league has no slot for cannot be rostered, so he is not offered.
    if (tab === 'available' || tab === 'trending') {
      const startable = rows.filter((p) => positionIsRosterable(p.position, rosterable))
      // Hiding every player would mean the league's positions are spelled some way this list does not know.
      if (startable.length > 0 || rows.length === 0) rows = startable
    }
    if (needle) rows = rows.filter((p) => p.name.toLowerCase().includes(needle) || String(p.team ?? '').toLowerCase().includes(needle))
    if (tab === 'trending') rows = [...rows].sort((a, b) => (trend.get(b.id) ?? 0) - (trend.get(a.id) ?? 0))
    else rows = [...rows].sort((a, b) => (Number(b.projectedPoints ?? -1) || -1) - (Number(a.projectedPoints ?? -1) || -1))
    // Prospects have no projection: after every real player (lib/waiver-wire/prospectFreeAgentDisplay.ts).
    return (tab === 'trending' ? rows : placeProspectsAfterPlayers(rows, 'projection')).slice(0, 120)
  }, [allPlayers, leaguePlayers, lastWeek, tab, watch, claimedIds, pos, q, trend, rosterable])
  const listHasProspects = list.some((p) => isNhlProspectWireRow(p))
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
      const send = (confirmed: boolean) =>
        fetch(`/api/waiver-wire/leagues/${id}/add-drop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addPlayerId: player.id, dropPlayerId, ...(confirmed ? { confirmLineupWarning: true } : {}) }),
        })
      let res = await send(false)
      let j = await res.json().catch(() => ({}))
      if (isLineupWarningResponse(j)) {
        // The drop leaves a starting slot unfillable: a warning the manager confirms, not a block.
        if (!confirmLineupWarning(j, tInterpolate)) return
        res = await send(true)
        j = await res.json().catch(() => ({}))
      }
      if (res.ok && j?.ok) {
        setDrawer(null)
        if (dropPlayerId && dropPlayerId === handoffDrop) setHandoffDrop(null)
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

  const submitClaim = async (player: UnifiedPlayerWireDto, opts: { dropPlayerId: string | null; faabBid: number | null; priorityOrder: number | null; conditionalGroup?: string | null }) => {
    setBusy(player.id)
    try {
      const send = (confirmed: boolean) =>
        fetch(`/api/waiver-wire/leagues/${id}/claims`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addPlayerId: player.id, ...opts, ...(confirmed ? { confirmLineupWarning: true } : {}) }),
        })
      let res = await send(false)
      let j = await res.json().catch(() => ({}))
      if (isLineupWarningResponse(j)) {
        if (!confirmLineupWarning(j, tInterpolate)) return
        res = await send(true)
        j = await res.json().catch(() => ({}))
      }
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
    // A drop chosen on the player card: the sheet opens with it picked, so the manager sees the swap.
    if (handoffDrop && roster.ids.includes(handoffDrop)) return setDrawer({ player, immediate: true })
    const open = roster.capacity == null ? true : roster.ids.length < roster.capacity
    if (open) void addDrop(player, null)
    else setDrawer({ player, immediate: true })
  }

  /*
   * `?add=<id>` from the player card: open the add sheet on him once the pool has loaded. Never the
   * one-tap add — a link must not make a roster move, so the sheet's own button is the confirmation.
   */
  useEffect(() => {
    if (!handoffAdd || loading) return
    const player = players.find((p) => p.id === handoffAdd)
    setHandoffAdd(null)
    if (!player) return
    setDrawer({ player, immediate: Boolean(immediate) && !playerWaiverHoldUntil(player, settings) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffAdd, loading, players])

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

  // The league's own clear time first ("Wed 3:00 AM PT"), then — when the viewer's zone differs — their own
  // clock for the next clear in brackets. Without a league-time clear, the viewer's clock alone, as before.
  const viewerRun = nextRunAt
    ? new Date(nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : null
  const runLabel = leagueClearLabel
    ? viewerRun && viewerRun.replace(/([A-Z])[SD]T$/, '$1T').split(' ').pop() !== leagueClearLabel.split(' ').pop()
      ? `${leagueClearLabel} (${viewerRun} your time)`
      : leagueClearLabel
    : viewerRun
  const waiverDay = nextRunAt ? DAYS[new Date(nextRunAt).getDay()] : settings?.processingDayOfWeek != null ? DAYS[settings.processingDayOfWeek] : null
  const totalBid = claims.reduce((s, c) => s + (Number(c.faabBid) || 0), 0)
  const mine = history.filter((t) => roster.id && t.roster?.id === roster.id).slice(0, 4)
  const lastRunOthers = history.filter((t) => !(roster.id && t.roster?.id === roster.id)).length

  return (
    <RedraftScreen identity={rd}>
    <div className="nls" data-testid="native-waivers-screen" data-rd-screen={rd ? 'waivers' : undefined}>
      <ScreenHead eyebrow="Players" title="Players & waivers">
        {/* Redraft carries these in the header strip below instead. */}
        {!rd && runLabel ? <span className="nls-chip">Waivers run {runLabel}</span> : null}
        {!rd && faabMode && roster.faab != null ? <span className="nls-chip" data-tone="accent">FAAB ${roster.faab} left</span> : null}
        {!rd && roster.priority != null ? <span className="nls-chip">Priority {roster.priority} of {league.teamCount}</span> : null}
      </ScreenHead>

      {rd && settings ? (
        <RedraftWaiverHeader
          claimType={waiverClaimTypeLabel(settings.waiverType)}
          faab={faabMode ? faabMeter(roster.faab, settings.faabBudget) : null}
          faabRemaining={faabMode ? roster.faab : null}
          runLabel={runLabel}
          priority={roster.priority}
          teamCount={league.teamCount}
        />
      ) : null}

      {handoffDrop && roster.ids.includes(handoffDrop) ? (
        <p className="nls-handoff" role="status" data-testid="native-waivers-drop-handoff">
          <span>
            Dropping <b>{roster.names.find((n) => n.id === handoffDrop)?.name ?? 'your player'}</b>. Pick the player to add in his place.
          </span>
          <button type="button" className="nls-btn" onClick={() => setHandoffDrop(null)}>Cancel</button>
        </p>
      ) : null}

      <div className="nls-toolbar">
        <Segmented label="Player list" value={tab} onChange={setTab} options={[...PLAYERS_TABS]} />
        <Segmented label="Position" value={pos} onChange={setPos} options={[{ id: 'ALL', label: 'ALL' }, ...positions.map((p) => ({ id: p, label: p }))]} />
        <input ref={searchRef} className="nls-search" type="search" placeholder="Search players" aria-label="Search players" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {phaseReason ? (
        <p className="nls-muted" role="status" data-testid="native-waivers-phase-reason">{phaseReason}</p>
      ) : null}
      {/*
        An imported league (2026-11-22: it opens this screen too). A claim here never reaches the host, so say so before
        anyone files one, in the classic waiver page's own words (WaiverWirePage `shadow-league-waiver-notice`).
      */}
      {settings?.writeAuthority?.shadow === true ? (
        <p className="nls-muted" data-testid="shadow-league-waiver-notice">
          Claims here are recommendations held inside AllFantasy — nothing is submitted to {settings.writeAuthority.sourceLabel || 'your host platform'}. Enter the move there before your league&apos;s waiver deadline for it to count.
        </p>
      ) : null}
      {listHasProspects ? (
        <p className="nls-muted" data-testid="native-waivers-prospect-sort-note">{tr('waiverWire.prospects.sortNote')}</p>
      ) : null}
      {prospectMeta && prospectMeta.total > prospectMeta.listed ? (
        <p className="nls-muted" data-testid="native-waivers-prospect-search-hint">
          {tInterpolate('waiverWire.prospects.searchHint', { listed: prospectMeta.listed, total: prospectMeta.total })}
        </p>
      ) : null}

      <div className="nls-cols">
        <section className="nls-card nls-card-flush" aria-label="Players" aria-busy={loading}>
          {(loading && !players.length) || (tabUsesLeagueScope(tab) && leagueLoading && !leaguePlayers) ? (
            <p className="nls-empty" role="status">Loading players…</p>
          ) : list.length ? (
            <table className="nls-table nls-table-players">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" data-hide="phone">Rost%</th>
                  <th scope="col">
                    {/* A phone has no room for the week in the header; it widened this column and squeezed the names. */}
                    <span className="nls-long">{league.currentWeek ? `Wk ${league.currentWeek} proj` : 'Proj'}</span>
                    <span className="nls-short">Proj</span>
                  </th>
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
                  // Football carries the week's game; basketball, hockey and baseball carry the period's opponent.
                  const period = p as { periodOpponent?: string | null; periodHomeAway?: string | null }
                  const gameLine = wireGameLine(
                    a.displayOpponent ?? period.periodOpponent ?? null,
                    p.nflRedraftGameContext?.homeAway ?? period.periodHomeAway,
                    a.displayKickoffTime,
                  )
                  const strip = a.seasonStatsSummary.map(splitStatLine)
                  const row = p as WireRow
                  const heldBy = rosteredByLabel(row.rosteredBy)
                  // Last week's points lead the strip where the league has them; a dash means he had no game.
                  const lastWeekStat = lastWeek != null ? { label: `Wk ${lastWeek} pts`, value: row.lastWeekPoints == null ? '—' : fmt1(row.lastWeekPoints) } : null
                  return (
                    <tr key={p.id}>
                      <td data-align="left">
                        {/* One line on a wide screen. On a phone its two children are separate grid items, so the
                            star sits beside the stat strip and the name keeps the row's width. */}
                        <div className="nls-prow">
                        <div className="nls-pcell">
                          <PlayerHeadshot playerId={p.id} playerName={p.name} headshotUrl={a.displayHeadshotUrl} position={p.position} team={p.team} sport={p.sport || league.sport} size={36} />
                          <PosPill label={p.position} />
                          <div className="nls-player">
                            <strong>
                              <PlayerNameButton name={p.name} onOpen={() => openCard({ id: p.id, name: p.name, position: p.position, team: p.team, imageUrl: a.displayHeadshotUrl })}>{p.name}</PlayerNameButton>
                              <InjuryFlag status={p.injuryStatus} />
                            </strong>
                            <small>
                              {a.displayTeamLogoUrl ? <FallbackImg src={a.displayTeamLogoUrl} alt="" width={14} height={14} className="nls-team-logo" fallback={null} data-testid="waiver-team-logo" /> : null}
                              {/* Phone only: the position, in its colour, sits here; the wide badge beside the photo is dropped. */}
                              <span className="nls-pcell-pos"><PosPill label={p.position} /></span>
                              {p.team ?? (isNhlProspectWireRow(p) ? tr('draftRoom.pool.prospectUnsigned') : 'FA')}{a.displayByeWeek ? ` · Bye ${a.displayByeWeek}` : ''}
                              {isNhlProspectWireRow(p) ? (
                                <span className="nls-chip" data-tone="accent" title={tr('draftRoom.pool.prospectTooltip')} data-testid={`native-waivers-prospect-badge-${p.id}`}>
                                  {tr('draftRoom.pool.prospectBadge')}
                                </span>
                              ) : null}
                            </small>
                            {gameLine ? <small data-game data-testid={`native-waivers-game-${p.id}`}>{gameLine}</small> : null}
                            {heldBy ? <small data-held data-testid={`native-waivers-held-${p.id}`}>{heldBy}</small> : null}
                            {holdUntil ? <small data-hold data-testid={`native-waivers-hold-${p.id}`}>{onWaiversUntilLabel(holdUntil, { tInterpolate, language })}</small> : null}
                          </div>
                        </div>
                          <button type="button" className="nls-iconbtn" aria-pressed={watch.includes(p.id)} aria-label={watch.includes(p.id) ? `Remove ${p.name} from watchlist` : `Watch ${p.name}`} onClick={() => toggleWatch(p.id)} data-watch>
                            <Star size={16} aria-hidden fill={watch.includes(p.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        {/* The season's figures, each under its own label. On a phone the strip takes the row's full
                            width under the player; the rostered share joins it there, where its column is hidden. */}
                        {strip.length || pct != null || lastWeekStat ? (
                          <span className="nls-pstats-wide" data-stats data-testid={`native-waivers-stats-${p.id}`}>
                            {lastWeekStat ? (
                              <span className="nls-pstat" data-last-week data-testid={`native-waivers-lastweek-${p.id}`}>
                                <em>{lastWeekStat.label}</em>
                                <b>{lastWeekStat.value}</b>
                              </span>
                            ) : null}
                            {strip.map((stat, i) => (
                              <span key={`${stat.label}-${i}`} className="nls-pstat">
                                {stat.label ? <em>{stat.label}</em> : null}
                                <b>{stat.value}</b>
                              </span>
                            ))}
                            {pct != null ? (
                              <span className="nls-pstat" data-phone-only>
                                <em>Rost %</em>
                                <b>{Math.round(pct)}</b>
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td data-hide="phone">{pct != null ? `${Math.round(pct)}%` : '—'}</td>
                      <td data-proj>{fmt1(p.projectedPoints)}</td>
                      <td data-hide="phone" data-pts={t > 0 ? 'good' : t < 0 ? 'bad' : 'neutral'}>{signed(t)}</td>
                      <td data-align="left" data-hide="phone">
                        {heldBy ? <span className="nls-chip">{heldBy}</span> : rowImmediate ? <span className="nls-chip" data-tone="good">Free agent</span> : <span className="nls-chip" data-tone="warn">Waivers{waiverDay ? ` · ${waiverDay}` : ''}</span>}
                      </td>
                      <td data-action>
                        {row.rosteredBy?.mine ? (
                          <span className="nls-chip">Yours</span>
                        ) : row.rosteredBy ? (
                          <button type="button" className="nls-btn" data-size="sm" aria-label={`Trade for ${p.name}`} onClick={() => setTradeFor({ playerId: p.id, rosterId: row.rosteredBy?.rosterId ?? null })} data-testid={`native-waivers-trade-${p.id}`}>Trade</button>
                        ) : claimed ? (
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
            <p className="nls-empty">{tab === 'watchlist' ? 'Star a player to keep him on your watchlist.' : tab === 'claims' ? 'You have no pending claims.' : tab === 'search' ? (q.trim() ? 'No player in this league matches that name.' : 'Type a name to search every player in this league.') : tab === 'trade' ? 'No players on other teams match these filters.' : 'No available players match these filters.'}</p>
          )}
        </section>

        {/* Mounted only while open: the builder reads the session and loads every roster. */}
        {tradeFor ? (
        <ProposeTradeModal
          open
          onClose={() => setTradeFor(null)}
          leagueId={league.id}
          teams={[]}
          platform={league.platform}
          sport={league.sport}
          initialPartnerRosterId={tradeFor?.rosterId ?? null}
          initialGetPlayerId={tradeFor?.playerId ?? null}
          onSubmitted={() => {
            setTradeFor(null)
            toast.success('Trade offer sent')
          }}
        />
        ) : null}

        <aside className="nls-aside" aria-label="Your claims">
          <Card label="Your claims" right={faabMode && totalBid > 0 ? <span className="nls-mono">${totalBid} bid</span> : undefined}>
            {claims.length ? (
              <ol className="nls-claims">
                {[...claims].sort((a, b) => a.priorityOrder - b.priorityOrder).map((c, i) => {
                  const addName = nameOf(c.addPlayerId) ?? 'Player'
                  const dropName = nameOf(c.dropPlayerId)
                  // A claim on a player still on waivers after a drop runs at the first waiver run after he clears.
                  const holdUntil = playerWaiverHoldUntil(players.find((p) => p.id === c.addPlayerId), settings)
                  const draft = bidDrafts[c.id] ?? (c.faabBid != null ? String(c.faabBid) : '')
                  const state = rd ? claimStatusLabel(c.status) : null
                  return (
                    <li key={c.id} className="nls-claim">
                      <span className="nls-claim-order">{i + 1}</span>
                      <div className="nls-pl nls-claim-who">
                      <PlayerAvatar name={addName} headshotUrl={mediaOf(c.addPlayerId)?.headshotUrl} teamLogoUrl={mediaOf(c.addPlayerId)?.teamLogoUrl} team={mediaOf(c.addPlayerId)?.team} sport={waiverSport} />
                      <div>
                        <strong>Add {addName}</strong>
                        <small>{dropName ? `Drop ${dropName}` : c.dropPlayerId ? 'Drop a rostered player' : 'No drop'}</small>
                        {state ? <span className="nls-chip" data-tone={state.tone === 'neutral' ? undefined : state.tone} data-testid={`native-waivers-claim-state-${c.id}`}>{state.label}</span> : null}
                        {holdUntil ? (
                          <small data-hold data-testid={`native-waivers-claim-hold-${c.id}`}>
                            {tInterpolate('waiverClaim.processesAfter', { date: claimProcessesAfterDate(holdUntil, language) })}
                          </small>
                        ) : null}
                      </div>
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
                  <li key={t.id} className="nls-pl nls-feed-player">
                    {/* An unnamed add (a player no longer in either list) would draw an empty circle: leave it text. */}
                    {nameOf(t.addPlayerId) ? <PlayerAvatar name={nameOf(t.addPlayerId)} headshotUrl={mediaOf(t.addPlayerId)?.headshotUrl} teamLogoUrl={mediaOf(t.addPlayerId)?.teamLogoUrl} team={mediaOf(t.addPlayerId)?.team} sport={waiverSport} /> : null}
                    <span>You added <b>{nameOf(t.addPlayerId) ?? 'a player'}</b>{t.faabSpent != null ? ` · $${t.faabSpent}` : ''}</span>
                  </li>
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
        player={drawer ? { id: drawer.player.id, name: drawer.player.name, position: drawer.player.position, team: drawer.player.team, headshotUrl: mediaOf(drawer.player.id)?.headshotUrl ?? null, teamLogoUrl: mediaOf(drawer.player.id)?.teamLogoUrl ?? null } : null}
        faabMode={drawer?.immediate ? false : faabMode}
        faabRemaining={roster.faab}
        hasOpenRosterSpot={drawer?.immediate ? false : roster.capacity == null || roster.ids.length < roster.capacity}
        rosterPlayerIds={roster.ids}
        rosterPlayers={roster.names}
        initialDropId={handoffDrop && roster.ids.includes(handoffDrop) ? handoffDrop : null}
        immediate={Boolean(drawer?.immediate)}
        conditionalClaims={conditionalClaims}
        bidHelpLeagueId={faabMode ? id : null}
        onSubmit={async (opts) => {
          if (!drawer) return
          if (drawer.immediate) await addDrop(drawer.player, opts.dropPlayerId)
          else await submitClaim(drawer.player, opts)
        }}
      />
    </div>
    </RedraftScreen>
  )
}
