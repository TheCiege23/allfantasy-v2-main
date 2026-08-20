"use client"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowUp, Bot, Check, ChevronLeft, ClipboardList, Copy, Loader2, PlayCircle, Plus, RefreshCw, Settings, Share2, Sparkles, Trophy, Users } from "lucide-react"
import { toast } from "sonner"
import type { WorldCupAiBuilderProgress, WorldCupAiStrategy, WorldCupChallengeView, WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import { isWorldCupChallengeLocked } from "@/lib/world-cup/worldCupBracketBuilder"
import type {
  WorldCupBracketEntryClient,
  WorldCupChallengeIntegrityReport,
  WorldCupAdminSyncProvider,
  WorldCupAdminSyncTeamsResult,
  WorldCupAdminSyncFixturesResult,
  WorldCupAdminSyncLiveResult,
  WorldCupAdminSimulationStrategy,
} from "@/lib/world-cup/worldCupClientApi"
import {
  adminLoadWorldCupTestFixtures,
  adminResetWorldCupSimulation,
  adminSimulateWorldCupMatch,
  adminSimulateWorldCupRound,
  adminSimulateWorldCupTournament,
  adminSyncWorldCupFixtures,
  adminSyncWorldCupLive,
  adminSyncWorldCupTeams,
  clearWorldCupBracketEntryPicks,
  createWorldCupBracketEntry,
  deleteWorldCupBracketEntry,
  getWorldCupIntegrityReport,
  getWorldCupBracketEntry,
  listWorldCupBracketEntries,
  renameWorldCupBracketEntry,
  saveWorldCupBracketEntryPick,
} from "@/lib/world-cup/worldCupClientApi"
import {
  assertWorldCupPickPayloadReady,
  countRemainingPicks,
  findWorldCupPickForMatch,
  findFirstUnpickedMatch,
  getWorldCupPickMatchMethod,
  getWorldCupGuidedPicksState,
  getInvalidDownstreamPickIds,
  getWorldCupUnpickableReason,
  hasWorldCupPickSelection,
  isWorldCupMatchPickable,
  worldCupPickMatchesMatch,
} from "@/lib/world-cup/worldCupProjectedBracket"
import {
  buildWorldCupProjectedMatches,
  getOrderedRounds,
} from "@/lib/world-cup/worldCupProjectedBracket"
import { calculateWorldCupBracketHealth, getWorldCupPickRecommendation } from "@/lib/world-cup/worldCupAiInsights"
import WorldCupBracketBoard from "./WorldCupBracketBoard"
import WorldCupBracketHealthCard from "./WorldCupBracketHealthCard"
import WorldCupEntryDashboard from "./WorldCupEntryDashboard"
import type { GuidedPickPayload } from "./WorldCupGuidedMatchupPicker"
import WorldCupGuidedMatchupPicker from "./WorldCupGuidedMatchupPicker"
import WorldCupInvitePanel from "./WorldCupInvitePanel"
import WorldCupRoundBreakdown from "./WorldCupRoundBreakdown"
import WorldCupScoreSummary from "./WorldCupScoreSummary"
import WorldCupLeaderboard from "./WorldCupLeaderboard"
import WorldCupLeaderboardInsights from "./WorldCupLeaderboardInsights"
import WorldCupLiveScoreTicker from "./WorldCupLiveScoreTicker"
import WorldCupBracketSettingsPanel from "./WorldCupBracketSettingsPanel"
import WorldCupCommissionerBrainPanel from "./WorldCupCommissionerBrainPanel"
type Tab = "home" | "picks" | "leaderboard" | "rules" | "invite" | "settings" | "commissioner"
const BASE_TABS: Array<{ id: Tab; label: string; icon: typeof ClipboardList }> = [
  { id: "home", label: "Home", icon: Trophy },
  { id: "picks", label: "My Brackets", icon: ClipboardList },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "rules", label: "Rules", icon: Users },
  { id: "invite", label: "Invite", icon: Share2 },
]

const DEFAULT_WORLD_CUP_VIEW_SCORING = {
  roundOf32Points: 10,
  roundOf16Points: 20,
  quarterFinalPoints: 40,
  semiFinalPoints: 80,
  finalPoints: 160,
  championBonusPoints: 320,
  thirdPlacePoints: 4,
}

function normalizeWorldCupView(input: WorldCupChallengeView | (Partial<WorldCupChallengeView> & { id?: string; name?: string }) | undefined): WorldCupChallengeView {
  const raw = input as any
  const challengeRaw = raw?.challenge ?? raw ?? {}
  if (raw?.challenge) {
    const v = raw as Partial<WorldCupChallengeView>
    return {
      ...v,
      challenge: {
        id: challengeRaw?.id ?? "",
        name: challengeRaw?.name ?? "World Cup Bracket",
        ownerUserId: challengeRaw?.ownerUserId ?? "",
        seasonYear: challengeRaw?.seasonYear ?? 2026,
        inviteCode: challengeRaw?.inviteCode ?? "",
        inviteUrl: challengeRaw?.inviteUrl ?? null,
        visibility: challengeRaw?.visibility ?? "private",
        pickLockStrategy: challengeRaw?.pickLockStrategy ?? "tournament_start",
        pickLockAt: challengeRaw?.pickLockAt ?? null,
        maxParticipants: challengeRaw?.maxParticipants ?? 100,
        maxEntriesPerParticipant: challengeRaw?.maxEntriesPerParticipant ?? 5,
        effectivePickLockAt: challengeRaw?.effectivePickLockAt ?? null,
        status: challengeRaw?.status ?? "open",
        includeThirdPlace: Boolean(challengeRaw?.includeThirdPlace),
        isTestMode: Boolean(challengeRaw?.isTestMode),
        simulationEnabled: Boolean(challengeRaw?.simulationEnabled),
        simulatedAt: challengeRaw?.simulatedAt ?? null,
        simulationStatus: challengeRaw?.simulationStatus ?? null,
        hasSimulatedResults: Boolean(challengeRaw?.hasSimulatedResults),
        lastSyncedAt: challengeRaw?.lastSyncedAt ?? null,
        createdAt: challengeRaw?.createdAt ?? new Date().toISOString(),
        updatedAt: challengeRaw?.updatedAt ?? new Date().toISOString(),
      },
      scoring: v.scoring ?? DEFAULT_WORLD_CUP_VIEW_SCORING,
      slots: v.slots ?? [],
      matches: v.matches ?? [],
      participant: v.participant ?? null,
      activeEntry: v.activeEntry ?? null,
      entries: v.entries ?? [],
      picks: v.picks ?? [],
      leaderboard: v.leaderboard ?? [],
      isOwner: Boolean(v.isOwner),
      isAdmin: Boolean(v.isAdmin),
      hasBracketBrainAi: Boolean(v.hasBracketBrainAi),
    }
  }
  return {
    challenge: {
      id: challengeRaw?.id ?? "",
      name: challengeRaw?.name ?? "World Cup Bracket",
      ownerUserId: challengeRaw?.ownerUserId ?? "",
      seasonYear: challengeRaw?.seasonYear ?? 2026,
      inviteCode: challengeRaw?.inviteCode ?? "",
      inviteUrl: challengeRaw?.inviteUrl ?? null,
      visibility: challengeRaw?.visibility ?? "private",
      pickLockStrategy: challengeRaw?.pickLockStrategy ?? "tournament_start",
      pickLockAt: challengeRaw?.pickLockAt ?? null,
      maxParticipants: challengeRaw?.maxParticipants ?? 100,
      maxEntriesPerParticipant: challengeRaw?.maxEntriesPerParticipant ?? 5,
      effectivePickLockAt: challengeRaw?.effectivePickLockAt ?? null,
      status: challengeRaw?.status ?? "open",
      includeThirdPlace: Boolean(challengeRaw?.includeThirdPlace),
      isTestMode: Boolean(challengeRaw?.isTestMode),
      simulationEnabled: Boolean(challengeRaw?.simulationEnabled),
      simulatedAt: challengeRaw?.simulatedAt ?? null,
      simulationStatus: challengeRaw?.simulationStatus ?? null,
      hasSimulatedResults: Boolean(challengeRaw?.hasSimulatedResults),
      lastSyncedAt: challengeRaw?.lastSyncedAt ?? null,
      createdAt: challengeRaw?.createdAt ?? new Date().toISOString(),
      updatedAt: challengeRaw?.updatedAt ?? new Date().toISOString(),
    },
    scoring: raw?.scoring ?? DEFAULT_WORLD_CUP_VIEW_SCORING,
    slots: raw?.slots ?? [],
    matches: raw?.matches ?? [],
    participant: raw?.participant ?? null,
    activeEntry: raw?.activeEntry ?? null,
    entries: raw?.entries ?? [],
    picks: raw?.picks ?? [],
    leaderboard: raw?.leaderboard ?? [],
    isOwner: Boolean(raw?.isOwner),
    isAdmin: Boolean(raw?.isAdmin),
    hasBracketBrainAi: Boolean(raw?.hasBracketBrainAi),
  }
}

function getSelectedEntryStorageKey(challengeId: string): string {
  return `world-cup:selected-entry:${challengeId}`
}

function mergeEntryScoresFromView(
  currentEntries: WorldCupBracketEntryClient[],
  nextView: WorldCupChallengeView
): WorldCupBracketEntryClient[] {
  if (currentEntries.length === 0) return currentEntries
  const summaries = new Map(nextView.entries.map((entry) => [entry.id, entry]))
  const leaderboard = new Map(nextView.leaderboard.map((row) => [row.entryId, row]))

  return currentEntries.map((entry) => {
    const summary = summaries.get(entry.id)
    const row = leaderboard.get(entry.id)
    if (!summary && !row) return entry

    return {
      ...entry,
      name: summary?.name ?? entry.name,
      totalScore: row?.totalScore ?? summary?.totalScore ?? entry.totalScore,
      maxPossibleScore: row?.maxPossibleScore ?? entry.maxPossibleScore,
      correctPicks: row?.correctPicks ?? entry.correctPicks,
      incorrectPicks: row?.incorrectPicks ?? entry.incorrectPicks,
      rank: row?.rank ?? summary?.rank ?? entry.rank,
      roundBreakdown: row?.roundBreakdown ?? entry.roundBreakdown,
      championTeamId: row?.championTeamId ?? entry.championTeamId,
      championTeamName: row?.championPickName ?? entry.championTeamName,
      isComplete: summary?.isComplete ?? entry.isComplete,
      updatedAt: row?.updatedAt ?? entry.updatedAt,
    }
  })
}

