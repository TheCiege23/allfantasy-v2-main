"use client"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowUp, BarChart3, Baseline, Bell, Bold, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Clock, Copy, Edit3, Film, Globe2, ImageIcon, Italic, ListOrdered, Loader2, Lock, MessageSquare, Megaphone, Mic, Pin, PlayCircle, Plus, RefreshCw, Send, Settings, Share2, Smile, Sparkles, Strikethrough, Trophy, Underline, Users, X } from "lucide-react"
import { toast } from "sonner"
import type { WorldCupChallengeView, WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import { isWorldCupChallengeLocked } from "@/lib/world-cup/worldCupBracketBuilder"
import type {
  WorldCupBracketEntryClient,
  WorldCupChallengeIntegrityReport,
  WorldCupAdminSyncProvider,
  WorldCupAdminSyncTeamsResult,
  WorldCupAdminSyncFixturesResult,
  WorldCupAdminSyncGroupStandingsResult,
  WorldCupAdminSyncLiveResult,
  WorldCupAdminSimulationStrategy,
  WorldCupEntryCompletionReviewClient,
  WorldCupGroupStageViewClient,
} from "@/lib/world-cup/worldCupClientApi"
import {
  adminLoadWorldCupTestFixtures,
  adminResetWorldCupSimulation,
  adminSimulateWorldCupMatch,
  adminSimulateWorldCupRound,
  adminSimulateWorldCupTournament,
  adminSyncWorldCupFixtures,
  adminSyncWorldCupGroupStandings,
  adminSyncWorldCupLive,
  adminSyncWorldCupTeams,
  clearWorldCupBracketEntryPicks,
  createWorldCupBracketEntry,
  deleteWorldCupBracketEntry,
  fetchWorldCupEntryCompletionReview,
  fetchWorldCupGroupStageView,
  finalizeWorldCupEntryClient,
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
  buildWorldCupMatchesFromGroupPredictions,
  buildWorldCupProjectedMatches,
  getOrderedRounds,
} from "@/lib/world-cup/worldCupProjectedBracket"
import { hasOfficialWorldCupReseededKnockoutFixtures } from "@/lib/world-cup/worldCupKnockoutMode"
import { calculateWorldCupBracketHealth } from "@/lib/world-cup/worldCupAiInsights"
import {
  buildWorldCupPathToWinInsight,
  calculateWorldCupBracketGrade,
  calculateWorldCupLeaderboardAiInsights,
  type WorldCupBracketGradeInsight,
  type WorldCupPathToWinInsight,
} from "@/lib/world-cup/worldCupAiSubscriptionInsights"
import { getBrowserWorldCupInviteUrl } from "@/lib/world-cup/worldCupBracketUtils"
import { resolveWorldCupEntitlementSummary } from "@/lib/world-cup/worldCupEntitlements"
import {
  parseWorldCupChatRichText,
  sanitizeWorldCupChatMessage,
  type WorldCupChatColor,
  type WorldCupChatFont,
  type WorldCupChatRichTextSegment,
} from "@/lib/world-cup/worldCupChatRichText"
import { worldCupTabToQueryValue, type WorldCupBracketTab } from "@/lib/world-cup/worldCupTabs"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import WorldCupBracketBoard from "./WorldCupBracketBoard"
import WorldCupBracketHealthCard from "./WorldCupBracketHealthCard"
import WorldCupRootingGuideCard from "./WorldCupRootingGuideCard"
import WorldCupExplainBracketCard from "./WorldCupExplainBracketCard"
import WorldCupBracketUniquenessCard from "./WorldCupBracketUniquenessCard"
import WorldCupAiBracketShareCard from "./WorldCupAiBracketShareCard"
import WorldCupKnockoutDangerZonesCard from "./WorldCupKnockoutDangerZonesCard"
import { buildWorldCupRootingGuide } from "@/lib/world-cup/worldCupRootingGuide"
import { buildWorldCupBracketShareMessage } from "@/lib/world-cup/worldCupShareCopy"
import WorldCupEntryDashboard from "./WorldCupEntryDashboard"
import AllFantasyBracketBoard, { AllFantasyBracketPickSkeleton } from "@/components/brackets/shared/AllFantasyBracketBoard"
import { WorldCupCompactBracketPreview } from "./WorldCupCompactBracketPreview"
import type { GuidedPickPayload } from "./WorldCupGuidedMatchupPicker"
import WorldCupGuidedMatchupPicker from "./WorldCupGuidedMatchupPicker"
import WorldCupInvitePanel from "./WorldCupInvitePanel"
import WorldCupRoundBreakdown from "./WorldCupRoundBreakdown"
import WorldCupScoreSummary from "./WorldCupScoreSummary"
import WorldCupLeaderboard from "./WorldCupLeaderboard"
import WorldCupLeaderboardInsights from "./WorldCupLeaderboardInsights"
import WorldCupLiveScoreTicker from "./WorldCupLiveScoreTicker"
import WorldCupShareCard from "./WorldCupShareCards"
import WorldCupBracketSettingsPanel from "./WorldCupBracketSettingsPanel"
import WorldCupCommissionerBrainPanel from "./WorldCupCommissionerBrainPanel"
import WorldCupGroupStagePicks from "./WorldCupGroupStagePicks"
import WorldCupReadinessPanel from "./WorldCupReadinessPanel"
import WorldCupLeagueEventFeed from "./WorldCupLeagueEventFeed"
type Tab = WorldCupBracketTab
type WorldCupPoolChatMessage = {
  id: string
  userId: string | null
  authorName: string
  authorAvatarUrl: string | null
  body: string
  messageType: string
  gif?: WorldCupChatGifAttachment | null
  image?: WorldCupChatImageAttachment | null
  poll?: WorldCupChatPollAttachment | null
  visibility: string
  targetUserId: string | null
  mentions: unknown[]
  createdAt: string
  isOwnMessage: boolean
  isPrivate: boolean
}
type WorldCupChatGifAttachment = {
  id: string
  title: string
  previewUrl: string
  gifUrl: string
  width: number
  height: number
  provider: "klipy" | "tenor" | "giphy"
}
type WorldCupChatImageAttachment = {
  assetId: string
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
  provider: "cloudinary"
}
type WorldCupChatPollOption = {
  id: string
  label: string
  votes: number
  percentage: number
}
type WorldCupChatPollAttachment = {
  question: string
  options: WorldCupChatPollOption[]
  currentUserVote: string | null
  totalVotes: number
  closed: boolean
  closedAt: string | null
  createdByUserId: string | null
  createdAt: string | null
}
type WorldCupNotificationPreferenceState = {
  poolMuted: boolean
  inAppEnabled: boolean
  smsEnabled: boolean
  usernameMentionsEnabled: boolean
  allMentionsEnabled: boolean
  commissionerAnnouncementsEnabled: boolean
  deadlineRemindersEnabled: boolean
  bracketFinalizedEnabled: boolean
  resultsUpdatedEnabled: boolean
  leaderboardUpdatedEnabled: boolean
  generalChatEnabled: boolean
  chimmyRepliesEnabled: boolean
}
type WorldCupComposerPanel = "gif" | "poll" | "image" | "voice" | null
type WorldCupAdminSimulationRound =
  | "round_of_32"
  | "round_of_16"
  | "quarterfinal"
  | "semifinal"
  | "third_place"
  | "final"
type WorldCupAdminSimulationPanelResult = {
  action: string
  ok: boolean
  dryRun: boolean
  summary: Record<string, unknown>
  warnings: string[]
  error?: string
}
const WORLD_CUP_CHAT_COLOR_OPTIONS: Array<{ value: WorldCupChatColor; label: string }> = [
  { value: "default", label: "Default" },
  { value: "af-blue", label: "AF Blue" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "purple", label: "Purple" },
]
const WORLD_CUP_CHAT_FONT_OPTIONS: Array<{ value: WorldCupChatFont; label: string }> = [
  { value: "default", label: "Default" },
  { value: "clean", label: "Clean" },
  { value: "sport", label: "Sport" },
  { value: "mono", label: "Mono" },
]
/**
 * Localizable tab definitions.
 *
 * `labelKey` resolves through `lib/world-cup/worldCupI18n` (`wc.tab.*`) at
 * render time using the user's active locale from `useOptionalLanguage`.
 * `label` stays as the English fallback so the array remains useful for
 * non-translated call-sites (test mocks, debug logging, etc.).
 */
const BASE_TABS: Array<{
  id: Tab
  label: string
  labelKey: string
  shortLabelKey: string
  icon: typeof ClipboardList
}> = [
  { id: "home", label: "Home", labelKey: "wc.tab.home", shortLabelKey: "wc.tab.home.short", icon: Trophy },
  { id: "group-stage", label: "Group Stage", labelKey: "wc.tab.groupStage", shortLabelKey: "wc.tab.groupStage.short", icon: ListOrdered },
  { id: "picks", label: "Knockouts", labelKey: "wc.tab.picks", shortLabelKey: "wc.tab.picks.short", icon: ClipboardList },
  { id: "review", label: "Review", labelKey: "wc.tab.review", shortLabelKey: "wc.tab.review.short", icon: ClipboardCheck },
  { id: "leaderboard", label: "Leaderboard", labelKey: "wc.tab.leaderboard", shortLabelKey: "wc.tab.leaderboard.short", icon: Trophy },
  { id: "rules", label: "Rules", labelKey: "wc.tab.rules", shortLabelKey: "wc.tab.rules.short", icon: Users },
  { id: "invite", label: "Invite", labelKey: "wc.tab.invite", shortLabelKey: "wc.tab.invite.short", icon: Share2 },
]
const WORLD_CUP_ADMIN_SIMULATION_ROUNDS: Array<{ value: WorldCupAdminSimulationRound; label: string }> = [
  { value: "round_of_32", label: "Round of 32" },
  { value: "round_of_16", label: "Round of 16" },
  { value: "quarterfinal", label: "Quarterfinal" },
  { value: "semifinal", label: "Semifinal" },
  { value: "third_place", label: "Third Place" },
  { value: "final", label: "Final" },
]

function summarizeSimulationPayload(payload: unknown): Record<string, unknown> {
  const result =
    payload && typeof payload === "object" && "result" in payload
      ? (payload as { result?: unknown }).result
      : payload
  if (!result || typeof result !== "object") return {}
  const data = result as Record<string, unknown>
  const rounds = Array.isArray(data.rounds)
    ? (data.rounds as Array<{ simulatedMatches?: number; skippedMatches?: number; skippedMatchIds?: string[] }>)
    : null
  const champion = data.champion && typeof data.champion === "object"
    ? (data.champion as { winnerTeamName?: string | null; winnerTeamId?: string | null })
    : null
  const simulatedMatches =
    typeof data.simulatedMatches === "number"
      ? data.simulatedMatches
      : rounds
        ? rounds.reduce((sum: number, round) => sum + (round.simulatedMatches ?? 0), 0)
        : undefined
  const skippedMatches =
    typeof data.skippedMatches === "number"
      ? data.skippedMatches
      : rounds
        ? rounds.reduce((sum: number, round) => sum + (round.skippedMatches ?? 0), 0)
        : undefined
  const skippedMatchIds =
    Array.isArray(data.skippedMatchIds)
      ? data.skippedMatchIds
      : rounds
        ? rounds.flatMap((round) => round.skippedMatchIds ?? [])
        : undefined
  return {
    simulatedMatches,
    skippedMatches,
    skippedMatchIds,
    champion: champion?.winnerTeamName ?? champion?.winnerTeamId ?? undefined,
    leaderboardTop: data.leaderboardTop,
    resetMatches: data.resetMatches,
    warnings: data.warnings,
    advancedMatchIds: data.advancedMatchIds,
    unresolvedMatchesAfter: data.unresolvedMatchesAfter,
    recalculated: data.recalculated,
  }
}

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
        knockoutMode: challengeRaw?.knockoutMode === "reseeded" ? "reseeded" : "predictive",
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
      knockoutMode: challengeRaw?.knockoutMode === "reseeded" ? "reseeded" : "predictive",
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
      submittedAt: summary ? summary.submittedAt ?? null : entry.submittedAt,
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
      submittedAt: entry.submittedAt ?? null,
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
    leaderboard: nextView.leaderboard,
    participant: nextView.participant ?? currentView.participant,
    activeEntry: nextView.activeEntry ?? currentView.activeEntry,
    picks: nextView.picks,
  }
}

function worldCupReviewStatusClass(status: "correct" | "wrong" | "pending") {
  if (status === "correct") return "border-cyan-300/35 bg-cyan-300/10 text-white/90"
  if (status === "wrong") return "border-rose-300/35 bg-rose-400/10 text-white/85"
  return "border-amber-300/30 bg-amber-400/10 text-white/80"
}

function worldCupReviewStatusLabel(input: { isCorrect?: boolean | null; pointsAwarded?: number | null }) {
  if (input.isCorrect === true) return { status: "correct" as const, label: `Correct +${input.pointsAwarded ?? 0}` }
  if (input.isCorrect === false) return { status: "wrong" as const, label: "Wrong +0" }
  return { status: "pending" as const, label: "Pending" }
}

