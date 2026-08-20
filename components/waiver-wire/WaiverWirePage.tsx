"use client"

import { useState, useCallback, useDeferredValue, useEffect, useMemo } from "react"
import Link from "next/link"
import { RefreshCw, CheckCircle, Loader2, MessageSquare, GitCompare } from "lucide-react"
import { toast } from "sonner"
import WaiverFilters from "@/components/waiver-wire/WaiverFilters"
import WaiverPlayerRow from "@/components/waiver-wire/WaiverPlayerRow"
import WaiverClaimDrawer from "@/components/waiver-wire/WaiverClaimDrawer"
import {
  getTabLabel,
  getWaiverRuleSummary,
  getWaiverTypeLabel,
  WAIVER_EMPTY_PLAYERS_TITLE,
  WAIVER_EMPTY_PLAYERS_HINT,
  WAIVER_EMPTY_PENDING_TITLE,
  WAIVER_EMPTY_HISTORY_TITLE,
} from "@/lib/waiver-wire/WaiverWireViewService"
import { getWaiverAIChatUrl, buildWaiverSummaryForAI } from "@/lib/waiver-wire/WaiverToAIContextBridge"
import { waiverPositionMatches } from "@/lib/waiver-wire/SportWaiverResolver"
import {
  getDefaultWaiverFilterState,
  getWaiverWatchlistStorageKey,
  resetWaiverFilters,
} from "@/lib/waiver-wire/WaiverUIStateService"
import { invalidateIntelligence } from "@/lib/dashboard/intelligence-events"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { DEFAULT_SPORT } from "@/lib/sport-scope"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import { useAIAssistantAvailability } from "@/hooks/useAIAssistantAvailability"
import { InContextMonetizationCard } from "@/components/monetization/InContextMonetizationCard"
import { usePlayerComparisonUIOptional } from "@/components/player-comparison-ui"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import FaabBudgetCard from "@/components/waivers/FaabBudgetCard"
import WaiverPriorityCard from "@/components/waivers/WaiverPriorityCard"
import CommissionerWaiverControls from "@/components/waivers/CommissionerWaiverControls"
import PendingClaimsList, { buildPendingClaimPatch } from "@/components/waivers/PendingClaimsList"
import WaiverResultsFeed from "@/components/waivers/WaiverResultsFeed"
import AIWaiverRecommendationsPanel from "@/components/waivers/AIWaiverRecommendationsPanel"
import CommissionerWaiverInsightsPanel from "@/components/waivers/CommissionerWaiverInsightsPanel"
import { formatWaiverOutcomeLabel, outcomeCodeFromMetadata } from "@/lib/waiver-wire/waiver-outcome-labels"
import type { UnifiedPlayerWireDto } from "@/lib/player-data/serializeUnifiedPlayerForApi"
import { adaptWaiverWirePlayer } from "@/lib/player-data/adapters/waiverPlayerAdapter"

type WaiverSettings = {
  leagueId?: string
  sport?: string | null
  formatType?: string | null
  lifecycleState?: string | null
  status?: string | null
  waiverType?: string
  processingDayOfWeek?: number | null
  processingTimeUtc?: string | null
  claimLimitPerPeriod?: number | null
  faabBudget?: number | null
  tiebreakRule?: string | null
  instantFaAfterClear?: boolean
}

type Player = UnifiedPlayerWireDto
type Claim = {
  id: string
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number | null
  priorityOrder: number
  status: string
  resultMessage?: string | null
  processedAt?: string | null
  metadata?: { outcomeCode?: string; commissionerOverrides?: unknown } | null
  roster?: { id: string; faabRemaining: number | null; waiverPriority: number | null }
}
type Transaction = {
  id: string
  addPlayerId: string
  dropPlayerId: string | null
  faabSpent: number | null
  processedAt: string
  addPlayerPosition?: string
  dropPlayerPosition?: string
  isDefensiveAdd?: boolean
  isDefensiveDrop?: boolean
}

export type WaiverWireActiveTab = "available" | "trending" | "claimed" | "dropped" | "pending" | "history"

type WaiverWirePageProps = {
  leagueId: string
  initialTab?: WaiverWireActiveTab
  lockedTab?: boolean
  chrome?: "full" | "embedded"
}

type WaiverEngineSuggestion = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  compositeScore: number
  recommendation: string
  faabBid: number | null
  topDrivers: Array<{ label: string; detail: string }>
}

type WaiverEngineAnalysis = {
  sport: string
  deterministic: {
    basedOn: string[]
    suggestions: WaiverEngineSuggestion[]
  }
  explanation: {
    source: "deterministic" | "ai"
    text: string
  }
}

type RosterSnapshotPlayer = {
  id: string
  name: string
  position: string
  team: string | null
  slot: "starter" | "bench" | "ir" | "taxi"
  age: number | null
  value: number
}

const POSITION_BASE_VALUE: Record<string, number> = {
  QB: 2400,
  RB: 3000,
  WR: 2900,
  TE: 2200,
  K: 900,
  DEF: 1000,
  DST: 1000,
  PG: 2600,
  SG: 2500,
  SF: 2500,
  PF: 2500,
  C: 2650,
  SP: 2800,
  RP: 1800,
  P: 2600,
  G: 2400,
  F: 2400,
  UTIL: 2200,
  GKP: 1800,
  GK: 1800,
  MID: 2600,
  FWD: 2700,
  DM: 2200,
  DEFENDER: 2100,
}

const WAIVER_PLAYER_FETCH_LIMIT = 200
const WAIVER_PLAYER_RENDER_LIMIT = 120

function readFiniteNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function playerNumber(row: Player, keys: string[]): number | null {
  for (const key of keys) {
    const own = readFiniteNumber((row as unknown as Record<string, unknown>)[key])
    if (own != null) return own
    const unified = row.product?.unified as unknown as Record<string, unknown> | undefined
    const fromUnified = unified ? readFiniteNumber(unified[key]) : null
    if (fromUnified != null) return fromUnified
    const fromStats = row.normalizedStats ? readFiniteNumber(row.normalizedStats[key]) : null
    if (fromStats != null) return fromStats
    const fromProjection = row.normalizedProjections ? readFiniteNumber(row.normalizedProjections[key]) : null
    if (fromProjection != null) return fromProjection
  }
  return null
}

function compareNumberWithNulls(a: number | null, b: number | null, direction: "asc" | "desc"): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return direction === "asc" ? a - b : b - a
}

function estimateWaiverCandidateValue(position: string | null, trendScore: number, watchlisted: boolean): number {
  const normalizedPosition = String(position ?? "").toUpperCase()
  const base = POSITION_BASE_VALUE[normalizedPosition] ?? 2200
  const trendBoost = Math.max(0, trendScore) * 240
  const watchlistBoost = watchlisted ? 260 : 0
  return Math.round(base + trendBoost + watchlistBoost)
}