function entryClientsFromInitialView(view: WorldCupChallengeView): WorldCupBracketEntryClient[] {
  const leaderboardByEntry = new Map(view.leaderboard.map((row) => [row.entryId, row]))
  return view.entries.map((entry) => {
    const leaderboard = leaderboardByEntry.get(entry.id)
    return {
      id: entry.id,
      challengeId: view.challenge.id,
      participantId: leaderboard?.participantId ?? view.participant?.id ?? "",
      userId: leaderboard?.userId ?? view.participant?.userId ?? "",
      name: entry.name,
      championTeamId: leaderboard?.championTeamId ?? null,
      championTeamName: leaderboard?.championPickName ?? null,
      totalScore: leaderboard?.totalScore ?? entry.totalScore ?? 0,
      maxPossibleScore: leaderboard?.maxPossibleScore ?? 0,
      correctPicks: leaderboard?.correctPicks ?? 0,
      incorrectPicks: leaderboard?.incorrectPicks ?? 0,
      rank: leaderboard?.rank ?? entry.rank ?? null,
      roundBreakdown: leaderboard?.roundBreakdown ?? {},
      isComplete: entry.isComplete,
      isLocked: false,
      submittedAt: null,
      createdAt: entry.createdAt,
      updatedAt: leaderboard?.updatedAt ?? entry.createdAt,
    }
  })
}

function mergeWorldCupChallengeView(
  currentView: WorldCupChallengeView,
  nextView: WorldCupChallengeView
): WorldCupChallengeView {
  const sameChallenge =
    !nextView.challenge.id ||
    !currentView.challenge.id ||
    nextView.challenge.id === currentView.challenge.id

  if (!sameChallenge) return nextView

  const keepCurrentMatches =
    currentView.matches.length > 0 && nextView.matches.length === 0
  const keepCurrentSlots =
    currentView.slots.length > 0 && nextView.slots.length === 0

  return {
    ...currentView,
    ...nextView,
    challenge: {
      ...currentView.challenge,
      ...nextView.challenge,
      id: nextView.challenge.id || currentView.challenge.id,
    },
    scoring: nextView.scoring ?? currentView.scoring,
    slots: keepCurrentSlots ? currentView.slots : nextView.slots,
    matches: keepCurrentMatches ? currentView.matches : nextView.matches,
    entries: nextView.entries.length > 0 ? nextView.entries : currentView.entries,
    leaderboard: nextView.leaderboard.length > 0 ? nextView.leaderboard : currentView.leaderboard,
    participant: nextView.participant ?? currentView.participant,
    activeEntry: nextView.activeEntry ?? currentView.activeEntry,
    picks: nextView.picks,
  }
}