function teamNameFromGroupStageReview(view: WorldCupGroupStageViewClient, teamId: string) {
  for (const group of view.groups) {
    const team = group.teams.find((row) => row.teamId === teamId)
    if (team) return team.name
  }
  return teamId
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
  // World Cup translation helper. The language source comes from the
  // global LanguageProviderClient (cookie `af_lang` + UserProfile
  // preferredLanguage + localStorage). useOptionalLanguage() returns the
  // default value when no provider is mounted (test harness, isolated
  // story), so this never throws.
  const { language: wcLanguage } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(wcLanguage), [wcLanguage])
  const normalizedInitialView = normalizeWorldCupView(initialView ?? challenge)
  const initialEntries = entryClientsFromInitialView(normalizedInitialView)
  const shouldAutoSelectInitialEntry =
    defaultTab === "picks" ||
    defaultTab === "group-stage" ||
    defaultTab === "review" ||
    Boolean(initialEntryId) ||
    initialGuidedOpen
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
  const [savingPickMatchIds, setSavingPickMatchIds] = useState<Set<string>>(() => new Set())
  const savingPickMatchIdsRef = useRef<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [lockNow, setLockNow] = useState(() => new Date())
  // Gate time-relative UI behind a mounted flag so SSR and the first
  // CSR render emit identical HTML. Without this, the lock countdown
  // label ("20d 17h until picks lock") differs between server clock
  // and client clock and trips React #425 / #418 hydration warnings.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  // ── Entry state ──────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<WorldCupBracketEntryClient[]>(initialEntries)
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  // When the initial ?entry= param is stale (not in the entries list), we resolve
  // to a valid entry inside the .then() callback and store it here so the URL-
  // correction effect below can fire inside React's flush cycle (observable by RTL).
  const staleEntryResolvedRef = useRef<string | null>(null)
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [isCreatingEntry, setIsCreatingEntry] = useState(false)
  const [isMutatingEntry, setIsMutatingEntry] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(initialSelectedEntryId)
  const [headerRenameOpen, setHeaderRenameOpen] = useState(false)
  const [headerRenameValue, setHeaderRenameValue] = useState("")

  // Picks per-entry: keyed by entryId → array of picks
  const [entryPicks, setEntryPicks] = useState<Record<string, WorldCupPickView[]>>(() => {
    if (
      initialSelectedEntryId &&
      normalizedInitialView.activeEntry?.id === initialSelectedEntryId
    ) {
      return { [initialSelectedEntryId]: normalizedInitialView.picks }
    }
    return {}
  })
  const [loadedEntryPickIds, setLoadedEntryPickIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedEntryId &&
          normalizedInitialView.activeEntry?.id === initialSelectedEntryId
          ? [initialSelectedEntryId]
          : []
      )
  )

  // ── Guided picker state ──────────────────────────────────────────────────
  const [isGuidedPickerOpen, setIsGuidedPickerOpen] = useState(false)
  const [guidedInitialMatchId, setGuidedInitialMatchId] = useState<string | null>(null)
  const [hasUnsavedGroupChanges, setHasUnsavedGroupChanges] = useState(false)
  const [dashboardPreviewMode, setDashboardPreviewMode] = useState<"starting" | "ai">("starting")
  const [completionReview, setCompletionReview] = useState<WorldCupEntryCompletionReviewClient | null>(null)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [isCompletionLoading, setIsCompletionLoading] = useState(false)
  const [knockoutGroupStageView, setKnockoutGroupStageView] = useState<WorldCupGroupStageViewClient | null>(null)
  const [knockoutGroupStageError, setKnockoutGroupStageError] = useState<string | null>(null)
  const [knockoutGroupStageRefreshKey, setKnockoutGroupStageRefreshKey] = useState(0)
  const [reviewGroupStageView, setReviewGroupStageView] = useState<WorldCupGroupStageViewClient | null>(null)
  const [reviewGroupStageError, setReviewGroupStageError] = useState<string | null>(null)
  const [isFinalizingEntry, setIsFinalizingEntry] = useState(false)
  const [integrityReport, setIntegrityReport] = useState<WorldCupChallengeIntegrityReport | null>(null)
  const [integrityUnavailable, setIntegrityUnavailable] = useState(false)
  const [isIntegrityLoading, setIsIntegrityLoading] = useState(false)

  // ── Admin sync state ────────────────────────────────────────────────────
  const [syncProvider, setSyncProvider] = useState<WorldCupAdminSyncProvider>("mock")
  const [syncDryRun, setSyncDryRun] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncTeamsResult, setSyncTeamsResult] = useState<WorldCupAdminSyncTeamsResult | null>(null)
  const [syncFixturesResult, setSyncFixturesResult] = useState<WorldCupAdminSyncFixturesResult | null>(null)
  const [syncLiveResult, setSyncLiveResult] = useState<WorldCupAdminSyncLiveResult | null>(null)
  const [syncStandingsResult, setSyncStandingsResult] = useState<WorldCupAdminSyncGroupStandingsResult | null>(null)
  const [simulationStrategy, setSimulationStrategy] = useState<WorldCupAdminSimulationStrategy>("random")
  const [simulationRound, setSimulationRound] = useState<WorldCupAdminSimulationRound>("round_of_32")
  const [simulationDryRun, setSimulationDryRun] = useState(true)
  const [simulationMatchId, setSimulationMatchId] = useState<string>("")
  const [simulationResult, setSimulationResult] = useState<WorldCupAdminSimulationPanelResult | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [isSavingSimulationMode, setIsSavingSimulationMode] = useState(false)
  const [isLoadingTestFixtures, setIsLoadingTestFixtures] = useState(false)
  const isCreatingEntryRef = useRef(false)
  const isFinalizingEntryRef = useRef(false)
  const pageScrollRef = useRef<HTMLDivElement | null>(null)
  const knockoutScrollRef = useRef<HTMLDivElement | null>(null)
  const guidedAutoOpenedRef = useRef(false)
  const latestViewRef = useRef(normalizedInitialView)

  const challengeId = view.challenge.id

  const showCommissionerTab = Boolean(view.isOwner || view.isAdmin)
  const entitlementSummary = useMemo(
    () => resolveWorldCupEntitlementSummary({
      isOwner: view.isOwner,
      isAdmin: view.isAdmin,
      hasBracketBrainAi: view.hasBracketBrainAi,
    }),
    [view.hasBracketBrainAi, view.isAdmin, view.isOwner]
  )
  const aiInsightsUnlocked = entitlementSummary.ai
  const tabList = useMemo(() => {
    const list = BASE_TABS.map((entry) => ({
      ...entry,
      label: t(entry.labelKey),
      shortLabel: t(entry.shortLabelKey),
    }))
    if (showCommissionerTab) {
      list.push({
        id: "settings",
        label: t("wc.tab.admin"),
        labelKey: "wc.tab.admin",
        shortLabelKey: "wc.tab.admin.short",
        shortLabel: t("wc.tab.admin.short"),
        icon: Settings,
      })
      list.push({
        id: "commissioner",
        label: t("wc.tab.commissioner"),
        labelKey: "wc.tab.commissioner",
        shortLabelKey: "wc.tab.commissioner.short",
        shortLabel: t("wc.tab.commissioner.short"),
        icon: Sparkles,
      })
    }
    return list
  }, [showCommissionerTab, t])

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
      try {
        if (entryId) {
          window.localStorage.setItem(key, entryId)
        } else {
          window.localStorage.removeItem(key)
        }
      } catch {
        // localStorage may be unavailable in restricted/test environments
      }
    },
    [challengeId]
  )

  const syncSelectedEntryUrl = useCallback(
    (entryId: string | null, mode: "push" | "replace" = "replace", targetTab?: "group-stage" | "picks") => {
      if (typeof window === "undefined") return
      const url = new URL(window.location.href)
      if (entryId) {
        const nextTab = targetTab ?? (tab === "group-stage" ? "group-stage" : "picks")
        url.searchParams.set("tab", worldCupTabToQueryValue(nextTab))
        url.searchParams.set("entry", entryId)
      } else {
        url.searchParams.delete("entry")
        if (url.searchParams.get("tab") === "picks" || url.searchParams.get("tab") === "knockouts" || url.searchParams.get("tab") === "group-stage") {
          url.searchParams.delete("tab")
        }
      }
      const nextUrl = url.pathname + (url.search ? url.search : "")
      if (mode === "push") {
        router.push(nextUrl)
      } else {
        router.replace(nextUrl)
      }
    },
    [router, tab]
  )

  const updateTabUrl = useCallback(
    (nextTab: Tab, entryId: string | null = selectedEntryId, mode: "push" | "replace" = "push") => {
      if (typeof window === "undefined") return
      const url = new URL(window.location.href)
      url.searchParams.set("tab", worldCupTabToQueryValue(nextTab))
      if (entryId) {
        url.searchParams.set("entry", entryId)
      } else {
        url.searchParams.delete("entry")
      }
      const nextUrl = url.pathname + (url.search ? url.search : "")
      if (mode === "replace") router.replace(nextUrl)
      else router.push(nextUrl)
    },
    [router, selectedEntryId]
  )

  const confirmLeavingGroupStage = useCallback(() => {
    if (tab !== "group-stage" || !hasUnsavedGroupChanges) return true
    const message = "You have unsaved group changes. Save before leaving, or your changes will be discarded."
    if (typeof window === "undefined") return true
    const confirmed = window.confirm(message)
    if (!confirmed) toast.info("Stayed on Group Stage. Save or discard your group changes before leaving.")
    return confirmed
  }, [hasUnsavedGroupChanges, tab])

  const switchTab = useCallback(
    (nextTab: Tab) => {
      if (nextTab === tab) return
      if (!confirmLeavingGroupStage()) return
      if (tab === "group-stage") setHasUnsavedGroupChanges(false)
      setTab(nextTab)
      updateTabUrl(nextTab)
    },
    [confirmLeavingGroupStage, tab, updateTabUrl]
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
    if (ms <= 0) return t("wc.lock.locksSoon")
    const totalM = Math.floor(ms / 60000)
    const d = Math.floor(totalM / 1440)
    const h = Math.floor((totalM % 1440) / 60)
    const m = totalM % 60
    if (d > 0) return t("wc.lock.untilLockDays", { d, h })
    if (h > 0) return t("wc.lock.untilLockHours", { h, m })
    return t("wc.lock.untilLockMinutes", { m: Math.max(1, m) })
  }, [isLocked, lockState.lockAt, lockNow, t])
  // Picks for the selected entry.
  const picks: WorldCupPickView[] = useMemo(() => {
    if (!selectedEntryId) return []
    return entryPicks[selectedEntryId] ?? []
  }, [selectedEntryId, entryPicks])

  const entryPicksHydrated = useMemo(
    () => !selectedEntryId || loadedEntryPickIds.has(selectedEntryId),
    [selectedEntryId, loadedEntryPickIds]
  )

  useEffect(() => {
    if (!selectedEntryId) {
      setKnockoutGroupStageView(null)
      setKnockoutGroupStageError(null)
      return
    }
    let cancelled = false
    fetchWorldCupGroupStageView(challengeId, selectedEntryId)
      .then((nextView) => {
        if (cancelled) return
        setKnockoutGroupStageView(nextView)
        setKnockoutGroupStageError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setKnockoutGroupStageView(null)
        setKnockoutGroupStageError(err instanceof Error ? err.message : "Failed to load group-stage predictions")
      })
    return () => {
      cancelled = true
    }
  }, [challengeId, selectedEntryId, knockoutGroupStageRefreshKey])

  const completedPickCount = useMemo(
    () => picks.filter(hasWorldCupPickSelection).length,
    [picks]
  )
  const groupSeededKnockout = useMemo(
    () =>
      buildWorldCupMatchesFromGroupPredictions({
        matches: view.matches,
        groupStageView: knockoutGroupStageView,
        bestThirdMappingConfirmed: false,
      }),
    [knockoutGroupStageView, view.matches]
  )
  const knockoutMode = view.challenge.knockoutMode ?? "predictive"
  const reseededOfficialFixturesReady = hasOfficialWorldCupReseededKnockoutFixtures(view.matches)
  const baseKnockoutMatches = groupSeededKnockout.matches
  const projectedMatches = useMemo(
    () => buildWorldCupProjectedMatches(
      knockoutMode === "reseeded" && reseededOfficialFixturesReady ? view.matches : baseKnockoutMatches,
      picks
    ),
    [baseKnockoutMatches, knockoutMode, picks, reseededOfficialFixturesReady, view.matches]
  )
  const pickableMatches = useMemo(
    () => projectedMatches.filter(isWorldCupMatchPickable),
    [projectedMatches]
  )
  const rawPickableMatches = useMemo(
    () => baseKnockoutMatches.filter(isWorldCupMatchPickable),
    [baseKnockoutMatches]
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
    () => getWorldCupGuidedPicksState(baseKnockoutMatches),
    [baseKnockoutMatches]
  )
  const knockoutPicksLockedByMode = knockoutMode === "reseeded" && !reseededOfficialFixturesReady
  const hasPickableFixtures = projectedPickableMatchCount > 0 && !knockoutPicksLockedByMode
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
      projectedMatches,
      picks
    ).championAlive
  }, [selectedEntry, selectedLeaderboardRow, projectedMatches, picks])
  const pathToWinInsight = useMemo(
    () => buildWorldCupPathToWinInsight({
      selectedEntry: selectedEntry
        ? {
            id: selectedEntry.id,
            name: selectedEntry.name,
            championTeamId: selectedEntry.championTeamId,
            championTeamName: selectedEntry.championTeamName,
            totalScore: selectedEntry.totalScore,
            maxPossibleScore: selectedEntry.maxPossibleScore,
            submittedAt: selectedEntry.submittedAt,
          }
        : null,
      leaderboard: view.leaderboard,
      hasBracketBrainAi: aiInsightsUnlocked,
    }),
    [aiInsightsUnlocked, selectedEntry, view.leaderboard]
  )

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
          let storedEntryId: string | null = null
          if (typeof window !== "undefined") {
            try {
              storedEntryId = window.localStorage.getItem(getSelectedEntryStorageKey(challengeId))
            } catch {
              // localStorage may be unavailable in restricted/test environments
            }
          }
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
          if (initialEntryId && initialEntryId !== active.id) {
            // Record the resolved ID; the effect below fires it inside React's
            // flush cycle so RTL / waitFor can observe the router.replace call.
            staleEntryResolvedRef.current = active.id
          }
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

  // When a stale ?entry= param was resolved to a valid entry, correct the URL.
  // Separated from the loading effect above so the router.replace call happens
  // inside a React render cycle and is observable by @testing-library waitFor.
  useEffect(() => {
    const resolvedId = staleEntryResolvedRef.current
    if (!resolvedId || !entriesLoaded) return
    staleEntryResolvedRef.current = null
    updateTabUrl(tab, resolvedId, "replace")
  }, [entriesLoaded, updateTabUrl, tab])

  // ── Entry management callbacks ───────────────────────────────────────────
  const handleCreateEntry = useCallback(async () => {
    if (isCreatingEntryRef.current) return
    isCreatingEntryRef.current = true
    setIsCreatingEntry(true)
    try {
      const entry = await createWorldCupBracketEntry(challengeId)
      setEntries((prev) => [...prev, entry])
      markEntryPicksLoaded(entry.id, [])
      setSelectedEntryId(entry.id)
      persistSelectedEntryId(entry.id)
      setTab("group-stage")
      syncSelectedEntryUrl(entry.id, "push", "group-stage")
      toast.success(`Created "${entry.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bracket")
    } finally {
      isCreatingEntryRef.current = false
      setIsCreatingEntry(false)
    }
  }, [challengeId, markEntryPicksLoaded, persistSelectedEntryId, syncSelectedEntryUrl])

  const handleSelectEntry = useCallback((entryId: string) => {
    setSelectedEntryId(entryId)
    setCompletionReview(null)
    setCompletionError(null)
    setKnockoutGroupStageView(null)
    setKnockoutGroupStageError(null)
    setReviewGroupStageView(null)
    setReviewGroupStageError(null)
    persistSelectedEntryId(entryId)
    setTab((current) => current === "group-stage" ? "group-stage" : "picks")
    syncSelectedEntryUrl(entryId, "push")
  }, [persistSelectedEntryId, syncSelectedEntryUrl])

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
        setView((prev) => ({
          ...prev,
          activeEntry: prev.activeEntry?.id === entryId ? { ...prev.activeEntry, name: updated.name } : prev.activeEntry,
          entries: prev.entries.map((entry) => entry.id === entryId ? { ...entry, name: updated.name } : entry),
          leaderboard: prev.leaderboard.map((row) => row.entryId === entryId ? { ...row, entryName: updated.name } : row),
        }))
        await refreshChallengeView()
        toast.success(`Renamed to "${updated.name}"`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to rename")
      } finally {
        setIsMutatingEntry(false)
      }
    },
    [challengeId, refreshChallengeView]
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
          syncSelectedEntryUrl(nextSelectedEntryId, nextSelectedEntryId ? "replace" : "push")
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
    [challengeId, entries, persistSelectedEntryId, selectedEntryId, syncSelectedEntryUrl]
  )

  const loadCompletionReview = useCallback(async () => {
    if (!selectedEntryId) return
    setIsCompletionLoading(true)
    setCompletionError(null)
    setReviewGroupStageError(null)
    try {
      const [review, groupStageView] = await Promise.all([
        fetchWorldCupEntryCompletionReview(challengeId, selectedEntryId),
        fetchWorldCupGroupStageView(challengeId, selectedEntryId),
      ])
      setCompletionReview(review)
      setReviewGroupStageView(groupStageView)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load completion review"
      setCompletionError(message)
      setReviewGroupStageError(message)
    } finally {
      setIsCompletionLoading(false)
    }
  }, [challengeId, selectedEntryId])

  const refreshCompletionReviewAfterMeaningfulEdit = useCallback(() => {
    setCompletionReview(null)
    setCompletionError(null)
    setReviewGroupStageView(null)
    setReviewGroupStageError(null)
    if (tab === "review") void loadCompletionReview()
  }, [loadCompletionReview, tab])

  const refreshKnockoutBracketFromGroupStage = useCallback(() => {
    setKnockoutGroupStageRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (tab !== "review" || !selectedEntryId) return
    void loadCompletionReview()
  }, [loadCompletionReview, selectedEntryId, tab])

  const handleFinalizeEntry = useCallback(async () => {
    if (!selectedEntryId) return
    if (isFinalizingEntryRef.current) return
    if (hasUnsavedGroupChanges) {
      const message = "Save your Group Stage changes before finalizing."
      setCompletionError(message)
      toast.error(message)
      return
    }
    if (savingPickMatchIdsRef.current.size > 0) {
      const message = "A knockout pick is still saving. Try Finalize again when saving finishes."
      setCompletionError(message)
      toast.info(message)
      return
    }
    if (knockoutPicksLockedByMode) {
      const message = t("wc.knockouts.intro.reseeded")
      setCompletionError(message)
      toast.info(message)
      return
    }
    isFinalizingEntryRef.current = true
    setIsFinalizingEntry(true)
    setCompletionError(null)
    try {
      const result = await finalizeWorldCupEntryClient(challengeId, selectedEntryId)
      setCompletionReview(result.completion)
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === selectedEntryId
            ? { ...entry, isComplete: true, isLocked: result.completion.isLocked, submittedAt: result.completion.submittedAt }
            : entry
        )
      )
      if (result.view) {
        applyChallengeView(normalizeWorldCupView(result.view))
      }
      toast.success("Bracket submitted")
    } catch (err) {
      const maybeCompletion = (err as { completion?: WorldCupEntryCompletionReviewClient })?.completion
      if (maybeCompletion) setCompletionReview(maybeCompletion)
      setCompletionError(err instanceof Error ? err.message : "Failed to finalize entry")
    } finally {
      isFinalizingEntryRef.current = false
      setIsFinalizingEntry(false)
    }
  }, [applyChallengeView, challengeId, hasUnsavedGroupChanges, knockoutPicksLockedByMode, selectedEntryId])

  // ── Pick saving ──────────────────────────────────────────────────────────
  async function persistPick(match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) {
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
    if (knockoutPicksLockedByMode) {
      setSaveState("error")
      setSaveError(t("wc.knockouts.intro.reseeded"))
      toast.error(t("wc.knockouts.intro.reseeded"))
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
    if (savingPickMatchIdsRef.current.has(match.id)) {
      setSaveState("saving")
      setSaveError("That pick is still saving. Please try again.")
      toast.info("That pick is still saving. Please try again.")
      return
    }
    const invalidIds = getInvalidDownstreamPickIds(
      baseKnockoutMatches,
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
      confidencePoints: view.challenge.confidenceScoringEnabled ? confidencePoints ?? null : null,
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
    savingPickMatchIdsRef.current.add(match.id)
    setSavingPickMatchIds(new Set(savingPickMatchIdsRef.current))

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
        confidencePoints: view.challenge.confidenceScoringEnabled ? confidencePoints ?? null : null,
      })

      // Keep pick saves fast: the save route returns entry/pick state only.
      // Admin/leaderboard/review paths refresh the full challenge view when needed.
      if (result.view) {
        applyChallengeView(normalizeWorldCupView(result.view))
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
      refreshCompletionReviewAfterMeaningfulEdit()

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
    } finally {
      savingPickMatchIdsRef.current.delete(match.id)
      setSavingPickMatchIds(new Set(savingPickMatchIdsRef.current))
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
    setIntegrityUnavailable(false)
    try {
      const report = await getWorldCupIntegrityReport(challengeId)
      setIntegrityReport(report)
      if (report.ok) {
        toast.success("Integrity check passed")
      } else {
        toast.error(`Integrity check found ${report.errors.length} error(s)`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Integrity check failed"
      if (/route not found/i.test(message)) {
        setIntegrityUnavailable(true)
        toast.error("Integrity checks are temporarily unavailable from this panel.")
      } else {
        toast.error(message)
      }
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

  const runSyncGroupStandings = useCallback(async () => {
    setIsSyncing(true)
    setSyncStandingsResult(null)
    try {
      const result = await adminSyncWorldCupGroupStandings(challengeId, { provider: syncProvider })
      setSyncStandingsResult(result)
      if (result.view) {
        setView(result.view)
      } else {
        await refreshChallengeView()
      }
      toast.success(`Group standings synced: ${result.result.groupTeamsUpdated} team result(s) updated`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync group standings failed")
    } finally {
      setIsSyncing(false)
    }
  }, [challengeId, refreshChallengeView, syncProvider])

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
      setSimulationResult({
        action: "Simulate Match",
        ok: response.ok,
        dryRun: response.result.dryRun,
        summary: summarizeSimulationPayload(response),
        warnings: [],
      })
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Dry run complete" : "Match simulated")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Simulate match failed"
      setSimulationResult({
        action: "Simulate Match",
        ok: false,
        dryRun: simulationDryRun,
        summary: {},
        warnings: [],
        error: message,
      })
      toast.error(message)
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun, simulationMatchId])

  const runSimulateRound = useCallback(async () => {
    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminSimulateWorldCupRound(challengeId, {
        round: simulationRound,
        strategy: simulationStrategy,
        dryRun: simulationDryRun,
      })
      setSimulationResult({
        action: "Simulate Round",
        ok: response.ok,
        dryRun: response.result.dryRun,
        summary: summarizeSimulationPayload(response),
        warnings: [],
      })
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Round dry run complete" : "Round simulated")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Simulate round failed"
      setSimulationResult({
        action: "Simulate Round",
        ok: false,
        dryRun: simulationDryRun,
        summary: {},
        warnings: [],
        error: message,
      })
      toast.error(message)
    } finally {
      setIsSimulating(false)
    }
  }, [challengeId, refreshChallengeView, simulationDryRun, simulationRound, simulationStrategy])

  const runSimulateTournament = useCallback(async () => {
    setIsSimulating(true)
    setSimulationResult(null)
    try {
      const response = await adminSimulateWorldCupTournament(challengeId, {
        strategy: simulationStrategy,
        dryRun: simulationDryRun,
      })
      setSimulationResult({
        action: "Simulate Full Tournament",
        ok: response.ok,
        dryRun: response.result.dryRun,
        summary: summarizeSimulationPayload(response),
        warnings: [],
      })
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Tournament dry run complete" : "Tournament simulated")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Simulate tournament failed"
      setSimulationResult({
        action: "Simulate Full Tournament",
        ok: false,
        dryRun: simulationDryRun,
        summary: {},
        warnings: [],
        error: message,
      })
      toast.error(message)
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
      setSimulationResult({
        action: "Reset Simulation",
        ok: response.ok,
        dryRun: response.result.dryRun,
        summary: summarizeSimulationPayload(response),
        warnings: [],
      })
      if (!simulationDryRun) {
        await refreshChallengeView()
      }
      toast.success(simulationDryRun ? "Reset dry run complete" : "Simulation reset")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reset simulation failed"
      setSimulationResult({
        action: "Reset Simulation",
        ok: false,
        dryRun: simulationDryRun,
        summary: {},
        warnings: [],
        error: message,
      })
      toast.error(message)
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
      setSimulationResult({
        action: "Load Test Fixtures",
        ok: response.ok,
        dryRun: simulationDryRun,
        summary: summarizeSimulationPayload(response),
        warnings: response.result.warnings ?? [],
      })
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
      toast.success(simulationDryRun ? "Load Test Fixtures dry run complete" : "Test fixtures loaded successfully")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load test fixtures"
      setSimulationResult({
        action: "Load Test Fixtures",
        ok: false,
        dryRun: simulationDryRun,
        summary: {},
        warnings: [],
        error: message,
      })
      toast.error(message)
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
  const firstUnpickedMatch = useMemo(
    () => projectedMatches.find((match) => match.id === firstUnpickedMatchId) ?? null,
    [firstUnpickedMatchId, projectedMatches]
  )
  const blockedFuturePickCount = useMemo(
    () =>
      projectedMatches.filter(
        (match) =>
          (match.round !== "third_place" || view.challenge.includeThirdPlace) &&
          !isWorldCupMatchPickable(match)
      ).length,
    [projectedMatches, view.challenge.includeThirdPlace]
  )
  const computedIsComplete =
    !knockoutPicksLockedByMode &&
    projectedPickableMatchCount > 0 &&
    completedPickCount > 0 &&
    remainingPicks === 0
  const simulationResultChecklist = useMemo(() => {
    if (!simulationResult) return []
    const summary = simulationResult.summary
    const simulatedMatches = Number(summary.simulatedMatches ?? 0)
    const skippedMatches = Number(summary.skippedMatches ?? 0)
    const skippedMatchIds = Array.isArray(summary.skippedMatchIds) ? summary.skippedMatchIds : []
    const advancedMatchIds = Array.isArray(summary.advancedMatchIds) ? summary.advancedMatchIds : []
    const leaderboardTop = Array.isArray(summary.leaderboardTop) ? summary.leaderboardTop : []
    const unresolvedMatchesAfter =
      typeof summary.unresolvedMatchesAfter === "number" ? summary.unresolvedMatchesAfter : undefined
    const champion = summary.champion
    const recalculated = summary.recalculated
    const isFullTournament = simulationResult.action === "Simulate Full Tournament"
    return [
      {
        label: "Did request return 200?",
        value: simulationResult.ok,
        detail: simulationResult.ok ? "OK" : simulationResult.error ?? "Request failed",
      },
      {
        label: "Did any matches get skipped?",
        value: skippedMatches > 0 ? false : true,
        detail: skippedMatches > 0 ? `${skippedMatches} skipped (${skippedMatchIds.join(", ") || "no ids"})` : "No skipped matches reported",
      },
      {
        label: "Are there unresolved matches?",
        value: unresolvedMatchesAfter === undefined ? null : unresolvedMatchesAfter === 0,
        detail: unresolvedMatchesAfter === undefined ? "Not reported by this action" : `${unresolvedMatchesAfter} unresolved`,
      },
      {
        label: "Did winner advancement happen?",
        value: advancedMatchIds.length > 0 || simulatedMatches > 0 ? true : null,
        detail: advancedMatchIds.length > 0 ? `${advancedMatchIds.length} slot(s) advanced` : simulatedMatches > 0 ? "Simulation returned completed matches" : "Not reported by this action",
      },
      {
        label: "Did leaderboard recalc happen?",
        value: recalculated === true || leaderboardTop.length > 0 ? true : recalculated === false ? false : null,
        detail: recalculated === true ? "Recalculated" : leaderboardTop.length > 0 ? `${leaderboardTop.length} leaderboard row(s)` : "Not reported by this action",
      },
      {
        label: "Did champion resolve after full tournament?",
        value: isFullTournament ? Boolean(champion) : null,
        detail: isFullTournament ? String(champion ?? "No champion returned") : "Only checked after full tournament",
      },
      {
        label: "Were any errors returned?",
        value: simulationResult.error ? false : true,
        detail: simulationResult.error ?? (simulationResult.warnings.length > 0 ? `${simulationResult.warnings.length} warning(s)` : "No errors returned"),
      },
    ]
  }, [simulationResult])
  const guidedPickerAvailable =
    !isLocked &&
    !knockoutPicksLockedByMode &&
    projectedPickableMatchCount > 0 &&
    (remainingPicks > 0 || computedIsComplete)
  const guidedPickerLabel =
    isLocked
      ? t("wc.guided.headerLocked")
      : knockoutPicksLockedByMode
        ? t("wc.pickHelp.knockoutLocked")
      : projectedPickableMatchCount === 0
        ? t("wc.guided.headerFixturesNotReady")
        : completedPickCount === 0
          ? t("wc.guided.headerStart")
          : remainingPicks > 0
            ? t("wc.pickHelp.continueGuided")
            : t("wc.pickHelp.reviewGuided")
  const openNextActionablePick = useCallback(() => {
    if (knockoutPicksLockedByMode) {
      toast.info(t("wc.knockouts.intro.reseeded"))
      return
    }
    if (!guidedPickerAvailable || !firstUnpickedMatchId) {
      toast.info(
        blockedFuturePickCount > 0
          ? t("wc.pickHelp.picksBlocked")
          : t("wc.knockouts.guidance.noneReady")
      )
      return
    }
    setGuidedInitialMatchId(firstUnpickedMatchId)
    setIsGuidedPickerOpen(true)
  }, [blockedFuturePickCount, firstUnpickedMatchId, guidedPickerAvailable, knockoutPicksLockedByMode])
  const showSeedTestFixturesCta =
    !isLocked &&
    knockoutMode !== "reseeded" &&
    (view.isOwner || view.isAdmin) &&
    (guidedPicksState === "fixtures_not_synced" || guidedPicksState === "fixtures_not_ready")

  const participantCount = Math.max(
    view.leaderboard.length > 0 ? new Set(view.leaderboard.map((row) => row.userId)).size : 0,
    view.participant ? 1 : 0
  )
  const inviteUrl = getBrowserWorldCupInviteUrl({
    inviteCode: view.challenge.inviteCode,
    fallbackInviteUrl: view.challenge.inviteUrl,
  })
  const fixturesReadyLabel =
    knockoutPicksLockedByMode
      ? t("wc.home.fixtureReady.knockoutLocked")
      : guidedPicksState === "ready"
      ? (projectedPickableMatchCount === 1
          ? t("wc.home.fixtureReady.readySingle", { n: projectedPickableMatchCount })
          : t("wc.home.fixtureReady.readyPlural", { n: projectedPickableMatchCount }))
      : guidedPicksState === "fixtures_not_synced"
        ? t("wc.home.fixtureReady.notSynced")
        : t("wc.home.fixtureReady.notReady")

  async function copyPoolInvite() {
    if (!inviteUrl) return
    await navigator.clipboard?.writeText(getBrowserWorldCupInviteUrl({
      inviteCode: view.challenge.inviteCode,
      fallbackInviteUrl: view.challenge.inviteUrl,
    }))
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
        baseKnockoutMatches,
        currentPicks,
        payload.matchId,
        payload.selectedTeamId
      )
      const invalidMatchIds = invalidIds
        .map((id) => currentPicks.find((p) => p.id === id)?.matchId)
        .filter((mid): mid is string => mid !== undefined)
        .filter((mid) => mid !== payload.matchId)
      const projectedForSave = buildWorldCupProjectedMatches(baseKnockoutMatches, currentPicks)
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
        confidencePoints: view.challenge.confidenceScoringEnabled ? payload.confidencePoints ?? null : null,
      })

      const returnedPicks = Array.isArray(result.picks)
        ? (result.picks as WorldCupPickView[])
        : currentPicks

      // Update shell entry picks state
      markEntryPicksLoaded(selectedEntryId, returnedPicks)
      refreshCompletionReviewAfterMeaningfulEdit()

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

      // Save responses are intentionally minimal so later-round picks remain fast.
      // Full challenge refreshes happen from explicit dashboard/leaderboard/review actions.
      if (result.view) {
        applyChallengeView(normalizeWorldCupView(result.view))
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
    [applyChallengeView, baseKnockoutMatches, challengeId, isLocked, markEntryPicksLoaded, refreshCompletionReviewAfterMeaningfulEdit, selectedEntryId]
  )

  // Whether to show the full picks board or the entry dashboard
  const showBoard = tab === "picks" && selectedEntry !== null

  useEffect(() => {
    if (tab !== "picks") return
    window.requestAnimationFrame(() => {
      if (knockoutScrollRef.current) knockoutScrollRef.current.scrollLeft = 0
      const nestedBoard = knockoutScrollRef.current?.querySelector<HTMLElement>('[data-testid="world-cup-knockout-board-scroll"]')
      if (nestedBoard) nestedBoard.scrollLeft = 0
    })
  }, [selectedEntryId, tab])

  const scrollToAnchor = useCallback(
    (anchorId: string, nextTab?: Tab) => {
      const tabChanged = Boolean(nextTab && tab !== nextTab)
      if (nextTab && tab !== nextTab) {
        if (!confirmLeavingGroupStage()) return
        if (tab === "group-stage") setHasUnsavedGroupChanges(false)
        setTab(nextTab)
        updateTabUrl(nextTab)
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
    [confirmLeavingGroupStage, tab, updateTabUrl]
  )

  return (
    // `mode-readable` opts the entire dashboard shell into the
    // globals.css light-mode rescue layer so muted labels, tab text,
    // and helper copy stay readable on white. Dark + AF (legacy) modes
    // keep the original `bg-[#05070b]` styling unchanged.
    <div id="world-cup-top" data-wc-dark className="mode-readable fixed inset-0 z-50 flex flex-col bg-[#05070b] text-white">
      <header className="shrink-0 border-b border-white/10 bg-zinc-950/95 backdrop-blur pt-[env(safe-area-inset-top,0px)]">
        <div className="flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-4 sm:py-2">
          {showBoard ? (
            <button
              type="button"
              onClick={() => {
                setSelectedEntryId(null)
                persistSelectedEntryId(null)
                syncSelectedEntryUrl(null, "push")
              }}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              title="Back to Knockouts"
              aria-label="Back to Knockouts"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link
              href="/brackets"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              aria-label="Back to brackets hub"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {showBoard && headerRenameOpen ? (
              <form
                className="flex min-w-0 items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const nextName = headerRenameValue.trim()
                  if (!selectedEntry || nextName.length < 2 || nextName.length > 60) return
                  void handleRenameEntry(selectedEntry.id, nextName).then(() => setHeaderRenameOpen(false))
                }}
              >
                <input
                  autoFocus
                  value={headerRenameValue}
                  onChange={(event) => setHeaderRenameValue(event.target.value)}
                  maxLength={64}
                  className="min-w-0 flex-1 rounded-lg border border-cyan-300/30 bg-black/40 px-2 py-1 text-sm font-black text-white outline-none"
                  aria-label="Bracket name"
                />
                <button
                  type="submit"
                  disabled={headerRenameValue.trim().length < 2 || headerRenameValue.trim().length > 60 || isMutatingEntry}
                  className="rounded-lg bg-cyan-300 px-2 py-1 text-[11px] font-black text-black disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setHeaderRenameOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-1 text-white/55"
                  aria-label="Cancel rename"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-sm font-black leading-tight tracking-tight text-white sm:text-lg lg:text-xl">
                  {showBoard ? selectedEntry!.name : view.challenge.name}
                </h1>
                {!showBoard && (view.isOwner || view.isAdmin) && (
                  <span className="shrink-0 rounded-full border border-amber-300/40 bg-gradient-to-r from-amber-400/20 to-amber-300/[0.08] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-white/80 shadow-[0_0_14px_-3px_rgba(251,191,36,0.45)]">
                    {view.isAdmin && !view.isOwner ? "Admin" : "Commissioner"}
                  </span>
                )}
                {showBoard && selectedEntry ? (
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderRenameValue(selectedEntry.name)
                      setHeaderRenameOpen(true)
                    }}
                    disabled={isMutatingEntry}
                    className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/45 hover:text-white disabled:opacity-40"
                    aria-label="Rename bracket"
                    title="Rename bracket"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            )}
            <p className={`text-[10px] sm:text-[11px] ${saveState === "locked" || saveState === "error" ? "text-white/70" : "text-white/45"}`}>
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
            {hasMounted && lockCountdownLabel ? (
              <p
                data-testid="world-cup-lock-countdown"
                className="mt-1 inline-flex max-w-full items-center rounded-md bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-white/80"
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
              className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              {t("wc.header.sync")}
            </button>
          ) : null}
          {/* Language picker — reuses the global LanguageToggle component so
              the choice persists app-wide via localStorage `af_lang` + the
              UserProfile preferredLanguage write inside LanguageToggle.
              The "compact" variant shows a globe icon + native language
              names so it fits cleanly inside the dense pool header.
              Phase 6 update: shown on mobile too (was `sm:block` only).
              The compact pill caps its width at 12rem so it never pushes
              the Invite CTA off small screens. */}
          <div data-testid="wc-shell-language-toggle">
            <LanguageToggle variant="compact" />
          </div>
          {(view.isOwner || view.isAdmin) && (
            <button
              type="button"
              onClick={() => switchTab("invite")}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-300 to-cyan-200 px-3 py-2 text-xs font-black text-black shadow-[0_6px_20px_-8px_rgba(34,211,238,0.6)] transition-transform hover:scale-[1.03] active:scale-[0.97] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:min-h-0 sm:min-w-0"
              aria-label={t("wc.header.inviteAria")}
              data-testid="wc-shell-invite-btn"
            >
              <Share2 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">{t("wc.header.invite")}</span>
            </button>
          )}
        </div>
        {saveError && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-rose-400/35 bg-gradient-to-r from-rose-500/15 to-rose-400/[0.06] px-3 py-2 text-xs text-white/85">
            <span className="mt-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" aria-hidden />
            <span>{saveError}</span>
          </div>
        )}
        {(view.challenge.isTestMode || view.challenge.simulationEnabled || view.challenge.hasSimulatedResults) && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-amber-400/[0.06] px-3 py-2 text-[11px] text-white/80">
            <span className="mt-1 inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-300" aria-hidden />
            <span>
              <span className="font-black uppercase tracking-[0.14em]">{t("wc.header.testMode")}</span> — {t("wc.header.testModeNote")}
            </span>
          </div>
        )}
        <WorldCupLiveScoreTicker matches={view.matches} />
        <nav
          aria-label="Section tabs"
          className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] sm:px-4 sm:pb-2.5 [&::-webkit-scrollbar]:hidden"
        >
          {tabList.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`group inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors duration-150 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 ${
                tab === id
                  ? "border-cyan-300/45 bg-gradient-to-b from-cyan-300/20 to-cyan-300/10 text-white/90 shadow-[0_4px_18px_-6px_rgba(34,211,238,0.45)]"
                  : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/15 hover:bg-white/[0.07] hover:text-white/85"
              }`}
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
          className="sticky top-0 z-40 border-b border-white/10 bg-[#04060acc]/95 px-1 py-1 backdrop-blur sm:px-2"
        >
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:justify-center sm:pb-0 touch-pan-x">
            <JumpButton label={t("wc.subnav.top")} onClick={() => scrollToAnchor("world-cup-top")} />
            <JumpButton label={t("wc.tab.groupStage")} onClick={() => scrollToAnchor("world-cup-group-stage", "group-stage")} />
            <JumpButton label={t("wc.tab.picks")} onClick={() => scrollToAnchor("world-cup-picks", "picks")} />
            <JumpButton label={t("wc.subnav.roundOf32")} onClick={() => {
              scrollToAnchor("world-cup-bracket", "picks")
              window.requestAnimationFrame(() => {
                if (knockoutScrollRef.current) knockoutScrollRef.current.scrollLeft = 0
                const nestedBoard = knockoutScrollRef.current?.querySelector<HTMLElement>('[data-testid="world-cup-knockout-board-scroll"]')
                if (nestedBoard) nestedBoard.scrollLeft = 0
              })
            }} />
            {(view.isOwner || view.isAdmin) ? (
              <JumpButton label={t("wc.subnav.adminTest")} onClick={() => scrollToAnchor("world-cup-admin", "picks")} />
            ) : null}
            <JumpButton label={t("wc.tab.leaderboard")} onClick={() => scrollToAnchor("world-cup-leaderboard", "leaderboard")} />
            {(view.isOwner || view.isAdmin) ? (
              <JumpButton label={t("wc.tab.invite")} onClick={() => scrollToAnchor("world-cup-invite", "invite")} />
            ) : null}
          </div>
        </nav>

        {tab === "picks" && showBoard ? (
          <div className="sticky top-0 z-30 border-b border-white/10 bg-[#05070b]/92 px-3 py-2 backdrop-blur sm:hidden">
            <button
              data-testid="world-cup-mobile-start-picks-cta"
              type="button"
              disabled={!guidedPickerAvailable}
              onClick={openNextActionablePick}
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
                onClick={openNextActionablePick}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-cyan-300/45"
              >
                <PlayCircle className="h-4 w-4" />
                {guidedPickerLabel}
              </button>
            </div>
          ) : (
            <div className="flex justify-center px-4 py-2">
              <span className="rounded-lg border border-rose-400/30 bg-rose-400/15 px-3 py-2 text-xs font-bold text-white/85">{t("wc.lock.bracketLocked")}</span>
            </div>
          )}

          {!isLocked && guidedPicksState === "fixtures_not_synced" && (
            <div className="px-4 pb-3 text-center text-[11px] text-white/50">
              <p>{t("wc.pickHelp.fixturesNotSynced")}</p>
              {showSeedTestFixturesCta && (
                <div className="mt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadTestFixtures()}
                    disabled={isLoadingTestFixtures || isSimulating}
                    className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-4 py-2 text-[12px] font-bold text-white/80 hover:bg-amber-900/60 disabled:opacity-50"
                  >
                    {isLoadingTestFixtures ? t("wc.pickHelp.seeding") : t("wc.pickHelp.seedBtn")}
                  </button>
                </div>
              )}
            </div>
          )}

          {!isLocked && guidedPicksState === "fixtures_not_ready" && (
            <div className="mx-4 mb-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-white/80">
              <p className="mb-2 text-center">
                {t("wc.pickHelp.knockoutFromGroups")}
              </p>
              {showSeedTestFixturesCta && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadTestFixtures()}
                    disabled={isLoadingTestFixtures || isSimulating}
                    className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-4 py-2 text-[12px] font-bold text-white/80 hover:bg-amber-900/60 disabled:opacity-50"
                  >
                    {isLoadingTestFixtures ? t("wc.pickHelp.seeding") : t("wc.pickHelp.seedBtn")}
                  </button>
                </div>
              )}
            </div>
          )}

          {process.env.NODE_ENV === "development" && (view.isOwner || view.isAdmin) && (
            <div className="mx-4 mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] text-white/55">
              Debug counts: total matches {view.matches.length} · pickable matches {pickableMatches.length} · unresolved matches {Math.max(unresolvedMatchesCount, 0)}
            </div>
          )}

          {selectedEntry && (
            <div className="mx-3 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:mx-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/85">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("wc.pickHelp.title")}
              </div>
              <p className="text-xs leading-5 text-white/50">
                {t("wc.pickHelp.body")}
              </p>
            </div>
          )}

          {selectedEntry && (
            <WorldCupBracketHealthCard
              entry={selectedEntry}
              matches={projectedMatches}
              picks={picks}
            />
          )}

          {(view.isOwner || view.isAdmin) && (
            <>
            <div id="world-cup-admin" className="mx-4 mb-2 h-0" aria-hidden="true" />
            <WorldCupReadinessPanel
              challengeId={challengeId}
              seasonYear={view.challenge.seasonYear}
            />
            <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-white/60">Admin Integrity</div>
                <button
                  type="button"
                  onClick={() => void runIntegrityCheck()}
                  disabled={isIntegrityLoading || integrityUnavailable}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-60"
                >
                  {isIntegrityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Run Integrity Check
                </button>
              </div>
              {integrityUnavailable ? (
                <p className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] text-white/80">
                  Integrity checks are temporarily unavailable from this panel.
                </p>
              ) : null}
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
                    <p key={err} className="text-white/70">✗ {err}</p>
                  ))}
                  {integrityReport.warnings.slice(0, 3).map((warn) => (
                    <p key={warn} className="text-white/70">⚠ {warn}</p>
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
                            ? "text-white/85"
                            : ok === false
                            ? "text-white/80"
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
                              ? "text-white/70"
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
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/75">
                World Cup Simulation Panel
              </div>
              <p className="mb-3 text-[11px] text-white/65">
                Owner/admin only. Testing only. Simulated results can change scores and leaderboard standings when dry run is off.
              </p>
              {!simulationDryRun && (
                <div
                  data-testid="world-cup-simulation-live-warning"
                  className="mb-3 rounded-lg border border-rose-400/40 bg-rose-950/30 p-2 text-[11px] font-semibold text-white/85"
                >
                  Dry run is OFF. The next simulation click can write match results, advance winners, and recalculate the leaderboard.
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLoadTestFixtures()}
                  disabled={isLoadingTestFixtures || isSimulating}
                  title="Adds demo teams to unresolved Round of 32 matches so picks and simulation can be tested before real World Cup fixtures are synced."
                  className="rounded-lg border border-amber-400/50 bg-amber-900/30 px-3 py-1.5 text-[11px] font-bold text-white/80 hover:bg-amber-900/50 disabled:opacity-50"
                >
                  {isLoadingTestFixtures ? "Loading..." : "Load Test Fixtures"}
                </button>
              </div>
              <p className="mb-3 text-[11px] text-white/65">
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
                  aria-label="Simulation strategy"
                >
                  <option value="random">Random</option>
                  <option value="higher_seed">Higher seed</option>
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                </select>
                <select
                  value={simulationRound}
                  onChange={(e) => setSimulationRound(e.target.value as WorldCupAdminSimulationRound)}
                  disabled={isSimulating}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white/80"
                  aria-label="Simulation round"
                >
                  {WORLD_CUP_ADMIN_SIMULATION_ROUNDS.map((round) => (
                    <option key={round.value} value={round.value}>
                      {round.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  value={simulationMatchId}
                  onChange={(e) => setSimulationMatchId(e.target.value)}
                  disabled={isSimulating}
                  className="min-w-[220px] rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-white/80"
                  aria-label="Match ID required for simulate match"
                  placeholder="Match ID required"
                  list="world-cup-simulation-match-ids"
                />
                <datalist id="world-cup-simulation-match-ids">
                  {view.matches.map((match) => (
                    <option key={match.id} value={match.id}>
                      M{match.matchNumber} · {match.homeTeamName} vs {match.awayTeamName}
                    </option>
                  ))}
                </datalist>

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
                  className="rounded-lg border border-cyan-400/30 bg-cyan-900/30 px-3 py-1.5 text-[11px] font-bold text-white/90 disabled:opacity-50"
                >
                  Simulate Full Tournament
                </button>
                <button
                  type="button"
                  onClick={() => void runResetSimulation()}
                  disabled={isSimulating}
                  className="rounded-lg border border-rose-400/30 bg-rose-900/20 px-3 py-1.5 text-[11px] font-bold text-white/85 disabled:opacity-50"
                >
                  Reset Simulation
                </button>
              </div>
              {!simulationMatchId ? (
                <p className="mb-2 text-[11px] text-white/70">
                  Select or enter a Match ID before simulating.
                </p>
              ) : null}

              {simulationResult && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 text-[11px] text-white/75">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-white">{simulationResult.action}</span>
                    <span className={simulationResult.dryRun ? "text-white/85" : "text-white/75"}>
                      {simulationResult.dryRun ? "Dry run" : "Writes enabled"}
                    </span>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/35 p-2 text-[10px] leading-relaxed text-white/70">
                    {JSON.stringify(simulationResult.summary, null, 2)}
                  </pre>
                  {simulationResult.warnings.length > 0 && (
                    <div className="mt-2 text-white/75">
                      Warnings: {simulationResult.warnings.join("; ")}
                    </div>
                  )}
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {simulationResultChecklist.map((item) => (
                      <div key={item.label} className="flex gap-2 rounded-md bg-white/[0.03] px-2 py-1.5">
                        <span className={item.value === true ? "text-white/85" : item.value === false ? "text-white/70" : "text-white/40"}>
                          {item.value === true ? "✓" : item.value === false ? "✗" : "○"}
                        </span>
                        <span>
                          <span className="font-semibold text-white/80">{item.label}</span>
                          <span className="ml-1 text-white/45">— {item.detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-cyan-900/30 px-3 py-1.5 text-[11px] font-bold text-white/85 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                  Sync Live Scores
                </button>
                <button
                  type="button"
                  onClick={() => void runSyncGroupStandings()}
                  disabled={isSyncing || syncDryRun}
                  title={syncDryRun ? "Disable dry run before applying official standings." : "Apply provider group standings, derive third-place actuals, and recalculate leaderboard."}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/80 disabled:opacity-50"
                >
                  {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListOrdered className="h-3.5 w-3.5" />}
                  Sync Group Standings
                </button>
              </div>

              {/* Sync results */}
              {syncTeamsResult && (
                <SyncResultRow
                  label="Teams"
                  result={syncTeamsResult}
                  extra={
                    syncTeamsResult.officialGroupsReady
                      ? `Official groups ready (${syncTeamsResult.groupsAssigned ?? 0}/48 assigned)`
                      : syncTeamsResult.incompleteGroups?.length
                        ? `${syncTeamsResult.groupsAssigned ?? 0}/48 assigned; ${syncTeamsResult.incompleteGroups.length} incomplete group(s)`
                        : undefined
                  }
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
                    {syncLiveResult.dryRun && <span className="text-white/70">dry run</span>}
                  </div>
                  {syncLiveResult.warnings.slice(0, 2).map((w) => (
                    <p key={w} className="mt-1 text-white/70">{w}</p>
                  ))}
                  <p className="mt-1 text-white/30">{new Date(syncLiveResult.syncedAt).toLocaleTimeString()}</p>
                </div>
              )}
              {syncStandingsResult && (
                <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11px]">
                  <div className="flex flex-wrap gap-3 text-white/60">
                    <span>Standings <span className="font-bold text-white/80">{syncStandingsResult.result.standingsReceived}</span></span>
                    <span>Groups <span className="font-bold text-white/80">{syncStandingsResult.result.groupsUpdated}</span></span>
                    <span>Teams <span className="font-bold text-white/80">{syncStandingsResult.result.groupTeamsUpdated}</span></span>
                    <span>Third-place <span className="font-bold text-white/80">{syncStandingsResult.result.thirdPlaceTeamsUpdated}</span></span>
                  </div>
                  {syncStandingsResult.result.warnings?.slice(0, 2).map((w) => (
                    <p key={w} className="mt-1 text-white/70">{w}</p>
                  ))}
                  <p className="mt-1 text-white/30">{new Date(syncStandingsResult.syncedAt).toLocaleTimeString()}</p>
                </div>
              )}
            </div>
            </>
          )}
        </div>
      )}

      <main className="min-h-0 px-2 pb-24 pt-3 sm:px-4 sm:pb-8">
        {tab === "home" ? (
          <div className="space-y-4 pb-28 sm:pb-8">

            {/* ── Pool Command Hero ──────────────────────────────────────────────── */}
            <section
              data-testid="world-cup-pool-command-hero"
              className="mx-auto max-w-5xl px-2 sm:px-0"
            >
              <div className="relative overflow-hidden rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.07] via-indigo-500/[0.04] to-transparent p-5 sm:p-6">
                {/* Atmospheric glows */}
                <div className="pointer-events-none absolute -top-14 right-4 h-36 w-48 rounded-full bg-cyan-400/15 blur-3xl" aria-hidden />
                <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-36 rounded-full bg-indigo-500/10 blur-2xl" aria-hidden />

                {/* Eyebrow + badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">
                    {t("wc.pool.eyebrow")}
                  </span>
                  {view.challenge.visibility === "private" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/55">
                      <Lock className="h-2.5 w-2.5" aria-hidden />
                      {t("wc.pool.privateBadge")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/60">
                      <Globe2 className="h-2.5 w-2.5" aria-hidden />
                      {t("wc.pool.publicBadge")}
                    </span>
                  )}
                  {(view.isOwner || view.isAdmin) && (
                    <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/80">
                      {view.isAdmin && !view.isOwner ? "Admin" : "Commissioner"}
                    </span>
                  )}
                </div>

                {/* Pool name */}
                <h2 className="mt-2 truncate text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {view.challenge.name}
                </h2>

                {/* Participant count + lock countdown */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-white/50">
                    {participantCount} / {view.challenge.maxParticipants} {t("wc.home.stat.participants").toLowerCase()}
                  </span>
                  {hasMounted && lockCountdownLabel && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2 py-0.5 text-[11px] font-bold text-white/80">
                      <Clock className="h-3 w-3" aria-hidden />
                      {lockCountdownLabel}
                    </span>
                  )}
                </div>

                {/* Invite CTAs */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyPoolInvite}
                    disabled={!inviteUrl}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-white/90 disabled:opacity-40"
                  >
                    <Copy className="h-4 w-4" />
                    {t("wc.home.copyInvite")}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchTab("invite")}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-bold text-white/75"
                  >
                    <Share2 className="h-4 w-4" />
                    {t("wc.home.invitePanel")}
                  </button>
                </div>

                {/* Stat grid */}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PoolStatCard label={t("wc.home.stat.participants")} value={`${participantCount}/${view.challenge.maxParticipants}`} />
                  <PoolStatCard label={t("wc.home.stat.entries")} value={`${entries.length}/${view.challenge.maxEntriesPerParticipant}`} />
                  <PoolStatCard label={t("wc.home.stat.finalized")} value={String(view.leaderboard.length)} />
                  <PoolStatCard label={t("wc.home.stat.fixtureStatus")} value={guidedPicksState === "ready" ? t("wc.home.stat.ready") : t("wc.home.stat.notReady")} tone={guidedPicksState === "ready" ? "ready" : "warn"} />
                </div>
              </div>
            </section>

            {/* ── What To Do Next ────────────────────────────────────────────────── */}
            {!isEntriesLoading && (() => {
              const isFinalized = Boolean(selectedEntry?.isComplete)
              const hasPendingPicks = entries.length > 0 && guidedPicksState === "ready" && remainingPicks > 0
              const readyToReview = computedIsComplete && selectedEntry && !selectedEntry.isComplete
              const awaitingFixtures = entries.length > 0 && guidedPicksState !== "ready" && !isFinalized
              const noEntry = entries.length === 0 && !isLocked
              if (!isFinalized && !readyToReview && !hasPendingPicks && !awaitingFixtures && !noEntry) return null

              const accentClasses =
                isFinalized ? "border-emerald-400/25 bg-emerald-400/[0.06]"
                : readyToReview ? "border-violet-400/25 bg-violet-400/[0.06]"
                : awaitingFixtures ? "border-amber-400/25 bg-amber-400/[0.06]"
                : "border-cyan-300/25 bg-cyan-300/[0.06]"
              const iconColorClass =
                isFinalized ? "text-white/85"
                : readyToReview ? "text-violet-300"
                : awaitingFixtures ? "text-white/70"
                : "text-white/85"
              const progressSteps = [
                { label: t("wc.pool.progress.created"), done: true },
                { label: t("wc.pool.progress.picks"), done: isFinalized || Boolean(readyToReview) },
                { label: t("wc.pool.progress.finalized"), done: isFinalized },
              ]
              return (
                <section
                  data-testid="world-cup-next-action-card"
                  className="mx-auto max-w-5xl px-2 sm:px-0"
                >
                  <div className={`rounded-2xl border p-4 sm:p-5 ${accentClasses}`}>
                    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                      {t("wc.pool.next.title")}
                    </p>
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] ${iconColorClass}`}>
                        {isFinalized ? <CheckCircle2 className="h-5 w-5" aria-hidden /> :
                         readyToReview ? <ClipboardCheck className="h-5 w-5" aria-hidden /> :
                         awaitingFixtures ? <Clock className="h-5 w-5" aria-hidden /> :
                         noEntry ? <Plus className="h-5 w-5" aria-hidden /> :
                         <PlayCircle className="h-5 w-5" aria-hidden />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-black text-white">
                          {isFinalized ? t("wc.pool.next.done.title") :
                           readyToReview ? t("wc.pool.next.review.title") :
                           awaitingFixtures ? t("wc.pool.next.waiting.title") :
                           noEntry ? t("wc.pool.next.create.title") :
                           t("wc.pool.next.picks.title")}
                        </h3>
                        <p className="mt-1 text-sm text-white/55">
                          {isFinalized ? t("wc.pool.next.done.body") :
                           readyToReview ? t("wc.pool.next.review.body") :
                           awaitingFixtures ? t("wc.pool.next.waiting.body") :
                           noEntry ? t("wc.pool.next.create.body") :
                           t("wc.pool.next.picks.body")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {noEntry && (
                            <button
                              type="button"
                              onClick={() => void handleCreateEntry()}
                              disabled={isCreatingEntry}
                              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40"
                            >
                              {isCreatingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                              {isCreatingEntry ? t("wc.review.creating") : t("wc.review.createMyBracket")}
                            </button>
                          )}
                          {hasPendingPicks && (
                            <button
                              type="button"
                              onClick={openNextActionablePick}
                              disabled={!guidedPickerAvailable}
                              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40"
                            >
                              <PlayCircle className="h-4 w-4" />
                              {guidedPickerLabel}
                            </button>
                          )}
                          {readyToReview && (
                            <button
                              type="button"
                              onClick={() => switchTab("review")}
                              className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-black text-white"
                            >
                              {t("wc.tab.review")}
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          )}
                          {isFinalized && (
                            <button
                              type="button"
                              onClick={() => switchTab("leaderboard")}
                              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-black text-white/90"
                            >
                              {t("wc.tab.leaderboard")}
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Progress strip */}
                    {entries.length > 0 && (
                      <div className="mt-4 flex items-center gap-1.5 border-t border-white/[0.07] pt-4">
                        <span className="mr-1 shrink-0 text-[10px] font-black uppercase tracking-wider text-white/30">
                          {t("wc.pool.progress.title")}
                        </span>
                        {progressSteps.map((step, idx) => (
                          <div key={step.label} className="flex min-w-0 items-center">
                            {idx > 0 && <div className={`mx-1 h-px w-4 shrink-0 ${step.done ? "bg-cyan-300/40" : "bg-white/10"}`} />}
                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${step.done ? "bg-cyan-300/15 text-white/85" : "bg-white/[0.04] text-white/30"}`}>
                              {step.done
                                ? <CheckCircle2 className="h-2.5 w-2.5 shrink-0" aria-hidden />
                                : <div className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20" aria-hidden />}
                              <span className="hidden sm:inline">{step.label}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )
            })()}

            <WorldCupPremiumAccessPanel
              entitlementSummary={entitlementSummary}
              maxEntriesPerParticipant={view.challenge.maxEntriesPerParticipant}
              currentEntryCount={entries.length}
              isOwnerOrAdmin={Boolean(view.isOwner || view.isAdmin)}
            />

            <WorldCupCommunityFoundationPanel
              challengeId={challengeId}
              entitlementSummary={entitlementSummary}
              poolName={view.challenge.name}
            />

            <section className="mx-auto max-w-[min(100%,1600px)] px-2 sm:px-4">
              <AllFantasyBracketBoard
                mode={dashboardPreviewMode === "starting" ? "preview" : "ai"}
                isReadOnly
                showBranding
                toolbar={
                  <WorldCupDashBracketPreviewToolbar
                    dashboardPreviewMode={dashboardPreviewMode}
                    setDashboardPreviewMode={setDashboardPreviewMode}
                    onOpenOrCreateBracket={() => {
                      if (selectedEntryId) {
                        handleSelectEntry(selectedEntryId)
                      } else if (entries[0]?.id) {
                        handleSelectEntry(entries[0].id)
                      } else {
                        void handleCreateEntry()
                      }
                    }}
                    isCreatingEntry={isCreatingEntry}
                    openDisabled={isCreatingEntry || (isLocked && !selectedEntryId && entries.length === 0)}
                    openLabel={selectedEntryId || entries.length > 0 ? t("wc.review.openMyBracket") : t("wc.review.createMyBracket")}
                  />
                }
              >
                {dashboardPreviewMode === "starting" ? (
                  <WorldCupCompactBracketPreview matches={view.matches} />
                ) : (
                  <AiSimulationLockPanel isCommissioner={Boolean(view.isOwner || view.isAdmin)} />
                )}
              </AllFantasyBracketBoard>
            </section>

            <section className="mx-auto max-w-5xl px-2 sm:px-0">
              <WorldCupRootingGuideCard
                entry={
                  selectedEntry
                    ? {
                        id: selectedEntry.id,
                        name: selectedEntry.name,
                        championTeamId:
                          view.leaderboard.find(
                            (row) => row.entryId === selectedEntry.id
                          )?.championTeamId ?? null,
                        championTeamName:
                          view.leaderboard.find(
                            (row) => row.entryId === selectedEntry.id
                          )?.championPickName ?? null,
                        isComplete: selectedEntry.isComplete,
                      }
                    : null
                }
                matches={view.matches}
                picks={picks}
                hasBracketBrainAi={aiInsightsUnlocked}
              />
            </section>

            {/* AI features teaser — always visible so users discover Chimmy + Explain My Bracket */}
            <section
              data-testid="world-cup-ai-features-teaser"
              className="mx-auto max-w-5xl px-2 sm:px-0"
            >
              <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.06] to-indigo-400/[0.04] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-white/65" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-black text-white">{t("wc.home.ai.title")}</h3>
                    {aiInsightsUnlocked ? (
                      <ul className="mt-2 space-y-1.5">
                        <li className="flex items-start gap-2 text-xs text-white/65">
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden />
                          {t("wc.home.ai.chimmyHint")}
                        </li>
                        <li className="flex items-start gap-2 text-xs text-white/65">
                          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300/60" aria-hidden />
                          <button
                            type="button"
                            onClick={() => switchTab("review")}
                            className="text-left text-white/65 underline-offset-2 hover:underline"
                          >
                            {t("wc.home.ai.explainHint")}
                          </button>
                        </li>
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-xs text-white/50">{t("wc.home.ai.unlockHint")}</p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Commissioner Quick Panel ──────────────────────────────────────── */}
            {(view.isOwner || view.isAdmin) && (
              <section
                data-testid="world-cup-commissioner-panel"
                className="mx-auto max-w-5xl px-2 sm:px-0"
              >
                <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.05] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                      <h3 className="text-sm font-black text-white">{t("wc.pool.commissioner.title")}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void runSyncFixtures()}
                        disabled={isSyncing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-white/75 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} aria-hidden />
                        {isSyncing ? t("wc.home.commissioner.syncing") : t("wc.home.commissioner.syncBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchTab("settings")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-bold text-white/80"
                      >
                        <Settings className="h-3 w-3" aria-hidden />
                        {t("wc.home.commissioner.settingsBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchTab("invite")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-1.5 text-[11px] font-bold text-white/90"
                      >
                        <Share2 className="h-3 w-3" aria-hidden />
                        {t("wc.home.commissioner.inviteBtn")}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="mx-auto grid max-w-5xl gap-4 px-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] sm:px-0">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-white">{t("wc.home.entries.title")}</h3>
                    <p className="mt-1 text-xs text-white/45">
                      {t("wc.entryList.subtitle")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateEntry}
                    disabled={isLocked || isCreatingEntry || entries.length >= view.challenge.maxEntriesPerParticipant}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isCreatingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {isCreatingEntry ? t("wc.review.creating") : t("wc.review.createMyBracket")}
                  </button>
                </div>

                {isEntriesLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/45">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("wc.home.entries.loading")}
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
                            {entry.isComplete ? t("wc.entryList.complete") : t("wc.entryList.notComplete")} · {entry.totalScore} {t("wc.lb.ptsLabel")} · {entry.rank ? t("wc.entryList.rank", { rank: entry.rank }) : t("wc.entryList.unranked")}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-black text-black">
                          {t("wc.entryList.openBracket")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
                    <Trophy className="mx-auto h-8 w-8 text-white/45" />
                    <p className="mt-3 text-sm font-black text-white">{t("wc.entryList.noBracketsTitle")}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {t("wc.entryList.noBracketsBody")}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <h3 className="text-base font-black text-white">{t("wc.home.fixtureReady.cardTitle")}</h3>
                  <p className="mt-1 text-sm text-white/55">{fixturesReadyLabel}</p>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/50">
                    {guidedPicksState === "ready" ? (
                      <p>{t("wc.home.fixtureReady.descReady")}</p>
                    ) : (
                      <p>
                        {t("wc.home.fixtureReady.descBlocked")}
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
                          className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-3 py-2 text-xs font-bold text-white/80 hover:bg-amber-900/60 disabled:opacity-50"
                        >
                          {isLoadingTestFixtures ? t("wc.pickHelp.seeding") : t("wc.pickHelp.seedBtn")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void runSyncFixtures()}
                        disabled={isSyncing}
                        className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/75 disabled:opacity-50"
                      >
                        {isSyncing ? t("wc.home.commissioner.syncing") : t("wc.home.commissioner.syncBtn")}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchTab("settings")}
                        className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/75"
                      >
                        {t("wc.home.fixtureReady.commissionerSettings")}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-base font-black text-white">{t("wc.pool.leaderboard.title")}</h3>
                    <button
                      type="button"
                      onClick={() => switchTab("leaderboard")}
                      className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white/85"
                    >
                      {t("wc.pool.leaderboard.viewFull")}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                  {view.leaderboard.length > 0 ? (
                    <div className="space-y-1.5">
                      {view.leaderboard.slice(0, 5).map((row) => {
                        const rankColor =
                          row.rank === 1 ? "text-white/70"
                          : row.rank === 2 ? "text-zinc-300"
                          : row.rank === 3 ? "text-white/55"
                          : "text-white/40"
                        return (
                          <div key={row.entryId} className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs">
                            <span className={`w-5 shrink-0 text-center font-black tabular-nums ${rankColor}`}>
                              {row.rank}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-white/70">{row.entryName}</span>
                            <span className="font-black text-white/90">{row.totalScore} pts</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-center">
                      <BarChart3 className="mx-auto h-6 w-6 text-white/25" />
                      <p className="mt-2 text-xs font-black text-white/50">{t("wc.pool.leaderboard.empty")}</p>
                      <p className="mt-0.5 text-xs text-white/30">{t("wc.pool.leaderboard.emptyNote")}</p>
                    </div>
                  )}
                </div>

              </div>
            </section>
          </div>
        ) : null}
        {tab === "picks" ? (
          selectedEntry ? (
            <section id="world-cup-bracket" className="space-y-3">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-white/90">
                <p className="font-black">
                  {knockoutMode === "reseeded"
                    ? t("wc.knockouts.intro.reseeded")
                    : t("wc.knockouts.intro.predictive")}
                </p>
                <p className="mt-1 text-xs text-white/65">
                  {knockoutMode === "reseeded"
                    ? t("wc.knockouts.subintro.reseeded")
                    : t("wc.knockouts.subintro.predictive")}
                </p>
                {knockoutGroupStageError ? (
                  <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs font-bold text-white/80">
                    {knockoutGroupStageError}
                  </p>
                ) : knockoutPicksLockedByMode ? (
                  <p
                    data-testid="world-cup-reseeded-knockout-locked"
                    className="mt-2 rounded-lg border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs font-bold text-white/80"
                  >
                    Reseeded Knockout is enabled. Official knockout fixtures are not available yet, so generated knockout picks are locked.
                  </p>
                ) : groupSeededKnockout.status !== "ready" ? (
                  <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs font-bold text-white/80">
                    {groupSeededKnockout.message}
                  </p>
                ) : null}
              </div>
              <WorldCupKnockoutDangerZonesCard
                entry={
                  selectedEntry
                    ? {
                        id: selectedEntry.id,
                        championTeamId:
                          view.leaderboard.find(
                            (row) => row.entryId === selectedEntry.id
                          )?.championTeamId ?? null,
                        championTeamName:
                          view.leaderboard.find(
                            (row) => row.entryId === selectedEntry.id
                          )?.championPickName ?? null,
                      }
                    : null
                }
                picks={picks}
                matches={view.matches}
                hasBracketBrainAi={aiInsightsUnlocked}
              />
              <div className="sticky top-[3.35rem] z-30 rounded-xl border border-white/10 bg-zinc-950/95 p-2 backdrop-blur sm:top-[3.6rem]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {!isLocked ? (
                    <button
                      type="button"
                      disabled={!guidedPickerAvailable || knockoutPicksLockedByMode}
                      onClick={openNextActionablePick}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-cyan-300/45"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {guidedPickerLabel}
                    </button>
                  ) : (
                    <span className="rounded-lg border border-rose-400/30 bg-rose-400/15 px-3 py-2 text-xs font-bold text-white/85">{t("wc.lock.bracketLocked")}</span>
                  )}
                  <div
                    data-testid="world-cup-knockout-pick-guidance"
                    className="min-w-[min(100%,24rem)] rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-white/55"
                  >
                    <p className="font-bold text-white/75">
                      {t("wc.knockouts.guidance.complete", {
                        done: progress.done,
                        required: progress.required,
                      })}
                    </p>
                    <p className="mt-1">
                      {firstUnpickedMatch
                        ? t("wc.knockouts.guidance.nextPick", {
                            matchNumber: firstUnpickedMatch.matchNumber,
                          })
                        : blockedFuturePickCount > 0
                          ? t("wc.knockouts.guidance.blocked")
                          : t("wc.knockouts.guidance.noneReady")}
                    </p>
                  </div>
                  {!isLocked && guidedPicksState !== "ready" ? (
                    <div className="min-w-[min(100%,22rem)] rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-white/80">
                      <p className="font-bold">
                        {knockoutMode === "reseeded" ? "Official knockout fixtures required." : "Knockout teams come from your group predictions."}
                      </p>
                      <p className="mt-1 text-white/65">
                        {knockoutMode === "reseeded"
                          ? "Do not fake official fixtures. Picks stay closed until provider fixtures are ready."
                          : groupSeededKnockout.message}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {showSeedTestFixturesCta ? (
                      <button
                        type="button"
                        onClick={() => void handleLoadTestFixtures()}
                        disabled={isLoadingTestFixtures || isSimulating}
                        className="rounded-lg border border-amber-400/60 bg-amber-900/40 px-3 py-2 text-[11px] font-bold text-white/80 hover:bg-amber-900/60 disabled:opacity-50"
                      >
                        {isLoadingTestFixtures ? "Loading..." : "Load Test Knockout Teams"}
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

              <div ref={knockoutScrollRef} data-testid="world-cup-bracket-scroll" className="max-h-[72vh] overflow-auto">
                {knockoutPicksLockedByMode ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 text-center">
                    <Lock className="mx-auto h-8 w-8 text-white/55" />
                    <h2 className="mt-3 text-lg font-black text-white">Reseeded Knockout Locked</h2>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/55">
                      Knockout picks open after official Round of 32 fixtures are available. Finish your Group Stage predictions now and come back when the real knockout bracket is synced.
                    </p>
                  </div>
                ) : entryPicksHydrated ? (
                  <AllFantasyBracketBoard mode="pick" isReadOnly={false} showBranding frameClassName="w-max min-w-max !overflow-visible" contentClassName="min-h-0 w-max min-w-max">
                    <WorldCupBracketBoard
                      view={view}
                      picks={picks}
                      matches={projectedMatches}
                      isLocked={isLocked}
                      savingMatchIds={savingPickMatchIds}
                      aiInsightsUnlocked={aiInsightsUnlocked}
                      confidenceScoringEnabled={view.challenge.confidenceScoringEnabled}
                      onPick={persistPick}
                      onOpenMatchupPicker={(matchId) => {
                        if (!hasPickableFixtures) {
                          toast.info(groupSeededKnockout.message)
                          return
                        }
                        setGuidedInitialMatchId(matchId)
                        setIsGuidedPickerOpen(true)
                      }}
                    />
                  </AllFantasyBracketBoard>
                ) : (
                  <AllFantasyBracketBoard mode="pick" isReadOnly showBranding contentClassName="min-h-0">
                    <AllFantasyBracketPickSkeleton />
                  </AllFantasyBracketBoard>
                )}
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
        {tab === "group-stage" ? (
          <div id="world-cup-group-stage" className="pb-8">
            {selectedEntry ? (
              <WorldCupGroupStagePicks
                challengeId={challengeId}
                entryId={selectedEntry.id}
                aiInsightsUnlocked={aiInsightsUnlocked}
                onDirtyChange={setHasUnsavedGroupChanges}
                onCompletionChanged={() => {
                  setHasUnsavedGroupChanges(false)
                  refreshKnockoutBracketFromGroupStage()
                  refreshCompletionReviewAfterMeaningfulEdit()
                  toast.info("Your bracket updated because your group predictions changed.")
                }}
              />
            ) : (
              <section className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center">
                <Trophy className="mx-auto h-8 w-8 text-white/45" />
                <h2 className="mt-3 text-xl font-black text-white">Create an entry first</h2>
                <p className="mt-2 text-sm text-white/50">
                  Group-stage picks are saved per bracket entry. Create or open an entry before ranking groups.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {entries[0]?.id ? (
                    <button
                      type="button"
                      onClick={() => handleSelectEntry(entries[0].id)}
                      className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black"
                    >
                      Open My Bracket
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCreateEntry}
                    disabled={isLocked || isCreatingEntry || entries.length >= view.challenge.maxEntriesPerParticipant}
                    className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/75 disabled:opacity-45"
                  >
                    {isCreatingEntry ? t("wc.review.creating") : t("wc.review.createMyBracket")}
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : null}
        {tab === "review" ? (
          <div id="world-cup-review" className="mx-auto max-w-4xl pb-8">
            {selectedEntry ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                {/* ── Review Hero ─────────────────────────────────────── */}
                <div className="relative overflow-hidden rounded-xl border border-indigo-400/15 bg-gradient-to-br from-indigo-500/[0.08] via-violet-500/[0.04] to-transparent p-4 sm:p-5">
                  <div className="pointer-events-none absolute -top-10 right-2 h-28 w-36 rounded-full bg-indigo-400/15 blur-3xl" aria-hidden />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                          {view.challenge.name}
                        </span>
                        {completionReview ? (
                          completionReview.isLocked ? (
                            <span className="rounded-full border border-rose-300/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/70">
                              {t("wc.review.statusLocked")}
                            </span>
                          ) : completionReview.fullEntryComplete && completionReview.submittedAt ? (
                            <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/70">
                              {t("wc.review.statusFinalized")}
                            </span>
                          ) : completionReview.fullEntryComplete ? (
                            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/70">
                              {t("wc.review.statusReady")}
                            </span>
                          ) : (
                            <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/70">
                              {t("wc.review.statusIncomplete")}
                            </span>
                          )
                        ) : null}
                      </div>
                      <h2 className="mt-1.5 text-xl font-black tracking-tight text-white sm:text-2xl">
                        {t("wc.review.heroTitle")}
                      </h2>
                      <p className="mt-1 text-sm text-white/55">
                        {t("wc.review.heroSubtitle")}
                      </p>
                      <p className="mt-1.5 text-xs text-white/45">
                        {t("wc.review.groupChangeWarning")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadCompletionReview()}
                      disabled={isCompletionLoading}
                      className="shrink-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/75 disabled:opacity-45"
                    >
                      {isCompletionLoading ? t("wc.review.checking") : t("wc.review.refreshReview")}
                    </button>
                  </div>
                </div>

                {completionError ? (
                  <p className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
                    {completionError}
                  </p>
                ) : null}

                {isCompletionLoading && !completionReview ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/45">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("wc.review.loadingReview")}
                  </div>
                ) : completionReview ? (
                  <div data-testid="world-cup-review-panel" className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <PoolStatCard
                        label={t("wc.review.stat.groups")}
                        value={`${completionReview.groupsRankedCount}/12`}
                        tone={completionReview.groupsRankedCount === 12 ? "ready" : "warn"}
                      />
                      <PoolStatCard
                        label={t("wc.review.stat.thirdPlace")}
                        value={`${completionReview.thirdPlaceSelectedCount}/8`}
                        tone={completionReview.thirdPlaceSelectedCount === 8 ? "ready" : "warn"}
                      />
                      <PoolStatCard
                        label={t("wc.review.stat.knockouts")}
                        value={`${completionReview.completedKnockoutPicks}/${completionReview.requiredKnockoutPicks}`}
                        tone={completionReview.knockoutComplete ? "ready" : "warn"}
                      />
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
                      <p className="font-bold text-white/80">{t("wc.review.scoringNoteTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-white/50">
                        {t("wc.review.scoringNoteBody")}
                      </p>
                    </div>

                    <section
                      data-testid="world-cup-review-ai-report"
                      aria-label="Bracket AI report"
                      className="space-y-3 rounded-2xl border border-cyan-300/15 bg-gradient-to-b from-cyan-300/[0.04] to-transparent p-3 sm:p-4"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
                            <Sparkles className="h-4 w-4 text-white/85" aria-hidden />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                              {t("wc.aiReport.eyebrow")}
                            </p>
                            <h3 className="text-base font-black text-white sm:text-lg">
                              {t("wc.aiReport.title")}
                            </h3>
                            <p className="mt-0.5 text-xs leading-5 text-white/55">
                              {t("wc.aiReport.subtitle")}
                            </p>
                          </div>
                        </div>
                        <span
                          data-testid="world-cup-review-ai-report-tier"
                          className={
                            aiInsightsUnlocked
                              ? "shrink-0 rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/90"
                              : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/65"
                          }
                        >
                          {aiInsightsUnlocked ? t("wc.aiReport.tierActive") : t("wc.aiReport.tierPreview")}
                        </span>
                      </div>

                      {!aiInsightsUnlocked ? (
                        <p
                          data-testid="world-cup-review-ai-report-upgrade-banner"
                          className="rounded-lg border border-cyan-300/30 bg-cyan-300/[0.06] px-3 py-2.5 text-[11px] leading-5 text-white/70"
                        >
                          <span className="font-black uppercase tracking-wide text-white/90">{t("wc.review.afProUnlocks")}</span>{" "}
                          {t("wc.review.afProUnlocksDetails")}
                        </p>
                      ) : null}

                      {/* 1. Grade — headline metric (A/B/C, completion %, risk, upset meter). */}
                      <WorldCupBracketGradeCard
                        unlocked={aiInsightsUnlocked}
                        hideTierChip
                        t={t}
                        grade={calculateWorldCupBracketGrade({
                          completionReview,
                          entry: selectedEntry,
                          picks,
                          matches: projectedMatches,
                        })}
                      />

                      {/* 2. Confidence check — deterministic missing-picks summary. */}
                      <ReviewAiConfidenceCard
                        unlocked={aiInsightsUnlocked}
                        hideTierChip
                        completionReview={completionReview}
                        picks={picks}
                        t={t}
                      />

                      {/* 3. Path to win — vs leaderboard. */}
                      <WorldCupPathToWinCard
                        insight={pathToWinInsight}
                        unlocked={aiInsightsUnlocked}
                        hideTierChip
                        t={t}
                      />

                      {/* 4. Explain my bracket — on-demand AI narrative. */}
                      <WorldCupExplainBracketCard
                        challengeId={challengeId}
                        entryId={selectedEntryId ?? null}
                        hasBracketBrainAi={aiInsightsUnlocked}
                        hideTierChip
                      />

                      {/* 5. Uniqueness — vs finalized pool distribution. */}
                      <WorldCupBracketUniquenessCard
                        challengeId={challengeId}
                        entryId={selectedEntryId ?? null}
                        hasBracketBrainAi={aiInsightsUnlocked}
                        hideTierChip
                      />

                      {/* 6. Share card — composes everything above into one shareable text card. */}
                      <WorldCupAiBracketShareCard
                      challengeId={challengeId}
                      entryId={selectedEntryId ?? null}
                      hideTierChip
                      poolName={view.challenge.name}
                      entryName={selectedEntry?.name ?? null}
                      championName={
                        view.leaderboard.find(
                          (row) => row.entryId === selectedEntry?.id
                        )?.championPickName ?? null
                      }
                      isComplete={Boolean(selectedEntry?.isComplete)}
                      grade={calculateWorldCupBracketGrade({
                        completionReview,
                        entry: selectedEntry,
                        picks,
                        matches: projectedMatches,
                      })}
                      topRootingRec={
                        selectedEntry
                          ? buildWorldCupRootingGuide({
                              entry: {
                                id: selectedEntry.id,
                                name: selectedEntry.name,
                                championTeamId:
                                  view.leaderboard.find(
                                    (row) => row.entryId === selectedEntry.id
                                  )?.championTeamId ?? null,
                                championTeamName:
                                  view.leaderboard.find(
                                    (row) => row.entryId === selectedEntry.id
                                  )?.championPickName ?? null,
                                isComplete: selectedEntry.isComplete,
                              },
                              matches: view.matches,
                              picks,
                              hasBracketBrainAi: aiInsightsUnlocked,
                            }).recommendations[0] ?? null
                          : null
                      }
                      aiWinProbabilityPct={
                        selectedEntry
                          ? calculateWorldCupLeaderboardAiInsights(view.leaderboard).find(
                              (row) => row.entryId === selectedEntry.id
                            )?.aiWinProbability ?? null
                          : null
                      }
                      hasBracketBrainAi={aiInsightsUnlocked}
                    />
                    </section>

                    <div data-testid="world-cup-review-saved-picks" className="space-y-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm font-black text-white">{t("wc.review.savedGroupTitle")}</p>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                            {t("wc.review.savedGroupNote")}
                          </span>
                        </div>
                        {reviewGroupStageError ? (
                          <p className="mt-2 rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
                            {reviewGroupStageError}
                          </p>
                        ) : reviewGroupStageView ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {reviewGroupStageView.groups.map((group) => {
                              const groupPicks = reviewGroupStageView.groupRankingPicks
                                .filter((pick) => pick.groupId === group.id)
                                .sort((a, b) => a.predictedRank - b.predictedRank)
                              return (
                                <div key={group.id} data-testid={`world-cup-review-group-${group.groupKey}`} className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-xs font-black text-white">{group.displayName}</p>
                                    <span className="text-[10px] text-white/35">{t("wc.review.groupPicksSaved", { n: groupPicks.length })}</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {groupPicks.length > 0 ? groupPicks.map((pick) => {
                                      const result = worldCupReviewStatusLabel(pick)
                                      return (
                                        <div key={pick.id} data-result-state={result.status} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-xs">
                                          <span className="min-w-0 truncate text-white/75">
                                            #{pick.predictedRank} {teamNameFromGroupStageReview(reviewGroupStageView, pick.teamId)}
                                          </span>
                                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${worldCupReviewStatusClass(result.status)}`}>
                                            {result.label}
                                          </span>
                                        </div>
                                      )
                                    }) : (
                                      <p className="rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-xs text-white/75">{t("wc.review.noGroupPicksYet")}</p>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-white/40">{t("wc.review.loadingGroupPicks")}</p>
                        )}
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-sm font-black text-white">{t("wc.review.savedThirdPlaceTitle")}</p>
                        {reviewGroupStageView ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {reviewGroupStageView.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).length > 0 ? (
                              reviewGroupStageView.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).map((pick) => {
                                const result = worldCupReviewStatusLabel(pick)
                                return (
                                  <span key={pick.id} data-result-state={result.status} className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${worldCupReviewStatusClass(result.status)}`}>
                                    {/* Team name intentionally NOT translated — Phase 5 brief. */}
                                    {teamNameFromGroupStageReview(reviewGroupStageView, pick.teamId)}
                                    <span className="text-[10px] opacity-80">{result.label}</span>
                                  </span>
                                )
                              })
                            ) : (
                              <p className="rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-xs text-white/80">{t("wc.review.noSavedThirdPlace")}</p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-white/40">{t("wc.review.loadingSavedThirdPlace")}</p>
                        )}
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-sm font-black text-white">{t("wc.review.savedKnockoutTitle")}</p>
                        <div className="mt-2 space-y-1.5">
                          {picks.filter(hasWorldCupPickSelection).length > 0 ? (
                            picks.filter(hasWorldCupPickSelection).map((pick) => {
                              const match = projectedMatches.find((row) => row.id === pick.matchId || row.matchNumber === pick.matchNumber)
                              const result = worldCupReviewStatusLabel(pick)
                              return (
                                <div key={pick.id} data-testid={`world-cup-review-knockout-pick-${pick.matchId}`} data-result-state={result.status} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1.5 text-xs">
                                  <span className="min-w-0 truncate text-white/75">
                                    {/* pick.selectedTeamName intentionally NOT translated — Phase 5 brief. */}
                                    {match ? t("wc.review.knockoutPickPrefix", { number: match.matchNumber }) : ""}{pick.selectedTeamName}
                                  </span>
                                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${worldCupReviewStatusClass(result.status)}`}>
                                    {result.label}
                                  </span>
                                </div>
                              )
                            })
                          ) : (
                            <p className="rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-xs text-white/80">{t("wc.review.noSavedKnockout")}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {!completionReview.fullEntryComplete ? (
                      <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-xs text-white/80">
                        <p className="font-black">{t("wc.review.missingRequirementsTitle")}</p>
                        {completionReview.needsRefinalize ? (
                          <p className="mt-1 font-bold">
                            {t("wc.review.needsRefinalize")}
                          </p>
                        ) : null}
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {completionReview.missingGroups.length > 0 ? (
                            <li>{t("wc.review.missingGroupRankings", { groups: completionReview.missingGroups.join(", ") })}</li>
                          ) : null}
                          {completionReview.thirdPlaceSelectedCount !== 8 ? (
                            <li>{t("wc.review.thirdPlaceCount", { count: completionReview.thirdPlaceSelectedCount })}</li>
                          ) : null}
                          {completionReview.missingKnockoutPicks > 0 ? (
                            <li>{t("wc.review.missingKnockout", { count: completionReview.missingKnockoutPicks })}</li>
                          ) : null}
                        </ul>
                      </div>
                    ) : null}

                    {completionReview.isLocked ? (
                      <div className="rounded-xl border border-rose-300/25 bg-rose-400/10 p-3 text-sm font-bold text-white/80">
                        {completionReview.submittedAt
                          ? t("wc.review.lockedWithTime", { at: new Date(completionReview.submittedAt).toLocaleString() })
                          : t("wc.review.lockedNoTime")}
                      </div>
                    ) : completionReview.fullEntryComplete && completionReview.submittedAt ? (
                      <WorldCupFinalizedSuccessBlock
                        challengeId={challengeId}
                        poolName={view.challenge.name}
                        entryName={selectedEntry?.name ?? null}
                        championName={
                          view.leaderboard.find(
                            (row) => row.entryId === selectedEntry?.id
                          )?.championPickName ?? null
                        }
                        gradeLabel={calculateWorldCupBracketGrade({
                          completionReview,
                          entry: selectedEntry,
                          picks,
                          matches: projectedMatches,
                        }).grade}
                        submittedAt={completionReview.submittedAt}
                        switchTab={switchTab}
                      />
                    ) : completionReview.fullEntryComplete ? (
                      <div
                        data-testid="world-cup-finalize-cta-zone"
                        className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4"
                      >
                        <p className="mb-3 text-xs text-white/55">{t("wc.review.completeDraftHelper")}</p>
                        <button
                          type="button"
                          onClick={() => void handleFinalizeEntry()}
                          disabled={isFinalizingEntry}
                          className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3.5 text-base font-black text-black shadow-[0_6px_20px_-8px_rgba(34,211,238,0.7)] transition-transform hover:scale-[1.02] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        >
                          {isFinalizingEntry
                            ? t("wc.review.finalizing")
                            : completionReview.needsRefinalize || completionReview.isComplete
                              ? t("wc.review.refinalizeEntry")
                              : t("wc.review.finalizeEntry")}
                        </button>
                        <p className="mt-2 text-[11px] text-white/40">{t("wc.review.finalizeLockWarning")}</p>
                      </div>
                    ) : (
                      <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-white/45">
                        {t("wc.review.completeAllToUnlock")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/45">
                    {t("wc.review.tapRefresh")}
                  </p>
                )}
              </section>
            ) : (
              <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center">
                <Trophy className="mx-auto h-8 w-8 text-white/45" />
                <h2 className="mt-3 text-xl font-black text-white">{t("wc.review.createEntryFirstTitle")}</h2>
                <p className="mt-2 text-sm text-white/50">{t("wc.review.createEntryFirstBody")}</p>
                <button
                  type="button"
                  onClick={handleCreateEntry}
                  disabled={isLocked || isCreatingEntry || entries.length >= view.challenge.maxEntriesPerParticipant}
                  className="mt-4 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black disabled:opacity-45"
                >
                  {isCreatingEntry ? t("wc.review.creating") : t("wc.review.createMyBracket")}
                </button>
              </section>
            )}
          </div>
        ) : null}
        {tab === "leaderboard" ? (
          <div id="world-cup-leaderboard" className="h-full overflow-y-auto">
            <WorldCupLeaderboardInsights leaderboard={view.leaderboard} aiInsightsUnlocked={aiInsightsUnlocked} />
            <div className="mx-auto max-w-4xl px-4">
              <WorldCupPathToWinCard
                insight={pathToWinInsight}
                unlocked={aiInsightsUnlocked}
                t={t}
              />
            </div>
            <WorldCupLeaderboard view={view} busy={isPending} onRecalculate={() => runOwnerAction("recalculate")} switchTab={switchTab} />
          </div>
        ) : null}
        {tab === "invite" ? (
          <div id="world-cup-invite">
            <WorldCupInvitePanel view={view} isCommissioner={Boolean(view.isOwner || view.isAdmin)} switchTab={switchTab} />
          </div>
        ) : null}
        {tab === "rules" ? (
          <div
            data-testid="wc-rules-tab"
            className="mode-readable mx-auto max-w-2xl px-4 py-6 pb-28 sm:pb-8"
          >
            {/* ── Hero ──────────────────────────────────────────── */}
            <div data-testid="wc-rules-hero" className="mb-5">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/[0.07]">
                  <ClipboardList className="h-4 w-4 text-white/80" aria-hidden />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                    {t("wc.rules.hero.eyebrow")}
                  </p>
                  <h2 className="text-lg font-black text-white">{t("wc.rules.hero.title")}</h2>
                </div>
              </div>
              <p className="text-sm leading-6 text-white/60">{t("wc.rules.hero.subtitle")}</p>
            </div>

            {/* ── How It Works ──────────────────────────────────── */}
            <section
              data-testid="wc-rules-how"
              className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
            >
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
                {t("wc.rules.how.title")}
              </h3>
              <p className="text-sm leading-7 text-white/75">{t("wc.rules.how.body1")}</p>
              <p className="mt-2 text-sm leading-7 text-white/75">{t("wc.rules.how.body2")}</p>
            </section>

            {/* ── Scoring ───────────────────────────────────────── */}
            <section
              data-testid="wc-rules-scoring"
              className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
            >
              <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
                {t("wc.rules.scoring.title")}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {([
                  { key: "wc.rules.scoring.roundOf32", value: view.scoring.roundOf32Points },
                  { key: "wc.rules.scoring.roundOf16", value: view.scoring.roundOf16Points },
                  { key: "wc.rules.scoring.quarterfinal", value: view.scoring.quarterFinalPoints },
                  { key: "wc.rules.scoring.semifinal", value: view.scoring.semiFinalPoints },
                  { key: "wc.rules.scoring.final", value: view.scoring.finalPoints },
                ] as const).map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                    <span className="font-semibold text-white/80">{t(row.key)}</span>
                    <span className="font-black tabular-nums text-white">
                      {row.value}{" "}
                      <span className="text-[11px] font-bold text-white/45">{t("wc.rules.scoring.pts")}</span>
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 rounded-lg border border-white/20 bg-white/[0.08] px-3 py-2">
                  <span className="font-black text-white">{t("wc.rules.scoring.champion")}</span>
                  <span className="font-black tabular-nums text-white">
                    {view.scoring.championBonusPoints}{" "}
                    <span className="text-[11px] font-bold text-white/45">{t("wc.rules.scoring.pts")}</span>
                  </span>
                </li>
                {view.challenge.includeThirdPlace && view.scoring.thirdPlacePoints != null ? (
                  <li className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                    <span className="font-semibold text-white/80">{t("wc.rules.scoring.thirdPlace")}</span>
                    <span className="font-black tabular-nums text-white">
                      {view.scoring.thirdPlacePoints}{" "}
                      <span className="text-[11px] font-bold text-white/45">{t("wc.rules.scoring.pts")}</span>
                    </span>
                  </li>
                ) : null}
              </ul>
            </section>

            {/* ── Pool Settings ─────────────────────────────────── */}
            <section
              data-testid="wc-rules-settings"
              className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
            >
              <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-white/55">
                {t("wc.rules.settings.title")}
              </h3>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                  <span className="font-semibold text-white/70">{t("wc.rules.settings.bracketsPerUser")}</span>
                  <span className="font-bold tabular-nums text-white">{view.challenge.maxEntriesPerParticipant}</span>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                  <span className="font-semibold text-white/70">{t("wc.rules.settings.thirdPlace")}</span>
                  <span className="font-bold text-white">
                    {view.challenge.includeThirdPlace ? t("wc.rules.settings.thirdPlaceOn") : t("wc.rules.settings.thirdPlaceOff")}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                  <span className="font-semibold text-white/70">{t("wc.rules.settings.inviteSharing")}</span>
                  <span className="font-bold text-white">{t("wc.rules.settings.inviteCommish")}</span>
                </li>
              </ul>
            </section>

            {/* ── Trust Note ────────────────────────────────────── */}
            <p
              data-testid="wc-rules-trust-note"
              className="mt-4 text-center text-[11px] leading-5 text-white/35"
            >
              {t("wc.rules.trustNote")}
            </p>
          </div>
        ) : null}
        {tab === "settings" ? (
          <div id="world-cup-settings" className="mx-auto max-w-3xl px-2 pb-28 sm:pb-8">
            <WorldCupBracketSettingsPanel
              challengeId={challengeId}
              onSaved={() => void refreshChallengeView()}
            />
          </div>
        ) : null}
        {tab === "commissioner" ? (
          <div id="world-cup-commissioner" className="mx-auto max-w-3xl px-2 pb-28 sm:pb-8">
            <WorldCupCommissionerBrainPanel
              challengeId={challengeId}
              onOpenLeagueSettings={() => switchTab("settings")}
              poolName={view.challenge.name}
              poolUrl={
                typeof window !== "undefined"
                  ? `${window.location.origin}/brackets/world-cup/${challengeId}`
                  : `https://allfantasy.ai/brackets/world-cup/${challengeId}`
              }
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
        className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-white/10 bg-zinc-950/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md sm:hidden"
      >
        {tabList.map(({ id, icon: Icon, label, shortLabel }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`relative flex min-h-[56px] min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] font-bold transition-colors touch-manipulation focus-visible:outline-none focus-visible:bg-white/[0.05] ${
              tab === id ? "text-white" : "text-white/50 hover:text-white/75"
            }`}
          >
            {tab === id ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-b-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-200 shadow-[0_2px_12px_rgba(34,211,238,0.55)]"
              />
            ) : null}
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            <span className="w-full truncate text-center leading-tight">
              {shortLabel}
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
          matches={baseKnockoutMatches}
          picks={picks}
          isOpen={isGuidedPickerOpen}
          initialMatchId={guidedInitialMatchId}
          isLocked={isLocked}
          entryIsComplete={selectedEntry.isComplete}
          lockAt={view.challenge.pickLockAt}
          tournamentStartAt={view.challenge.effectivePickLockAt}
          includeThirdPlace={view.challenge.includeThirdPlace}
          hasBracketBrainAi={view.hasBracketBrainAi}
          confidenceScoringEnabled={view.challenge.confidenceScoringEnabled}
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
      className="whitespace-nowrap rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/65 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-white/85 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 disabled:cursor-not-allowed disabled:opacity-40"
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 backdrop-blur transition-colors hover:border-white/15 hover:bg-white/[0.06]">
      <div className="text-[10px] font-black uppercase tracking-widest text-white/45">{label}</div>
      <div
        className={`mt-1 text-xl font-black tabular-nums ${
          tone === "ready" ? "text-white/85" : tone === "warn" ? "text-white/75" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function WorldCupFinalizedSuccessBlock({
  challengeId,
  poolName,
  entryName,
  championName,
  gradeLabel,
  submittedAt,
  switchTab,
}: {
  challengeId: string
  poolName: string
  entryName: string | null
  championName: string | null
  gradeLabel: string
  submittedAt: string
  switchTab: (tab: WorldCupBracketTab) => void
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [copied, setCopied] = useState(false)
  // Hydration-safe: mount-gate the locale-dependent timestamp so SSR HTML
  // matches the first CSR render. Pre-mount fallback uses a stable
  // no-timestamp variant.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])
  const submittedAtLabel = useMemo(() => {
    if (!hasMounted) return null
    try {
      return new Date(submittedAt).toLocaleString()
    } catch {
      return null
    }
  }, [hasMounted, submittedAt])
  const shareResult = useMemo(
    () =>
      buildWorldCupBracketShareMessage({
        poolName,
        entryName,
        championName,
        gradeLabel,
        isComplete: true,
        locale: language,
        poolUrl:
          typeof window !== "undefined"
            ? `${window.location.origin}/brackets/world-cup/${challengeId}`
            : `https://allfantasy.ai/brackets/world-cup/${challengeId}`,
      }),
    [challengeId, championName, entryName, gradeLabel, language, poolName]
  )

  async function copyShare() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(shareResult.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${entryName ?? "My Bracket"} — AllFantasy World Cup`,
          text: shareResult.message,
        })
        return
      } catch {
        // user cancelled — fall through to copy
      }
    }
    await copyShare()
  }

  return (
    <div
      data-testid="world-cup-review-finalized-success"
      className="rounded-xl border border-emerald-300/30 bg-gradient-to-b from-emerald-400/[0.14] to-emerald-400/[0.05] p-4 backdrop-blur"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-300/40 bg-emerald-400/15 shadow-[0_0_16px_-4px_rgba(52,211,153,0.5)]">
          <Check className="h-4 w-4 text-white/85" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">
            {t("wc.finalize.eyebrow")}
          </p>
          <h3 className="text-base font-black text-white sm:text-lg">
            {t("wc.finalize.title")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-white/60">
            {submittedAtLabel
              ? t("wc.finalize.subtitleWithTime", { at: submittedAtLabel })
              : t("wc.finalize.subtitleNoTime")}
          </p>
        </div>
      </div>

      {/* Challenge prompt */}
      <div className="mt-3 border-t border-white/[0.07] pt-3">
        <p className="text-sm font-black text-white">{t("wc.finalize.challengeTitle")}</p>
        <p className="mt-0.5 text-xs text-white/55">{t("wc.finalize.challengeDesc")}</p>
      </div>

      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={copyShare}
          data-testid="world-cup-review-finalized-copy-share"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? t("wc.finalize.copyShareCopied") : t("wc.finalize.copyShare")}
        </button>
        <button
          type="button"
          onClick={nativeShare}
          data-testid="world-cup-review-finalized-share-native"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.10] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
        >
          <Share2 className="h-4 w-4" />
          {t("wc.finalize.shareReport")}
        </button>
        <button
          type="button"
          onClick={() => switchTab("leaderboard")}
          data-testid="world-cup-review-finalized-view-leaderboard"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.10] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
        >
          <Trophy className="h-4 w-4" />
          {t("wc.finalize.viewLeaderboard")}
        </button>
        <button
          type="button"
          onClick={() => switchTab("invite")}
          data-testid="world-cup-review-finalized-invite-friends"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/[0.08] px-4 py-2.5 text-sm font-bold text-white/85 transition-colors hover:border-cyan-300/50 hover:bg-cyan-300/[0.12] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:w-auto"
        >
          <Users className="h-4 w-4" />
          {t("wc.finalize.inviteFriends")}
        </button>
      </div>

      <details className="mt-3" data-testid="world-cup-review-finalized-share-preview">
        <summary className="cursor-pointer text-[11px] font-semibold text-white/50 hover:text-white/80">
          {t("wc.finalize.previewShare")}
        </summary>
        <div className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs leading-5 text-white/80">
          {shareResult.message}
        </div>
      </details>

      <p className="mt-3 text-[10px] text-white/30">{t("wc.finalize.trustNote")}</p>
    </div>
  )
}

function ReviewAiConfidenceCard({
  unlocked,
  completionReview,
  picks,
  hideTierChip = false,
  t,
}: {
  unlocked: boolean
  completionReview: WorldCupEntryCompletionReviewClient
  picks: WorldCupPickView[]
  /** When true, suppress the per-card Open/Locked chip — the section-level chip is canonical. */
  hideTierChip?: boolean
  t: ReturnType<typeof makeWcT>
}) {
  const completedPickCount = picks.filter(hasWorldCupPickSelection).length
  const highRiskCount = picks.filter((pick) => pick.round === "round_of_32" || pick.round === "round_of_16").length
  const chalkWarning = completedPickCount > 0 && highRiskCount <= Math.max(1, Math.floor(completedPickCount / 3))
  return (
    <details data-testid="world-cup-review-ai-confidence" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3 text-xs text-white/90">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {t("wc.confidence.title")}
        </span>
        {hideTierChip ? null : (
          <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[10px] uppercase tracking-wide">
            {unlocked ? t("wc.confidence.tierOpen") : t("wc.confidence.tierLocked")}
          </span>
        )}
      </summary>
      {unlocked ? (
        <div className="mt-3 space-y-2 leading-5 text-white/75">
          <p>
            <span className="font-black text-white">{t("wc.confidence.missingPicks")}</span>{" "}
            {completionReview.fullEntryComplete
              ? t("wc.confidence.noMissing")
              : t("wc.confidence.missingBreakdown", {
                  knockout: completionReview.missingKnockoutPicks,
                  groups: Math.max(0, 12 - completionReview.groupsRankedCount),
                  thirdPlace: Math.max(0, 8 - completionReview.thirdPlaceSelectedCount),
                })}
          </p>
          <p>
            <span className="font-black text-white">{t("wc.confidence.highRiskPicks")}</span>{" "}
            {t("wc.confidence.highRiskBody", { count: highRiskCount })}
          </p>
          <p>
            <span className="font-black text-white">{t("wc.confidence.bracketShape")}</span>{" "}
            {chalkWarning
              ? t("wc.confidence.bracketShapeChalk")
              : t("wc.confidence.bracketShapeBalanced")}
          </p>
          <p>
            <span className="font-black text-white">{t("wc.confidence.finalizeConfidence")}</span>{" "}
            {completionReview.fullEntryComplete
              ? t("wc.confidence.finalizeReady")
              : t("wc.confidence.finalizeMissing")}
          </p>
          <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/55">
            {t("wc.confidence.privacyNote")}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[11px] leading-5 text-white/60" hidden>
          {t("wc.confidence.lockedBody")}
        </p>
      )}
    </details>
  )
}

function WorldCupBracketGradeCard({
  unlocked,
  grade,
  hideTierChip = false,
  t,
}: {
  unlocked: boolean
  grade: WorldCupBracketGradeInsight
  /** When true, suppress the per-card AF Pro/Basic chip — the section-level chip is canonical. */
  hideTierChip?: boolean
  t: ReturnType<typeof makeWcT>
}) {
  return (
    <section
      data-testid="world-cup-bracket-grade"
      className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3 text-xs text-white/90"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-white/60">{t("wc.grade.eyebrow")}</p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-black text-white">{grade.grade}</span>
            <span className="font-bold text-white/70">{t("wc.grade.completionLabel", { percent: grade.completionPercent })}</span>
          </div>
        </div>
        {hideTierChip ? null : (
          <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/90">
            {unlocked ? t("wc.grade.tierProDetail") : t("wc.grade.tierBasic")}
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <PoolStatCard label={t("wc.grade.stat.groups")} value={`${grade.groupCompletionPercent}%`} tone={grade.groupCompletionPercent === 100 ? "ready" : "warn"} />
        <PoolStatCard label={t("wc.grade.stat.thirdPlace")} value={`${grade.thirdPlaceCompletionPercent}%`} tone={grade.thirdPlaceCompletionPercent === 100 ? "ready" : "warn"} />
        <PoolStatCard label={t("wc.grade.stat.knockouts")} value={`${grade.knockoutCompletionPercent}%`} tone={grade.knockoutCompletionPercent === 100 ? "ready" : "warn"} />
        <PoolStatCard label={t("wc.grade.stat.missing")} value={String(grade.missingPickCount)} tone={grade.missingPickCount === 0 ? "ready" : "warn"} />
      </div>
      {unlocked ? (
        <div className="mt-3 space-y-1.5 leading-5 text-white/75">
          <p><span className="font-black text-white">{t("wc.grade.risk")}</span> {grade.riskLabel}</p>
          <p><span className="font-black text-white">{t("wc.grade.upset")}</span> {grade.upsetMeter}</p>
          <p><span className="font-black text-white">{t("wc.grade.championConfidence")}</span> {grade.championSelected ? `${grade.championConfidence}%` : t("wc.grade.championConfidenceNone")}</p>
          <p><span className="font-black text-white">{t("wc.grade.biggestRisk")}</span> {grade.biggestRisk}</p>
          <p><span className="font-black text-white">{t("wc.grade.recommendation")}</span> {grade.recommendation}</p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[11px] leading-5 text-white/60">
          {t("wc.grade.lockedBody")}
        </p>
      )}
    </section>
  )
}

function WorldCupPathToWinCard({
  insight,
  unlocked,
  hideTierChip = false,
  t,
}: {
  insight: WorldCupPathToWinInsight
  unlocked: boolean
  /** When true, suppress the per-card AF Pro chip — the section-level chip is canonical. */
  hideTierChip?: boolean
  t: ReturnType<typeof makeWcT>
}) {
  return (
    <section
      data-testid="world-cup-path-to-win"
      className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs text-white/65"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-white">{t("wc.path.title")}</p>
          <p className="mt-1 text-[11px] text-white/45">
            {t("wc.path.subtitle")}
          </p>
        </div>
        {hideTierChip ? null : (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${unlocked ? "border-cyan-200/25 text-white/90" : "border-purple-300/25 text-purple-100"}`}>
            {unlocked ? t("wc.path.tierActive") : t("wc.path.tierLocked")}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-1.5 leading-5">
        {insight.lines.map((line, index) => (
          <p key={`${insight.entryId ?? "none"}-${index}-${line}`}>{line}</p>
        ))}
      </div>
    </section>
  )
}

function WorldCupDashBracketPreviewToolbar({
  dashboardPreviewMode,
  setDashboardPreviewMode,
  onOpenOrCreateBracket,
  isCreatingEntry,
  openDisabled,
  openLabel,
}: {
  dashboardPreviewMode: "starting" | "ai"
  setDashboardPreviewMode: (mode: "starting" | "ai") => void
  onOpenOrCreateBracket: () => void
  isCreatingEntry: boolean
  openDisabled: boolean
  openLabel: string
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/60">
          Starting Bracket Preview
        </p>
        <h3 className="mt-1 text-xl font-black text-white">World Cup Bracket Preview</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-white/50">
          Display-only pool preview. Open your bracket to make picks.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-white/10 bg-black/35 p-1 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setDashboardPreviewMode("starting")}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-black ${dashboardPreviewMode === "starting" ? "bg-cyan-300 text-black" : "text-white/55 hover:text-white"}`}
          >
            Starting Bracket
          </button>
          <button
            type="button"
            onClick={() => setDashboardPreviewMode("ai")}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-black ${dashboardPreviewMode === "ai" ? "bg-cyan-300 text-black" : "text-white/55 hover:text-white"}`}
          >
            AI Simulation
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenOrCreateBracket}
          disabled={openDisabled}
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:opacity-50"
        >
          {isCreatingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {openLabel}
        </button>
      </div>
    </div>
  )
}

function AiSimulationLockPanel({ isCommissioner }: { isCommissioner: boolean }) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  return (
    <div className="flex min-h-[200px] flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
      <div className="rounded-2xl border border-cyan-200/20 bg-cyan-300/10 p-3 text-white/90 shadow-lg shadow-cyan-500/10 backdrop-blur-[2px]">
        <Lock className="h-7 w-7" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white/90 backdrop-blur-[2px]">
          {t("wc.aiLock.badge")}
        </div>
        <h4 className="mt-3 text-lg font-black text-white/90 drop-shadow-sm">{t("wc.aiLock.title")}</h4>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80 drop-shadow-sm">
          {t("wc.aiLock.body")}
        </p>
        <p className="mt-3 text-xs font-black uppercase tracking-widest text-white/65">{t("wc.aiLock.tier")}</p>
        {isCommissioner ? (
          <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.12] px-3 py-2 text-xs font-bold leading-5 text-white/75 backdrop-blur-[2px]">
            {t("wc.aiLock.commissionerNote")}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function PremiumFeatureCard({
  title,
  description,
  tier,
  unlocked,
}: {
  title: string
  description: string
  tier: "AF Commissioner" | "AI/Pro"
  unlocked: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  return (
    <div
      data-testid={`world-cup-premium-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={[
        "rounded-xl border p-3",
        unlocked
          ? "border-cyan-300/25 bg-cyan-300/[0.08]"
          : "border-white/10 bg-black/20",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-black text-white">{title}</p>
        <span
          className={[
            "shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide",
            unlocked
              ? "border-cyan-300/30 bg-cyan-300/10 text-white/90"
              : tier === "AF Commissioner"
                ? "border-amber-300/30 bg-amber-400/10 text-white/80"
                : "border-purple-300/30 bg-purple-400/10 text-white/80",
          ].join(" ")}
        >
          {unlocked ? t("wc.premium.unlocked") : tier}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/50">{description}</p>
    </div>
  )
}

function WorldCupPremiumAccessPanel({
  entitlementSummary,
  maxEntriesPerParticipant,
  currentEntryCount,
  isOwnerOrAdmin,
}: {
  entitlementSummary: ReturnType<typeof resolveWorldCupEntitlementSummary>
  maxEntriesPerParticipant: number
  currentEntryCount: number
  isOwnerOrAdmin: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const commissionerUnlocked = entitlementSummary.commissioner
  const aiUnlocked = entitlementSummary.ai
  const freeEntryLimitCopy = maxEntriesPerParticipant > 1
    ? t("wc.premium.freeLimitPlural", { n: maxEntriesPerParticipant })
    : t("wc.premium.freeLimitSingle")

  return (
    <section
      data-testid="world-cup-premium-access-panel"
      className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{t("wc.premium.eyebrow")}</p>
          <h3 className="mt-1 text-lg font-black text-white">{t("wc.premium.title")}</h3>
          <p className="mt-2 text-xs leading-5 text-white/50">
            {t("wc.premium.body")}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/55">
          <p>
            {t("wc.premium.entryCap")} <span className="font-black text-white">{currentEntryCount}/{maxEntriesPerParticipant}</span>
          </p>
          <p className="mt-1 text-white/35">{freeEntryLimitCopy}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-black text-white/80">{t("wc.premium.commissionerSection")}</p>
            <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/80">
              {entitlementSummary.labels.commissioner}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <PremiumFeatureCard
              title={t("wc.premium.card.commissioner.title")}
              tier="AF Commissioner"
              unlocked={commissionerUnlocked}
              description={isOwnerOrAdmin ? t("wc.premium.card.commissioner.descOwner") : t("wc.premium.card.commissioner.descOther")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.chat.title")}
              tier="AF Commissioner"
              unlocked={commissionerUnlocked}
              description={t("wc.premium.card.chat.desc")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.export.title")}
              tier="AF Commissioner"
              unlocked={entitlementSummary.exportLeaderboard}
              description={t("wc.premium.card.export.desc")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.multiEntry.title")}
              tier="AF Commissioner"
              unlocked={entitlementSummary.multipleEntries}
              description={t("wc.premium.card.multiEntry.desc")}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-black text-white/90">{t("wc.premium.aiSection")}</p>
            <span className="rounded-full border border-purple-300/25 bg-purple-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90">
              {entitlementSummary.labels.ai}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <PremiumFeatureCard
              title={t("wc.premium.card.bracketBuilder.title")}
              tier="AI/Pro"
              unlocked={aiUnlocked}
              description={t("wc.premium.card.bracketBuilder.desc")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.matchupPreview.title")}
              tier="AI/Pro"
              unlocked={aiUnlocked}
              description={t("wc.premium.card.matchupPreview.desc")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.whatIf.title")}
              tier="AI/Pro"
              unlocked={aiUnlocked}
              description={t("wc.premium.card.whatIf.desc")}
            />
            <PremiumFeatureCard
              title={t("wc.premium.card.alerts.title")}
              tier="AI/Pro"
              unlocked={aiUnlocked}
              description={t("wc.premium.card.alerts.desc")}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function WorldCupCommunityFoundationPanel({
  challengeId,
  entitlementSummary,
  poolName,
}: {
  challengeId: string
  entitlementSummary: ReturnType<typeof resolveWorldCupEntitlementSummary>
  poolName: string
}) {
  const commissionerUnlocked = entitlementSummary.commissioner
  const aiUnlocked = entitlementSummary.ai
  // i18n — hydration-safe, drives all copy in this component
  const { language } = useOptionalLanguage()
  const tChat = useMemo(() => makeWcT(language), [language])
  const [messages, setMessages] = useState<WorldCupPoolChatMessage[]>([])
  const [chatBody, setChatBody] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(true)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [composerPanel, setComposerPanel] = useState<WorldCupComposerPanel>(null)
  const [gifQuery, setGifQuery] = useState("")
  const [gifResults, setGifResults] = useState<WorldCupChatGifAttachment[]>([])
  const [selectedGif, setSelectedGif] = useState<WorldCupChatGifAttachment | null>(null)
  const [isGifSearching, setIsGifSearching] = useState(false)
  const [gifError, setGifError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<WorldCupChatImageAttachment | null>(null)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState(["", ""])
  const [isPollCreating, setIsPollCreating] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pollVotingMessageId, setPollVotingMessageId] = useState<string | null>(null)
  const richPreviewSegments = useMemo(() => parseWorldCupChatRichText(chatBody), [chatBody])
  const isChimmyPrompt = /(^|[\s*_~\]])@chimmy\b/i.test(chatBody)
  const latestAiRecap = useMemo(
    () => messages
      .filter((message) => message.visibility === "public" && message.messageType === "ai_recap")
      .at(-1) ?? null,
    [messages]
  )

  function insertComposerText(value: string) {
    setChatBody((current) => `${current}${value}`)
  }

  function wrapComposerText(open: string, close = open) {
    setChatBody((current) => `${current}${open}text${close}`)
  }

  function applyComposerColor(color: WorldCupChatColor) {
    if (color === "default") return
    wrapComposerText(`[color=${color}]`, "[/color]")
  }

  function applyComposerFont(font: WorldCupChatFont) {
    if (font === "default") return
    wrapComposerText(`[font=${font}]`, "[/font]")
  }

  const loadChat = useCallback(async () => {
    setIsChatLoading(true)
    setChatError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not load pool chat")
      }
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not load pool chat")
    } finally {
      setIsChatLoading(false)
    }
  }, [challengeId])

  useEffect(() => {
    void loadChat()
  }, [loadChat])

  async function sendChatMessage() {
    const body = chatBody.trim()
    if (!body) return
    setIsSendingChat(true)
    setChatError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, gif: selectedGif ?? undefined, image: selectedImage ?? undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not send message")
      }
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages((prev) => [...prev, ...data.messages])
      } else if (data.message) {
        setMessages((prev) => [...prev, data.message])
      } else {
        await loadChat()
      }
      setChatBody("")
      setSelectedGif(null)
      setSelectedImage(null)
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not send message")
    } finally {
      setIsSendingChat(false)
    }
  }

  async function uploadWorldCupImage(file: File) {
    setImageError(null)
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setImageError("Only PNG, JPEG, WebP, and GIF images are allowed.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Image too large (max 5MB).")
      return
    }
    setIsImageUploading(true)
    try {
      const formData = new FormData()
      formData.set("action", "upload_image")
      formData.set("file", file)
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat?action=upload_image`, {
        method: "POST",
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not upload image")
      if (!data.image) throw new Error("Upload response missing image metadata")
      setSelectedImage(data.image)
      if (!chatBody.trim()) setChatBody("Image")
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not upload image")
    } finally {
      setIsImageUploading(false)
    }
  }

  async function searchWorldCupGifs() {
    const query = gifQuery.trim()
    if (!query) {
      setGifResults([])
      return
    }
    setIsGifSearching(true)
    setGifError(null)
    try {
      const params = new URLSearchParams({ action: "gifs", q: query, limit: "12" })
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat?${params.toString()}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not search GIFs")
      setGifResults(Array.isArray(data.gifs) ? data.gifs : [])
    } catch (err) {
      setGifError(err instanceof Error ? err.message : "Could not search GIFs")
      setGifResults([])
    } finally {
      setIsGifSearching(false)
    }
  }

  async function createWorldCupPoll() {
    const question = pollQuestion.trim()
    const options = pollOptions.map((option) => option.trim()).filter(Boolean)
    if (!question) {
      setPollError("Poll question is required.")
      return
    }
    if (options.length < 2 || options.length > 6) {
      setPollError("Polls require 2 to 6 options.")
      return
    }
    const unique = new Set(options.map((option) => option.toLowerCase()))
    if (unique.size !== options.length) {
      setPollError("Poll options must be unique.")
      return
    }

    setIsPollCreating(true)
    setPollError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_poll", question, options }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not create poll")
      if (data.message) {
        setMessages((prev) => [...prev, data.message])
      } else {
        await loadChat()
      }
      setPollQuestion("")
      setPollOptions(["", ""])
      setComposerPanel(null)
    } catch (err) {
      setPollError(err instanceof Error ? err.message : "Could not create poll")
    } finally {
      setIsPollCreating(false)
    }
  }

  async function voteWorldCupPoll(messageId: string, optionId: string) {
    setPollVotingMessageId(messageId)
    setChatError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll_vote", messageId, optionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not vote in poll")
      if (data.message) {
        setMessages((prev) => prev.map((message) => message.id === messageId ? data.message : message))
      } else {
        await loadChat()
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not vote in poll")
    } finally {
      setPollVotingMessageId(null)
    }
  }

  return (
    <section
      data-testid="world-cup-community-foundation"
      className="mode-readable mx-auto grid max-w-5xl gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]"
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        {/* ── Chat Hero ──────────────────────────────────────────────── */}
        <div
          data-testid="wc-chat-hero"
          className="mb-4 flex items-start justify-between gap-3"
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <MessageSquare className="h-4 w-4 text-white/70" aria-hidden />
              {tChat("wc.chat.hero.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-white/50">
              {tChat("wc.chat.hero.subtitle")}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60">
            {tChat("wc.chat.hero.badge")}
          </span>
        </div>
        {/* ── Chimmy Prompt Chips ────────────────────────────────────── */}
        <div
          data-testid="wc-chat-prompt-chips"
          className="mb-4 -mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none"
        >
          {([
            "wc.chat.chip.explainBracket",
            "wc.chat.chip.dangerZone",
            "wc.chat.chip.poolFavorite",
            "wc.chat.chip.keyMatchup",
            "wc.chat.chip.trashTalk",
          ] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setChatBody(tChat(key))}
              className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/70 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
            >
              {tChat(key)}
            </button>
          ))}
        </div>
        <WorldCupNotificationSettingsCard challengeId={challengeId} />
        <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
              Pool Messages
            </p>
            <button
              type="button"
              onClick={() => void loadChat()}
              disabled={isChatLoading}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-bold text-white/55 disabled:opacity-40"
            >
              {isChatLoading ? "…" : tChat("wc.chat.refresh")}
            </button>
          </div>
          {isChatLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {tChat("wc.chat.loading")}
            </div>
          ) : messages.length > 0 ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs",
                    message.isPrivate
                      ? "border-purple-300/20 bg-purple-400/10"
                      : "border-white/10 bg-white/[0.04]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-white/80">{message.authorName}</span>
                    <span className="text-[10px] text-white/30">
                      {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <WorldCupChatRichTextRenderer
                    text={message.body}
                    className="mt-1 whitespace-pre-wrap break-words leading-5 text-white/65"
                  />
                  {message.gif ? <WorldCupGifPreview gif={message.gif} compact /> : null}
                  {message.image ? <WorldCupImagePreview image={message.image} compact /> : null}
                  {message.poll ? (
                    <WorldCupPollMessage
                      poll={message.poll}
                      messageId={message.id}
                      isVoting={pollVotingMessageId === message.id}
                      onVote={(optionId) => void voteWorldCupPoll(message.id, optionId)}
                    />
                  ) : null}
                  {message.isPrivate ? (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/70">
                      {tChat("wc.chat.privateLabel")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div
              data-testid="wc-chat-empty-state"
              className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center"
            >
              <p className="text-sm font-black text-white/75">
                {tChat("wc.chat.empty.headline")}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/40">
                {tChat("wc.chat.empty.body")}
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={chatBody}
              onChange={(event) => setChatBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void sendChatMessage()
                }
              }}
              maxLength={1000}
              placeholder={tChat("wc.chat.composer.placeholder")}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void sendChatMessage()}
              disabled={isSendingChat || !chatBody.trim()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-cyan-200 px-4 py-2 text-xs font-black text-black shadow-[0_4px_14px_-6px_rgba(34,211,238,0.5)] transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none touch-manipulation"
            >
              {isSendingChat ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {tChat("wc.chat.composer.send")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <ComposerFormatButton icon={Bold} label="Bold" onClick={() => wrapComposerText("**")} />
            <ComposerFormatButton icon={Italic} label="Italic" onClick={() => wrapComposerText("_")} />
            <ComposerFormatButton icon={Underline} label="Underline" onClick={() => wrapComposerText("__")} />
            <ComposerFormatButton icon={Strikethrough} label="Strike" onClick={() => wrapComposerText("~~")} />
            <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[11px] font-bold text-white/55">
              <Baseline className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Chat color</span>
              <select
                aria-label="Chat color"
                defaultValue="default"
                onChange={(event) => {
                  applyComposerColor(event.target.value as WorldCupChatColor)
                  event.target.value = "default"
                }}
                className="bg-transparent text-[11px] text-white/70 focus:outline-none"
              >
                {WORLD_CUP_CHAT_COLOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[11px] font-bold text-white/55">
              <span>Font</span>
              <select
                aria-label="Chat font"
                defaultValue="default"
                onChange={(event) => {
                  applyComposerFont(event.target.value as WorldCupChatFont)
                  event.target.value = "default"
                }}
                className="bg-transparent text-[11px] text-white/70 focus:outline-none"
              >
                {WORLD_CUP_CHAT_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {["🔥", "😂", "👏", "🏆", "⚽", "👀"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertComposerText(emoji)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-base"
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <ComposerUtilityButton icon={Smile} label="Emoji" onClick={() => insertComposerText("🙂")} />
            <ComposerUtilityButton icon={Film} label="GIF" onClick={() => setComposerPanel(composerPanel === "gif" ? null : "gif")} />
            <ComposerUtilityButton icon={BarChart3} label="Poll" onClick={() => setComposerPanel(composerPanel === "poll" ? null : "poll")} />
            <ComposerUtilityButton icon={ImageIcon} label="Image" onClick={() => setComposerPanel(composerPanel === "image" ? null : "image")} />
            <ComposerUtilityButton icon={Mic} label="Voice" onClick={() => setComposerPanel(composerPanel === "voice" ? null : "voice")} />
          </div>
          {sanitizeWorldCupChatMessage(chatBody).trim() ? (
            <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-white/35">Formatting Preview</p>
              <WorldCupChatRichTextSegments segments={richPreviewSegments} className="whitespace-pre-wrap break-words leading-5 text-white/65" />
            </div>
          ) : null}
          {isChimmyPrompt ? (
            <div className="mt-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs leading-5 text-white/70">
              {aiUnlocked
                ? tChat("wc.chat.aiHint.unlocked")
                : tChat("wc.chat.aiHint.locked")}
            </div>
          ) : null}
          {selectedGif ? (
            <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Selected GIF</p>
                <button
                  type="button"
                  onClick={() => setSelectedGif(null)}
                  className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold text-white/50"
                >
                  Remove
                </button>
              </div>
              <WorldCupGifPreview gif={selectedGif} />
            </div>
          ) : null}
          {selectedImage ? (
            <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Selected Image</p>
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-bold text-white/50"
                >
                  Remove
                </button>
              </div>
              <WorldCupImagePreview image={selectedImage} />
            </div>
          ) : null}
          {composerPanel === "gif" ? (
            <WorldCupGifSearchPanel
              query={gifQuery}
              onQueryChange={setGifQuery}
              onSearch={() => void searchWorldCupGifs()}
              isSearching={isGifSearching}
              error={gifError}
              results={gifResults}
              selectedGif={selectedGif}
              onSelect={(gif) => {
                setSelectedGif(gif)
                if (!chatBody.trim()) setChatBody("GIF")
              }}
            />
          ) : composerPanel === "image" ? (
            <WorldCupImageUploadPanel
              isUploading={isImageUploading}
              error={imageError}
              onFileSelected={(file) => void uploadWorldCupImage(file)}
            />
          ) : composerPanel === "poll" ? (
            <WorldCupPollComposer
              question={pollQuestion}
              options={pollOptions}
              isCreating={isPollCreating}
              error={pollError}
              onQuestionChange={setPollQuestion}
              onOptionChange={(index, value) => {
                setPollOptions((current) => current.map((option, optionIndex) => optionIndex === index ? value : option))
              }}
              onAddOption={() => setPollOptions((current) => current.length >= 6 ? current : [...current, ""])}
              onRemoveOption={(index) => setPollOptions((current) => current.length <= 2 ? current : current.filter((_, optionIndex) => optionIndex !== index))}
              onSubmit={() => void createWorldCupPoll()}
            />
          ) : composerPanel ? <WorldCupComposerFoundationPanel panel={composerPanel} /> : null}
          <p
            data-testid="wc-chat-trust-note"
            className="mt-2 text-[11px] leading-5 text-white/35"
          >
            {tChat("wc.chat.trustNote")}
          </p>
          {chatError ? (
            <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
              {chatError}
            </p>
          ) : null}
        </div>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-white/35">
            Latest Pool Updates
          </p>
          {latestAiRecap ? (
            <WorldCupShareCard
              kind="recap"
              poolName={poolName}
              recapBody={latestAiRecap.body}
              className="mb-3"
            />
          ) : null}
          <WorldCupLeagueEventFeed challengeId={challengeId} />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Megaphone className="h-4 w-4 text-white/70" aria-hidden />
              Commissioner Announcements
            </p>
            <p className="mt-2 text-xs leading-5 text-white/50">
              Post a pinned message for your pool.
            </p>
          </div>
          <span
            className={[
              "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              commissionerUnlocked
                ? "border-white/20 bg-white/[0.06] text-white/70"
                : "border-white/15 bg-white/[0.04] text-white/50",
            ].join(" ")}
          >
            {commissionerUnlocked ? "Unlocked" : "AF Commissioner feature"}
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="flex items-center gap-2 text-xs font-black text-white/80">
            <Pin className="h-3.5 w-3.5" aria-hidden />
            Pinned Announcement
          </p>
          <p className="mt-2 text-xs leading-5 text-white/50">
            {commissionerUnlocked
              ? "Announcement composer coming soon. Commissioner reminders can already post system-style updates to the activity feed."
              : "AF Commissioner feature. Pool owners and all-access users will be able to pin one announcement here."}
          </p>
        </div>

        {commissionerUnlocked ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-black text-white">System Reminders</p>
              <p className="mt-1 text-[11px] leading-5 text-white/45">
                Deadline and incomplete-bracket reminders are wired through the existing World Cup event feed.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-black text-white">Moderation</p>
              <p className="mt-1 text-[11px] leading-5 text-white/45">
                Delete/pin controls stay locked until the chat composer backend is added.
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/45">
            Free users can follow pool updates here, but commissioner announcements, pinned posts, and moderation controls require AF Commissioner access.
          </p>
        )}
      </div>
    </section>
  )
}

function ComposerUtilityButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Smile
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[11px] font-bold text-white/55 hover:border-cyan-300/30 hover:text-white/90"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  )
}

function ComposerFormatButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bold
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black text-white/65 hover:border-cyan-300/30 hover:text-white/90"
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  )
}

function getWorldCupRichTextClassName(segment: WorldCupChatRichTextSegment) {
  const colorClass: Record<WorldCupChatColor, string> = {
    default: "",
    "af-blue": "text-white/85",
    red: "text-white/85",
    amber: "text-white/75",
    green: "text-white/85",
    purple: "text-purple-200",
  }
  const fontClass: Record<WorldCupChatFont, string> = {
    default: "",
    clean: "font-sans tracking-normal",
    sport: "font-black uppercase tracking-wide",
    mono: "font-mono",
  }

  return [
    segment.marks.bold ? "font-black" : "",
    segment.marks.italic ? "italic" : "",
    segment.marks.underline ? "underline underline-offset-2" : "",
    segment.marks.strike ? "line-through" : "",
    colorClass[segment.marks.color ?? "default"],
    fontClass[segment.marks.font ?? "default"],
  ].filter(Boolean).join(" ")
}

function WorldCupChatRichTextSegments({
  segments,
  className,
}: {
  segments: WorldCupChatRichTextSegment[]
  className?: string
}) {
  return (
    <p className={className}>
      {segments.map((segment, index) => (
        <span key={`${segment.text}-${index}`} className={getWorldCupRichTextClassName(segment)}>
          {segment.text}
        </span>
      ))}
    </p>
  )
}

function WorldCupChatRichTextRenderer({ text, className }: { text: string; className?: string }) {
  return <WorldCupChatRichTextSegments segments={parseWorldCupChatRichText(text)} className={className} />
}

function WorldCupGifPreview({
  gif,
  compact = false,
}: {
  gif: WorldCupChatGifAttachment
  compact?: boolean
}) {
  return (
    <div className={compact ? "mt-2 max-w-56 overflow-hidden rounded-lg border border-white/10 bg-black/25" : "overflow-hidden rounded-lg border border-white/10 bg-black/25"}>
      <img
        src={gif.previewUrl}
        alt={gif.title || "Selected GIF"}
        className="max-h-40 w-full object-cover"
      />
      <p className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-white/35">
        <span className="truncate">{gif.title || "GIF"}</span>
        <span className="uppercase">{gif.provider}</span>
      </p>
    </div>
  )
}

function WorldCupImagePreview({
  image,
  compact = false,
}: {
  image: WorldCupChatImageAttachment
  compact?: boolean
}) {
  return (
    <div className={compact ? "mt-2 max-w-64 overflow-hidden rounded-lg border border-white/10 bg-black/25" : "overflow-hidden rounded-lg border border-white/10 bg-black/25"}>
      <img
        src={image.secureUrl}
        alt="Uploaded World Cup chat image"
        className="max-h-48 w-full object-cover"
      />
      <p className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-white/35">
        <span className="truncate">Cloudinary image</span>
        <span>{image.format.toUpperCase()} · {Math.round(image.bytes / 1024)}KB</span>
      </p>
    </div>
  )
}

function WorldCupImageUploadPanel({
  isUploading,
  error,
  onFileSelected,
}: {
  isUploading: boolean
  error: string | null
  onFileSelected: (file: File) => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-white/15 bg-black/25 p-3 text-xs leading-5 text-white/50">
      <p className="font-black text-white/75">Image Upload</p>
      <p className="mt-1">
        Upload a pool chat image through the World Cup Cloudinary route. PNG, JPEG, WebP, and GIF are allowed up to 5MB.
      </p>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-black text-white/90">
        {isUploading ? "Uploading..." : "Choose Image"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFileSelected(file)
            event.target.value = ""
          }}
        />
      </label>
      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function WorldCupPollMessage({
  poll,
  messageId,
  isVoting,
  onVote,
}: {
  poll: WorldCupChatPollAttachment
  messageId: string
  isVoting: boolean
  onVote: (optionId: string) => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
      <p className="text-xs font-black text-white">{poll.question}</p>
      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const selected = poll.currentUserVote === option.id
          return (
            <button
              key={`${messageId}-${option.id}`}
              type="button"
              onClick={() => onVote(option.id)}
              disabled={isVoting || poll.closed}
              className={[
                "w-full overflow-hidden rounded-lg border bg-black/25 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-65",
                selected ? "border-cyan-300/70" : "border-white/10 hover:border-cyan-300/35",
              ].join(" ")}
            >
              <span className="relative block">
                <span
                  className="absolute inset-y-0 left-0 bg-cyan-300/15"
                  style={{ width: `${option.percentage}%` }}
                  aria-hidden
                />
                <span className="relative flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-bold text-white/75">{option.label}</span>
                  <span className="text-[10px] font-black text-white/65">
                    {option.votes} vote{option.votes === 1 ? "" : "s"} · {option.percentage}%
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-white/35">
        {poll.totalVotes} total vote{poll.totalVotes === 1 ? "" : "s"}
        {poll.currentUserVote ? " · Your vote is counted" : ""}
        {poll.closed ? " · Closed" : ""}
      </p>
    </div>
  )
}

function WorldCupPollComposer({
  question,
  options,
  isCreating,
  error,
  onQuestionChange,
  onOptionChange,
  onAddOption,
  onRemoveOption,
  onSubmit,
}: {
  question: string
  options: string[]
  isCreating: boolean
  error: string | null
  onQuestionChange: (value: string) => void
  onOptionChange: (index: number, value: string) => void
  onAddOption: () => void
  onRemoveOption: (index: number) => void
  onSubmit: () => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-white/15 bg-black/25 p-3 text-xs leading-5 text-white/50">
      <p className="font-black text-white/75">Create Poll</p>
      <p className="mt-1">Create a single-choice poll for your World Cup pool. Each member gets one vote and can change it while open.</p>
      <input
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        maxLength={180}
        placeholder="Poll question..."
        className="mt-3 min-h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
      />
      <div className="mt-2 space-y-2">
        {options.map((option, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={option}
              onChange={(event) => onOptionChange(index, event.target.value)}
              maxLength={80}
              placeholder={`Option ${index + 1}`}
              className="min-h-10 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onRemoveOption(index)}
              disabled={options.length <= 2}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-white/55 disabled:opacity-35"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAddOption}
          disabled={options.length >= 6}
          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-black text-white/55 disabled:opacity-35"
        >
          Add Option
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isCreating}
          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-black text-white/90 disabled:opacity-45"
        >
          {isCreating ? "Creating..." : "Create Poll"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function WorldCupGifSearchPanel({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  error,
  results,
  selectedGif,
  onSelect,
}: {
  query: string
  onQueryChange: (value: string) => void
  onSearch: () => void
  isSearching: boolean
  error: string | null
  results: WorldCupChatGifAttachment[]
  selectedGif: WorldCupChatGifAttachment | null
  onSelect: (gif: WorldCupChatGifAttachment) => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-dashed border-white/15 bg-black/25 p-3 text-xs leading-5 text-white/50">
      <p className="font-black text-white/75">GIF Search</p>
      <p className="mt-1">Search is routed through the World Cup pool API. Provider keys stay server-side.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onSearch()
            }
          }}
          maxLength={64}
          placeholder="Search Klipy GIFs..."
          className="min-h-10 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={onSearch}
          disabled={isSearching || !query.trim()}
          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-black text-white/90 disabled:opacity-45"
        >
          {isSearching ? "Searching..." : "Search GIFs"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
          {error}
        </p>
      ) : null}
      {results.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {results.map((gif) => (
            <button
              key={`${gif.provider}-${gif.id}`}
              type="button"
              onClick={() => onSelect(gif)}
              className={[
                "overflow-hidden rounded-lg border bg-black/30 text-left transition",
                selectedGif?.id === gif.id && selectedGif.provider === gif.provider
                  ? "border-cyan-300/70"
                  : "border-white/10 hover:border-cyan-300/35",
              ].join(" ")}
            >
              <img src={gif.previewUrl} alt={gif.title || "GIF result"} className="h-24 w-full object-cover" />
              <span className="block truncate px-2 py-1 text-[10px] text-white/45">
                {gif.title || gif.provider}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-white/35">
          Select a GIF to attach it to your next pool message. Arbitrary GIF URLs are not accepted.
        </p>
      )}
    </div>
  )
}

function WorldCupComposerFoundationPanel({ panel }: { panel: Exclude<WorldCupComposerPanel, null> }) {
  const copy = {
    gif: {
      title: "GIF Search",
      body: "Klipy-ready GIF search is planned for this composer. GIFs stay disabled until the World Cup pool-scoped search route and moderation checks are enabled.",
    },
    poll: {
      title: "Polls Coming Soon",
      body: "Poll creation will support question text, options, close time, and one vote per pool member. No poll is created yet.",
    },
    image: {
      title: "Image Uploads",
      body: "Image uploads are coming soon with Cloudinary planning. Uploads stay disabled until pool membership checks, type limits, and metadata storage are wired.",
    },
    voice: {
      title: "Voice Notes",
      body: "Voice notes are coming soon. Recording and upload are disabled until audio limits, consent UX, and storage rules are implemented.",
    },
  }[panel]

  return (
    <div className="mt-2 rounded-xl border border-dashed border-white/15 bg-black/25 p-3 text-xs leading-5 text-white/50">
      <p className="font-black text-white/75">{copy.title}</p>
      <p className="mt-1">{copy.body}</p>
    </div>
  )
}

function WorldCupNotificationSettingsCard({ challengeId }: { challengeId: string }) {
  const defaultPrefs: WorldCupNotificationPreferenceState = {
    poolMuted: false,
    inAppEnabled: true,
    smsEnabled: false,
    usernameMentionsEnabled: true,
    allMentionsEnabled: true,
    commissionerAnnouncementsEnabled: true,
    deadlineRemindersEnabled: true,
    bracketFinalizedEnabled: true,
    resultsUpdatedEnabled: true,
    leaderboardUpdatedEnabled: true,
    generalChatEnabled: false,
    chimmyRepliesEnabled: true,
  }
  const [preferences, setPreferences] = useState(defaultPrefs)
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadPreferences() {
      try {
        const params = new URLSearchParams({ action: "notification_preferences" })
        const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat?${params.toString()}`, { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Could not load notification preferences")
        if (!cancelled && data.preferences) {
          setPreferences((current) => ({ ...current, ...data.preferences }))
        }
      } catch (err) {
        if (!cancelled) setSettingsError(err instanceof Error ? err.message : "Could not load notification preferences")
      }
    }
    void loadPreferences()
    return () => {
      cancelled = true
    }
  }, [challengeId])

  async function togglePreference(key: keyof WorldCupNotificationPreferenceState) {
    const nextValue = !preferences[key]
    setPreferences((current) => ({ ...current, [key]: nextValue }))
    setIsSaving(key)
    setSettingsError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_notification_preferences", [key]: nextValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save notification preferences")
      if (data.preferences) setPreferences((current) => ({ ...current, ...data.preferences }))
    } catch (err) {
      setPreferences((current) => ({ ...current, [key]: !nextValue }))
      setSettingsError(err instanceof Error ? err.message : "Could not save notification preferences")
    } finally {
      setIsSaving(null)
    }
  }

  const rows: Array<{ key: keyof WorldCupNotificationPreferenceState; label: string; helper?: string }> = [
    { key: "poolMuted", label: "Pool muted" },
    { key: "inAppEnabled", label: "In-app notifications" },
    { key: "smsEnabled", label: "SMS notifications", helper: "Requires verified phone." },
    { key: "usernameMentionsEnabled", label: "@username mentions" },
    { key: "allMentionsEnabled", label: "@all mentions" },
    { key: "commissionerAnnouncementsEnabled", label: "Commissioner announcements" },
    { key: "deadlineRemindersEnabled", label: "Deadline reminders" },
    { key: "bracketFinalizedEnabled", label: "Bracket finalized" },
    { key: "resultsUpdatedEnabled", label: "Results updated" },
    { key: "leaderboardUpdatedEnabled", label: "Leaderboard updated" },
    { key: "generalChatEnabled", label: "General chat messages" },
    { key: "chimmyRepliesEnabled", label: "Chimmy private replies" },
  ]

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="flex items-center gap-2 text-xs font-black text-white">
        <Bell className="h-3.5 w-3.5 text-white/70" aria-hidden />
        Notification Settings
      </p>
      <p className="mt-2 text-xs leading-5 text-white/50">
        In-app notifications are on by default. SMS alerts require a verified phone number and opt-in.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
            <span>
              <span className="block text-[11px] text-white/60">{row.label}</span>
              {row.helper ? <span className="block text-[10px] text-white/30">{row.helper}</span> : null}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={preferences[row.key]}
              aria-label={row.label}
              disabled={Boolean(isSaving)}
              onClick={() => void togglePreference(row.key)}
              className={[
                "relative h-5 w-9 rounded-full border transition disabled:opacity-50",
                preferences[row.key] ? "border-cyan-300/60 bg-cyan-300/40" : "border-white/15 bg-white/[0.06]",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition",
                  preferences[row.key] ? "left-4" : "left-0.5",
                ].join(" ")}
              />
            </button>
          </div>
        ))}
      </div>
      {settingsError ? (
        <p className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-white/85">
          {settingsError}
        </p>
      ) : null}
      <p className="mt-3 text-[11px] leading-5 text-white/35">
        Pool owners and commissioners cannot override a user's mute, SMS opt-in, or phone verification state.
      </p>
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
        {result.dryRun && <span className="text-white/70">dry run</span>}
      </div>
      {extra && <p className="mt-1 text-white/50">{extra}</p>}
      {(result.warnings ?? []).slice(0, 2).map((w) => (
        <p key={w} className="mt-1 text-white/70">{w}</p>
      ))}
      {result.syncedAt && (
        <p className="mt-1 text-white/30">{new Date(result.syncedAt).toLocaleTimeString()}</p>
      )}
    </div>
  )
}
