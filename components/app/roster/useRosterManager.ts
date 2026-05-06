"use client"

import { useCallback, useEffect, useState } from "react"
import { mergeUnifiedIntoRosterState } from "@/lib/player-data/adapters/rosterPlayerAdapter"
import type { UnifiedPlayerWireDto } from "@/lib/player-data/serializeUnifiedPlayerForApi"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { dispatchStateRefreshEvent } from "@/lib/state-consistency/state-events"

export type RosterSectionKey = "starters" | "bench" | "ir" | "taxi" | "devy"

const SECTION_KEYS: RosterSectionKey[] = ["starters", "bench", "ir", "taxi", "devy"]

export type RosterPlayer = {
  id: string
  name: string
  team: string
  position: string
  opponent: string
  gameTime: string
  projection: number
  actual: number | null
  status: "healthy" | "q" | "out" | "ir"
  slot: RosterSectionKey
  /** Normalized display-only enrichments from `unifiedRoster` API slice */
  headshotUrl?: string | null
  providerInjuryLabel?: string | null
  unifiedProjectedPoints?: number | null
  unifiedLowConfidence?: boolean
}

export type RosterState = {
  starters: RosterPlayer[]
  bench: RosterPlayer[]
  ir: RosterPlayer[]
  taxi: RosterPlayer[]
  devy: RosterPlayer[]
}

export type SlotLimits = Record<RosterSectionKey, number>

export type AvailablePoolPlayer = {
  id: string
  name: string
  position: string | null
  team: string | null
}

const EMPTY_ROSTER: RosterState = {
  starters: [],
  bench: [],
  ir: [],
  taxi: [],
  devy: [],
}

const DEFAULT_SLOT_LIMITS: SlotLimits = {
  starters: 9,
  bench: 7,
  ir: 2,
  taxi: 0,
  devy: 0,
}

const FALLBACK_STARTER_POSITIONS = [
  "QB", "RB", "WR", "TE", "K", "DST",
  "DE", "DT", "LB", "CB", "S", "DL", "DB", "IDP_FLEX",
  "PG", "SG", "SF", "PF", "C", "G", "F", "UTIL",
  "SP", "RP", "P", "1B", "2B", "3B", "SS", "OF", "DH",
  "LW", "RW", "D", "GK", "GKP", "DEF", "MID", "FWD",
  "SUPERFLEX", "FLEX",
]

export type LineupLockPayload = {
  locked: boolean
  reason?: string
  policy?: string
  lockedPlayerIds?: string[]
  perPlayerReasons?: Record<string, string>
}

export type RosterManagerOptions = {
  leagueId?: string
}

function isSectionEnabled(section: RosterSectionKey, limits: SlotLimits): boolean {
  return Number(limits[section] ?? 0) > 0
}

function toPlayerId(raw: unknown): string | null {
  if (typeof raw === "string") return raw
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    const id = obj.id ?? obj.player_id
    if (typeof id === "string" && id.trim()) return id.trim()
  }
  return null
}

function normalizeStatus(raw: unknown): RosterPlayer["status"] {
  const v = String(raw ?? "").trim().toUpperCase()
  if (!v) return "healthy"
  if (["IR", "PUP", "OUT_IR"].includes(v)) return "ir"
  if (["OUT", "SUSPENDED"].includes(v)) return "out"
  if (["Q", "QUESTIONABLE", "DOUBTFUL", "DAY_TO_DAY"].includes(v)) return "q"
  return "healthy"
}

function normalizeRosterPlayer(raw: unknown, fallbackId: string, slot: RosterSectionKey): RosterPlayer {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const id = toPlayerId(raw) ?? fallbackId
  const position = String(obj.position ?? obj.slot_position ?? "UTIL").trim().toUpperCase()
  const team = String(obj.team ?? obj.team_abbreviation ?? obj.teamAbbreviation ?? "—")
  return {
    id,
    name: String(obj.name ?? obj.full_name ?? obj.displayName ?? id),
    team,
    position: position || "UTIL",
    opponent: String(obj.opponent ?? "—"),
    gameTime: String(obj.gameTime ?? obj.game_time ?? "—"),
    projection: Number(obj.projection ?? 0) || 0,
    actual: obj.actual == null ? null : Number(obj.actual),
    status: normalizeStatus(obj.status ?? obj.injury_status),
    slot,
  }
}