export default function WorldCupBracketShell({
  initialView,
  challenge,
  defaultTab = "picks",
  initialGuidedOpen = false,
  initialEntryId = null,
}: {
  initialView?: WorldCupChallengeView
  challenge?: WorldCupChallengeView | any
  defaultTab?: Tab
  /** From `?guided=1` after join — opens guided picker once picks are loaded */
  initialGuidedOpen?: boolean
  /** From `?entry=` — selects bracket entry after join */
  initialEntryId?: string | null
}) {
  const router = useRouter()
  const normalizedInitialView = normalizeWorldCupView(initialView ?? challenge)
  const initialEntries = entryClientsFromInitialView(normalizedInitialView)
  const shouldAutoSelectInitialEntry = defaultTab === "picks" || Boolean(initialEntryId) || initialGuidedOpen
  const initialSelectedEntryId =
    shouldAutoSelectInitialEntry
      ? initialEntryId && initialEntries.some((entry) => entry.id === initialEntryId)
        ? initialEntryId
        : normalizedInitialView.activeEntry?.id &&
            initialEntries.some((entry) => entry.id === normalizedInitialView.activeEntry?.id)
          ? normalizedInitialView.activeEntry.id
          : initialEntries[0]?.id ?? null
      : null
  const [view, setView] = useState(normalizedInitialView)
  const [tab, setTab] = useState<Tab>(() => {
    if (
      (defaultTab === "commissioner" || defaultTab === "settings") &&
      !normalizedInitialView.isOwner &&
      !normalizedInitialView.isAdmin
    ) {
      return "picks"
    }
    return defaultTab
  })
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "locked">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [lockNow, setLockNow] = useState(() => new Date())

  // ── Entry state ──────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<WorldCupBracketEntryClient[]>(initialEntries)
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [isCreatingEntry, setIsCreatingEntry] = useState(false)
  const [isMutatingEntry, setIsMutatingEntry] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(initialSelectedEntryId)

  // Picks per-entry: keyed by entryId → array of picks
  const [entryPicks, setEntryPicks] = useState<Record<string, WorldCupPickView[]>>(() => {
    if (
      initialSelectedEntryId &&
      normalizedInitialView.activeEntry?.id === initialSelectedEntryId &&
      normalizedInitialView.picks.length > 0
    ) {
      return { [initialSelectedEntryId]: normalizedInitialView.picks }
    }
    return {}
  })
  const [loadedEntryPickIds, setLoadedEntryPickIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedEntryId &&
          normalizedInitialView.activeEntry?.id === initialSelectedEntryId &&
          normalizedInitialView.picks.length > 0
          ? [initialSelectedEntryId]
          : []
      )
  )

  // ── Guided picker state ──────────────────────────────────────────────────
  const [isGuidedPickerOpen, setIsGuidedPickerOpen] = useState(false)
  const [guidedInitialMatchId, setGuidedInitialMatchId] = useState<string | null>(null)

  // ── AI builder state ─────────────────────────────────────────────────────
  const [aiBuilder, setAiBuilder] = useState<WorldCupAiBuilderProgress>({
    state: "idle", current: 0, total: 0, message: "",
  })
  const [integrityReport, setIntegrityReport] = useState<WorldCupChallengeIntegrityReport | null>(null)
  const [isIntegrityLoading, setIsIntegrityLoading] = useState(false)

  // ── Admin sync state ────────────────────────────────────────────────────
  const [syncProvider, setSyncProvider] = useState<WorldCupAdminSyncProvider>("mock")
  const [syncDryRun, setSyncDryRun] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncTeamsResult, setSyncTeamsResult] = useState<WorldCupAdminSyncTeamsResult | null>(null)
  const [syncFixturesResult, setSyncFixturesResult] = useState<WorldCupAdminSyncFixturesResult | null>(null)
  const [syncLiveResult, setSyncLiveResult] = useState<WorldCupAdminSyncLiveResult | null>(null)
  const [simulationStrategy, setSimulationStrategy] = useState<WorldCupAdminSimulationStrategy>("random")
  const [simulationDryRun, setSimulationDryRun] = useState(false)
  const [simulationMatchId, setSimulationMatchId] = useState<string>("")
  const [simulationResult, setSimulationResult] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [isSavingSimulationMode, setIsSavingSimulationMode] = useState(false)
  const [isLoadingTestFixtures, setIsLoadingTestFixtures] = useState(false)
  const aiBuildAbortRef = useRef(false)
  const pageScrollRef = useRef<HTMLDivElement | null>(null)
  const guidedAutoOpenedRef = useRef(false)
  const latestViewRef = useRef(normalizedInitialView)

  const challengeId = view.challenge.id

  const showCommissionerTab = Boolean(view.isOwner || view.isAdmin)
  const tabList = useMemo(() => {
    const list = [...BASE_TABS]
    if (showCommissionerTab) {
      list.push({
        id: "settings",
        label: "Settings",
        icon: Settings,
      })
      list.push({
        id: "commissioner",
        label: "Commissioner",
        icon: Sparkles,
      })
    }
    return list
  }, [showCommissionerTab])

  useEffect(() => {
    latestViewRef.current = view
  }, [view])

  const applyChallengeView = useCallback((nextView: WorldCupChallengeView) => {
    const mergedView = mergeWorldCupChallengeView(latestViewRef.current, nextView)
    latestViewRef.current = mergedView
    setView(mergedView)
    setEntries((prev) => mergeEntryScoresFromView(prev, mergedView))
  }, [])

  const persistSelectedEntryId = useCallback(
    (entryId: string | null) => {
      if (typeof window === "undefined") return
      const key = getSelectedEntryStorageKey(challengeId)
      if (entryId) {
        window.localStorage.setItem(key, entryId)
      } else {
        window.localStorage.removeItem(key)
      }
    },
    [challengeId]
  )

  const markEntryPicksLoaded = useCallback((entryId: string, nextPicks: WorldCupPickView[]) => {
    setEntryPicks((prev) => ({ ...prev, [entryId]: nextPicks }))
    setLoadedEntryPickIds((prev) => {
      const next = new Set(prev)
      next.add(entryId)
      return next
    })
  }, [])

  const refreshChallengeView = useCallback(async () => {
    const latest = await fetch(`/api/brackets/world-cup/${challengeId}`)
    if (!latest.ok) return
    const data = await latest.json()
    const nextView = normalizeWorldCupView(data.view ?? data.challenge ?? data)
    applyChallengeView(nextView)
    try {
      const refreshedEntries = await listWorldCupBracketEntries(challengeId)
      setEntries(refreshedEntries)
    } catch {
      // The challenge view still carries leaderboard totals; entry-list refresh is best effort.
    }
  }, [applyChallengeView, challengeId])
  // Selected entry object
  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? null,
    [entries, selectedEntryId]
  )

  const lockState = useMemo(
    () =>
      isWorldCupChallengeLocked({
        challenge: view.challenge,
        matches: view.matches,
        entry: selectedEntry,
        now: lockNow,
      }),
    [lockNow, selectedEntry, view.challenge, view.matches]
  )
  const isLocked = lockState.locked
  useEffect(() => {
    if (lockState.locked || !lockState.lockAt) return
    const lockAt = new Date(lockState.lockAt)
    if (Number.isNaN(lockAt.getTime())) return
    const delay = lockAt.getTime() - Date.now()
    if (delay <= 0) {
      setLockNow(new Date())
      return
    }
    const timer = window.setTimeout(
      () => setLockNow(new Date()),
      Math.min(delay + 100, 2_147_483_647)
    )
    return () => window.clearTimeout(timer)
  }, [lockState.lockAt, lockState.locked])

  /** Keep lock countdown label fresh on phones while picks stay open */
  useEffect(() => {
    if (isLocked) return
    const id = window.setInterval(() => setLockNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [isLocked])

  const lockCountdownLabel = useMemo(() => {
    if (isLocked) return null
    if (!lockState.lockAt) return null
    const ms = new Date(lockState.lockAt).getTime() - lockNow.getTime()
    if (ms <= 0) return "Bracket locks soon"
    const totalM = Math.floor(ms / 60000)
    const d = Math.floor(totalM / 1440)
    const h = Math.floor((totalM % 1440) / 60)
    const m = totalM % 60
    if (d > 0) return `${d}d ${h}h until picks lock`
    if (h > 0) return `${h}h ${m}m until picks lock`
    return `${Math.max(1, m)}m until picks lock`
  }, [isLocked, lockState.lockAt, lockNow])
  // Picks for the selected entry.
  const picks: WorldCupPickView[] = useMemo(() => {
    if (!selectedEntryId) return []
    return entryPicks[selectedEntryId] ?? []
  }, [selectedEntryId, entryPicks])

  const completedPickCount = useMemo(
    () => picks.filter(hasWorldCupPickSelection).length,
    [picks]
  )
  const projectedMatches = useMemo(
    () => buildWorldCupProjectedMatches(view.matches, picks),
    [view.matches, picks]
  )
  const pickableMatches = useMemo(
    () => projectedMatches.filter(isWorldCupMatchPickable),
    [projectedMatches]
  )
  const rawPickableMatches = useMemo(
    () => view.matches.filter(isWorldCupMatchPickable),
    [view.matches]
  )
  const progress = useMemo(
    () => {
      const required = pickableMatches.filter(
        (match) =>
          (match.round !== "third_place" || view.challenge.includeThirdPlace) &&
          isWorldCupMatchPickable(match)
      )
      return {
        done: required.filter((match) => Boolean(findWorldCupPickForMatch(picks, match))).length,
        required: required.length,
      }
    },
    [pickableMatches, picks, view.challenge.includeThirdPlace]
  )
  const projectedPickableMatchCount = pickableMatches.length
  const guidedPicksState = useMemo(
    () => getWorldCupGuidedPicksState(view.matches),
    [view.matches]
  )
  const hasPickableFixtures = projectedPickableMatchCount > 0
  const unresolvedMatchesCount = view.matches.length - rawPickableMatches.length

  const selectedLeaderboardRow = useMemo(
    () => view.leaderboard.find((r) => r.entryId === selectedEntry?.id) ?? null,
    [view.leaderboard, selectedEntry?.id]
  )

  const championStillAliveForSummary = useMemo(() => {
    if (!selectedEntry) return true
    if (selectedLeaderboardRow) return selectedLeaderboardRow.championStillAlive
    return calculateWorldCupBracketHealth(
      {
        championTeamId: selectedEntry.championTeamId,
        totalScore: selectedEntry.totalScore,
        maxPossibleScore: selectedEntry.maxPossibleScore,
      },
      view.matches,
      picks
    ).championAlive
  }, [selectedEntry, selectedLeaderboardRow, view.matches, picks])

  // ── Load entries on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!challengeId || entriesLoaded) return
    setIsEntriesLoading(true)
    listWorldCupBracketEntries(challengeId)
      .then((rows) => {
        setEntries(rows)
        setEntriesLoaded(true)
        // Seed initial view picks only when they belong to the exact active entry,
        // then hydrate the selected entry from the entry-detail API below.
        if (rows.length > 0) {
          if (!shouldAutoSelectInitialEntry) {
            setSelectedEntryId(null)
            persistSelectedEntryId(null)
            return
          }
          const storedEntryId =
            typeof window !== "undefined"
              ? window.localStorage.getItem(getSelectedEntryStorageKey(challengeId))
              : null
          const urlEntryId =
            initialEntryId && rows.some((row) => row.id === initialEntryId) ? initialEntryId : null
          const activeEntryId =
            urlEntryId ??
            (storedEntryId && rows.some((row) => row.id === storedEntryId)
              ? storedEntryId
              : normalizedInitialView.activeEntry?.id ?? rows[0].id)
          const active = rows.find((row) => row.id === activeEntryId) ?? rows[0]
          setSelectedEntryId(active.id)
          persistSelectedEntryId(active.id)
          if (
            normalizedInitialView.activeEntry?.id === active.id &&
            normalizedInitialView.picks.length > 0
          ) {
            setEntryPicks((prev) => ({ ...prev, [active.id]: normalizedInitialView.picks }))
          }
        }
      })
      .catch(() => toast.error("Failed to load bracket entries"))
      .finally(() => setIsEntriesLoading(false))
  }, [challengeId, persistSelectedEntryId, initialEntryId, normalizedInitialView.activeEntry?.id, shouldAutoSelectInitialEntry])

  // ── Entry management callbacks ───────────────────────────────────────────
  const handleCreateEntry = useCallback(async () => {
    setIsCreatingEntry(true)
    try {
      const entry = await createWorldCupBracketEntry(challengeId)
      setEntries((prev) => [...prev, entry])
      markEntryPicksLoaded(entry.id, [])
      setSelectedEntryId(entry.id)
      persistSelectedEntryId(entry.id)
      setTab("picks")
      toast.success(`Created "${entry.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bracket")
    } finally {
      setIsCreatingEntry(false)
    }
  }, [challengeId, markEntryPicksLoaded, persistSelectedEntryId])

  const handleSelectEntry = useCallback((entryId: string) => {
    setSelectedEntryId(entryId)
    persistSelectedEntryId(entryId)
    setTab("picks")
  }, [persistSelectedEntryId])

  useEffect(() => {
    if (!selectedEntryId) return
    if (loadedEntryPickIds.has(selectedEntryId)) return

    let cancelled = false
    getWorldCupBracketEntry(challengeId, selectedEntryId)
      .then((detail) => {
        if (cancelled) return
        const detailPicks = Array.isArray(detail?.picks)
          ? (detail.picks as WorldCupPickView[])
          : []
        markEntryPicksLoaded(selectedEntryId, detailPicks)
      })
      .catch(() => {
        if (!cancelled) {
          setEntryPicks((prev) =>
            Object.prototype.hasOwnProperty.call(prev, selectedEntryId)
              ? prev
              : { ...prev, [selectedEntryId]: [] }
          )
          toast.error("Failed to load picks for this bracket")
        }
      })

    return () => {
      cancelled = true
    }
  }, [challengeId, loadedEntryPickIds, markEntryPicksLoaded, selectedEntryId])

  const handleRenameEntry = useCallback(
    async (entryId: string, name: string) => {
      setIsMutatingEntry(true)
      try {
        const updated = await renameWorldCupBracketEntry(challengeId, entryId, name)
        setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, name: updated.name } : e)))
        toast.success(`Renamed to "${updated.name}"`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to rename")
      } finally {
        setIsMutatingEntry(false)
      }
    },
    [challengeId]
  )

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      setIsMutatingEntry(true)
      try {
        await deleteWorldCupBracketEntry(challengeId, entryId)
        const nextEntries = entries.filter((e) => e.id !== entryId)
        setEntries(nextEntries)
        if (selectedEntryId === entryId) {
          const nextSelectedEntryId = nextEntries[0]?.id ?? null
          setSelectedEntryId(nextSelectedEntryId)
          persistSelectedEntryId(nextSelectedEntryId)
        }
        setEntryPicks((prev) => {
          const next = { ...prev }
          delete next[entryId]
          return next
        })
        setLoadedEntryPickIds((prev) => {
          const next = new Set(prev)
          next.delete(entryId)
          return next
        })
        toast.success("Bracket deleted")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete bracket")
      } finally {
        setIsMutatingEntry(false)
      }
    },
    [challengeId, entries, persistSelectedEntryId, selectedEntryId]
  )

  // ── Pick saving ──────────────────────────────────────────────────────────
  async function persistPick(match: WorldCupMatchView, side: "home" | "away") {
    if (!selectedEntryId) {
      toast.error("Select a bracket entry first")
      return
    }
    if (isLocked) {
      setSaveState("locked")
      setSaveError("Bracket is locked.")
      toast.error("Bracket is locked.")
      return
    }
    const currentPicks = entryPicks[selectedEntryId] ?? []
    const selectedTeamId = side === "home" ? match.homeTeamId : match.awayTeamId
    const selectedSlotKey = side === "home" ? match.homeSlotKey : match.awaySlotKey
    const selectedTeamName = side === "home" ? match.homeTeamName : match.awayTeamName
    const reason = getWorldCupUnpickableReason(match)
    const sideIsPickable =
      side === "home"
        ? Boolean(match.homeTeamId && match.homeTeamName)
        : Boolean(match.awayTeamId && match.awayTeamName)
    if (!isWorldCupMatchPickable(match) || !sideIsPickable || !selectedTeamId) {
      setSaveState("error")
      setSaveError(`This matchup is not ready for picks yet (${reason}).`)
      toast.error("This matchup is not ready for picks yet. Sync fixtures or use simulation data.")
      return
    }
    const invalidIds = getInvalidDownstreamPickIds(
      view.matches,
      currentPicks,
      match.id,
      selectedTeamId
    )
    const invalidMatchIds = invalidIds
      .map((id) => currentPicks.find((p) => p.id === id)?.matchId)
      .filter((mid): mid is string => mid !== undefined)
      .filter((mid) => mid !== match.id)
    const existingPick = findWorldCupPickForMatch(currentPicks, match)
    const nextMatchNumber = projectedMatches.find((projected) => projected.id === match.nextMatchId)?.matchNumber ?? null
    if (process.env.NODE_ENV === "development") {
      console.debug("[WorldCupBracketShell:save-pick]", {
        activeEntryId: selectedEntryId,
        matchId: match.id,
        round: match.round,
        matchNumber: match.matchNumber,
        selectedTeamId,
        selectedSlotKey,
        nextMatchNumber,
        existingPickMatchedBy: existingPick ? getWorldCupPickMatchMethod(existingPick, match) : null,
        downstreamPicksCleared: invalidMatchIds,
      })
      if ([29, 30, 31].includes(match.matchNumber)) {
        console.debug("[WorldCupBracketShell:save-pick:knockout-debug]", {
          activeEntryId: selectedEntryId,
          round: match.round,
          matchNumber: match.matchNumber,
          payload: {
            matchId: match.id,
            selectedTeamId,
            selectedSlotKey,
            selectedTeamName,
            matchNumber: match.matchNumber,
          },
          downstreamPicksCleared: invalidMatchIds,
        })
      }
    }

    // Optimistic update
    const optimistic: WorldCupPickView = {
      id: `optimistic-${match.id}`,
      matchId: match.id,
      round: match.round,
      selectedTeamId,
      selectedSlotKey,
      selectedTeamName,
      pointsAwarded: 0,
      isCorrect: null,
      lockedAt: null,
    }
    setEntryPicks((prev) => ({
      ...prev,
      [selectedEntryId]: [
        ...(prev[selectedEntryId] ?? []).filter((p) => !worldCupPickMatchesMatch(p, match) && !invalidIds.includes(p.id)),
        optimistic,
      ],
    }))
    setSaveState("saving")
    setSaveError(null)

    try {
      if (invalidMatchIds.length > 0) {
        await clearWorldCupBracketEntryPicks(challengeId, selectedEntryId, invalidMatchIds)
      }

      const result = await saveWorldCupBracketEntryPick(challengeId, selectedEntryId, {
        activeEntryId: selectedEntryId,
        matchId: match.id,
        selectedTeamId,
        selectedTeamName,
        selectedSlotKey,
        selectedSide: side,
        round: match.round,
        sourceSlotKey: selectedSlotKey,
        nextMatchId: match.nextMatchId,
        nextMatchSlot: match.nextMatchSlot,
        matchNumber: match.matchNumber,
      })

      // Keep the base challenge matches from the full view; never replace them
      // with the entry-only pick response.
      if (result.view) {
        applyChallengeView(normalizeWorldCupView(result.view))
      } else {
        const latest = await fetch(`/api/brackets/world-cup/${challengeId}`)
        if (latest.ok) {
          const data = await latest.json()
          const nextView = normalizeWorldCupView(data.view ?? data.challenge ?? data)
          applyChallengeView(nextView)
        }
      }

      // Update entry in local list if returned
      if (result.entry) {
        setEntries((prev) =>
          prev.map((e) => (e.id === selectedEntryId ? (result.entry as WorldCupBracketEntryClient) : e))
        )
      }

      // Replace optimistic picks with actual picks from response
      const returnedPicks = Array.isArray(result.picks)
        ? (result.picks as WorldCupPickView[])
        : currentPicks
      markEntryPicksLoaded(selectedEntryId, returnedPicks)

      if (process.env.NODE_ENV === "development" && [29, 30, 31].includes(match.matchNumber)) {
        const saved = findWorldCupPickForMatch(returnedPicks, match)
        console.debug("[WorldCupBracketShell:save-pick:knockout-return]", {
          activeEntryId: selectedEntryId,
          round: match.round,
          matchNumber: match.matchNumber,
          returnedPickCount: returnedPicks.length,
          matchedBy: saved ? getWorldCupPickMatchMethod(saved, match) : null,
          savedPickId: saved?.id ?? null,
        })
      }

      setSaveState("saved")
      if (invalidMatchIds.length > 0) {
        toast.success(`Updated pick and cleared ${invalidMatchIds.length} downstream pick${invalidMatchIds.length === 1 ? "" : "s"}.`)
      } else {
        toast.success("Updated pick")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save"
      if (msg.toLowerCase().includes("locked")) {
        setSaveState("locked")
        setSaveError("Bracket is locked.")
        // Roll back optimistic pick
        setEntryPicks((prev) => ({
          ...prev,
          [selectedEntryId]: (prev[selectedEntryId] ?? []).filter(
            (p) => p.id !== optimistic.id
          ),
        }))
      } else {
        setSaveState("error")
        setSaveError(msg)
        // Roll back optimistic pick
        setEntryPicks((prev) => ({
          ...prev,
          [selectedEntryId]: (prev[selectedEntryId] ?? []).filter(
            (p) => p.id !== optimistic.id
          ),
        }))
      }
    }
  }

  function runOwnerAction(action: "sync" | "recalculate") {
    startTransition(async () => {
      const res =
        action === "sync"
          ? await fetch("/api/brackets/world-cup/sync", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ challengeId }),
            })
          : await fetch(`/api/brackets/world-cup/${challengeId}/recalculate`, {
            method: "POST",
          })
      if (res.ok) {
        await refreshChallengeView()
      }
    })
  }

  const runIntegrityCheck = useCallback(async () => {
    setIsIntegrityLoading(true)
    try {
      const report = await getWorldCupIntegrityReport(challengeId)
      setIntegrityReport(report)
      if (report.ok) {
        toast.success("Integrity check passed")
      } else {
        toast.error(`Integrity check found ${report.errors.length} error(s)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Integrity check failed")
    } finally {
      setIsIntegrityLoading(false)
    }
  }, [challengeId])

  const runSyncTeams = useCallback(async () => {
    setIsSyncing(true)
    setSyncTeamsResult(null)
    try {
      const result = await adminSyncWorldCupTeams({ provider: syncProvider, dryRun: syncDryRun })
      setSyncTeamsResult(result)
      toast.success(
        syncDryRun
          ? `Dry run: ${result.created + result.updated} team(s) would be synced`
          : `Synced ${result.created} created, ${result.updated} updated`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync teams failed")
    } finally {
      setIsSyncing(false)
    }
  }, [challengeId, syncProvider, syncDryRun])

  const runSyncFixtures = useCallback(async () => {
    setIsSyncing(true)
    setSyncFixturesResult(null)
    try {
      const result = await adminSyncWorldCupFixtures(challengeId, { provider: syncProvider, dryRun: syncDryRun })
      setSyncFixturesResult(result)
      toast.success(
        syncDryRun
          ? `Dry run: ${result.updated} fixture(s) would be updated`
          : `Fixtures synced: ${result.updated} updated`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync fixtures failed")
    } finally {
      setIsSyncing(false)
    }
  }, [challengeId, syncProvider, syncDryRun])

  const runSyncLive = useCallback(async () => {
    setIsSyncing(true)
    setSyncLiveResult(null)
    try {
      const result = await adminSyncWorldCupLive(challengeId, {
        provider: syncProvider,
        dryRun: syncDryRun,
        recalculate: true,
      })
      setSyncLiveResult(result)
      if (!syncDryRun) {
        await refreshChallengeView()
      }
      toast.success(
        syncDryRun
          ? `Dry run: ${result.updated} live score(s) would be updated`
          : `Live scores synced: ${result.updated} updated${result.recalculated ? ", leaderboard recalculated" : ""}`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync live failed")
    } finally {
      setIsSyncing(false)
    }
  }, [challengeId, refreshChallengeView, syncProvider, syncDryRun])

  const saveSimulationMode = useCallback(
    async (patch: { isTestMode?: boolean; simulationEnabled?: boolean }) => {
      setIsSavingSimulationMode(true)
      try {
        const res = await fetch(`/api/brackets/world-cup/${challengeId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error((body as { error?: string }).error ?? "Failed to update simulation mode")
        }
        await refreshChallengeView()
      } finally {
        setIsSavingSimulationMode(false)
      }
    },
    [challengeId, refreshChallengeView]
  )

  const runSimulateMatch = useCallback(async () => {
    if (!simulationMatchId) {
      toast.error("Select a match to simulate")
      return
    }

    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminSimulateWorldCupMatch(challengeId, {
        matchId: simulationMatchId,
        dryRun: simulationDryRun,
        status: "final",
      })
      const advanced = response.result.advancedMatchIds.length
      setSimulationResult(
        simulationDryRun
          ? `Dry run: simulated 1 match${advanced > 0 ? `, would advance ${advanced} next match slot(s)` : ""}`
          : `Simulated 1 match${advanced > 0 ? ` and advanced ${advanced} next match slot(s)` : ""}`
      )
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Dry run complete" : "Match simulated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Simulate match failed")
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun, simulationMatchId, simulationStrategy])

  const runSimulateRound = useCallback(async () => {
    const nextRound =
      view.matches.find((m) => m.status !== "final" && m.homeTeamName && m.awayTeamName)?.round ?? "round_of_32"
    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminSimulateWorldCupRound(challengeId, {
        round: nextRound,
        strategy: simulationStrategy,
        dryRun: simulationDryRun,
      })
      setSimulationResult(
        simulationDryRun
          ? `Dry run: ${response.result.simulatedMatches} match(es) in ${nextRound} would be simulated`
          : `Simulated ${response.result.simulatedMatches} match(es) in ${nextRound}`
      )
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Round dry run complete" : "Round simulated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Simulate round failed")
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun, simulationStrategy, view.matches])

  const runSimulateTournament = useCallback(async () => {
    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminSimulateWorldCupTournament(challengeId, {
        strategy: simulationStrategy,
        dryRun: simulationDryRun,
      })
      setSimulationResult(
        simulationDryRun
          ? `Dry run: ${response.result.rounds.reduce((sum, r) => sum + r.simulatedMatches, 0)} matches would be simulated`
          : `Tournament simulated. Champion: ${response.result.champion.winnerTeamName ?? "TBD"}`
      )
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Tournament dry run complete" : "Tournament simulated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Simulate tournament failed")
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun, simulationStrategy])

  const runResetSimulation = useCallback(async () => {
    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminResetWorldCupSimulation(challengeId, {
        dryRun: simulationDryRun,
      })
      setSimulationResult(
        simulationDryRun
          ? `Dry run: ${response.result.resetMatches} matches would be reset`
          : `Reset ${response.result.resetMatches} matches to scheduled state`
      )
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Reset dry run complete" : "Simulation reset")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset simulation failed")
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun])

  const handleLoadTestFixtures = useCallback(async () => {
    const confirmed = window.confirm(
      "Seed demo teams into Round of 32 matches? This will populate 16 first-round matches with test teams so picks can be tested.\n\nExisting picks will not be deleted."
    )
    if (!confirmed) return

    setIsLoadingTestFixtures(true)
    try {
      const response = await adminLoadWorldCupTestFixtures(challengeId, {
        dryRun: simulationDryRun,
      })
      const data = response.result
      const modeLabel = simulationDryRun ? "Dry run" : "Test fixtures seeded"
      const msg = `${modeLabel}: ${data.matchesUpdated} matches updated, ${data.pickableMatchesAfter} pickable, ${data.unresolvedMatchesAfter} unresolved`
      setSimulationResult(msg)
      if (!simulationDryRun) {
        if (response.view) {
          applyChallengeView(normalizeWorldCupView(response.view))
          try {
            const refreshedEntries = await listWorldCupBracketEntries(challengeId)
            setEntries(refreshedEntries)
          } catch {
            // The refreshed challenge view is enough to update fixture readiness.
          }
        } else {
          await refreshChallengeView()
        }
      }
      toast.success(simulationDryRun ? "Seed Test Fixtures dry run complete" : "Test fixtures seeded successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to seed test fixtures")
    } finally {
      setIsLoadingTestFixtures(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun])

  const saveStatus =
    isLocked ? "Bracket Locked"
    : saveState === "saving" ? "Saving..."
    : saveState === "saved" ? "Saved ✓"
    : saveState === "locked" ? "Pick locked"
    : saveState === "error" ? "Save failed"
    : selectedEntry ? `${selectedEntry.name}`
    : "World Cup 2026"

  // Remaining picks for selected entry
  const remainingPicks = useMemo(
    () =>
      selectedEntry
        ? countRemainingPicks(
            pickableMatches,
            picks,
            view.challenge.includeThirdPlace
          )
        : 0,
    [selectedEntry, pickableMatches, view.challenge.includeThirdPlace, picks]
  )
  const firstUnpickedMatchId = useMemo(
    () =>
      findFirstUnpickedMatch(
        pickableMatches,
        picks,
        getOrderedRounds(pickableMatches, view.challenge.includeThirdPlace)
      )?.id ?? null,
    [pickableMatches, picks, view.challenge.includeThirdPlace]
  )
  const computedIsComplete =
    projectedPickableMatchCount > 0 &&
    completedPickCount > 0 &&
    remainingPicks === 0
  const guidedPickerAvailable =
    !isLocked && projectedPickableMatchCount > 0 && (remainingPicks > 0 || computedIsComplete)
  const guidedPickerLabel =
    isLocked
      ? "Bracket Locked"
      : projectedPickableMatchCount === 0
        ? "Fixtures Not Ready"
        : completedPickCount === 0
          ? "Start Making Picks"
          : remainingPicks > 0
            ? "Continue Guided Picks"
            : "Review Guided Picks"
  const showSeedTestFixturesCta =
    !isLocked &&
    (view.isOwner || view.isAdmin) &&
    (guidedPicksState === "fixtures_not_synced" || guidedPicksState === "fixtures_not_ready")

  const participantCount = view.leaderboard.length > 0
    ? new Set(view.leaderboard.map((row) => row.userId)).size
    : view.participant
      ? 1
      : 0
  const inviteUrl = view.challenge.inviteUrl ||
    (view.challenge.inviteCode
      ? `/join/bracket/${view.challenge.inviteCode}`
      : "")
  const fixturesReadyLabel =
    guidedPicksState === "ready"
      ? `${projectedPickableMatchCount} pickable matchup${projectedPickableMatchCount === 1 ? "" : "s"} ready`
      : guidedPicksState === "fixtures_not_synced"
        ? "Fixtures have not been synced yet"
        : "Fixtures loaded, but teams are still placeholders"

  async function copyPoolInvite() {
    if (!inviteUrl) return
    const absoluteUrl =
      inviteUrl.startsWith("http") || typeof window === "undefined"
        ? inviteUrl
        : `${window.location.origin}${inviteUrl}`
    await navigator.clipboard?.writeText(absoluteUrl)
    toast.success("Invite link copied")
  }

  useEffect(() => {
    if (!initialGuidedOpen || guidedAutoOpenedRef.current) return
    if (!selectedEntryId || !entriesLoaded) return
    if (!loadedEntryPickIds.has(selectedEntryId)) return
    const picksForEntry = entryPicks[selectedEntryId] ?? []
    if (picksForEntry.length > 0) return
    if (!guidedPickerAvailable) return

    guidedAutoOpenedRef.current = true
    setGuidedInitialMatchId(null)
    setIsGuidedPickerOpen(true)

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.delete("guided")
      url.searchParams.delete("entry")
      router.replace(url.pathname + (url.search ? url.search : ""))
    }
  }, [
    initialGuidedOpen,
    selectedEntryId,
    entriesLoaded,
    loadedEntryPickIds,
    entryPicks,
    guidedPickerAvailable,
    router,
  ])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    const tournamentStartAt =
      view.challenge.effectivePickLockAt ??
      view.matches
        .map((match) => match.startsAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ??
      null

    console.debug("[WorldCupBracketShell:debug]", {
      activeEntryId: selectedEntryId,
      "activeEntry.picks.length": picks.length,
      completedPickCount,
      projectedPickableMatchCount,
      remainingPickCount: remainingPicks,
      isComplete: computedIsComplete,
      entryIsCompleteFlag: selectedEntry?.isComplete ?? null,
      firstUnpickedMatchId,
      bracketLocked: isLocked,
      lockAt: view.challenge.pickLockAt,
      tournamentStartAt,
    })
  }, [
    completedPickCount,
    computedIsComplete,
    firstUnpickedMatchId,
    isLocked,
    picks.length,
    projectedPickableMatchCount,
    remainingPicks,
    selectedEntryId,
    selectedEntry?.isComplete,
    view.challenge.effectivePickLockAt,
    view.challenge.pickLockAt,
    view.matches,
  ])

  // ── Guided picker save handler ───────────────────────────────────────────
  const handleGuidedSavePick = useCallback(
    async (
      payload: GuidedPickPayload,
      currentPicks: WorldCupPickView[],
      options?: { suppressToast?: boolean }
    ): Promise<WorldCupPickView[]> => {
      if (!selectedEntryId) throw new Error("No entry selected")
      if (isLocked) throw new Error("Bracket is locked.")
      if (payload.activeEntryId !== selectedEntryId) {
        throw new Error("This pick belongs to a different bracket entry")
      }
      assertWorldCupPickPayloadReady(payload)

      // Clear invalid downstream picks before saving the new one
      const invalidIds = getInvalidDownstreamPickIds(
        view.matches,
        currentPicks,
        payload.matchId,
        payload.selectedTeamId
      )
      const invalidMatchIds = invalidIds
        .map((id) => currentPicks.find((p) => p.id === id)?.matchId)
        .filter((mid): mid is string => mid !== undefined)
        .filter((mid) => mid !== payload.matchId)
      const projectedForSave = buildWorldCupProjectedMatches(view.matches, currentPicks)
      const payloadMatch =
        projectedForSave.find((match) => match.id === payload.matchId) ??
        projectedForSave.find(
          (match) => match.round === payload.round && match.matchNumber === payload.matchNumber
        )
      const nextMatchNumber = projectedForSave.find((match) => match.id === payload.nextMatchId)?.matchNumber ?? null
      const existingPick = payloadMatch ? findWorldCupPickForMatch(currentPicks, payloadMatch) : null
      if (process.env.NODE_ENV === "development") {
        console.debug("[WorldCupBracketShell:guided-save-pick]", {
          activeEntryId: selectedEntryId,
          matchId: payload.matchId,
          round: payload.round,
          matchNumber: payload.matchNumber,
          selectedTeamId: payload.selectedTeamId,
          selectedSlotKey: payload.selectedSlotKey,
          nextMatchNumber,
          existingPickMatchedBy: payloadMatch && existingPick ? getWorldCupPickMatchMethod(existingPick, payloadMatch) : null,
          downstreamPicksCleared: invalidMatchIds,
        })
      }

      if (invalidMatchIds.length > 0) {
        await clearWorldCupBracketEntryPicks(
          challengeId,
          selectedEntryId,
          invalidMatchIds
        )
      }

      // Save the actual pick
      const result = await saveWorldCupBracketEntryPick(challengeId, selectedEntryId, {
        activeEntryId: selectedEntryId,
        matchId: payload.matchId,
        selectedTeamId: payload.selectedTeamId,
        selectedTeamName: payload.selectedTeamName ?? undefined,
        selectedSlotKey: payload.selectedSlotKey,
        selectedSide: payload.selectedSide,
        round: payload.round,
        sourceSlotKey: payload.sourceSlotKey,
        nextMatchId: payload.nextMatchId,
        nextMatchSlot: payload.nextMatchSlot,
        matchNumber: payload.matchNumber,
      })

      const returnedPicks = Array.isArray(result.picks)
        ? (result.picks as WorldCupPickView[])
        : currentPicks

      // Update shell entry picks state
      markEntryPicksLoaded(selectedEntryId, returnedPicks)

      // Update entry metadata
      if (result.entry) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === selectedEntryId
              ? (result.entry as WorldCupBracketEntryClient)
              : e
          )
        )
      }

      // Refresh view for leaderboard without ever replacing the base match list
      // with an entry-only save response.
      if (result.view) {
        applyChallengeView(normalizeWorldCupView(result.view))
      } else {
        fetch(`/api/brackets/world-cup/${challengeId}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data) {
              const nextView = normalizeWorldCupView(data.view ?? data.challenge ?? data)
              applyChallengeView(nextView)
            }
          })
          .catch(() => null)
      }

      if (!options?.suppressToast) {
        const cleared = invalidMatchIds.length
        if (cleared > 0) {
          toast.success(`Updated pick and cleared ${cleared} downstream pick${cleared === 1 ? "" : "s"}.`)
        } else {
          toast.success("Updated pick")
        }
      }

      return returnedPicks
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyChallengeView, challengeId, isLocked, markEntryPicksLoaded, selectedEntryId, view.matches]
  )

    // ── AI bracket builder ───────────────────────────────────────────────────
    const handleAiBuild = useCallback(
      async (strategy: WorldCupAiStrategy) => {
        if (!selectedEntryId) return
        if (isLocked) { toast.error("Bracket is locked"); return }
        if (!window.confirm(`Fill all unpicked matches using the "${strategy}" strategy? Existing picks will not be overwritten.`)) return

        const currentPicks = entryPicks[selectedEntryId] ?? []
        const projected = buildWorldCupProjectedMatches(view.matches, currentPicks)
        const orderedRounds = getOrderedRounds(view.matches, false)

        // Collect unpicked, available (both teams known) matches in order
        const unpicked = orderedRounds.flatMap((round) =>
          projected.filter(
            (m) =>
              m.round === round &&
              m.status !== "final" &&
              m.homeTeamId &&
              m.awayTeamId &&
              !findWorldCupPickForMatch(currentPicks, m)
          )
        )

        if (unpicked.length === 0) {
          toast.info("No picks to fill — all available matches already have picks.")
          return
        }

        aiBuildAbortRef.current = false
        setAiBuilder({ state: "running", current: 0, total: unpicked.length, message: "Building…" })

        let livePicks = [...currentPicks]

        for (let i = 0; i < unpicked.length; i++) {
          if (aiBuildAbortRef.current) break
          const match = unpicked[i]
          const rec = getWorldCupPickRecommendation(match, strategy)

          setAiBuilder((p) => ({
            ...p,
            current: i,
            message: `Picking ${match.round.replace(/_/g, " ")} (${i + 1}/${unpicked.length})…`,
          }))

          const payload: GuidedPickPayload = {
            activeEntryId: selectedEntryId,
            matchId: match.id,
            selectedTeamId: rec.recommendedTeamId,
            selectedTeamName: rec.recommendedTeamName,
            selectedSlotKey: rec.recommendedSide === "home" ? match.homeSlotKey : match.awaySlotKey,
            selectedSide: rec.recommendedSide ?? "home",
            round: match.round,
            sourceSlotKey: rec.recommendedSide === "home" ? match.homeSlotKey : match.awaySlotKey,
            nextMatchId: match.nextMatchId,
            nextMatchSlot: match.nextMatchSlot,
            matchNumber: match.matchNumber,
          }

          try {
            livePicks = await handleGuidedSavePick(payload, livePicks, { suppressToast: true })
          } catch {
            setAiBuilder({ state: "error", current: i, total: unpicked.length, message: `Failed at pick ${i + 1}` })
            toast.error("AI builder stopped — error saving a pick")
            return
          }
        }

        setAiBuilder({ state: "done", current: unpicked.length, total: unpicked.length, message: "Done!" })
        toast.success(`AI filled ${unpicked.length} pick${unpicked.length !== 1 ? "s" : ""} using ${strategy} strategy.`)
        setTimeout(() => setAiBuilder({ state: "idle", current: 0, total: 0, message: "" }), 3000)
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [selectedEntryId, isLocked, entryPicks, view.matches, handleGuidedSavePick]
    )

  // Whether to show the full picks board or the entry dashboard
  const showBoard = tab === "picks" && selectedEntry !== null

  const scrollToAnchor = useCallback(
    (anchorId: string, nextTab?: Tab) => {
      const tabChanged = Boolean(nextTab && tab !== nextTab)
      if (nextTab && tab !== nextTab) {
        setTab(nextTab)
      }

      window.requestAnimationFrame(() => {
        window.setTimeout(
          () => {
            const anchor = document.getElementById(anchorId)
            if (!anchor) return
            anchor.scrollIntoView({ behavior: "smooth", block: "start" })
          },
          tabChanged ? 70 : 0
        )
      })
    },
    [tab]
  )

  return (
    <div id="world-cup-top" className="fixed inset-0 z-50 flex flex-col bg-[#05070b] text-white">
      <header className="shrink-0 border-b border-white/10 bg-zinc-950/95 backdrop-blur pt-[env(safe-area-inset-top,0px)]">
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5 sm:py-3">
          {showBoard ? (
            <button
              type="button"
              onClick={() => {
                setSelectedEntryId(null)
                persistSelectedEntryId(null)
              }}
              className="min-h-11 min-w-11 shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/70 touch-manipulation"
              title="Back to My Brackets"
              aria-label="Back to My Brackets"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link
              href="/brackets"
              className="min-h-11 min-w-11 shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/70 touch-manipulation"
              aria-label="Back to brackets hub"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-black leading-tight text-white sm:text-lg">
              {showBoard ? selectedEntry!.name : view.challenge.name}
            </h1>
            <p className={`text-[10px] sm:text-[11px] ${saveState === "locked" || saveState === "error" ? "text-rose-300" : "text-white/45"}`}>
              {showBoard ? (
                <>
                  <span className="block truncate text-white/55">{view.challenge.name}</span>
                  <span className="mt-0.5 block">
                    {progress.done} of {progress.required} picks · {saveStatus}
                  </span>
                </>
              ) : (
                <span className="line-clamp-2">{view.challenge.name}</span>
              )}
            </p>
            {lockCountdownLabel ? (
              <p
                data-testid="world-cup-lock-countdown"
                className="mt-1 inline-flex max-w-full items-center rounded-md bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-100/95"
              >
                {lockCountdownLabel}
              </p>
            ) : null}
          </div>
          {/* Entry switcher dropdown — visible when in board mode and multiple entries */}
          {showBoard && entries.length > 1 && (
            <select
              data-testid="world-cup-entry-switcher"
              value={selectedEntryId ?? ""}
              onChange={(e) => handleSelectEntry(e.target.value)}
              className="hidden rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white/80 sm:block"
            >
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {view.isOwner || view.isAdmin ? (
            <button
              type="button"
              onClick={() => runOwnerAction("sync")}
              disabled={isPending}
              className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/[0.08] sm:inline-flex"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              Sync
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("invite")}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-black touch-manipulation sm:min-h-0 sm:min-w-0"
            aria-label="Invite friends"
          >
            <Share2 className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Invite</span>
          </button>
        </div>
        {saveError && (
          <div className="mx-3 mb-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
            {saveError}
          </div>
        )}
        {(view.challenge.isTestMode || view.challenge.simulationEnabled || view.challenge.hasSimulatedResults) && (
          <div className="mx-3 mb-2 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            TEST MODE: results are simulated and can change leaderboard standings.
          </div>
        )}
        <WorldCupLiveScoreTicker matches={view.matches} />
        <nav
          aria-label="Section tabs"
          className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:px-5 sm:pb-3 [&::-webkit-scrollbar]:hidden"
        >
          {tabList.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold touch-manipulation ${tab === id ? "bg-white text-black" : "bg-white/[0.04] text-white/55"}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div ref={pageScrollRef} className="flex-1 overflow-y-auto scroll-smooth">
        <nav
          data-testid="world-cup-sticky-subnav"
          className="sticky top-0 z-40 border-b border-white/10 bg-[#04060acc]/95 px-2 py-2 backdrop-blur sm:px-4"
        >
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:justify-center sm:pb-0 touch-pan-x">
            <JumpButton label="Top" onClick={() => scrollToAnchor("world-cup-top")} />
            <JumpButton label="Picks" onClick={() => scrollToAnchor("world-cup-picks", "picks")} />
            <JumpButton label="Bracket" onClick={() => scrollToAnchor("world-cup-bracket", "picks")} />
            <JumpButton label="Admin/Test" disabled={!(view.isOwner || view.isAdmin)} onClick={() => scrollToAnchor("world-cup-admin", "picks")} />
            <JumpButton label="Leaderboard" onClick={() => scrollToAnchor("world-cup-leaderboard", "leaderboard")} />
            <JumpButton label="Invite" onClick={() => scrollToAnchor("world-cup-invite", "invite")} />
          </div>
        </nav>

        {tab === "picks" && showBoard ? (
          <div className="sticky top-0 z-30 border-b border-white/10 bg-[#05070b]/92 px-3 py-2 backdrop-blur sm:hidden">
            <button
              data-testid="world-cup-mobile-start-picks-cta"
              type="button"
              disabled={!guidedPickerAvailable}
              onClick={() => {
                if (!guidedPickerAvailable) {
                  toast.info("This matchup is not ready for picks yet. Sync fixtures or use simulation data.")
                  return
                }
                setGuidedInitialMatchId(null)
                setIsGuidedPickerOpen(true)
              }}
              className="flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-black touch-manipulation disabled:bg-cyan-300/40 disabled:text-black/50"
            >
              <PlayCircle className="h-5 w-5 shrink-0" aria-hidden />
              {guidedPickerLabel}
            </button>
          </div>
        ) : null}

        {/* Entry header strip — shown when a bracket is open in picks tab */}
        {showBoard && (
        <div id="world-cup-picks" className="border-b border-white/[0.07] bg-white/[0.03] pb-2">
          <WorldCupScoreSummary
            entry={selectedEntry!}
            leaderboardRow={selectedLeaderboardRow}
            championStillAlive={championStillAliveForSummary}
            isLocked={isLocked}
            fixturesReady={hasPickableFixtures}
            scoresSynced={Boolean(view.challenge.lastSyncedAt)}
          />
          <WorldCupRoundBreakdown
            roundBreakdown={
              selectedLeaderboardRow?.roundBreakdown ?? selectedEntry!.roundBreakdown ?? {}
            }
            scoring={view.scoring}
            includeThirdPlace={view.challenge.includeThirdPlace}
          />
          {/* Guided picks button */}
          {!isLocked ? (
            <div className="flex justify-center px-4 py-2">
              <button
                type="button"
                disabled={!guidedPickerAvailable}
                onClick={() => {
                  if (!guidedPickerAvailable) {
                    toast.info("This matchup is not ready for picks yet. Sync fixtures or use simulation data.")
                    return
                  }
                  setGuidedInitialMatchId(null)
                  setIsGuidedPickerOpen(true)
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-cyan-300/45"
              >
                <PlayCircle className="h-4 w-4" />
                {guidedPickerLabel}
              </button>
            </div>
          ) : (
            <div className="flex justify-center px-4 py-2">
              <span className="rounded-lg border border-rose-400/30 bg-rose-400/15 px-3 py-2 text-xs font-bold text-rose-100">Bracket Locked</span>
            </div>
          )}

          {!isLocked && guidedPicksState === "fixtures_not_synced" && (
            <div className="px-4 pb-3 text-center text-[11px] text-white/50">
              <p>Picks open after World Cup fixtures are synced or test fixtures are seeded for this pool.</p>
              {showSeedTestFixturesCta && (
                <div className="mt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadTestFixtures()}
                    disabled={isLoadingTestFixtures || isSimulating}
                    className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-4 py-2 text-[12px] font-bold text-amber-100 hover:bg-amber-900/60 disabled:opacity-50"
                  >
                    {isLoadingTestFixtures ? "Seeding..." : "Seed Test Fixtures"}
                  </button>
                </div>
              )}
            </div>
          )}

          {!isLocked && guidedPicksState === "fixtures_not_ready" && (
            <div className="mx-4 mb-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              <p className="mb-2 text-center">
                Fixtures are loaded, but team matchups are not resolved yet. Run Sync Fixtures or use simulation/test data before making picks.
              </p>
              {showSeedTestFixturesCta && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadTestFixtures()}
                    disabled={isLoadingTestFixtures || isSimulating}
                    className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-4 py-2 text-[12px] font-bold text-amber-100 hover:bg-amber-900/60 disabled:opacity-50"
                  >
                    {isLoadingTestFixtures ? "Seeding..." : "Seed Test Fixtures"}
                  </button>
                </div>
              )}
            </div>
          )}

          {(view.isOwner || view.isAdmin) && (
            <div className="mx-4 mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] text-white/55">
              Debug counts: total matches {view.matches.length} · pickable matches {pickableMatches.length} · unresolved matches {Math.max(unresolvedMatchesCount, 0)}
            </div>
          )}

          {!isLocked && selectedEntry && (
            <div className="mx-3 mb-4 max-h-[min(280px,45vh)] overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:mx-4 sm:max-h-none sm:overflow-visible">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-cyan-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                AI Bracket Builder
              </div>
              <p className="mb-2 text-[10px] text-white/35 sm:hidden">
                Optional — scroll on small screens; guided picks above are the primary flow.
              </p>
              <div className="flex flex-wrap gap-2">
                {([
                  ["safe", "Safe"],
                  ["balanced", "Balanced"],
                  ["upset", "Upset"],
                  ["chaos", "Chaos"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void handleAiBuild(value)}
                    disabled={aiBuilder.state === "running"}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {aiBuilder.state !== "idle" && (
                <div className="mt-2 rounded-lg bg-black/30 px-2.5 py-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                    <span>{aiBuilder.message}</span>
                    <span>{aiBuilder.current}/{aiBuilder.total}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${aiBuilder.state === "error" ? "bg-red-400" : "bg-cyan-300"}`}
                      style={{ width: `${aiBuilder.total > 0 ? Math.round((aiBuilder.current / aiBuilder.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedEntry && (
            <WorldCupBracketHealthCard
              entry={selectedEntry}
              matches={view.matches}
              picks={picks}
            />
          )}

          {(view.isOwner || view.isAdmin) && (
            <>
            <div id="world-cup-admin" className="mx-4 mb-2 h-0" aria-hidden="true" />
            <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-white/60">Admin Integrity</div>
                <button
                  type="button"
                  onClick={() => void runIntegrityCheck()}
                  disabled={isIntegrityLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-60"
                >
                  {isIntegrityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Run Integrity Check
                </button>
              </div>
              {integrityReport ? (
                <div className="space-y-2 text-[11px]">
                  <div className="text-white/70">
                    {integrityReport.ok ? "No blocking integrity issues detected." : `${integrityReport.errors.length} error(s), ${integrityReport.warnings.length} warning(s)`}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-white/55 sm:grid-cols-4">
                    <span>Participants: {integrityReport.stats.participants}</span>
                    <span>Brackets: {integrityReport.stats.entries}</span>
                    <span>Matches: {integrityReport.stats.matches}</span>
                    <span>Picks: {integrityReport.stats.picks}</span>
                  </div>
                  {integrityReport.errors.slice(0, 3).map((err) => (
                    <p key={err} className="text-rose-300">✗ {err}</p>
                  ))}
                  {integrityReport.warnings.slice(0, 3).map((warn) => (
                    <p key={warn} className="text-amber-300">⚠ {warn}</p>
                  ))}
                </div>
              ) : null}

              {/* Launch checklist */}
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/45">Launch Checklist</div>
                <div className="space-y-1.5">
                  {[
                    {
                      label: "Integrity check passed",
                      ok: integrityReport?.ok ?? null,
                      hint: integrityReport ? undefined : "Run integrity check above",
                    },
                    {
                      label: "Fixtures synced",
                      ok: view.matches.length > 0 ? true : false,
                      hint: view.matches.length === 0 ? "No matches loaded — run Sync" : undefined,
                    },
                    {
                      label: "Teams/flags loaded",
                      ok: view.matches.some((m) => m.homeTeamId && m.awayTeamId) ? true : null,
                      hint: "At least one match has team IDs set",
                    },
                    {
                      label: "Lock time set",
                      ok: !!(view.challenge.pickLockAt || view.challenge.effectivePickLockAt),
                      hint: !view.challenge.pickLockAt && !view.challenge.effectivePickLockAt
                        ? "No lock time — set one or rely on per-match locking"
                        : undefined,
                    },
                    {
                      label: "Scoring profile active",
                      ok: view.scoring.roundOf32Points > 0,
                    },
                    {
                      label: "Invite link active",
                      ok: !!(view.challenge.inviteCode || view.challenge.inviteUrl),
                      hint: !view.challenge.inviteCode ? "No invite code found" : undefined,
                    },
                    {
                      label: "Leaderboard recalculation available",
                      ok: true,
                    },
                    {
                      label: "AI previews available",
                      ok: view.matches.some((m) => m.homeTeamId && m.awayTeamId) ? true : null,
                      hint: "Requires team IDs on matches",
                    },
                  ].map(({ label, ok, hint }) => (
                    <div key={label} className="flex items-start gap-2 text-[11px]">
                      <span
                        className={`mt-0.5 shrink-0 ${
                          ok === true
                            ? "text-emerald-400"
                            : ok === false
                            ? "text-rose-400"
                            : "text-white/30"
                        }`}
                      >
                        {ok === true ? "✓" : ok === false ? "✗" : "○"}
                      </span>
                      <div>
                        <span
                          className={
                            ok === true
                              ? "text-white/70"
                              : ok === false
                              ? "text-rose-300"
                              : "text-white/40"
                          }
                        >
                          {label}
                        </span>
                        {hint && (
                          <span className="ml-1 text-[10px] text-white/30">— {hint}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-4 mb-4 rounded-xl border border-amber-300/20 bg-amber-500/[0.06] p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-200">
                Simulation / Test Mode
              </div>
              <p className="mb-3 text-[11px] text-amber-100/80">
                Testing only. Simulated results can change scores and leaderboard standings.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLoadTestFixtures()}
                  disabled={isLoadingTestFixtures || isSimulating}
                  title="Adds demo teams to unresolved Round of 32 matches so picks and simulation can be tested before real World Cup fixtures are synced."
                  className="rounded-lg border border-amber-400/50 bg-amber-900/30 px-3 py-1.5 text-[11px] font-bold text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
                >
                  {isLoadingTestFixtures ? "Seeding..." : "Seed Test Fixtures"}
                </button>
              </div>
              <p className="mb-3 text-[11px] text-amber-100/80">
                Adds demo teams to unresolved Round of 32 matches so picks and simulation can be tested before real World Cup fixtures are synced.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-white/70">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={view.challenge.isTestMode}
                    onChange={(e) => void saveSimulationMode({ isTestMode: e.target.checked })}
                    disabled={isSavingSimulationMode || isSimulating}
                    className="h-3.5 w-3.5 accent-amber-300"
                  />
                  Test mode
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={view.challenge.simulationEnabled}
                    onChange={(e) => void saveSimulationMode({ simulationEnabled: e.target.checked })}
                    disabled={isSavingSimulationMode || isSimulating}
                    className="h-3.5 w-3.5 accent-amber-300"
                  />
                  Simulation enabled
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={simulationDryRun}
                    onChange={(e) => setSimulationDryRun(e.target.checked)}
                    disabled={isSimulating}
                    className="h-3.5 w-3.5 accent-amber-300"
                  />
                  Dry run
                </label>
                <select
                  value={simulationStrategy}
                  onChange={(e) => setSimulationStrategy(e.target.value as WorldCupAdminSimulationStrategy)}
                  disabled={isSimulating}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white/80"
                >
                  <option value="random">Random</option>
                  <option value="higher_seed">Higher seed</option>
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                </select>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={simulationMatchId}
                  onChange={(e) => setSimulationMatchId(e.target.value)}
                  disabled={isSimulating}
                  className="min-w-[220px] rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white/80"
                >
                  <option value="">Select match for manual simulation</option>
                  {view.matches.map((match) => (
                    <option key={match.id} value={match.id}>
                      M{match.matchNumber} · {match.homeTeamName} vs {match.awayTeamName}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void runSimulateMatch()}
                  disabled={isSimulating || !simulationMatchId}
                  className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
                >
                  Simulate Match
                </button>
                <button
                  type="button"
                  onClick={() => void runSimulateRound()}
                  disabled={isSimulating}
                  className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
                >
                  Simulate Round
                </button>
                <button
                  type="button"
                  onClick={() => void runSimulateTournament()}
                  disabled={isSimulating}
                  className="rounded-lg border border-cyan-400/30 bg-cyan-900/30 px-3 py-1.5 text-[11px] font-bold text-cyan-100 disabled:opacity-50"
                >
                  Simulate Full Tournament
                </button>
                <button
                  type="button"
                  onClick={() => void runResetSimulation()}
                  disabled={isSimulating}
                  className="rounded-lg border border-rose-400/30 bg-rose-900/20 px-3 py-1.5 text-[11px] font-bold text-rose-100 disabled:opacity-50"
                >
                  Reset Simulation
                </button>
              </div>

              {simulationResult && <p className="text-[11px] text-white/70">{simulationResult}</p>}
            </div>

            {/* Data sync controls */}
            <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/60">
                Data Sync
              </div>

              {/* Provider + dry-run row */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  value={syncProvider}
                  onChange={(e) => setSyncProvider(e.target.value as WorldCupAdminSyncProvider)}
                  disabled={isSyncing}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white/80 disabled:opacity-50"
                >
                  <option value="mock">Mock / Manual</option>
                  <option value="apifootball">API-Football</option>
                  <option value="sportsdata">SportsData.io</option>
                </select>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/60">
                  <input
                    type="checkbox"
                    checked={syncDryRun}
                    onChange={(e) => setSyncDryRun(e.target.checked)}
                    disabled={isSyncing}
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  Dry run
                </label>
              </div>

              {/* Sync buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runSyncTeams()}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  Sync Teams
                </button>
                <button
                  type="button"
                  onClick={() => void runSyncFixtures()}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync Fixtures
                </button>
                <button
                  type="button"
                  onClick={() => void runSyncLive()}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-cyan-900/30 px-3 py-1.5 text-[11px] font-bold text-cyan-200 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                  Sync Live Scores
                </button>
              </div>

              {/* Sync results */}
              {syncTeamsResult && (
                <SyncResultRow
                  label="Teams"
                  result={syncTeamsResult}
                />
              )}
              {syncFixturesResult && (
                <SyncResultRow
                  label="Fixtures"
                  result={syncFixturesResult}
                  extra={
                    syncFixturesResult.lockTimeInferred
                      ? `Lock inferred: ${new Date(syncFixturesResult.lockTimeInferred).toLocaleString()}`
                      : undefined
                  }
                />
              )}
              {syncLiveResult && (
                <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11px]">
                  <div className="flex flex-wrap gap-3 text-white/60">
                    <span>Live <span className="font-bold text-white/80">{syncLiveResult.updated}</span></span>
                    <span>Final <span className="font-bold text-white/80">{syncLiveResult.finalMatches}</span></span>
                    <span>Recalc <span className="font-bold text-white/80">{syncLiveResult.recalculated ? "yes" : "no"}</span></span>
                    {syncLiveResult.dryRun && <span className="text-amber-300">dry run</span>}
                  </div>
                  {syncLiveResult.warnings.slice(0, 2).map((w) => (
                    <p key={w} className="mt-1 text-amber-300">{w}</p>
                  ))}
                  <p className="mt-1 text-white/30">{new Date(syncLiveResult.syncedAt).toLocaleTimeString()}</p>
                </div>
              )}
            </div>
            </>
          )}
        </div>
      )}

      <main className="min-h-0 px-2 pb-24 pt-3 sm:px-4 sm:pb-8">
        {tab === "home" ? (
          <div className="mx-auto max-w-5xl space-y-4 px-2 pb-28 sm:pb-8">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200/70">
                    World Cup Pool Dashboard
                  </p>
                  <h2 className="mt-1 truncate text-2xl font-black text-white">
                    {view.challenge.name}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
                    Manage invites, brackets, leaderboard, and fixture readiness before opening a personal bracket.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyPoolInvite}
                    disabled={!inviteUrl}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 disabled:opacity-40"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Invite
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("invite")}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-bold text-white/75"
                  >
                    <Share2 className="h-4 w-4" />
                    Invite Panel
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PoolStatCard label="Participants" value={`${participantCount}/${view.challenge.maxParticipants}`} />
                <PoolStatCard label="My Brackets" value={`${entries.length}/${view.challenge.maxEntriesPerParticipant}`} />
                <PoolStatCard label="Leaderboard Brackets" value={String(view.leaderboard.length)} />
                <PoolStatCard label="Fixture Status" value={guidedPicksState === "ready" ? "Ready" : "Not Ready"} tone={guidedPicksState === "ready" ? "ready" : "warn"} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-white">My Brackets</h3>
                    <p className="mt-1 text-xs text-white/45">
                      Create or open your personal bracket when you are ready to make picks.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateEntry}
                    disabled={isLocked || isCreatingEntry || entries.length >= view.challenge.maxEntriesPerParticipant}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isCreatingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {isCreatingEntry ? "Creating..." : "Create My Bracket"}
                  </button>
                </div>

                {isEntriesLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/45">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading entries...
                  </div>
                ) : entries.length > 0 ? (
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => handleSelectEntry(entry.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left hover:bg-white/[0.06]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-white">{entry.name}</div>
                          <div className="mt-1 text-xs text-white/45">
                            {entry.isComplete ? "Complete" : "Not complete"} · {entry.totalScore} pts · {entry.rank ? `Rank #${entry.rank}` : "Unranked"}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-black text-black">
                          Open Bracket
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
                    <Trophy className="mx-auto h-8 w-8 text-cyan-200/50" />
                    <p className="mt-3 text-sm font-black text-white">No brackets created yet</p>
                    <p className="mt-1 text-xs text-white/45">
                      Create your personal bracket first, then you can make picks once fixtures are ready.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <h3 className="text-base font-black text-white">Fixture Readiness</h3>
                  <p className="mt-1 text-sm text-white/55">{fixturesReadyLabel}</p>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/50">
                    {guidedPicksState === "ready" ? (
                      <p>Round of 32 matchups have teams and can be picked. Test fixtures are marked as test data when used.</p>
                    ) : (
                      <p>
                        Picks stay blocked while matchups are placeholders like Group Winner or Winner Match. Sync official fixtures when available, or seed test fixtures for local QA.
                      </p>
                    )}
                  </div>
                  {(view.isOwner || view.isAdmin) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {showSeedTestFixturesCta ? (
                        <button
                          type="button"
                          onClick={() => void handleLoadTestFixtures()}
                          disabled={isLoadingTestFixtures || isSimulating}
                          className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/60 disabled:opacity-50"
                        >
                          {isLoadingTestFixtures ? "Seeding..." : "Seed Test Fixtures"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void runSyncFixtures()}
                        disabled={isSyncing}
                        className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/75 disabled:opacity-50"
                      >
                        {isSyncing ? "Syncing..." : "Sync Fixtures"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("settings")}
                        className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/75"
                      >
                        Commissioner Settings
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <h3 className="text-base font-black text-white">Leaderboard Preview</h3>
                  {view.leaderboard.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {view.leaderboard.slice(0, 5).map((row) => (
                        <div key={row.entryId} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs">
                          <span className="min-w-0 truncate text-white/70">#{row.rank} {row.entryName}</span>
                          <span className="font-black text-cyan-100">{row.totalScore} pts</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/40">
                      No scored brackets yet. Brackets appear here after users create them and scoring begins.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setTab("leaderboard")}
                    className="mt-3 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70"
                  >
                    Open Full Leaderboard
                  </button>
                </div>

                <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
                  <h3 className="text-base font-black text-cyan-100">AI Simulation Preview</h3>
                  <p className="mt-1 text-xs leading-5 text-cyan-100/70">
                    AI previews unlock after fixture teams are available. Commissioner simulation tools are gated to test/simulation mode and never represent official production results.
                  </p>
                  {(view.isOwner || view.isAdmin) ? (
                    <button
                      type="button"
                      onClick={() => setTab("commissioner")}
                      className="mt-3 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100"
                    >
                      Open Commissioner AI Tools
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {tab === "picks" ? (
          selectedEntry ? (
            <section id="world-cup-bracket" className="space-y-3">
              <div className="sticky top-[3.35rem] z-30 rounded-xl border border-white/10 bg-zinc-950/95 p-2 backdrop-blur sm:top-[3.6rem]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!isLocked ? (
                    <button
                      type="button"
                      disabled={!guidedPickerAvailable}
                      onClick={() => {
                        if (!guidedPickerAvailable) {
                          toast.info("This matchup is not ready for picks yet. Sync fixtures or use simulation data.")
                          return
                        }
                        setGuidedInitialMatchId(null)
                        setIsGuidedPickerOpen(true)
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-cyan-300/45"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {guidedPickerLabel}
                    </button>
                  ) : (
                    <span className="rounded-lg border border-rose-400/30 bg-rose-400/15 px-3 py-2 text-xs font-bold text-rose-100">Bracket Locked</span>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {showSeedTestFixturesCta ? (
                      <button
                        type="button"
                        onClick={() => void handleLoadTestFixtures()}
                        disabled={isLoadingTestFixtures || isSimulating}
                        className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-3 py-2 text-[11px] font-bold text-amber-100 hover:bg-amber-900/60 disabled:opacity-50"
                      >
                        {isLoadingTestFixtures ? "Seeding..." : "Seed Test Fixtures"}
                      </button>
                    ) : null}
                    {(view.isOwner || view.isAdmin) ? (
                      <button
                        type="button"
                        onClick={() => scrollToAnchor("world-cup-admin", "picks")}
                        className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-bold text-white/70"
                      >
                        Jump to Admin/Test
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => scrollToAnchor("world-cup-top")}
                      className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-bold text-white/70"
                    >
                      ↑ Top
                    </button>
                  </div>
                </div>
              </div>

              <div
                data-testid="world-cup-bracket-scroll"
                className="max-h-[72vh] overflow-auto rounded-xl border border-white/10 bg-black/25"
              >
                <WorldCupBracketBoard
                  view={view}
                  picks={picks}
                  isLocked={isLocked}
                  onPick={persistPick}
                  onOpenMatchupPicker={(matchId) => {
                    if (!hasPickableFixtures) {
                      toast.info("This matchup is not ready for picks yet. Sync fixtures or use simulation data.")
                      return
                    }
                    setGuidedInitialMatchId(matchId)
                    setIsGuidedPickerOpen(true)
                  }}
                />
              </div>
            </section>
          ) : (
            <div className="h-full overflow-y-auto">
              <WorldCupEntryDashboard
                challengeId={challengeId}
                entries={entries}
                maxEntriesPerParticipant={view.challenge.maxEntriesPerParticipant}
                isLocked={isLocked}
                selectedEntryId={selectedEntryId}
                onCreateEntry={handleCreateEntry}
                onSelectEntry={handleSelectEntry}
                onRenameEntry={handleRenameEntry}
                onDeleteEntry={handleDeleteEntry}
                isLoading={isEntriesLoading}
                isCreating={isCreatingEntry}
                isMutating={isMutatingEntry}
              />
            </div>
          )
        ) : null}
        {tab === "leaderboard" ? (
          <div id="world-cup-leaderboard" className="h-full overflow-y-auto">
            <WorldCupLeaderboardInsights leaderboard={view.leaderboard} />
            <WorldCupLeaderboard view={view} busy={isPending} onRecalculate={() => runOwnerAction("recalculate")} />
          </div>
        ) : null}
        {tab === "invite" ? <div id="world-cup-invite"><WorldCupInvitePanel view={view} /></div> : null}
        {tab === "rules" ? (
          <div className="mx-auto max-w-2xl px-4 py-6 text-sm leading-7 text-white/60">
            <h2 className="mb-3 text-lg font-black text-white">Rules</h2>
            <p>
              Pick every winner from the Round of 32 through the champion. Picks lock at kickoff for each match (or at tournament start if the challenge uses a tournament-start lock).
            </p>
            <p className="mt-3">
              Correct picks score more each round. Final API results update match winners, advance teams, score entries, and refresh the leaderboard.
            </p>
            <p className="mt-3 font-bold text-white/70">Scoring (default)</p>
            <ul className="mt-1 list-disc pl-5 space-y-1">
              <li>Round of 32: {view.scoring.roundOf32Points} pts</li>
              <li>Round of 16: {view.scoring.roundOf16Points} pts</li>
              <li>Quarterfinal: {view.scoring.quarterFinalPoints} pts</li>
              <li>Semifinal: {view.scoring.semiFinalPoints} pts</li>
              <li>Final: {view.scoring.finalPoints} pts</li>
              {view.challenge.includeThirdPlace && view.scoring.thirdPlacePoints != null ? (
                <li>3rd Place: {view.scoring.thirdPlacePoints} pts</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {tab === "settings" ? (
          <div id="world-cup-settings" className="mx-auto max-w-3xl px-2">
            <WorldCupBracketSettingsPanel
              challengeId={challengeId}
              onSaved={() => void refreshChallengeView()}
            />
          </div>
        ) : null}
        {tab === "commissioner" ? (
          <div id="world-cup-commissioner" className="mx-auto max-w-3xl px-2">
            <WorldCupCommissionerBrainPanel
              challengeId={challengeId}
              onOpenLeagueSettings={() => setTab("settings")}
            />
          </div>
        ) : null}
      </main>

      <button
        data-testid="world-cup-back-to-top"
        type="button"
        onClick={() => scrollToAnchor("world-cup-top")}
        className="fixed bottom-16 right-4 z-50 inline-flex items-center gap-1 rounded-full border border-white/20 bg-zinc-900/90 px-3 py-2 text-xs font-black text-white shadow-xl backdrop-blur sm:bottom-6"
      >
        <ArrowUp className="h-3.5 w-3.5" />
        Top
      </button>
      </div>

      <nav
        aria-label="Primary bracket tabs"
        className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-white/10 bg-zinc-950/95 pb-[env(safe-area-inset-bottom,0px)] sm:hidden"
      >
        {tabList.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex min-h-[52px] min-w-[68px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-bold touch-manipulation ${tab === id ? "text-cyan-200" : "text-white/45"}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {label === "Leaderboard" ? "Board" : label === "Commissioner" ? "Commish" : label === "Settings" ? "Setup" : label}
            </span>
          </button>
        ))}
      </nav>

      {/* ── Guided matchup picker ── */}
      {selectedEntry && isGuidedPickerOpen && (
        <WorldCupGuidedMatchupPicker
          challengeId={challengeId}
          entryId={selectedEntry.id}
          entryName={selectedEntry.name}
          matches={view.matches}
          picks={picks}
          isOpen={isGuidedPickerOpen}
          initialMatchId={guidedInitialMatchId}
          isLocked={isLocked}
          entryIsComplete={selectedEntry.isComplete}
          lockAt={view.challenge.pickLockAt}
          tournamentStartAt={view.challenge.effectivePickLockAt}
          includeThirdPlace={view.challenge.includeThirdPlace}
          hasBracketBrainAi={view.hasBracketBrainAi}
          onClose={() => {
            setIsGuidedPickerOpen(false)
            setGuidedInitialMatchId(null)
          }}
          onSavePick={handleGuidedSavePick}
          onPicksUpdated={(updatedPicks) => {
            if (selectedEntryId) {
              markEntryPicksLoaded(selectedEntryId, updatedPicks)
            }
          }}
        />
      )}
    </div>
  )
}

function JumpButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="whitespace-nowrap rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-bold text-white/70 touch-manipulation disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function PoolStatCard({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "ready" | "warn"
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-white/35">{label}</div>
      <div
        className={`mt-1 text-xl font-black ${
          tone === "ready" ? "text-emerald-200" : tone === "warn" ? "text-amber-200" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function SyncResultRow({
  label,
  result,
  extra,
}: {
  label: string
  result: { created?: number; updated?: number; skipped?: number; warnings?: string[]; syncedAt?: string; dryRun?: boolean }
  extra?: string
}) {
  return (
    <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11px]">
      <div className="flex flex-wrap gap-3 text-white/60">
        <span className="font-bold text-white/80">{label}</span>
        {result.created != null && <span>Created <strong className="text-white/80">{result.created}</strong></span>}
        {result.updated != null && <span>Updated <strong className="text-white/80">{result.updated}</strong></span>}
        {result.skipped != null && <span>Skipped <strong className="text-white/80">{result.skipped}</strong></span>}
        {result.dryRun && <span className="text-amber-300">dry run</span>}
      </div>
      {extra && <p className="mt-1 text-white/50">{extra}</p>}
      {(result.warnings ?? []).slice(0, 2).map((w) => (
        <p key={w} className="mt-1 text-amber-300">{w}</p>
      ))}
      {result.syncedAt && (
        <p className="mt-1 text-white/30">{new Date(result.syncedAt).toLocaleTimeString()}</p>
      )}
    </div>
  )
}