function getFallbackNeedPositionsForSport(sport: string | null | undefined): string[] {
  const normalizedSport = String(sport ?? DEFAULT_SPORT).toUpperCase()
  if (normalizedSport === "NBA") return ["PG", "SG", "SF", "PF", "C"]
  if (normalizedSport === "MLB") return ["SP", "RP", "1B", "2B", "3B", "SS", "OF"]
  if (normalizedSport === "NHL") return ["C", "LW", "RW", "D", "G"]
  if (normalizedSport === "SOCCER") return ["GK", "DEF", "MID", "FWD"]
  if (normalizedSport === "NCAAB") return ["PG", "SG", "SF", "PF", "C"]
  if (normalizedSport === "NCAAF") return ["QB", "RB", "WR", "TE"]
  return ["QB", "RB", "WR", "TE"]
}

export default function WaiverWirePage({
  leagueId,
  initialTab = "available",
  lockedTab = false,
  chrome = "full",
}: WaiverWirePageProps) {
  const compareUi = usePlayerComparisonUIOptional()
  const defaultFilterState = getDefaultWaiverFilterState()
  const { formatInTimezone } = useUserTimezone()
  const { enabled: aiAssistantEnabled, loading: aiAvailabilityLoading } = useAIAssistantAvailability()
  const [settings, setSettings] = useState<WaiverSettings | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [history, setHistory] = useState<{ claims: Claim[]; transactions: Transaction[] }>({ claims: [], transactions: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [claimLoading, setClaimLoading] = useState(false)
  const [faabRemaining, setFaabRemaining] = useState<number | null>(null)
  const [rosterPlayerIds, setRosterPlayerIds] = useState<string[]>([])
  const [rosterCapacity, setRosterCapacity] = useState<number | null>(null)
  const [waiverPriority, setWaiverPriority] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<WaiverWireActiveTab>(initialTab)

  const [search, setSearch] = useState(defaultFilterState.search)
  const [positionFilter, setPositionFilter] = useState(defaultFilterState.position)
  const [statusFilter, setStatusFilter] = useState(defaultFilterState.status)
  const [teamFilter, setTeamFilter] = useState(defaultFilterState.team)
  const [sort, setSort] = useState(defaultFilterState.sort)
  const deferredSearch = useDeferredValue(search)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPlayer, setDrawerPlayer] = useState<Player | null>(null)
  const [pendingEdits, setPendingEdits] = useState<Record<string, { faabBid: string; priority: string; dropPlayerId: string }>>({})
  const [rosterPlayers, setRosterPlayers] = useState<Array<{ id: string; name: string | null }>>([])
  const [rosterSnapshotPlayers, setRosterSnapshotPlayers] = useState<RosterSnapshotPlayer[]>([])
  const [starterAllowedPositions, setStarterAllowedPositions] = useState<string[]>([])
  const [watchlistPlayerIds, setWatchlistPlayerIds] = useState<string[]>([])
  const [waiverAiIncludeExplanation, setWaiverAiIncludeExplanation] = useState(false)
  const [waiverAiLoading, setWaiverAiLoading] = useState(false)
  const [waiverAiError, setWaiverAiError] = useState("")
  const [waiverAiAnalysis, setWaiverAiAnalysis] = useState<WaiverEngineAnalysis | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  // Step 3B: per-row action loading + immediate add/drop drawer mode.
  const [actionPlayerId, setActionPlayerId] = useState<string | null>(null)
  const [immediateMode, setImmediateMode] = useState(false)

  const applyRosterData = useCallback((rosterData: any) => {
    const roster = rosterData.roster
    setFaabRemaining(rosterData.faabRemaining ?? null)
    setWaiverPriority(rosterData.waiverPriority ?? null)
    const ids = getRosterPlayerIds(roster)
    setRosterPlayerIds(ids)
    const slotLimits = rosterData?.slotLimits as
      | { starters?: number; bench?: number; ir?: number; taxi?: number; devy?: number }
      | null
      | undefined
    const starterPositions = Array.isArray(rosterData?.starterAllowedPositions)
      ? (rosterData.starterAllowedPositions as unknown[]).map((position) => String(position ?? "").toUpperCase()).filter(Boolean)
      : []
    setStarterAllowedPositions(starterPositions)
    const capacityFromSlots = slotLimits ? Object.values(slotLimits).reduce((sum, value) => sum + (Number(value) || 0), 0) : 0
    setRosterCapacity(capacityFromSlots > 0 ? capacityFromSlots : null)
    const raw = Array.isArray(roster) ? roster : (roster as any)?.players ?? []
    const withNames: Array<{ id: string; name: string | null }> = raw
      .map((p: any) => {
        const id = typeof p === "string" ? p : p?.id ?? p?.player_id ?? ""
        const name = typeof p === "object" && p != null ? (p?.name ?? p?.displayName ?? null) : null
        return { id: String(id), name: name != null ? String(name) : null }
      })
      .filter((x: { id: string }) => x.id)
    setRosterPlayers(withNames)
    const normalizedSnapshot = withNames.map((player: { id: string; name: string | null }, idx: number): RosterSnapshotPlayer => {
      const source =
        Array.isArray(raw) && typeof raw[idx] === "object" && raw[idx] != null ? (raw[idx] as Record<string, unknown>) : {}
      const rawSlot = String(source.slot ?? source.rosterSlot ?? source.depthChartSlot ?? "").toLowerCase()
      const slot: RosterSnapshotPlayer["slot"] =
        rawSlot.includes("ir") ? "ir" : rawSlot.includes("taxi") ? "taxi" : rawSlot.includes("starter") ? "starter" : "bench"
      const position = String(source.position ?? source.pos ?? source.primaryPosition ?? "").toUpperCase() || "UTIL"
      const inferredValue =
        Number(source.value ?? (source as any)?.assetValue?.marketValue ?? (source as any)?.assetValue?.impactValue ?? 0) ||
        estimateWaiverCandidateValue(position, 0, false)
      return {
        id: player.id,
        name: player.name ?? player.id,
        position,
        team: source.team != null ? String(source.team) : source.teamAbbr != null ? String(source.teamAbbr) : null,
        slot,
        age: typeof source.age === "number" ? source.age : null,
        value: Math.max(200, Number.isFinite(inferredValue) ? Number(inferredValue) : 1200),
      }
    })
    setRosterSnapshotPlayers(normalizedSnapshot)
  }, [])

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setLoadError("")
    try {
      const [settingsRes, claimsRes, playersRes, rosterRes, historyRes, stateRes] = await Promise.all([
        fetch(`/api/waiver-wire/leagues/${leagueId}/settings`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/players?limit=${WAIVER_PLAYER_FETCH_LIMIT}`),
        fetch(`/api/league/roster?leagueId=${leagueId}`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims?type=history&limit=30`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/state`),
      ])
      const settingsData = await settingsRes.json().catch(() => ({}))
      const claimsData = await claimsRes.json().catch(() => ({}))
      const playersData = await playersRes.json().catch(() => ({}))
      const rosterData = await rosterRes.json().catch(() => ({}))
      const historyData = await historyRes.json().catch(() => ({}))
      const stateData = await stateRes.json().catch(() => ({}))
      const nr = stateData?.state?.nextRunAt
      setNextRunAt(typeof nr === "string" ? nr : nr instanceof Date ? nr.toISOString() : nr != null ? String(nr) : null)
      if (!settingsRes.ok) setSettings(null)
      else setSettings(settingsData)
      if (!claimsRes.ok) setClaims([])
      else setClaims(Array.isArray(claimsData.claims) ? claimsData.claims : [])
      if (!playersRes.ok) setPlayers([])
      else setPlayers(Array.isArray(playersData.players) ? playersData.players : [])
      if (!historyRes.ok) setHistory({ claims: [], transactions: [] })
      else setHistory({ claims: historyData.claims ?? [], transactions: historyData.transactions ?? [] })
      applyRosterData(rosterData)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load waiver wire data."
      setLoadError(message)
      toast.error("Unable to refresh waiver wire data.")
    } finally {
      setLoading(false)
    }
  }, [leagueId, applyRosterData])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  // Step 3C: server-backed watchlist. Load from the API; one-time migrate any legacy localStorage
  // entries into the server, then clear them. Falls back to localStorage if the API is unreachable.
  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    const storageKey = getWaiverWatchlistStorageKey(leagueId)
    const readLegacy = (): string[] => {
      try {
        const raw = window.localStorage.getItem(storageKey)
        const parsed = raw ? JSON.parse(raw) : null
        return Array.isArray(parsed) ? parsed.map((id) => String(id)) : []
      } catch {
        return []
      }
    }
    ;(async () => {
      try {
        const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/watchlist`, { credentials: "include" })
        if (!res.ok) throw new Error("watchlist load failed")
        const data = await res.json()
        let serverIds: string[] = Array.isArray(data.playerIds) ? data.playerIds.map(String) : []
        const legacy = readLegacy()
        if (serverIds.length === 0 && legacy.length > 0) {
          // Migrate legacy localStorage watchlist into the server once, then clear it.
          const migrateRes = await fetch(`/api/waiver-wire/leagues/${leagueId}/watchlist`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerIds: legacy, sport: settings?.sport ?? null }),
          })
          if (migrateRes.ok) {
            const migrated = await migrateRes.json()
            serverIds = Array.isArray(migrated.playerIds) ? migrated.playerIds.map(String) : legacy
          }
        }
        try {
          window.localStorage.removeItem(storageKey)
        } catch {
          // ignore
        }
        if (!cancelled) setWatchlistPlayerIds(serverIds)
      } catch {
        if (!cancelled) setWatchlistPlayerIds(readLegacy())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, settings?.sport])

  useEffect(() => {
    if (!aiAssistantEnabled && waiverAiIncludeExplanation) {
      setWaiverAiIncludeExplanation(false)
    }
  }, [aiAssistantEnabled, waiverAiIncludeExplanation])

  const submitClaimForPlayer = async (player: Player, opts: { dropPlayerId: string | null; faabBid: number | null; priorityOrder: number | null }) => {
    if (claimLoading) return
    setClaimLoading(true)
    try {
      const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addPlayerId: player.id,
          dropPlayerId: opts.dropPlayerId,
          faabBid: opts.faabBid,
          priorityOrder: opts.priorityOrder,
        }),
      })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        if (typeof json?.fcfsProcessWarning === "string" && json.fcfsProcessWarning.trim()) {
          toast.warning(`Claim saved; processing warning: ${json.fcfsProcessWarning}`)
        }
        setDrawerOpen(false)
        setDrawerPlayer(null)
        setImmediateMode(false)
        refreshAfterMutation()
        // Phase 3B.5: notify intelligence rail of waiver claim (fire-and-forget).
        invalidateIntelligence({ leagueId, reason: "waiver_claim" })
      } else {
        const json = await res.json().catch(() => ({}))
        toast.error(json?.error ?? "Failed to submit waiver claim")
      }
    } finally {
      setClaimLoading(false)
    }
  }

  // Step 3B: targeted refresh — claims + history + roster only (no league shell / player-pool reload).
  const refreshAfterMutation = useCallback(async () => {
    if (!leagueId) return
    try {
      const [claimsRes, historyRes, rosterRes] = await Promise.all([
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims?type=history&limit=30`),
        fetch(`/api/league/roster?leagueId=${leagueId}`),
      ])
      const claimsData = await claimsRes.json().catch(() => ({}))
      const historyData = await historyRes.json().catch(() => ({}))
      const rosterData = await rosterRes.json().catch(() => ({}))
      if (claimsRes.ok) setClaims(Array.isArray(claimsData.claims) ? claimsData.claims : [])
      if (historyRes.ok) setHistory({ claims: historyData.claims ?? [], transactions: historyData.transactions ?? [] })
      if (rosterRes.ok) applyRosterData(rosterData)
    } catch {
      // Non-blocking: the next full load reconciles. Avoid a disruptive shell reload here.
    }
  }, [leagueId, applyRosterData])

  // Step 3B: immediate free-agent add/drop (FCFS or instant-FA leagues). Optimistic with rollback.
  const addDropPlayer = useCallback(
    async (player: Player, dropPlayerId: string | null) => {
      if (actionPlayerId) return
      setActionPlayerId(player.id)
      const prevRosterIds = rosterPlayerIds
      // Optimistic roster update.
      setRosterPlayerIds((ids) => {
        const next = dropPlayerId ? ids.filter((id) => id !== dropPlayerId) : [...ids]
        return next.includes(player.id) ? next : [...next, player.id]
      })
      try {
        const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/add-drop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addPlayerId: player.id, dropPlayerId }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json?.ok) {
          setDrawerOpen(false)
          setDrawerPlayer(null)
          setImmediateMode(false)
          toast.success(dropPlayerId ? `Added ${player.name} and dropped a player.` : `Added ${player.name}.`)
          await refreshAfterMutation()
          invalidateIntelligence({ leagueId, reason: "waiver_add_drop" })
          return
        }
        // Rollback optimistic change.
        setRosterPlayerIds(prevRosterIds)
        if (json?.code === "WAIVER_REQUIRED") {
          // Not an immediate add — route to the claim drawer instead.
          setImmediateMode(false)
          setDrawerPlayer(player)
          setDrawerOpen(true)
          toast.message("This player must be claimed through waivers. Opening the claim form.")
          return
        }
        if (json?.code === "DROP_REQUIRED") {
          // Roster full — open the drawer so the user can pick a drop, in immediate mode.
          setImmediateMode(true)
          setDrawerPlayer(player)
          setDrawerOpen(true)
          toast.message("Your roster is full — choose a player to drop.")
          return
        }
        toast.error(json?.error ?? "Could not complete add/drop.")
      } catch {
        setRosterPlayerIds(prevRosterIds)
        toast.error("Could not complete add/drop.")
      } finally {
        setActionPlayerId(null)
      }
    },
    [actionPlayerId, leagueId, rosterPlayerIds, refreshAfterMutation],
  )

  const handleAddClick = useCallback(
    (player: Player) => {
      const immediateAddAllowed = settings?.waiverType === "fcfs" || settings?.instantFaAfterClear === true
      if (!immediateAddAllowed) {
        // Waiver league — use the existing claim drawer.
        setImmediateMode(false)
        setDrawerPlayer(player)
        setDrawerOpen(true)
        return
      }
      const openSpot = rosterCapacity == null ? true : rosterPlayerIds.length < rosterCapacity
      if (openSpot) {
        void addDropPlayer(player, null)
      } else {
        // Roster full — collect a drop in the drawer (immediate mode).
        setImmediateMode(true)
        setDrawerPlayer(player)
        setDrawerOpen(true)
      }
    },
    [settings?.waiverType, settings?.instantFaAfterClear, rosterCapacity, rosterPlayerIds, addDropPlayer],
  )

  const cancelClaimById = async (claimId: string) => {
    const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/claims/${claimId}`, { method: "DELETE" })
    if (res.ok) refreshAfterMutation()
    else {
      const json = await res.json().catch(() => ({}))
      toast.error(json?.error ?? "Failed to cancel waiver claim")
    }
  }

  const updateClaimById = async (claimId: string, patch: { faabBid?: number | null; priorityOrder?: number | null; dropPlayerId?: string | null }) => {
    const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/claims/${claimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      refreshAfterMutation()
    } else {
      const json = await res.json().catch(() => ({}))
      toast.error(json?.error ?? "Failed to update waiver claim")
    }
  }

  // Step 3C: move a pending claim up/down by swapping its priority with the adjacent claim.
  const reorderClaim = async (claimId: string, direction: "up" | "down") => {
    const idx = claims.findIndex((c) => c.id === claimId)
    if (idx < 0) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= claims.length) return
    const a = claims[idx]
    const b = claims[swapIdx]
    const aPrio = a.priorityOrder ?? idx + 1
    const bPrio = b.priorityOrder ?? swapIdx + 1
    // Optimistic reorder so the list updates without waiting on the round-trip.
    setClaims((prev) => {
      const next = [...prev]
      next[idx] = { ...a, priorityOrder: bPrio }
      next[swapIdx] = { ...b, priorityOrder: aPrio }
      return next.sort((x, y) => (x.priorityOrder ?? 0) - (y.priorityOrder ?? 0))
    })
    try {
      const [ra, rb] = await Promise.all([
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priorityOrder: bPrio }) }),
        fetch(`/api/waiver-wire/leagues/${leagueId}/claims/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priorityOrder: aPrio }) }),
      ])
      if (!ra.ok || !rb.ok) throw new Error("reorder failed")
      refreshAfterMutation()
    } catch {
      toast.error("Could not reorder claims.")
      refreshAfterMutation()
    }
  }

  const isFaab = settings?.waiverType === "faab"
  const hasOpenRosterSpot = rosterCapacity == null ? true : rosterPlayerIds.length < rosterCapacity
  const immediateAddAllowed = settings?.waiverType === "fcfs" || settings?.instantFaAfterClear === true
  const watchlistIdSet = useMemo(() => new Set(watchlistPlayerIds), [watchlistPlayerIds])
  const uniqueTeams = useMemo(
    () =>
      Array.from(
        new Set(players.map((p) => (p.team || "").trim()).filter((t) => t && t !== "FA")),
      ).sort(),
    [players],
  )

  const filteredPlayers = useMemo(() => {
    let list = [...players]
    const trendMap = new Map<string, number>()
    for (const tx of history.transactions) {
      if (tx.addPlayerId) trendMap.set(tx.addPlayerId, (trendMap.get(tx.addPlayerId) ?? 0) + 2)
      if (tx.dropPlayerId) trendMap.set(tx.dropPlayerId, (trendMap.get(tx.dropPlayerId) ?? 0) + 1)
    }
    for (const claim of claims) {
      trendMap.set(claim.addPlayerId, (trendMap.get(claim.addPlayerId) ?? 0) + 1)
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.team?.toLowerCase().includes(q))
    }
    if (positionFilter !== "ALL") {
      list = list.filter((p) => waiverPositionMatches(p.position, positionFilter))
    }
    if (statusFilter === "available") {
      const pendingIds = new Set(claims.map((c) => c.addPlayerId))
      list = list.filter((p) => !pendingIds.has(p.id))
    }
    if (statusFilter === "on_waivers") {
      list = list.filter((p) => p.id)
    }
    if (statusFilter === "free_agents") {
      const pendingIds = new Set(claims.map((c) => c.addPlayerId))
      list = list.filter((p) => !pendingIds.has(p.id))
    }
    if (statusFilter === "injured") {
      list = list.filter((p) => {
        const status = String(p.injuryStatus ?? "").trim().toLowerCase()
        return Boolean(status && status !== "healthy" && status !== "active")
      })
    }
    if (statusFilter === "rostered") {
      // The route intentionally excludes rostered players from the addable pool.
      list = []
    }
    if (statusFilter === "watchlist") {
      list = list.filter((p) => watchlistIdSet.has(p.id))
    }
    if (teamFilter) {
      const t = teamFilter.toLowerCase()
      list = list.filter((p) => (p.team || "").toLowerCase() === t)
    }
    if (sort === "projection") {
      list.sort((a, b) => {
        const byProjection = compareNumberWithNulls(
          readFiniteNumber(a.projectedPoints),
          readFiniteNumber(b.projectedPoints),
          "desc",
        )
        return byProjection || a.name.localeCompare(b.name)
      })
    } else if (sort === "adp") {
      list.sort((a, b) => {
        const byAdp = compareNumberWithNulls(readFiniteNumber(a.adp ?? a.aiAdp), readFiniteNumber(b.adp ?? b.aiAdp), "asc")
        return byAdp || a.name.localeCompare(b.name)
      })
    } else if (sort === "rank") {
      list.sort((a, b) => {
        const byRank = compareNumberWithNulls(
          playerNumber(a, ["rank", "overallRank", "ecr", "consensusRank"]),
          playerNumber(b, ["rank", "overallRank", "ecr", "consensusRank"]),
          "asc",
        )
        return byRank || a.name.localeCompare(b.name)
      })
    } else if (sort === "ownership") {
      list.sort((a, b) => {
        const byOwnership = compareNumberWithNulls(
          playerNumber(a, ["ownershipPercent", "rosteredPercent", "rosterPercent"]),
          playerNumber(b, ["ownershipPercent", "rosteredPercent", "rosterPercent"]),
          "desc",
        )
        return byOwnership || a.name.localeCompare(b.name)
      })
    } else if (sort === "recent") {
      list.sort((a, b) => {
        const byRecent = compareNumberWithNulls(
          readFiniteNumber(a.fantasyPointsPerGame) ?? playerNumber(a, ["recentPoints", "lastGamePoints"]),
          readFiniteNumber(b.fantasyPointsPerGame) ?? playerNumber(b, ["recentPoints", "lastGamePoints"]),
          "desc",
        )
        return byRecent || a.name.localeCompare(b.name)
      })
    } else if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === "position") {
      list.sort((a, b) => (a.position || "").localeCompare(b.position || ""))
    } else if (sort === "team") {
      list.sort((a, b) => (a.team || "").localeCompare(b.team || ""))
    } else if (sort === "trend") {
      list.sort((a, b) => {
        const scoreDelta = (trendMap.get(b.id) ?? 0) - (trendMap.get(a.id) ?? 0)
        if (scoreDelta !== 0) return scoreDelta
        return a.name.localeCompare(b.name)
      })
    }
    return list
  }, [players, history.transactions, deferredSearch, positionFilter, statusFilter, teamFilter, sort, claims, watchlistIdSet])

  const trendScoreByPlayerId = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of history.transactions) {
      if (tx.addPlayerId) map.set(tx.addPlayerId, (map.get(tx.addPlayerId) ?? 0) + 2)
      if (tx.dropPlayerId) map.set(tx.dropPlayerId, (map.get(tx.dropPlayerId) ?? 0) + 1)
    }
    for (const claim of claims) {
      map.set(claim.addPlayerId, (map.get(claim.addPlayerId) ?? 0) + 1)
    }
    return map
  }, [history.transactions, claims])

  const trendingPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      const scoreDelta = (trendScoreByPlayerId.get(b.id) ?? 0) - (trendScoreByPlayerId.get(a.id) ?? 0)
      if (scoreDelta !== 0) return scoreDelta
      return a.name.localeCompare(b.name)
    })
  }, [filteredPlayers, trendScoreByPlayerId])

  const activePlayerList = activeTab === "trending" ? trendingPlayers : filteredPlayers
  const visiblePlayerList = activePlayerList.slice(0, WAIVER_PLAYER_RENDER_LIMIT)
  const hiddenPlayerCount = Math.max(0, activePlayerList.length - visiblePlayerList.length)

  const claimedTransactions = useMemo(
    () => history.transactions.filter((tx) => Boolean(tx.addPlayerId)),
    [history.transactions]
  )

  const droppedTransactions = useMemo(
    () => history.transactions.filter((tx) => Boolean(tx.dropPlayerId)),
    [history.transactions]
  )

  const lastProcessedAt = useMemo(() => {
    if (!history.transactions.length) return null
    const ms = history.transactions
      .map((tx) => new Date(tx.processedAt).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0]
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }, [history.transactions])

  const toggleWatchlist = (playerId: string) => {
    const wasWatched = watchlistPlayerIds.includes(playerId)
    // Optimistic update.
    setWatchlistPlayerIds((prev) => (wasWatched ? prev.filter((id) => id !== playerId) : [...prev, playerId]))
    // Persist to the server; revert on failure.
    void (async () => {
      try {
        const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/watchlist`, {
          method: wasWatched ? "DELETE" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId, sport: settings?.sport ?? null }),
        })
        if (!res.ok) throw new Error("watchlist update failed")
        const data = await res.json().catch(() => null)
        if (data && Array.isArray(data.playerIds)) setWatchlistPlayerIds(data.playerIds.map(String))
      } catch {
        setWatchlistPlayerIds((prev) => (wasWatched ? [...prev, playerId] : prev.filter((id) => id !== playerId)))
        toast.error("Could not update watchlist.")
      }
    })()
  }

  const waiverRuleSummary = getWaiverRuleSummary({
    waiverType: settings?.waiverType ?? null,
    tiebreakRule: settings?.tiebreakRule ?? null,
    claimLimitPerPeriod: settings?.claimLimitPerPeriod ?? null,
  })
  const likelyPredraftLimited = useMemo(() => {
    const lifecycle = String(settings?.lifecycleState ?? settings?.status ?? '').trim().toLowerCase()
    if (lifecycle === 'pre_draft' || lifecycle === 'predraft' || lifecycle === 'draft_setup' || lifecycle === 'setup') {
      return true
    }
    return rosterPlayerIds.length === 0 && claims.length === 0 && history.transactions.length === 0
  }, [settings?.lifecycleState, settings?.status, rosterPlayerIds.length, claims.length, history.transactions.length])
  const topWatchlistTargets = players
    .filter((p) => watchlistIdSet.has(p.id))
    .map((p) => p.name)
    .slice(0, 3)
  const waiverAiHelpHref = aiAssistantEnabled
    ? getWaiverAIChatUrl(
        buildWaiverSummaryForAI(undefined, settings?.sport ?? undefined, {
          waiverType: getWaiverTypeLabel(settings?.waiverType ?? null),
          pendingClaims: claims.length,
          watchlistCount: watchlistPlayerIds.length,
          topTargets: topWatchlistTargets,
        }),
        {
          leagueId,
          insightType: 'waiver',
          sport: settings?.sport ?? DEFAULT_SPORT,
        }
      )
    : "#waiver-ai-engine-panel"
  const inferredNeedPositions = useMemo(() => {
    const positionCounts = new Map<string, number>()
    for (const player of rosterSnapshotPlayers) {
      if (!player.position) continue
      positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1)
    }

    const starterPositions = starterAllowedPositions.length > 0
      ? starterAllowedPositions
      : getFallbackNeedPositionsForSport(settings?.sport)
    const uniqueStarterPositions = Array.from(new Set(starterPositions))
    const scored = uniqueStarterPositions.map((position) => ({
      position,
      count: positionCounts.get(position) ?? 0,
    }))
    scored.sort((a, b) => a.count - b.count)
    const needs = scored.filter((entry) => entry.count <= 1).map((entry) => entry.position)
    return needs.slice(0, 4)
  }, [rosterSnapshotPlayers, starterAllowedPositions, settings?.sport])

  const inferredTeamNeedsPayload = useMemo(() => {
    const weakestSlots = inferredNeedPositions.map((position, index) => ({
      slot: position,
      position,
      currentPlayer: null,
      currentValue: 0,
      leagueMedianValue: 3000,
      gap: Math.max(800, 2800 - index * 350),
      gapPpg: 2.5 - index * 0.3,
    }))

    return {
      weakestSlots,
      biggestNeed: weakestSlots[0] ?? null,
      byeWeekClusters: [],
      positionalDepth: inferredNeedPositions.map((position, index) => ({
        position,
        count: 1,
        leagueMedianCount: 2,
        totalValue: Math.max(1000, 2400 - index * 220),
        leagueMedianValue: 4200,
        depthRating: Math.max(20, 38 - index * 4),
      })),
      dropCandidates: [],
    }
  }, [inferredNeedPositions])

  const analyzeWaiversWithEngine = useCallback(async () => {
    setWaiverAiLoading(true)
    setWaiverAiError("")
    setWaiverAiAnalysis(null)
    const candidatePool = (activeTab === "trending" ? trendingPlayers : filteredPlayers).slice(0, 60)
    if (candidatePool.length === 0) {
      setWaiverAiError("No waiver candidates available for analysis.")
      setWaiverAiLoading(false)
      return
    }

    try {
      const payload = {
        leagueId,
        sport: String(settings?.sport ?? DEFAULT_SPORT).toUpperCase(),
        includeAIExplanation: waiverAiIncludeExplanation,
        confirmTokenSpend: true,
        goal: "balanced" as const,
        leagueSettings: {
          numTeams: 12,
          isDynasty: String(settings?.formatType ?? "").toLowerCase().includes("dynasty"),
        },
        teamNeeds: inferredTeamNeedsPayload,
        roster: rosterSnapshotPlayers,
        availablePlayers: candidatePool.map((player) => ({
          playerId: player.id,
          playerName: player.name,
          position: player.position ?? "UTIL",
          team: player.team,
          value: estimateWaiverCandidateValue(
            player.position,
            trendScoreByPlayerId.get(player.id) ?? 0,
            watchlistIdSet.has(player.id)
          ),
          source: "waiver-wire-ui",
          product: player.product,
          lowConfidence: player.lowConfidence,
          profileSource: player.profileSource,
          statsSource: player.statsSource,
          fantasyPointsPerGame: player.fantasyPointsPerGame,
          injuryStatus: player.injuryStatus,
        })),
        maxResults: 8,
      }

      const response = await fetch("/api/waiver-ai/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = typeof json?.error === "string" ? json.error : "Failed to analyze waivers with engine."
        setWaiverAiError(message)
        return
      }
      setWaiverAiAnalysis(json.analysis ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to analyze waivers with engine."
      setWaiverAiError(message)
    } finally {
      setWaiverAiLoading(false)
    }
  }, [
    activeTab,
    filteredPlayers,
    inferredTeamNeedsPayload,
    leagueId,
    rosterSnapshotPlayers,
    settings?.formatType,
    settings?.sport,
    trendScoreByPlayerId,
    trendingPlayers,
    waiverAiIncludeExplanation,
    watchlistIdSet,
  ])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="waiver-loading-state">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff3d81]" />
      </div>
    )
  }

  return (
    <div className={chrome === "embedded" ? "space-y-4" : "space-y-6"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {chrome === "embedded" ? (
          <div className="space-y-0.5">
            {nextRunAt && (
              <p className="text-[11px] text-white/45" data-testid="waiver-next-run-hint">
                Next scheduled run: {formatInTimezone(nextRunAt)}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            <h1 className="text-lg font-semibold text-white sm:text-xl">Waiver Wire</h1>
            <p className="text-xs text-white/60">
              Browse free agents, submit claims, and track your FAAB and priority with rule-aware waiver tools.
            </p>
            {nextRunAt && (
              <p className="text-[11px] text-white/45" data-testid="waiver-next-run-hint">
                Next scheduled run: {formatInTimezone(nextRunAt)}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isFaab && <FaabBudgetCard faabRemaining={faabRemaining} budgetCap={settings?.faabBudget ?? null} />}
          <WaiverPriorityCard waiverPriority={waiverPriority} />
          <span className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-xs text-fuchsia-100 sm:text-sm">
            Watchlist: {watchlistPlayerIds.length}
          </span>
          <CommissionerWaiverControls leagueId={leagueId} onAfterAction={() => load()} />
          <button
            type="button"
            onClick={() => load()}
            data-testid="waiver-refresh-button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 sm:text-sm"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <Link
            href={`/app/trend-feed?sport=${encodeURIComponent(settings?.sport ?? DEFAULT_SPORT)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20 sm:text-sm"
          >
            Trending players
          </Link>
          {compareUi ? (
            <button
              type="button"
              onClick={() =>
                compareUi.openComparison({
                  playerA: "",
                  playerB: "",
                  sport: normalizeToSupportedSport(settings?.sport ?? DEFAULT_SPORT) ?? DEFAULT_SPORT,
                  leagueId,
                  source: "waiver",
                })
              }
              data-testid="waiver-open-player-compare"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#ff3d81]/40 bg-[#ff3d81]/10 px-3 py-1.5 text-xs text-[#ffb8d1] hover:bg-[#ff3d81]/20 sm:text-sm"
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare players
            </button>
          ) : (
            <Link
              href={`/player-compare?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(settings?.sport ?? DEFAULT_SPORT)}`}
              data-testid="waiver-open-player-compare-fallback"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#ff3d81]/40 bg-[#ff3d81]/10 px-3 py-1.5 text-xs text-[#ffb8d1] hover:bg-[#ff3d81]/20 sm:text-sm"
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare players
            </Link>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {loadError}
        </div>
      )}

      {likelyPredraftLimited && (
        <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" data-testid="waiver-predraft-limited-message">
          Waivers are limited before the draft. Claims open after rosters are created.
        </div>
      )}

      <section className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid="waiver-automation-status">
        <h2 className="text-sm font-semibold text-white">Waiver automation status</h2>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <StatusItem label="Next processing deadline" value={nextRunAt ? formatInTimezone(nextRunAt) : 'Not available yet'} />
          <StatusItem label="Waiver type" value={getWaiverTypeLabel(settings?.waiverType ?? null)} />
          {isFaab ? (
            <StatusItem
              label="Your FAAB remaining"
              value={faabRemaining != null ? `$${faabRemaining}` : 'Not available yet'}
            />
          ) : (
            <StatusItem
              label="Your waiver priority"
              value={waiverPriority != null ? `#${waiverPriority}` : 'Not available yet'}
            />
          )}
          <StatusItem label="Pending claims" value={String(claims.length)} />
          <StatusItem
            label="Last waiver processed"
            value={lastProcessedAt ? formatInTimezone(lastProcessedAt) : 'Not available yet'}
          />
        </div>
      </section>

      {!lockedTab && (
        <div className="flex gap-2 border-b border-white/10 pb-2">
          {(["available", "trending", "claimed", "dropped", "pending", "history"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              data-testid={`waiver-tab-${tab}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                activeTab === tab ? "bg-[#ff3d81]/20 text-[#ffb8d1]" : "text-white/70 hover:text-white"
              }`}
            >
              {tab === "available" ? "All players" : getTabLabel(tab, claims.length)}
            </button>
          ))}
        </div>
      )}

      {(activeTab === "available" || activeTab === "trending") && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-0 sm:p-3">
          <WaiverFilters
            search={search}
            onSearchChange={setSearch}
            position={positionFilter}
            onPositionChange={setPositionFilter}
            team={teamFilter}
            onTeamChange={setTeamFilter}
            status={statusFilter}
            onStatusChange={setStatusFilter}
            sort={sort}
            onSortChange={setSort}
            onResetFilters={() =>
              resetWaiverFilters({
                setSearch,
                setPosition: setPositionFilter,
                setTeam: setTeamFilter,
                setStatus: setStatusFilter,
                setSort,
              })
            }
            teams={uniqueTeams}
            sport={settings?.sport ?? undefined}
            formatType={settings?.formatType ?? undefined}
          />
          <ul className="max-h-[480px] space-y-1.5 overflow-y-auto px-1 pb-3 pt-1 sm:px-0">
            {activePlayerList.length === 0 ? (
              <li className="py-6 text-center text-sm text-white/50">
                {WAIVER_EMPTY_PLAYERS_TITLE}
                <span className="block text-xs text-white/40 mt-1">{WAIVER_EMPTY_PLAYERS_HINT}</span>
              </li>
            ) : (
              visiblePlayerList.map((p) => {
                const alreadyClaimed = claims.some((c) => c.addPlayerId === p.id)
                const row = adaptWaiverWirePlayer(p)
                return (
                  <WaiverPlayerRow
                    key={p.id}
                    player={{
                      id: row.id,
                      name: row.name,
                      position: row.position,
                      team: row.team,
                      headshotUrl: row.displayHeadshotUrl ?? row.headshotUrl,
                      teamLogoUrl: row.displayTeamLogoUrl ?? row.teamLogoUrl,
                      injuryStatus: row.displayInjury ?? row.injuryStatus,
                      experienceSummary: row.experienceSummary,
                      projectedPoints: row.displayProjection,
                      adp: row.displayAdp,
                      aiAdp: row.displayAiAdp,
                      byeWeek: row.displayByeWeek,
                      rank: playerNumber(p, ["rank", "overallRank", "ecr", "consensusRank"]),
                      ownershipPercent: playerNumber(p, ["ownershipPercent", "rosteredPercent", "rosterPercent"]),
                      projectionSourceLabel: row.projectionSourceLabel,
                      adpSourceLabel: row.adpSourceLabel,
                      statsSourceLabel: row.statsSourceLabel,
                      dataQualityLabels: row.dataQualityLabels,
                      seasonStatsSummary: row.seasonStatsSummary,
                    }}
                    sport={settings?.sport ?? null}
                    trendScore={trendScoreByPlayerId.get(p.id) ?? 0}
                    addMode={immediateAddAllowed}
                    actionLoading={actionPlayerId === p.id}
                    onRowClick={() => {
                      if (alreadyClaimed) return
                      if (immediateAddAllowed) handleAddClick(p)
                      else {
                        setImmediateMode(false)
                        setDrawerPlayer(p)
                        setDrawerOpen(true)
                      }
                    }}
                    onAdd={() => {
                      if (alreadyClaimed) return
                      handleAddClick(p)
                    }}
                    onAddClick={() => {
                      if (alreadyClaimed) return
                      setImmediateMode(false)
                      setDrawerPlayer(p)
                      setDrawerOpen(true)
                    }}
                    onToggleWatchlist={() => toggleWatchlist(p.id)}
                    watchlisted={watchlistIdSet.has(p.id)}
                    alreadyClaimed={alreadyClaimed}
                  />
                )
              })
            )}
            {hiddenPlayerCount > 0 && (
              <li
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs text-white/55"
                data-testid="waiver-player-render-limit-note"
              >
                Showing {WAIVER_PLAYER_RENDER_LIMIT} of {activePlayerList.length}. Narrow search or filters for more players.
              </li>
            )}
          </ul>
        </div>
      )}

      {activeTab === "claimed" && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Recently claimed players</h3>
          <ul className="space-y-1.5 text-sm">
            {claimedTransactions.length === 0 ? (
              <li className="py-4 text-center text-sm text-white/50">No successful claims yet.</li>
            ) : (
              claimedTransactions.map((t) => (
                <li
                  key={`claimed-${t.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-white/90"
                >
                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>Add {t.addPlayerId}</span>
                  {t.faabSpent != null && <span className="text-[#ff9ec0]">${t.faabSpent}</span>}
                  <span className="ml-auto text-xs text-white/50">
                    {formatInTimezone(t.processedAt)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {activeTab === "dropped" && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Recently dropped players</h3>
          <ul className="space-y-1.5 text-sm">
            {droppedTransactions.length === 0 ? (
              <li className="py-4 text-center text-sm text-white/50">No dropped players in recent waiver runs.</li>
            ) : (
              droppedTransactions.map((t) => (
                <li
                  key={`dropped-${t.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-white/90"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-400/60 text-[10px] text-amber-300">
                    -
                  </span>
                  <span>Drop {t.dropPlayerId}</span>
                  <span className="ml-auto text-xs text-white/50">
                    {formatInTimezone(t.processedAt)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {activeTab === "pending" && (
        <PendingClaimsList
          claims={claims}
          isFaab={isFaab}
          rosterPlayers={rosterPlayers}
          pendingEdits={pendingEdits}
          setPendingEdits={setPendingEdits}
          onSave={(claimId, idx, c) => {
            const patch = buildPendingClaimPatch(c, idx, pendingEdits[claimId], isFaab)
            void updateClaimById(claimId, patch)
          }}
          onCancel={cancelClaimById}
          onReorder={(claimId, direction) => {
            void reorderClaim(claimId, direction)
          }}
        />
      )}

      {activeTab === "history" && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Processed claims</h3>
          {history.transactions.length === 0 && history.claims.filter((c) => c.status === "failed").length === 0 ? (
            <p className="py-4 text-center text-sm text-white/50">{WAIVER_EMPTY_HISTORY_TITLE}</p>
          ) : (
            <div className="space-y-4">
              {history.transactions.length > 0 && (
                <div data-testid="waiver-history-transactions">
                <WaiverResultsFeed
                  transactions={history.transactions.map((t) => ({
                    id: t.id,
                    addPlayerId: t.addPlayerId,
                    dropPlayerId: t.dropPlayerId,
                    faabSpent: t.faabSpent,
                    processedAt: t.processedAt,
                    addPlayerPosition: t.addPlayerPosition,
                    dropPlayerPosition: t.dropPlayerPosition,
                    isDefensiveAdd: t.isDefensiveAdd,
                    isDefensiveDrop: t.isDefensiveDrop,
                    outcomeLabel: 'Won',
                  }))}
                  formatTime={formatInTimezone}
                />
                </div>
              )}
              {history.claims.filter((c) => c.status === "failed").length > 0 && (
                <ul className="space-y-1.5 text-sm" data-testid="waiver-history-failed-claims">
                  {history.claims
                    .filter((c) => c.status === "failed")
                    .map((c) => {
                    const oc = outcomeCodeFromMetadata(c.metadata)
                    const headline = formatWaiverOutcomeLabel(oc, c.resultMessage)
                    return (
                      <li
                        key={c.id}
                        className="flex flex-col gap-1 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-white/90 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-red-400/60 text-[10px] leading-none text-red-300">
                            !
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-white">Lost · {headline}</div>
                            <div className="text-xs text-white/70">
                              Add {c.addPlayerId}
                              {c.dropPlayerId && <> · Drop {c.dropPlayerId}</>}
                            </div>
                            {c.resultMessage && c.resultMessage !== headline && (
                              <div className="mt-1 text-[11px] text-white/50">{c.resultMessage}</div>
                            )}
                            {oc && (
                              <span className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                                {oc.replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                          {c.faabBid != null && <span className="text-[#ff9ec0]">${c.faabBid}</span>}
                          {c.processedAt && (
                            <span className="text-xs text-white/50">{formatInTimezone(c.processedAt)}</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!lockedTab && <AIWaiverRecommendationsPanel leagueId={leagueId} />}
      {!lockedTab && <CommissionerWaiverInsightsPanel leagueId={leagueId} />}

      {!lockedTab && (
      <section id="waiver-ai-engine-panel" className="rounded-xl border border-[#ff3d81]/20 bg-black/20 p-4" data-testid="waiver-ai-engine-panel">
        <InContextMonetizationCard
          title="Waiver AI access"
          featureId="ai_waivers"
          tokenRuleCodes={["ai_waiver_engine_run"]}
          className="mb-3"
          testIdPrefix="waiver-monetization"
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#ffd7e5]">Waiver AI Engine</h2>
            <p className="mt-1 text-xs text-white/60">
              Deterministic waiver pickups scored from available players and team-needs context, with optional AI explanation.
            </p>
            {!aiAssistantEnabled && !aiAvailabilityLoading && (
              <p className="mt-1 text-[11px] text-amber-200">
                AI assistant is disabled. Deterministic waiver scoring remains available.
              </p>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-white/75">
            <input
              type="checkbox"
              checked={waiverAiIncludeExplanation}
              onChange={(event) => setWaiverAiIncludeExplanation(event.target.checked)}
              disabled={!aiAssistantEnabled}
              className="rounded border-white/30 bg-black/40"
              data-testid="waiver-ai-engine-explanation-toggle"
            />
            AI explanation {!aiAssistantEnabled && !aiAvailabilityLoading ? '(disabled)' : ''}
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void analyzeWaiversWithEngine()}
            disabled={waiverAiLoading || players.length === 0}
            data-testid="waiver-ai-engine-analyze"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#ff3d81]/40 bg-[#ff3d81]/20 px-3 py-1.5 text-xs font-medium text-[#ffd7e5] hover:bg-[#ff3d81]/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {waiverAiLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing
              </>
            ) : (
              "Analyze waivers"
            )}
          </button>
          {inferredNeedPositions.length > 0 && (
            <span className="text-[11px] text-white/55" data-testid="waiver-ai-engine-needs">
              Need focus: {inferredNeedPositions.join(", ")}
            </span>
          )}
        </div>

        {waiverAiError && (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200" data-testid="waiver-ai-engine-error">
            {waiverAiError}
          </p>
        )}

        {waiverAiAnalysis && (
          <div className="mt-3 space-y-3" data-testid="waiver-ai-engine-results">
            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-white/65">
                <span>
                  Explanation source:{" "}
                  <span className="font-medium text-[#ffb8d1]">{waiverAiAnalysis.explanation.source}</span>
                </span>
                <span className="text-white/35">|</span>
                <span>Sport: {waiverAiAnalysis.sport}</span>
              </div>
              <p className="text-sm text-white/85">{waiverAiAnalysis.explanation.text}</p>
            </div>
            <ul className="space-y-2">
              {waiverAiAnalysis.deterministic.suggestions.slice(0, 5).map((suggestion, index) => (
                <li
                  key={`${suggestion.playerId}-${index}`}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                  data-testid={`waiver-ai-engine-suggestion-${index + 1}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-white">
                      #{index + 1} {suggestion.playerName} ({suggestion.position})
                    </span>
                    <span className="text-[#ffb8d1]">
                      {suggestion.recommendation} · Score {suggestion.compositeScore}
                      {suggestion.faabBid != null ? ` · FAAB ${suggestion.faabBid}%` : ""}
                    </span>
                  </div>
                  {suggestion.topDrivers.length > 0 && (
                    <p className="mt-1 text-[11px] text-white/60">
                      {suggestion.topDrivers.map((driver) => driver.label).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      )}

      {!lockedTab && (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-2 text-sm font-semibold text-white">League waiver rules</h2>
        <p className="mb-3 text-xs text-white/55">{waiverRuleSummary}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-white/50">Type</dt>
            <dd className="text-white">
              {getWaiverTypeLabel(settings?.waiverType ?? null)}
            </dd>
          </div>
          {settings?.faabBudget != null && (
            <div>
              <dt className="text-white/50">FAAB budget</dt>
              <dd className="text-white">{settings.faabBudget}</dd>
            </div>
          )}
          {settings?.processingTimeUtc && (
            <div>
              <dt className="text-white/50">Process time (UTC)</dt>
              <dd className="text-white">{settings.processingTimeUtc}</dd>
            </div>
          )}
          {settings?.claimLimitPerPeriod != null && (
            <div>
              <dt className="text-white/50">Claim limit</dt>
              <dd className="text-white">
                {settings.claimLimitPerPeriod} per period
              </dd>
            </div>
          )}
          {settings?.tiebreakRule && (
            <div>
              <dt className="text-white/50">Tiebreaker</dt>
              <dd className="text-white">{settings.tiebreakRule}</dd>
            </div>
          )}
          {settings?.instantFaAfterClear != null && (
            <div>
              <dt className="text-white/50">After waivers clear</dt>
              <dd className="text-white">
                {settings.instantFaAfterClear ? "Instant free agency" : "Remains on waivers"}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-xs text-white/55">
          Roster and positional limits are enforced by your host league. If your roster is full or a player is
          ineligible for a slot, you may be required to choose a drop here or finalize moves directly on the host
          platform after claims process.
        </p>
        <div className="mt-3 pt-3 border-t border-white/10">
          <Link
            href={waiverAiHelpHref}
            data-testid="waiver-ai-help-link"
            className="inline-flex items-center gap-2 rounded-lg border border-[#ff3d81]/40 bg-[#ff3d81]/10 px-3 py-2 text-xs text-[#ffb8d1] hover:bg-[#ff3d81]/20 transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {aiAssistantEnabled ? "Get AI waiver help" : "Open deterministic waiver guidance"}
          </Link>
        </div>
      </section>
      )}

      <WaiverClaimDrawer
        open={drawerOpen}
        onClose={() => {
          if (!claimLoading) {
            setDrawerOpen(false)
            setDrawerPlayer(null)
          }
        }}
        player={drawerPlayer}
        faabMode={isFaab}
        faabRemaining={faabRemaining}
        hasOpenRosterSpot={hasOpenRosterSpot}
        rosterPlayerIds={rosterPlayerIds}
        rosterPlayers={rosterPlayers.length > 0 ? rosterPlayers : undefined}
        onSubmit={async (opts) => {
          if (!drawerPlayer) return
          // Immediate mode (FCFS / instant-FA, full roster): perform the add/drop directly.
          if (immediateMode) {
            await addDropPlayer(drawerPlayer, opts.dropPlayerId)
            return
          }
          await submitClaimForPlayer(drawerPlayer, opts)
        }}
      />
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <p className="text-white/45">{label}</p>
      <p className="mt-0.5 text-white/90">{value}</p>
    </div>
  )
}