function dedupePlayers(players: RosterPlayer[]): RosterPlayer[] {
  const seen = new Set<string>()
  const out: RosterPlayer[] = []
  for (const p of players) {
    if (!p.id || seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out
}

function normalizeRosterState(raw: unknown): RosterState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_ROSTER
  const obj = raw as Record<string, unknown>
  const sections: Partial<Record<RosterSectionKey, RosterPlayer[]>> = {}
  for (const key of SECTION_KEYS) {
    const arr = obj[key]
    if (!Array.isArray(arr)) {
      sections[key] = []
      continue
    }
    sections[key] = dedupePlayers(
      arr
        .map((item, idx) => normalizeRosterPlayer(item, `${key}-${idx + 1}`, key))
        .filter((p) => Boolean(p.id))
    )
  }
  return {
    starters: sections.starters ?? [],
    bench: sections.bench ?? [],
    ir: sections.ir ?? [],
    taxi: sections.taxi ?? [],
    devy: sections.devy ?? [],
  }
}

function buildRosterStateFromPlayerData(playerData: unknown): RosterState {
  if (!playerData) return EMPTY_ROSTER
  if (playerData && typeof playerData === "object" && !Array.isArray(playerData)) {
    const obj = playerData as Record<string, unknown>
    const lineupSections = normalizeRosterState(obj.lineup_sections)
    const hasSectionData = SECTION_KEYS.some((key) => lineupSections[key].length > 0)
    if (hasSectionData) return lineupSections
  }

  const ids = getRosterPlayerIds(playerData)
  if (ids.length === 0) return EMPTY_ROSTER

  const dataObj =
    playerData && typeof playerData === "object" && !Array.isArray(playerData)
      ? (playerData as Record<string, unknown>)
      : {}
  const starterIds = new Set(getRosterPlayerIds(dataObj.starters))
  const irIds = new Set(getRosterPlayerIds(dataObj.reserve))
  const taxiIds = new Set(getRosterPlayerIds(dataObj.taxi))
  const devyIds = new Set(getRosterPlayerIds(dataObj.devy))

  const rawById = new Map<string, unknown>()
  const possibleBuckets = [dataObj.players, dataObj.starters, dataObj.reserve, dataObj.taxi, dataObj.devy]
  for (const bucket of possibleBuckets) {
    if (!Array.isArray(bucket)) continue
    for (const entry of bucket) {
      const id = toPlayerId(entry)
      if (!id) continue
      rawById.set(id, entry)
    }
  }

  const next: RosterState = { starters: [], bench: [], ir: [], taxi: [], devy: [] }
  for (const id of ids) {
    const raw = rawById.get(id) ?? { id, name: id }
    if (starterIds.has(id)) next.starters.push(normalizeRosterPlayer(raw, id, "starters"))
    else if (irIds.has(id)) next.ir.push(normalizeRosterPlayer(raw, id, "ir"))
    else if (taxiIds.has(id)) next.taxi.push(normalizeRosterPlayer(raw, id, "taxi"))
    else if (devyIds.has(id)) next.devy.push(normalizeRosterPlayer(raw, id, "devy"))
    else next.bench.push(normalizeRosterPlayer(raw, id, "bench"))
  }
  return next
}

function normalizePositionForEligibility(position: string): string {
  const p = String(position ?? "").trim().toUpperCase()
  if (p === "GK") return "GKP"
  if (p === "EDGE") return "DE"
  if (p === "OLB" || p === "ILB" || p === "MLB") return "LB"
  if (p === "SS" || p === "FS") return "S"
  if (p === "NT") return "DT"
  return p
}

function isStarterPositionEligible(position: string, starterAllowedPositions: string[]): boolean {
  const normalized = normalizePositionForEligibility(position)
  const allowed = new Set(starterAllowedPositions.map((p) => normalizePositionForEligibility(p)))
  if (allowed.size === 0 || allowed.has("*")) return true
  if (allowed.has("UTIL")) return true
  if (allowed.has(normalized)) return true
  if (allowed.has("FLEX") && ["RB", "WR", "TE"].includes(normalized)) return true
  if (allowed.has("SUPERFLEX") && ["QB", "RB", "WR", "TE"].includes(normalized)) return true
  if (allowed.has("G") && ["PG", "SG"].includes(normalized)) return true
  if (allowed.has("F") && ["SF", "PF"].includes(normalized)) return true
  if (allowed.has("P") && ["SP", "RP"].includes(normalized)) return true
  if (allowed.has("DL") && ["DE", "DT"].includes(normalized)) return true
  if (allowed.has("DB") && ["CB", "S"].includes(normalized)) return true
  if (allowed.has("IDP_FLEX") && ["DE", "DT", "LB", "CB", "S"].includes(normalized)) return true
  return false
}

function serializeRosterState(state: RosterState, existingPlayerData: unknown): Record<string, unknown> {
  const asObj =
    existingPlayerData && typeof existingPlayerData === "object" && !Array.isArray(existingPlayerData)
      ? (existingPlayerData as Record<string, unknown>)
      : {}

  const lineupSections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: state.starters.map((p) => ({ ...p, slot: "starters" })),
    bench: state.bench.map((p) => ({ ...p, slot: "bench" })),
    ir: state.ir.map((p) => ({ ...p, slot: "ir" })),
    taxi: state.taxi.map((p) => ({ ...p, slot: "taxi" })),
    devy: state.devy.map((p) => ({ ...p, slot: "devy" })),
  }

  const allPlayerIds = dedupePlayers([
    ...state.starters,
    ...state.bench,
    ...state.ir,
    ...state.taxi,
    ...state.devy,
  ]).map((p) => p.id)

  return {
    ...asObj,
    players: allPlayerIds,
    starters: state.starters.map((p) => p.id),
    reserve: state.ir.map((p) => p.id),
    taxi: state.taxi.map((p) => p.id),
    devy: state.devy.map((p) => p.id),
    lineup_sections: lineupSections,
    lineup_updated_at: new Date().toISOString(),
  }
}

export function useRosterManager(options: RosterManagerOptions = {}) {
  const [roster, setRoster] = useState<RosterState | null>(null)
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [leagueSport, setLeagueSport] = useState<string>('NFL')
  const [existingPlayerData, setExistingPlayerData] = useState<unknown>(null)
  const [slotLimits, setSlotLimits] = useState<SlotLimits>(DEFAULT_SLOT_LIMITS)
  const [starterAllowedPositions, setStarterAllowedPositions] = useState<string[]>(FALLBACK_STARTER_POSITIONS)
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePoolPlayer[]>([])
  const [poolLoading, setPoolLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [lineupLock, setLineupLock] = useState<LineupLockPayload | null>(null)
  const [canEditLineup, setCanEditLineup] = useState(true)

  const loadAvailablePlayers = useCallback(async () => {
    if (!options.leagueId) {
      setAvailablePlayers([])
      return
    }
    setPoolLoading(true)
    try {
      const res = await fetch(`/api/waiver-wire/leagues/${encodeURIComponent(options.leagueId)}/players?limit=120`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAvailablePlayers([])
        return
      }
      const next = Array.isArray(data.players)
        ? (data.players as unknown[])
            .map((p) => {
              const obj = p as Record<string, unknown>
              return {
                id: String(obj.id ?? ""),
                name: String(obj.name ?? "Unknown"),
                position: obj.position == null ? null : String(obj.position),
                team: obj.team == null ? null : String(obj.team),
              } satisfies AvailablePoolPlayer
            })
            .filter((p) => p.id)
        : []
      setAvailablePlayers(next)
    } finally {
      setPoolLoading(false)
    }
  }, [options.leagueId])

  const loadRoster = useCallback(async () => {
    if (!options.leagueId) {
      setRoster(EMPTY_ROSTER)
      setExistingPlayerData(null)
      setRosterId(null)
      setLeagueSport('NFL')
      setSlotLimits(DEFAULT_SLOT_LIMITS)
      setStarterAllowedPositions(FALLBACK_STARTER_POSITIONS)
      setLineupLock(null)
      setCanEditLineup(true)
      return
    }
    try {
      const res = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(options.leagueId)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRoster(EMPTY_ROSTER)
        setExistingPlayerData(null)
        setRosterId(null)
        setSaveError(typeof data?.error === "string" ? data.error : "Unable to load roster.")
        return
      }
      setRosterId(typeof data?.rosterId === "string" ? data.rosterId : null)
      setLeagueSport(
        typeof data?.sport === 'string' && data.sport.trim()
          ? data.sport.toUpperCase()
          : 'NFL'
      )
      const lockRaw = data?.lineupLock as LineupLockPayload | null | undefined
      setLineupLock(
        lockRaw && typeof lockRaw === "object"
          ? {
              locked: Boolean(lockRaw.locked),
              reason: typeof lockRaw.reason === "string" ? lockRaw.reason : undefined,
              policy: typeof lockRaw.policy === "string" ? lockRaw.policy : undefined,
              lockedPlayerIds: Array.isArray(lockRaw.lockedPlayerIds)
                ? lockRaw.lockedPlayerIds.map(String)
                : undefined,
              perPlayerReasons:
                lockRaw.perPlayerReasons && typeof lockRaw.perPlayerReasons === "object"
                  ? (lockRaw.perPlayerReasons as Record<string, string>)
                  : undefined,
            }
          : null
      )
      setCanEditLineup(data?.canEditLineup !== false)
      setExistingPlayerData(data?.roster ?? null)
      const base = buildRosterStateFromPlayerData(data?.roster)
      const unified =
        Array.isArray(data?.unifiedRoster) && data.unifiedRoster.length > 0
          ? (data.unifiedRoster as UnifiedPlayerWireDto[])
          : null
      setRoster(unified ? mergeUnifiedIntoRosterState(base, unified) : base)
      setSaveError(null)
      const incomingLimits = data?.slotLimits as Partial<SlotLimits> | null | undefined
      setSlotLimits({
        starters: Number(incomingLimits?.starters ?? DEFAULT_SLOT_LIMITS.starters),
        bench: Number(incomingLimits?.bench ?? DEFAULT_SLOT_LIMITS.bench),
        ir: Number(incomingLimits?.ir ?? DEFAULT_SLOT_LIMITS.ir),
        taxi: Number(incomingLimits?.taxi ?? DEFAULT_SLOT_LIMITS.taxi),
        devy: Number(incomingLimits?.devy ?? DEFAULT_SLOT_LIMITS.devy),
      })
      const incomingStarterAllowed = Array.isArray(data?.starterAllowedPositions)
        ? (data.starterAllowedPositions as unknown[]).map((v) => String(v).toUpperCase()).filter(Boolean)
        : []
      setStarterAllowedPositions(
        incomingStarterAllowed.length > 0 ? incomingStarterAllowed : FALLBACK_STARTER_POSITIONS
      )
    } catch {
      setRoster(EMPTY_ROSTER)
      setExistingPlayerData(null)
      setRosterId(null)
      setSaveError("Unable to load roster.")
    }
  }, [options.leagueId])

  useEffect(() => {
    void loadRoster()
    void loadAvailablePlayers()
  }, [loadRoster, loadAvailablePlayers])

  const movePlayer = useCallback(
    (playerId: string, toSlot: RosterSectionKey) => {
      if (!canEditLineup) {
        setSaveError("Lineup is locked for this period.")
        return false
      }
      if (!roster) return false
      let moved: RosterPlayer | null = null

      const next: RosterState = {
        starters: [],
        bench: [],
        ir: [],
        taxi: [],
        devy: [],
      }

      for (const key of Object.keys(roster) as RosterSectionKey[]) {
        for (const p of roster[key]) {
          if (p.id === playerId) {
            moved = { ...p, slot: toSlot }
          } else {
            next[key].push(p)
          }
        }
      }

      if (moved) {
        if (!isSectionEnabled(toSlot, slotLimits)) {
          setSaveError(`${toSlot.toUpperCase()} is not enabled for this league.`)
          return false
        }
        if (next[toSlot].length >= slotLimits[toSlot]) {
          setSaveError(`${toSlot.toUpperCase()} is full.`)
          return false
        }
        if (toSlot === "starters" && !isStarterPositionEligible(moved.position, starterAllowedPositions)) {
          setSaveError(`${moved.position} is not eligible for starter slots in this league.`)
          return false
        }
        next[toSlot] = [...next[toSlot], moved]
        setSaveError(null)
        setRoster(next)
        void autoSave(next)
        return true
      }
      return false
    },
    [roster, slotLimits, starterAllowedPositions, canEditLineup],
  )

  const swapPlayers = useCallback(
    (aId: string, bId: string) => {
      if (!canEditLineup) {
        setSaveError("Lineup is locked for this period.")
        return false
      }
      if (!roster) return false
      const next: RosterState = { ...roster, starters: [...roster.starters], bench: [...roster.bench], ir: [...roster.ir], taxi: [...roster.taxi], devy: [...roster.devy] }

      let aRef: { section: RosterSectionKey; index: number } | null = null
      let bRef: { section: RosterSectionKey; index: number } | null = null

      ;(Object.keys(next) as RosterSectionKey[]).forEach((key) => {
        const section = key as RosterSectionKey
        next[section].forEach((p, idx) => {
          if (p.id === aId) aRef = { section, index: idx }
          if (p.id === bId) bRef = { section, index: idx }
        })
      })

      if (!aRef || !bRef) return false

      type Ref = { section: RosterSectionKey; index: number }
      const aR = aRef as Ref
      const bR = bRef as Ref
      const a = next[aR.section][aR.index]
      const b = next[bR.section][bR.index]
      if (
        aR.section !== bR.section &&
        (!isSectionEnabled(aR.section, slotLimits) || !isSectionEnabled(bR.section, slotLimits))
      ) {
        setSaveError("Cannot move players into a disabled roster section.")
        return false
      }
      if (
        aR.section === "starters" &&
        !isStarterPositionEligible(b.position, starterAllowedPositions)
      ) {
        setSaveError(`${b.position} is not eligible for starter slots in this league.`)
        return false
      }
      if (
        bR.section === "starters" &&
        !isStarterPositionEligible(a.position, starterAllowedPositions)
      ) {
        setSaveError(`${a.position} is not eligible for starter slots in this league.`)
        return false
      }

      next[aR.section][aR.index] = { ...b, slot: aR.section }
      next[bR.section][bR.index] = { ...a, slot: bR.section }

      setSaveError(null)
      setRoster(next)
      void autoSave(next)
      return true
    },
    [roster, slotLimits, starterAllowedPositions, canEditLineup],
  )

  const dropPlayer = useCallback(
    (playerId: string) => {
      if (!canEditLineup) return
      if (!roster) return
      const next: RosterState = {
        starters: [],
        bench: [],
        ir: [],
        taxi: [],
        devy: [],
      }
      ;(Object.keys(roster) as RosterSectionKey[]).forEach((key) => {
        roster[key].forEach((p) => {
          if (p.id !== playerId) {
            next[key].push(p)
          }
        })
      })
      setRoster(next)
      void autoSave(next)
    },
    [roster, canEditLineup],
  )

  const addPlayer = useCallback(
    (player: RosterPlayer, toSlot: RosterSectionKey = "bench") => {
      if (!canEditLineup) return
      if (!roster) return
      const exists = SECTION_KEYS.some((key) => roster[key].some((p) => p.id === player.id))
      if (exists) return
      if (!isSectionEnabled(toSlot, slotLimits)) {
        setSaveError(`${toSlot.toUpperCase()} is not enabled for this league.`)
        return
      }
      if (roster[toSlot].length >= slotLimits[toSlot]) {
        setSaveError(`${toSlot.toUpperCase()} is full.`)
        return
      }
      if (toSlot === "starters" && !isStarterPositionEligible(player.position, starterAllowedPositions)) {
        setSaveError(`${player.position} is not eligible for starter slots in this league.`)
        return
      }
      const next: RosterState = {
        ...roster,
        [toSlot]: [...roster[toSlot], { ...player, slot: toSlot }],
      }
      setRoster(next)
      void autoSave(next)
    },
    [roster, slotLimits, starterAllowedPositions, canEditLineup],
  )

  const autoSave = useCallback(
    async (state: RosterState) => {
      if (!options.leagueId) return
      setSaving(true)
      setSaveError(null)
      try {
        const rosterData = serializeRosterState(state, existingPlayerData)
        const res = await fetch("/api/leagues/roster/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leagueId: options.leagueId,
            rosterId,
            roster: state,
            rosterData,
            starters: rosterData.starters,
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(
            typeof json?.error === "string" ? json.error : "Unable to save lineup."
          )
        }
        setExistingPlayerData(rosterData)
        setLastSavedAt(Date.now())
        dispatchStateRefreshEvent({
          domain: "leagues",
          reason: "roster_save",
          leagueId: options.leagueId,
          source: "useRosterManager",
        })
        void loadAvailablePlayers()
      } catch (err: any) {
        setSaveError(err?.message || "Unable to save lineup.")
      } finally {
        setSaving(false)
      }
    },
    [options.leagueId, existingPlayerData, rosterId, loadAvailablePlayers, canEditLineup],
  )

  const addPlayerFromPool = useCallback(
    (playerId: string, toSlot: RosterSectionKey = "bench") => {
      if (!roster) return
      const candidate = availablePlayers.find((p) => p.id === playerId)
      if (!candidate) return
      addPlayer(
        {
          id: candidate.id,
          name: candidate.name,
          team: candidate.team ?? "—",
          position: (candidate.position ?? "UTIL").toUpperCase(),
          opponent: "—",
          gameTime: "—",
          projection: 0,
          actual: null,
          status: "healthy",
          slot: toSlot,
        },
        toSlot
      )
      setAvailablePlayers((prev) => prev.filter((p) => p.id !== playerId))
    },
    [roster, availablePlayers, addPlayer],
  )

  const optimizeLineup = useCallback(() => {
    if (!canEditLineup) {
      setSaveError("Lineup is locked for this period.")
      return
    }
    if (!roster) return
    const startersTarget = slotLimits.starters > 0 ? slotLimits.starters : 9
    const allPlayers = dedupePlayers([
      ...roster.starters,
      ...roster.bench,
      ...roster.ir,
      ...roster.taxi,
      ...roster.devy,
    ]).sort((a, b) => b.projection - a.projection)

    const next: RosterState = {
      starters: [],
      bench: [],
      ir: [],
      taxi: [],
      devy: [],
    }
    const deferred: RosterPlayer[] = []

    for (const player of allPlayers) {
      if (
        next.starters.length < startersTarget &&
        isStarterPositionEligible(player.position, starterAllowedPositions)
      ) {
        next.starters.push({ ...player, slot: 'starters' })
      } else {
        deferred.push(player)
      }
    }

    let overflowUnassigned = 0
    for (const player of deferred) {
      if (
        (player.status === 'ir' || player.status === 'out') &&
        slotLimits.ir > 0 &&
        next.ir.length < slotLimits.ir
      ) {
        next.ir.push({ ...player, slot: 'ir' })
        continue
      }
      if (slotLimits.bench > 0 && next.bench.length < slotLimits.bench) {
        next.bench.push({ ...player, slot: 'bench' })
        continue
      }
      if (slotLimits.taxi > 0 && next.taxi.length < slotLimits.taxi) {
        next.taxi.push({ ...player, slot: 'taxi' })
        continue
      }
      if (slotLimits.devy > 0 && next.devy.length < slotLimits.devy) {
        next.devy.push({ ...player, slot: 'devy' })
        continue
      }
      overflowUnassigned += 1
    }

    if (overflowUnassigned > 0) {
      setSaveError(
        `${overflowUnassigned} player(s) could not be assigned because all enabled sections are full.`
      )
    } else {
      setSaveError(null)
    }
    setRoster(next)
    void autoSave(next)
  }, [roster, slotLimits, starterAllowedPositions, autoSave, canEditLineup])

  const reload = useCallback(async () => {
    await Promise.all([loadRoster(), loadAvailablePlayers()])
  }, [loadRoster, loadAvailablePlayers])

  return {
    roster,
    rosterId,
    leagueSport,
    slotLimits,
    starterAllowedPositions,
    availablePlayers,
    poolLoading,
    saving,
    saveError,
    lastSavedAt,
    lineupLock,
    canEditLineup,
    movePlayer,
    swapPlayers,
    dropPlayer,
    addPlayer,
    addPlayerFromPool,
    optimizeLineup,
    reload,
  }
}

