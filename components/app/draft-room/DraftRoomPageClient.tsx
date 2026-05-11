'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  isAllFantasyAdpEnabled,
  resolveAllFantasyAdpDraftMode,
  buildAllFantasyAdpUrl,
} from '@/lib/adp/allFantasyAdpFlag'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { DraftRoomShell, type MobileDraftTab } from '@/components/app/draft-room/DraftRoomShell'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { AutopickMeToggle, type ViewerAutopickData } from '@/components/app/draft-room/AutopickMeToggle'
import { useLiveDraftSync } from '@/hooks/useLiveDraftSync'
import { useCommissionerActions, type CommissionerControlApiResult } from '@/hooks/useCommissionerActions'
import { DraftRoomSettingsModal } from '@/components/app/draft-room/DraftRoomSettingsModal'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { DraftTeamStrip, type DraftTeamStripTeamMeta } from '@/components/app/draft-room/DraftTeamStrip'
import { PickTradeHistoryModal } from '@/components/app/draft-room/PickTradeHistoryModal'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { SportAwareDraftRoom } from '@/components/app/draft-room/SportAwareDraftRoom'
import { QueuePanel } from '@/components/app/draft-room/QueuePanel'
import { DraftIntelQueuePanel } from '@/components/app/draft-room/DraftIntelQueuePanel'
import { DraftChatPanel, type DraftChatMessage } from '@/components/app/draft-room/DraftChatPanel'
import { DraftChatDock } from '@/components/app/draft-room/DraftChatDock'
import { DraftHelperPanel } from '@/components/app/draft-room/DraftHelperPanel'
import { DraftHelperFloatingBubble } from '@/components/app/draft-room/DraftHelperFloatingBubble'
import { DraftHelperFloatingWindow } from '@/components/app/draft-room/DraftHelperFloatingWindow'
import { DraftHelperCopilot } from '@/components/app/draft-room/DraftHelperCopilot'
import { DraftHelperIntelligence } from '@/components/app/draft-room/DraftHelperIntelligence'
import { calculateDraftHelperBadgeCount, hasDraftHelperContent } from '@/lib/draft-helper/calculateBadgeCount'
import { useDraftHelperFloatingState } from '@/hooks/useDraftHelperFloatingState'
import { DraftTeamPanel } from '@/components/app/draft-room/DraftTeamPanel'
import { WarRoomPopup } from '@/components/app/draft-room/WarRoomPopup'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'
import {
  ResultsRosterPanel,
  type ResultsRosterPanelTeam,
  type ResultsRosterPanelPick,
} from '@/components/app/draft-room/ResultsRosterPanel'
import { DraftRosterStrip } from '@/components/app/draft-room/DraftRosterStrip'
import { DraftRoundOneAnnouncementOverlay } from '@/components/app/draft-room/DraftRoundOneAnnouncementOverlay'
import { DraftIntroGate } from '@/components/draft/DraftIntroGate'
import type { DraftAiOverlaySignal, PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import type { RoundOneAnnouncementQueueItem } from '@/lib/draft-room/resolvePickAnnouncementAssets'
import { resolvePickAnnouncementAssets } from '@/lib/draft-room/resolvePickAnnouncementAssets'
import type { DraftWarRoomSnapshot } from '@/components/draft/ai/DraftWarRoom'
import { LiveDraftStatusColumn } from '@/components/draft/live/LiveDraftStatusColumn'

const DraftPickTradePanel = dynamic(() => import('@/components/app/draft-room/DraftPickTradePanel'), { ssr: false })
const CommissionerControlCenterModal = dynamic(
  () => import('@/components/app/draft-room/CommissionerControlCenterModal'),
  { ssr: false }
)
const PostDraftView = dynamic(() => import('@/components/app/draft-room/PostDraftView'), { ssr: false })
const AuctionSpotlightPanel = dynamic(() => import('@/components/app/draft-room/AuctionSpotlightPanel'), { ssr: false })
const KeeperPanel = dynamic(() => import('@/components/app/draft-room/KeeperPanel'), { ssr: false })
const PreDraftWizard = dynamic(
  () => import('@/components/commissioner/PreDraftWizard').then((m) => m.PreDraftWizard),
  { ssr: false },
)
import type { DraftSessionSnapshot, QueueEntry } from '@/lib/live-draft-engine/types'
import {
  buildDraftRoomCoreState,
  resolveEffectiveCurrentPick,
  isPickCommitAllowed,
  isPickCommitAllowedByName,
} from '@/lib/live-draft-engine'
import { getUpcomingPickOwners } from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftIntelState, DraftIntelQueueEntry } from '@/lib/draft-intelligence'
import type { DraftUISettings } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { normalizeDraftQueueSizeLimit, trimDraftQueue } from '@/lib/draft-defaults/DraftQueueLimitResolver'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import {
  buildAiAdpLookupMaps,
  expandAiAdpKeysForLookup,
  lookupAiAdpMatch,
} from '@/lib/draft-room/ai-adp-lookup'
import { buildDraftSummaryForAI, buildLiveDraftBrainPayload, canAddToQueue, getDefaultRosterSlotsForSport } from '@/lib/draft-room'
import { computeTeamNeeds, detectByeWeekClusters } from '@/lib/draft-room/teamNeeds'
import type { LiveDraftBrainEnvelope } from '@/lib/live-draft-brain/schemas'
import { IdpDraftExplainerCard } from '@/components/idp/IdpDraftExplainerCard'
import { confirmTokenSpend } from '@/lib/tokens/client-confirm'
import { DRAFT_ROOM } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { computePicksUntilViewerTurn } from '@/lib/draft-room/computePicksUntilViewer'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'
import { CommissionerPickEditorPanel, type CommissionerPickEditorPlayerOption } from '@/components/app/draft-room/CommissionerPickEditorPanel'
import { CommissionerAuditLogList } from '@/components/app/draft-room/CommissionerAuditLogList'
import { PreDraftSlotSetupCard } from '@/components/app/draft-room/PreDraftSlotSetupCard'
import { isDraftPickRowEmptyFromSnapshot } from '@/lib/live-draft-engine/draftPickEmpty'
import { draftRoomPickTrace, draftRoomWarn } from '@/lib/draft-room/draftRoomDevLog'
import { buildDraftRoomPageDerivedState } from '@/lib/draft-room/buildDraftRoomPageDerivedState'
import { getPlayerImage, preloadPlayerImage } from '@/lib/players/getPlayerImage'
import { LEAGUE_DRAFT_ROOM_REVALIDATE } from '@/lib/draft-room/emitLeagueDraftRoomRevalidate'
import { filterPlayersAvailableForDraftAi } from '@/lib/draft-room/availableForDraftAi'
import { buildDraftRoomClientDiagnostics } from '@/lib/draft-room/player-pool-audit'
import type { DraftCopilotInsight } from '@/lib/draft-room/draft-copilot-types'
import { detectSnakeBackToBackSoon, computeRedraftStarterHints } from '@/lib/draft-room/redraftPlanningHints'
import { RedraftPlanningRibbon } from '@/components/app/draft-room/RedraftPlanningRibbon'
import {
  buildAssistantFeedByPlayerName,
  getAssistantFeedForPlayer,
} from '@/lib/draft-room/assistantFeedLookup'
import {
  buildDraftChatPlayerContextFromDisplay,
  type DraftChatPlayerContext,
} from '@/lib/draft-room/draft-chat-player-context'
import type { DraftAssistantRoomContext } from '@/components/app/draft-room/PlayerDetailModal'

export type DraftRoomPageClientProps = {
  /** Draft session id from URL (`/draft/[draftId]/snake`) — used for telemetry / deep links only. */
  draftId?: string
  leagueId: string
  leagueName: string
  /** League avatar/logo. Surfaced in draft-room chrome (top bar). */
  leagueLogoUrl?: string | null
  sport: string
  isDynasty?: boolean
  isCommissioner: boolean
  /** When IDP league, pass 'IDP' for position filters and roster template. */
  formatType?: string
  /** Premium chrome for live snake redraft route. */
  presentationVariant?: 'default' | 'redraft_snake'
  /**
   * Server-rendered snapshot used to seed initial state and avoid the empty
   * flash. Live-sync polling still runs as designed; this only primes the
   * first render. Omit for the legacy client-fetch flow.
   */
  initialSnapshot?: DraftSessionSnapshot | null
}

type DraftRoomChromeTeam = {
  id: string
  externalId?: string | null
  teamName: string
  ownerName: string
  avatarUrl?: string | null
  role?: string | null
  claimedByUserId?: string | null
  isCommissioner?: boolean
  isCoCommissioner?: boolean
}

function normalizeManagerKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/** Match `pickCommitFlow` / pool filters — session pick names are compared case-insensitively. */
function normalizeDraftedPlayerName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase()
}

function resolveInviteLink(payload: { inviteLink?: string | null; inviteCode?: string | null } | null | undefined): string | null {
  const direct = typeof payload?.inviteLink === 'string' ? payload.inviteLink.trim() : ''
  if (direct) return direct
  const inviteCode = typeof payload?.inviteCode === 'string' ? payload.inviteCode.trim() : ''
  if (!inviteCode || typeof window === 'undefined') return null
  return `${window.location.origin}/join?code=${encodeURIComponent(inviteCode)}`
}

function resolveManagerChromeTeam(
  manager: { rosterId: string; displayName: string },
  teams: DraftRoomChromeTeam[],
): DraftRoomChromeTeam | null {
  const rosterId = manager.rosterId.trim()
  const displayName = normalizeManagerKey(manager.displayName)
  return (
    teams.find((team) => team.id === rosterId) ??
    teams.find((team) => String(team.externalId ?? '').trim() === rosterId) ??
    teams.find((team) => normalizeManagerKey(team.teamName) === displayName) ??
    teams.find((team) => normalizeManagerKey(team.ownerName) === displayName) ??
    null
  )
}

const POLL_MS = 8000
const POLL_MS_BACKGROUND = 30000
/** Require several consecutive lightweight poll failures before treating the room as degraded (avoids top-bar flicker). */
const SESSION_POLL_FAILS_FOR_DEGRADED = 5
/** Brief delay before showing the badge so transient blips do not flash "Sync issue". */
const CONNECTION_DEGRADED_SHOW_DELAY_MS = 1600
const AI_ADP_POLL_SKIP_MS = 30 * 60 * 1000
const QUEUE_POLL_EVERY_N_TICKS = 2
const SETTINGS_POLL_EVERY_N_TICKS = 3
const CHAT_POLL_EVERY_N_TICKS = 2
const POOL_POLL_EVERY_N_TICKS = 3
const DRAFT_ROOM_LOCAL_PREFS_KEY_PREFIX = 'af:draft-room-prefs:'

function mergeDraftChatWire(
  prev: DraftChatMessage[],
  incoming: DraftChatMessage[],
): DraftChatMessage[] {
  const map = new Map<string, DraftChatMessage>()
  for (const m of prev) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
}

export function DraftRoomPageClient({
  draftId,
  leagueId,
  leagueName,
  leagueLogoUrl,
  sport,
  isDynasty = false,
  isCommissioner,
  formatType,
  presentationVariant = 'default',
  initialSnapshot,
}: DraftRoomPageClientProps) {
  type CenterDockTab = 'queue' | 'chat' | 'ai' | 'commish'
  const { data: authSession } = useSession()
  const viewerAppUserId = (authSession?.user as { id?: string } | undefined)?.id ?? null
  const [session, setSession] = useState<DraftSessionSnapshot | null>(initialSnapshot ?? null)
  const sessionRef = useRef<DraftSessionSnapshot | null>(initialSnapshot ?? null)
  useEffect(() => {
    sessionRef.current = session
  }, [session])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [draftIntel, setDraftIntel] = useState<DraftIntelState | null>(null)
  const [draftIntelLoading, setDraftIntelLoading] = useState(true)
  const [chatMessages, setChatMessages] = useState<DraftChatMessage[]>([])
  const [chatSyncActive, setChatSyncActive] = useState(false)
  const [loading, setLoading] = useState(initialSnapshot ? false : true)
  /** Set when GET draft/session returns 401/403 so we don't show the misleading "no draft session" copy. */
  const [draftSessionAccess, setDraftSessionAccess] = useState<"ok" | "unauthorized" | "forbidden" | null>(null)
  /** True only after repeated failed draft session polls — not routine background sync (avoids top-bar flicker). */
  const [connectionDegraded, setConnectionDegraded] = useState(false)
  /**
   * Pre-draft validation wizard. Opened in-place when `handleStartDraft` runs
   * the validation route and the report comes back with `canStartDraft: false`.
   * Renders as an overlay above the existing DraftRoomShell — never replaces
   * the shell, never navigates, never redirects. The unified-state contract
   * locked by `__tests__/nfl-redraft-snake-draft-board-state.test.ts` (Commit
   * E) is preserved.
   */
  const [showPreDraftValidationWizard, setShowPreDraftValidationWizard] = useState(false)
  /**
   * Slice J: in-place recovery state for `DRAFT_SESSION_MISMATCH` 409
   * responses from the session route. When the server tells the client its
   * view of the draft session is stale, we DO NOT navigate (no
   * `router.push`, `router.replace`, or `window.location.replace`) — that
   * would violate the unified-state contract locked by Commit E. Instead we
   * flip this banner on, schedule a single in-place refetch via
   * `fetchSession`, and clear the flag once the next response is 2xx.
   * After 3 consecutive 409s the banner exposes an inline "Try again" button
   * so the user can retry without leaving the room.
   */
  const [sessionMismatchRecovering, setSessionMismatchRecovering] = useState(false)
  const sessionMismatchRetryTimerRef = useRef<number | null>(null)
  const sessionMismatchAttemptsRef = useRef(0)
  const pollSessionFailStreakRef = useRef(0)
  /** Browser timers are numeric IDs; avoids NodeJS.Timeout vs DOM mismatch in `tsc`. */
  const connectionDegradedTimerRef = useRef<number | null>(null)
  /**
   * Canonical draft state from the last successful `/draft/session` response.
   * Stored in a ref (not state) — never drives renders, only used for dev-mode
   * divergence logging and future migration comparisons.
   */
  const canonicalDraftStateRef = useRef<{
    status: string
    currentPickNumber: number | null
    picksMade: number
    currentTeamId: string | null
    timerEndAt: string | null
  } | null>(null)
  const [commissionerLoading, setCommissionerLoading] = useState(false)
  /** Slice C.1: while a commissioner control or settings PATCH is in flight, the periodic
   * live-sync poll must not overwrite our optimistic patch with the server's pre-action
   * snapshot. Polling continues for queue/chat freshness — only the session/settings merges
   * are skipped while the ref is > 0. */
  const controlActionInflightRef = useRef(0)
  const [governanceBanner, setGovernanceBanner] = useState<{
    variant: 'success' | 'error' | 'info'
    message: string
  } | null>(null)
  const governanceSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pickSubmitting, setPickSubmitting] = useState(false)
  const [draftUISettings, setDraftUISettings] = useState<DraftUISettings | null>(null)
  const [skipPickAllowed, setSkipPickAllowed] = useState(false)
  const [orphanAiStatus, setOrphanAiStatus] = useState<{
    orphanRosterIds: string[]
    recentActions: Array<{ action: string; createdAt: string; reason: string | null; rosterId?: string }>
  } | null>(null)
  const [commissionerAiDraft, setCommissionerAiDraft] = useState<{
    assignedAiTeams: Array<{ teamId: string; teamName: string; aiStyle: string; tradeAggression: string; active: boolean }>
    tradeRules: {
      allowOutbound: boolean
      allowInbound: boolean
      blockAiToAi: boolean
      proposalCooldownSeconds: number
      maxProposalsPerRound: number
      acceptConfidenceMin: number
    }
  } | null>(null)
  /** Prisma AI opponent assignments — draft roster ids (see `/api/league/ai-opponents/summary`). */
  const [aiOpponentRosterIds, setAiOpponentRosterIds] = useState<string[]>([])
  /** Draft roster id → AI archetype label for manager strip badges. */
  const [aiArchetypeByRoster, setAiArchetypeByRoster] = useState<Record<string, string>>({})
  const [orphanAiProviderAvailableState, setOrphanAiProviderAvailableState] = useState<boolean>(true)
  const [draftQueueSizeLimit, setDraftQueueSizeLimit] = useState<number>(normalizeDraftQueueSizeLimit(null))
  const [leagueAiAdp, setLeagueAiAdp] = useState<{
    enabled: boolean
    entries: Array<{ playerName: string; position: string; team: string | null; adp: number; sampleSize: number; lowSample?: boolean }>
    totalDrafts: number
    computedAt: string | null
    stale?: boolean
    ageHours?: number | null
    message?: string | null
  } | null>(null)
  const aiAdpLookupMaps = useMemo(
    () => buildAiAdpLookupMaps(leagueAiAdp?.entries ?? null),
    [leagueAiAdp?.entries],
  )
  /**
   * D.5-proper — feature flag + dev-only draft-mode toggle for AllFantasy AI ADP.
   *
   * When `NEXT_PUBLIC_USE_ALLFANTASY_ADP=true`, the draft room hits the new
   * `/api/.../ai-adp?source=allfantasy&draftMode=<mode>` endpoint and bypasses
   * the legacy `lookupAiAdpMatch` client overlay so the resolver-provided
   * `e.aiAdp` value is the single source of truth for the AI ADP column.
   *
   * `?adpMode=test` (URL) or `NEXT_PUBLIC_ALLFANTASY_ADP_DRAFT_MODE=test` (env)
   * lets dev surface seeded harness data without polluting production.
   */
  const useAllFantasyAdp = useMemo(() => isAllFantasyAdpEnabled(), [])
  const allFantasyAdpDraftMode = useMemo(() => {
    const sp =
      typeof window !== 'undefined' && window.location
        ? new URLSearchParams(window.location.search)
        : null
    return resolveAllFantasyAdpDraftMode({ searchParams: sp })
  }, [])
  const [autoPickFromQueue, setAutoPickFromQueue] = useState(false)
  const [awayMode, setAwayMode] = useState(false)
  const [aiQueueReorderEnabled, setAiQueueReorderEnabled] = useState(true)
  const [draftAiExplanationEnabled, setDraftAiExplanationEnabled] = useState(false)
  const [showAiOverlays, setShowAiOverlays] = useState(true)
  const [mobileTab, setMobileTabState] = useState<MobileDraftTab>('board')
  const [centerDockTab, setCenterDockTab] = useState<CenterDockTab>('queue')
  const [commissionerEditOverall, setCommissionerEditOverall] = useState<number | null>(null)
  const [commissionerEditModalOpen, setCommissionerEditModalOpen] = useState(false)
  const openCommissionerPickEditor = useCallback((overall: number) => {
    if (!Number.isFinite(overall) || overall < 1) return
    setCommissionerEditOverall(Math.floor(overall))
    setCenterDockTab('commish')
    setCommissionerEditModalOpen(true)
  }, [])
  const floatingHelperState = useDraftHelperFloatingState()
  const setMobileTab = useCallback((tab: MobileDraftTab) => {
    sendProductAnalyticsBeacon(DRAFT_ROOM.MOBILE_TAB, { tab, leagueId })
    setMobileTabState(tab)
  }, [leagueId])
  const [aiReorderLoading, setAiReorderLoading] = useState(false)
  const [aiReorderExplanation, setAiReorderExplanation] = useState<string | null>(null)
  const [aiReorderExecutionMode, setAiReorderExecutionMode] = useState<string | null>(null)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [commissionerLeagues, setCommissionerLeagues] = useState<Array<{ id: string; name: string | null }>>([])
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastSelectedIds, setBroadcastSelectedIds] = useState<Set<string>>(new Set())
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [recommendationResult, setRecommendationResult] = useState<{
    recommendation: { player: { name: string; position: string; team?: string | null; adp?: number | null }; reason: string; confidence: number } | null
    alternatives: Array<{ player: { name: string; position: string; team?: string | null }; reason: string; confidence: number }>
    reachWarning: string | null
    valueWarning: string | null
    scarcityInsight: string | null
    stackInsight: string | null
    correlationInsight: string | null
    formatInsight: string | null
    byeNote: string | null
    explanation: string
    evidence: string[]
    caveats: string[]
    uncertainty: string | null
    execution?: { mode?: string; lane?: string } | null
  } | null>(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [recommendationError, setRecommendationError] = useState<string | null>(null)
  const recommendationRequestKeyRef = useRef('')
  const warRoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warRoomCacheRef = useRef<Map<string, DraftWarRoomSnapshot>>(new Map())
  const [warRoomData, setWarRoomData] = useState<DraftWarRoomSnapshot | null>(null)
  const [warRoomLoading, setWarRoomLoading] = useState(false)
  const [warRoomError, setWarRoomError] = useState<string | null>(null)
  const [liveBrainEnvelope, setLiveBrainEnvelope] = useState<LiveDraftBrainEnvelope | null>(null)
  const [runAiPickLoading, setRunAiPickLoading] = useState(false)
  const [resyncLoading, setResyncLoading] = useState(false)
  const [showCommissionerModal, setShowCommissionerModal] = useState(false)
  const [draftRoomSettingsOpen, setDraftRoomSettingsOpen] = useState(false)
  const [showTradePanel, setShowTradePanel] = useState(false)
  const [tradePanelGeneration, setTradePanelGeneration] = useState(0)
  const [tradeInitialDraft, setTradeInitialDraft] = useState<{
    giveRound?: number
    receiveRound?: number
    receiverRosterId?: string
  } | null>(null)
  const [pendingTradesCount, setPendingTradesCount] = useState(0)
  const [roundOneAnnouncementQueue, setRoundOneAnnouncementQueue] = useState<RoundOneAnnouncementQueueItem[]>([])
  const roundOneSeenPickIdsRef = useRef(new Set<string>())
  const roundOneBootstrapRef = useRef(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [draftPool, setDraftPool] = useState<{ entries: NormalizedDraftEntry[]; sport: string; devyConfig?: { enabled: boolean; devyRounds: number[] }; c2cConfig?: { enabled: boolean; collegeRounds: number[] }; isIdp?: boolean } | null>(null)
  const [poolFetching, setPoolFetching] = useState(true)
  const [poolError, setPoolError] = useState(false)
  const [draftAssistantContext, setDraftAssistantContext] = useState<{
    sport: string
    headlines: Array<{
      id: string
      title: string
      playerName?: string | null
      team?: string | null
      publishedAt?: string | null
      source?: string | null
    }>
    injuries: Array<{
      playerName: string
      team?: string | null
      status?: string | null
      note?: string | null
      reportedAt?: string | null
      source?: string | null
    }>
    sportsFeed: {
      available: boolean
      updatedAt?: string | null
      sourceKeys?: string[]
      digest?: string | null
    }
  } | null>(null)
  const [leagueTeams, setLeagueTeams] = useState<DraftRoomChromeTeam[]>([])
  const [rosterConfig, setRosterConfig] = useState<{
    starterSlots: Record<string, number>
    benchSlots: number
    taxiSlots: number
    devySlots: number
    orderedSlotLabels?: string[]
  } | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [claimableRosterIds, setClaimableRosterIds] = useState<string[]>([])
  const [tradeHistoryOpen, setTradeHistoryOpen] = useState(false)
  const [tradeHistoryFocus, setTradeHistoryFocus] = useState<{
    round: number
    originalRosterId: string
  } | null>(null)
  const entitlements = useEntitlements()
  const tokenBalance = useTokenBalance()
  const hasAiSubscription =
    entitlements.hasPro || entitlements.hasSupreme || entitlements.hasCommissioner || entitlements.hasAllAccess
  /**
   * Token-balance fallback: free-tier users who've bought AF token packs still
   * get to use AI features, spending one token per request. Gate is true when
   * EITHER a qualifying subscription is active OR balance > 0.
   */
  const hasAiAccess = hasAiSubscription || tokenBalance.balance > 0
  const resolvedOrphanAiProviderAvailable =
    (session as { orphanAiProviderAvailable?: boolean } | null)?.orphanAiProviderAvailable ??
    orphanAiProviderAvailableState ??
    true
  const [claimSlotLoadingRosterId, setClaimSlotLoadingRosterId] = useState<string | null>(null)
  const [auctionNominateLoading, setAuctionNominateLoading] = useState(false)
  const [auctionBidLoading, setAuctionBidLoading] = useState(false)
  const [auctionResolveLoading, setAuctionResolveLoading] = useState(false)
  const [autopickExpiredLoading, setAutopickExpiredLoading] = useState(false)
  const [helperSelectedPlayer, setHelperSelectedPlayer] = useState<{ name: string; position: string; team?: string | null } | null>(null)

  const localPrefsKey = `${DRAFT_ROOM_LOCAL_PREFS_KEY_PREFIX}${leagueId}`

  /** Draft room uses normalized pool from fetchDraftPool only; skip useLeagueSectionData to avoid duplicate /api/mock-draft/adp. */
  const draftData = null as { entries?: PlayerEntry[] } | null
  const poolLoading = poolFetching && draftPool === null
  const effectiveDraftSport = draftPool?.sport ?? sport

  const draftedNames = useMemo(
    () =>
      new Set(
        (session?.picks ?? [])
          .map((p) => normalizeDraftedPlayerName(p.playerName))
          .filter(Boolean),
      ),
    [session?.picks],
  )
  const draftedPlayerIds = useMemo(() => {
    const s = new Set<string>()
    for (const p of session?.picks ?? []) {
      if (p.playerId) s.add(String(p.playerId).trim())
    }
    return s
  }, [session?.picks])
  /** Single source for on-clock team, overall, and timer anchor — derived only from `session`. */
  const draftCore = useMemo(
    () => (session ? buildDraftRoomCoreState(session) : null),
    [session],
  )
  /** On-clock pick — uses resolver when session.currentPick is briefly null (poll/reconnect races). */
  const currentPick = useMemo(
    () => (session ? resolveEffectiveCurrentPick(session) : null),
    [session],
  )
  const tradeDraftStateFingerprint = useMemo(() => {
    if (!session) return ''
    const traded =
      Array.isArray(session.tradedPicks) && session.tradedPicks.length > 0 ? session.tradedPicks.length : 0
    const onClock =
      currentPick?.overall != null && Number.isFinite(currentPick.overall)
        ? `-o${currentPick.overall}`
        : ''
    return `${session.version}-${session.picks.length}-${traded}-${session.updatedAt}${onClock}`
  }, [session, currentPick])
  /** Fallback when Chimmy SSE has not emitted (no roster yet) or intel is idle — drives RedraftPlanningRibbon. */
  const ribbonPicksUntilUser = useMemo(() => {
    if (draftIntel?.picksUntilUser != null) return draftIntel.picksUntilUser
    if (!session || (session.status !== 'in_progress' && session.status !== 'paused')) return null
    const rid = (session as DraftSessionSnapshot & { currentUserRosterId?: string }).currentUserRosterId
    return computePicksUntilViewerTurn(session as DraftSessionSnapshot, rid ?? null)
  }, [draftIntel?.picksUntilUser, session])
  const players: PlayerEntry[] = useMemo(() => {
    const rawEntries = Array.isArray(draftPool?.entries)
      ? draftPool.entries
      : Array.isArray((draftData as any)?.entries)
        ? (draftData as any).entries
        : []
    const useNormalizedPool = Array.isArray(draftPool?.entries) && draftPool.entries.length > 0
    return useNormalizedPool
      ? (rawEntries as NormalizedDraftEntry[]).map((e) => {
          const name = e.name ?? e.display?.displayName ?? ''
          const position = e.position ?? e.display?.metadata?.position ?? ''
          const team = e.team ?? e.display?.metadata?.teamAbbreviation ?? null
          // D.5-proper — when the AllFantasy snapshot flag is on, the resolver-provided
          // `e.aiAdp` is the single source of truth. Skip the legacy lookup so we never
          // overwrite resolver values with cross-context data.
          const ai = draftUISettings?.aiAdpEnabled && !useAllFantasyAdp
            ? lookupAiAdpMatch(aiAdpLookupMaps, name, position, team)
            : null
          return {
            id: e.playerId ?? e.display?.playerId ?? name,
            name,
            position,
            team,
            adp: e.adp ?? e.display?.stats?.adp ?? null,
            byeWeek: e.byeWeek ?? e.display?.metadata?.byeWeek ?? null,
            aiAdp: useAllFantasyAdp
              ? (e.aiAdp ?? null)
              : draftUISettings?.aiAdpEnabled && ai
                ? ai.adp
                : (e.aiAdp ?? null),
            aiAdpSampleSize: useAllFantasyAdp ? e.aiAdpSampleSize : ai?.sampleSize,
            aiAdpLowSample: useAllFantasyAdp ? e.aiAdpLowSample : ai?.lowSample,
            display: e.display ?? null,
            isDevy: e.isDevy,
            school: e.school ?? null,
            classYearLabel: e.classYearLabel ?? e.display?.metadata?.classYearLabel ?? null,
            draftGrade: e.draftGrade ?? e.display?.metadata?.draftGrade ?? null,
            projectedLandingSpot: e.projectedLandingSpot ?? e.display?.metadata?.projectedLandingSpot ?? null,
            graduatedToNFL: e.graduatedToNFL,
            poolType: e.poolType,
            nflDraftProjectionSplits: e.nflDraftProjectionSplits ?? null,
          }
        })
      : rawEntries.map((e: any) => {
          const name = e.name ?? e.playerName ?? ''
          const position = e.position ?? ''
          const team = e.team ?? null
          // D.5-proper — see note above; flag bypasses legacy lookup.
          const ai = draftUISettings?.aiAdpEnabled && !useAllFantasyAdp
            ? lookupAiAdpMatch(aiAdpLookupMaps, name, position, team)
            : null
          return {
            id: e.id ?? e.playerId ?? name,
            name,
            position,
            team,
            adp: e.adp ?? e.rank ?? null,
            byeWeek: e.byeWeek ?? null,
            aiAdp: useAllFantasyAdp
              ? (e.aiAdp ?? null)
              : draftUISettings?.aiAdpEnabled && ai
                ? ai.adp
                : (e.aiAdp ?? null),
            aiAdpSampleSize: useAllFantasyAdp ? e.aiAdpSampleSize : ai?.sampleSize,
            aiAdpLowSample: useAllFantasyAdp ? e.aiAdpLowSample : ai?.lowSample,
          }
        })
  }, [draftPool, draftData, aiAdpLookupMaps, draftUISettings?.aiAdpEnabled, useAllFantasyAdp])

  const playerAuditFingerprintRef = useRef('')
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DRAFT_PLAYER_AUDIT !== 'true') return
    if (players.length === 0) return

    const diagnostics = buildDraftRoomClientDiagnostics(
      players.map((player) => ({
        id: player.playerId ?? player.id ?? null,
        name: player.name,
        position: player.position,
        team: player.team,
        imageUrl: player.display?.assets?.headshotUrl ?? null,
      })),
    )

    if (!diagnostics.hasIssues) return

    const fingerprint = JSON.stringify({
      totalPlayers: diagnostics.totalPlayers,
      duplicatePlayerIds: diagnostics.duplicatePlayerIds,
      duplicateNormalizedNames: diagnostics.duplicateNormalizedNames,
      missingImages: diagnostics.missingImages,
      malformedNameExamples: diagnostics.malformedNameExamples,
      missingTeamOrPosition: diagnostics.missingTeamOrPosition,
    })
    if (playerAuditFingerprintRef.current === fingerprint) return

    playerAuditFingerprintRef.current = fingerprint
    console.warn('[draft-room/player-audit]', {
      leagueId,
      diagnostics,
    })
  }, [leagueId, players])

  const commissionerPickEditorPlayers: CommissionerPickEditorPlayerOption[] = useMemo(() => {
    const filledPicks = (session?.picks ?? []).filter(
      (p) =>
        !isDraftPickRowEmptyFromSnapshot({
          playerName: p.playerName,
          position: p.position,
          pickMetadata: (p as { pickMetadata?: unknown }).pickMetadata,
          pickEditorEmpty: p.pickEditorEmpty,
        }),
    )
    const draftedNameSet = new Set(filledPicks.map((p) => p.playerName.trim().toLowerCase()).filter(Boolean))
    const draftedIdSet = new Set(
      filledPicks.map((p) => String(p.playerId ?? '').trim()).filter(Boolean),
    )
    return players
      .filter((p) => {
        if (!p.name || !p.position) return false
        const pid = String(p.playerId ?? p.id ?? '').trim()
        if (pid && draftedIdSet.has(pid)) return false
        return !draftedNameSet.has(p.name.trim().toLowerCase())
      })
      .slice(0, 500)
      .map((p) => ({
        id: p.playerId ?? p.id ?? p.name,
        name: p.name,
        position: p.position,
        team: p.team ?? null,
        byeWeek: p.byeWeek ?? null,
        imageUrl: p.display?.assets?.headshotUrl ?? null,
      }))
  }, [players, session?.picks])

  useEffect(() => {
    roundOneSeenPickIdsRef.current.clear()
    roundOneBootstrapRef.current = false
    setRoundOneAnnouncementQueue([])
  }, [leagueId])

  const dismissRoundOneAnnouncement = useCallback(() => {
    setRoundOneAnnouncementQueue((q) => q.slice(1))
  }, [])

  useEffect(() => {
    if (!session?.picks || session.status !== 'in_progress') return

    const picks = session.picks ?? []
    if (!roundOneBootstrapRef.current) {
      for (const p of picks) roundOneSeenPickIdsRef.current.add(p.id)
      roundOneBootstrapRef.current = true
      return
    }

    const rsRoom = presentationVariant === 'redraft_snake' && !isDynasty
    const visualsOn = draftUISettings?.roundOnePickAnnouncementEnabled !== false

    for (const p of picks) {
      if (roundOneSeenPickIdsRef.current.has(p.id)) continue
      roundOneSeenPickIdsRef.current.add(p.id)
      if (!rsRoom || !visualsOn || p.round !== 1) continue

      const assets = resolvePickAnnouncementAssets(p, players)
      setRoundOneAnnouncementQueue((prev) =>
        [...prev, { id: p.id, pick: p, ...assets }].slice(-4),
      )
    }
  }, [
    session?.picks,
    session?.status,
    session?.version,
    players,
    presentationVariant,
    isDynasty,
    draftUISettings?.roundOnePickAnnouncementEnabled,
  ])

  const assistantFeedByName = useMemo(
    () =>
      buildAssistantFeedByPlayerName(draftAssistantContext?.headlines ?? [], draftAssistantContext?.injuries ?? []),
    [draftAssistantContext],
  )

  const assistantFeedBriefForRecommend = useMemo(() => {
    const ctx = draftAssistantContext
    if (!ctx) return ''
    const chunks: string[] = []
    for (const h of ctx.headlines.slice(0, 5)) {
      const t = typeof h.title === 'string' ? h.title.trim() : ''
      if (!t) continue
      chunks.push(h.playerName ? `${h.playerName}: ${t}` : t)
    }
    for (const inj of ctx.injuries.slice(0, 5)) {
      const bits = [inj.playerName, inj.team, inj.status, inj.note].filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      )
      if (bits.length) chunks.push(bits.join(' '))
    }
    const digest = ctx.sportsFeed?.digest?.trim()
    if (digest) chunks.push(digest)
    return chunks.join(' | ').slice(0, 600)
  }, [draftAssistantContext])

  const resolvePlayerFromPool = useCallback(
    (name: string, position: string) =>
      players.find(
        (p) =>
          p.name.trim().toLowerCase() === name.trim().toLowerCase() &&
          p.position.trim().toLowerCase() === position.trim().toLowerCase(),
      ) ?? null,
    [players],
  )

  /** AI layers must never surface players who are already drafted or missing from the live pool. */
  const isAiRecommendationPlayerAvailable = useCallback(
    (name: string, position: string): boolean => {
      const resolved = resolvePlayerFromPool(name, position)
      if (!resolved) return false
      if (
        !isPickCommitAllowedByName({
          canDraft: true,
          playerName: resolved.name,
          draftedNames,
        })
      ) {
        return false
      }
      const pidRaw = resolved.display?.playerId ?? resolved.id ?? null
      const pid =
        pidRaw != null &&
        String(pidRaw).trim() !== '' &&
        !String(pidRaw).startsWith('name:')
          ? String(pidRaw).trim()
          : null
      if (
        pid &&
        !isPickCommitAllowed({
          canDraft: true,
          playerId: pid,
          draftedPlayerIds,
        })
      ) {
        return false
      }
      return true
    },
    [resolvePlayerFromPool, draftedNames, draftedPlayerIds],
  )

  const getAssistantRoomContext = useCallback(
    (player: PlayerEntry): DraftAssistantRoomContext | null => {
      const snap = getAssistantFeedForPlayer(assistantFeedByName, player.name)
      const digestRaw = draftAssistantContext?.sportsFeed?.digest?.trim()
      const digestPreview =
        digestRaw && digestRaw.length > 280 ? `${digestRaw.slice(0, 277)}…` : digestRaw ?? null
      const headline = snap?.headlineTitle?.trim() || null
      const injuryLine =
        snap?.injuryStatus || snap?.injuryNote
          ? [snap.injuryStatus, snap.injuryNote].filter(Boolean).join(' · ')
          : null
      if (!headline && !injuryLine && !digestPreview) return null
      return { headline, injuryLine, digestPreview }
    },
    [assistantFeedByName, draftAssistantContext?.sportsFeed?.digest],
  )

  const currentUserRosterId = (session as any)?.currentUserRosterId as string | undefined
  const rosterConfigBlocked = Boolean(session?.rosterConfigurationIncomplete)

  const commissionerOfflinePick = Boolean(draftUISettings?.executionMode === 'offline' && isCommissioner)
  const isCurrentUserOnClock = Boolean(
    currentUserRosterId &&
      draftCore?.draftStarted &&
      draftCore.currentOverall > 0 &&
      draftCore.currentTeamId === currentUserRosterId,
  )
  const overnightBlocksUserPicks = Boolean(
    session?.status === 'in_progress' &&
      session.timer?.pauseReason === 'overnight_window' &&
      draftUISettings?.allowPicksDuringOvernightPause !== true,
  )
  const snakeCanDraftRaw = useMemo(
    () =>
      session != null &&
      session.status === 'in_progress' &&
      !overnightBlocksUserPicks &&
      !commissionerLoading &&
      draftCore?.draftStarted === true &&
      draftCore.currentOverall > 0 &&
      pickSubmitting === false &&
      (commissionerOfflinePick || isCurrentUserOnClock),
    [session, draftCore, pickSubmitting, commissionerOfflinePick, isCurrentUserOnClock, overnightBlocksUserPicks, commissionerLoading],
  )

  useEffect(() => {
    if (snakeCanDraftRaw || session?.status !== 'in_progress') return
    console.warn('[draft-gate] picks blocked', {
      draftStarted: draftCore?.draftStarted,
      currentOverall: draftCore?.currentOverall,
      onClockTeam: draftCore?.currentTeamId,
      viewerRosterId: currentUserRosterId,
      rosterMatch: draftCore?.currentTeamId === currentUserRosterId,
      commissionerLoading,
      pickSubmitting,
      overnightBlocked: overnightBlocksUserPicks,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snakeCanDraftRaw, session?.status])

  const isAuctionDraft = session?.draftType === 'auction'
  const auctionNom = session?.auction
  const auctionNominator = auctionNom?.nominationOrder?.[auctionNom?.auctionState?.nominationOrderIndex ?? 0]
  const isMyTurnToNominateDraft = Boolean(
    isAuctionDraft && currentUserRosterId != null && auctionNominator?.rosterId === currentUserRosterId,
  )
  const auctionCanBidRaw = Boolean(
    isAuctionDraft &&
      session?.status === 'in_progress' &&
      Boolean(currentUserRosterId) &&
      auctionNom?.auctionState?.currentNomination != null,
  )

  const draftRoomState = useMemo(
    () =>
      buildDraftRoomPageDerivedState({
        session,
        draftCore,
        currentPick,
        players,
        draftedNames,
        draftedPlayerIds,
        isCommissioner,
        rosterConfigurationIncomplete: rosterConfigBlocked,
        rosterConfigurationMessage: session?.rosterConfigurationMessage ?? null,
        snakeCanDraft: snakeCanDraftRaw,
        auctionCanNominate: isMyTurnToNominateDraft,
        auctionCanBid: auctionCanBidRaw,
      }),
    [
      session,
      draftCore,
      currentPick,
      players,
      draftedNames,
      draftedPlayerIds,
      isCommissioner,
      rosterConfigBlocked,
      session?.rosterConfigurationMessage,
      snakeCanDraftRaw,
      isMyTurnToNominateDraft,
      auctionCanBidRaw,
    ],
  )

  const canDraft = draftRoomState.canDraft

  useEffect(() => {
    if (!session) return
    draftRoomPickTrace({
      event: 'draft-gate',
      sessionStatus: session.status,
      sessionCurrentPickOverall: session.currentPick?.overall ?? null,
      effectivePickOverall: currentPick?.overall ?? null,
      draftStarted: draftCore?.draftStarted,
      currentOverall: draftCore?.currentOverall,
      currentUserRosterId,
      currentTeamId: draftCore?.currentTeamId,
      slotOrderLen: session.slotOrder?.length ?? 0,
      rounds: session.rounds,
      teamCount: session.teamCount,
      isCurrentUserOnClock,
      canDraft,
      pickSubmitting,
      timerMode: draftRoomState.timerMode,
      timerStatus: session.timer?.status,
      timerEndAt: session.timer?.timerEndAt ?? session.timerEndAt ?? null,
      sessionVersion: session.version,
      updatedAt: session.updatedAt,
    })
  }, [
    session,
    currentPick?.overall,
    draftCore?.draftStarted,
    draftCore?.currentOverall,
    draftCore?.currentTeamId,
    currentUserRosterId,
    isCurrentUserOnClock,
    canDraft,
    draftRoomState.timerMode,
    pickSubmitting,
  ])

  const fetchDraftPool = useCallback(async () => {
    if (!leagueId) {
      setPoolFetching(false)
      return
    }
    setPoolFetching(true)
    setPoolError(false)
    const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/draft/pool`
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      const data = await res.json().catch(() => ({}))
      if (process.env.NODE_ENV !== 'production') {
        const rowCount = Array.isArray(data?.entries) ? data.entries.length : 0
        const source = typeof data?.meta?.source === 'string' ? data.meta.source : null
        console.info('[draft-room] draft pool loaded', {
          endpoint,
          leagueId,
          rowCount,
          elapsedMs,
          source,
          cacheHit: source === 'db-cache',
        })
      }
      if (res.ok && Array.isArray(data.entries)) {
        setDraftPool({
          entries: data.entries,
          sport: data.sport ?? sport,
          devyConfig: data.devyConfig,
          c2cConfig: data.c2cConfig,
          isIdp: data.isIdp,
        })
        // Preload headshots for first 20 rows so browser cache is warm when
        // IntersectionObserver fires for visible rows (P2 CDN latency mitigation).
        const poolSport = data.sport ?? sport
        for (const entry of (data.entries as Array<Record<string, unknown>>).slice(0, 20)) {
          const url =
            getPlayerImage(
              { imageUrl: (entry.display as Record<string, unknown> | undefined)?.assets ? ((entry.display as Record<string, unknown>).assets as Record<string, unknown>).headshotUrl as string | null : null, name: String(entry.name ?? ''), id: String(entry.playerId ?? entry.id ?? '') },
              poolSport,
            ) ?? ((entry.display as Record<string, unknown> | undefined)?.assets as Record<string, unknown> | undefined)?.headshotUrl as string | null | undefined
          preloadPlayerImage(url as string | null | undefined)
        }
      } else {
        setDraftPool(null)
        setPoolError(true)
      }
    } catch {
      if (process.env.NODE_ENV !== 'production') {
        const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
        console.warn('[draft-room] draft pool load failed', {
          endpoint,
          leagueId,
          elapsedMs,
        })
      }
      setDraftPool(null)
      setPoolError(true)
    } finally {
      setPoolFetching(false)
    }
  }, [leagueId, sport])

  const fetchRosterConfig = useCallback(async () => {
    if (!leagueId) return
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/roster-config`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (!data || typeof data !== 'object') return
      const starterSlots =
        data.starterSlots && typeof data.starterSlots === 'object'
          ? (data.starterSlots as Record<string, number>)
          : {}
      const ordered =
        Array.isArray(data.orderedSlotLabels) &&
        data.orderedSlotLabels.every((x: unknown) => typeof x === 'string')
          ? (data.orderedSlotLabels as string[])
          : undefined
      setRosterConfig({
        starterSlots,
        benchSlots: typeof data.benchSlots === 'number' ? data.benchSlots : 0,
        taxiSlots: typeof data.taxiSlots === 'number' ? data.taxiSlots : 0,
        devySlots: typeof data.devySlots === 'number' ? data.devySlots : 0,
        ...(ordered && ordered.length > 0 ? { orderedSlotLabels: ordered } : {}),
      })
    } catch {
      /* keep null → strip falls back */
    }
  }, [leagueId])

  useEffect(() => {
    void fetchRosterConfig()
  }, [fetchRosterConfig])

  const [idpRosterSummary, setIdpRosterSummary] = useState<{ starterSlots: Record<string, number>; benchSlots: number } | null>(null)
  const [idpScoringPreset, setIdpScoringPreset] = useState<string>('balanced')
  const [idpPositionMode, setIdpPositionMode] = useState<string>('standard')
  const effectiveRosterSlots = useMemo(() => {
    if (formatType === 'IDP' && idpRosterSummary) {
      const slots: string[] = []
      for (const [slotName, count] of Object.entries(idpRosterSummary.starterSlots)) {
        for (let i = 0; i < count; i += 1) slots.push(slotName)
      }
      for (let i = 0; i < (idpRosterSummary.benchSlots ?? 0); i += 1) {
        slots.push('BENCH')
      }
      return slots
    }

    const labels = rosterConfig?.orderedSlotLabels
    if (Array.isArray(labels) && labels.length > 0) return labels

    /** Last resort when `/roster-config` failed — matches `getRosterSlotLabelsForLeagueDraft` server fallback (sport defaults). */
    return getDefaultRosterSlotsForSport(effectiveDraftSport)
  }, [effectiveDraftSport, formatType, idpRosterSummary, rosterConfig?.orderedSlotLabels])
  const isSuperflexFormat = useMemo(() => {
    const normalizedSlots = effectiveRosterSlots.map((slot) => String(slot || '').toUpperCase())
    return (
      normalizedSlots.includes('SUPER_FLEX') ||
      normalizedSlots.includes('SUPERFLEX') ||
      normalizedSlots.includes('OP') ||
      normalizedSlots.filter((slot) => slot === 'QB').length >= 2
    )
  }, [effectiveRosterSlots])

  const warRoomBrainInput = useMemo(() => {
    if (!session) return null
    const aiAdpByKey =
      draftUISettings?.aiAdpEnabled && leagueAiAdp?.entries?.length
        ? expandAiAdpKeysForLookup(leagueAiAdp.entries)
        : {}
    return buildLiveDraftBrainPayload({
      session,
      effectiveDraftSport,
      isDynasty,
      formatType,
      isIdpLeague: Boolean(draftPool?.isIdp),
      isSuperflexFormat,
      isTePremium: effectiveRosterSlots.some((s) => /TE\+|PREM|PREMIUM|TE\s*PREM/i.test(String(s))),
      leagueSiteDraftCount: leagueAiAdp?.totalDrafts,
      currentUserRosterId,
      players,
      draftedNames,
      effectiveRosterSlots,
      aiAdpByKey: Object.keys(aiAdpByKey).length ? aiAdpByKey : undefined,
    })
  }, [
    session,
    effectiveDraftSport,
    isDynasty,
    formatType,
    draftPool?.isIdp,
    isSuperflexFormat,
    effectiveRosterSlots,
    leagueAiAdp?.entries,
    leagueAiAdp?.totalDrafts,
    draftUISettings?.aiAdpEnabled,
    currentUserRosterId,
    players,
    draftedNames,
  ])

  const fetchDraftSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // Don't clobber an optimistic toggle while a PATCH is still in flight.
        if (data.draftUISettings && controlActionInflightRef.current === 0) setDraftUISettings(data.draftUISettings)
        if (typeof data.orphanAiProviderAvailable === 'boolean') {
          setOrphanAiProviderAvailableState(data.orphanAiProviderAvailable)
        }
        setSkipPickAllowed(String(data?.config?.autopick_behavior ?? '').toLowerCase() === 'skip')
        if (data.orphanStatus && typeof data.orphanStatus === 'object') {
          setOrphanAiStatus(data.orphanStatus)
        } else {
          setOrphanAiStatus(null)
        }
        if (data.commissionerAiDraft && typeof data.commissionerAiDraft === 'object') {
          setCommissionerAiDraft(data.commissionerAiDraft)
        } else {
          setCommissionerAiDraft(null)
        }
        // Phase 3b — perf: ai-opponents/summary takes ~70s on cold load
        // (calls AI provider). DON'T await it — fire-and-forget and let the
        // panel re-render when it lands. Initialize to empty so consumers
        // don't see undefined.
        setAiOpponentRosterIds([])
        setAiArchetypeByRoster({})
        void (async () => {
          try {
            const aiSum = await fetch(`/api/league/ai-opponents/summary?leagueId=${encodeURIComponent(leagueId)}`, {
              cache: 'no-store',
              credentials: 'include',
            })
            const sumJson = await aiSum.json().catch(() => ({}))
            if (aiSum.ok && Array.isArray(sumJson.aiManagedDraftRosterIds)) {
              setAiOpponentRosterIds(sumJson.aiManagedDraftRosterIds.filter((x: unknown) => typeof x === 'string'))
            }
            const arch: Record<string, string> = {}
            if (aiSum.ok && Array.isArray(sumJson.assignments)) {
              for (const a of sumJson.assignments as { draftRosterId?: string | null; archetypeLabel?: string | null }[]) {
                if (a.draftRosterId && typeof a.archetypeLabel === 'string' && a.archetypeLabel.trim()) {
                  arch[a.draftRosterId] = a.archetypeLabel.trim()
                }
              }
              setAiArchetypeByRoster(arch)
            }
          } catch {
            /* keep empty defaults — no panic on AI failure */
          }
        })()
        setDraftQueueSizeLimit(normalizeDraftQueueSizeLimit(data?.config?.queue_size_limit))
        setIdpRosterSummary(data.idpRosterSummary ?? null)
      }
    } catch {
      setDraftUISettings(null)
      setSkipPickAllowed(false)
      setOrphanAiStatus(null)
      setCommissionerAiDraft(null)
      setAiOpponentRosterIds([])
      setAiArchetypeByRoster({})
      setDraftQueueSizeLimit(normalizeDraftQueueSizeLimit(null))
      setIdpRosterSummary(null)
    }
  }, [leagueId])

  const fetchDraftAssistantContext = useCallback(async () => {
    if (!leagueId) return
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/assistant-context`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setDraftAssistantContext({
          sport: typeof data.sport === 'string' ? data.sport : sport,
          headlines: Array.isArray(data.headlines) ? data.headlines : [],
          injuries: Array.isArray(data.injuries) ? data.injuries : [],
          sportsFeed: data.sportsFeed && typeof data.sportsFeed === 'object'
            ? {
                available: Boolean(data.sportsFeed.available),
                updatedAt: typeof data.sportsFeed.updatedAt === 'string' ? data.sportsFeed.updatedAt : null,
                sourceKeys: Array.isArray(data.sportsFeed.sourceKeys)
                  ? data.sportsFeed.sourceKeys.filter((value: unknown): value is string => typeof value === 'string')
                  : [],
                digest: typeof data.sportsFeed.digest === 'string' ? data.sportsFeed.digest : null,
              }
            : {
                available: false,
                updatedAt: null,
                sourceKeys: [],
                digest: null,
              },
        })
      }
    } catch {
      setDraftAssistantContext(null)
    }
  }, [leagueId, sport])

  const fetchDraftChromeData = useCallback(async () => {
    try {
      const [settingsRes, privacyRes] = await Promise.all([
        fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/privacy`, { cache: 'no-store' }),
      ])

      const settingsJson = await settingsRes.json().catch(() => ({}))
      const privacyJson = await privacyRes.json().catch(() => ({}))

      if (settingsRes.ok && Array.isArray(settingsJson?.league?.teams)) {
        setLeagueTeams(settingsJson.league.teams as DraftRoomChromeTeam[])
      } else {
        setLeagueTeams([])
      }

      if (privacyRes.ok) {
        setInviteLink(resolveInviteLink(privacyJson))
      } else {
        setInviteLink(null)
      }
    } catch {
      setLeagueTeams([])
      setInviteLink(null)
    }
  }, [leagueId])

  const fetchClaimableRosters = useCallback(async () => {
    if (!leagueId) return
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/claim-roster`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.alreadyClaimed) {
        setClaimableRosterIds([])
        return
      }
      const rows = Array.isArray(data.rosters) ? data.rosters : []
      setClaimableRosterIds(
        rows
          .map((r: { rosterId?: string }) => (typeof r?.rosterId === 'string' ? r.rosterId : ''))
          .filter(Boolean),
      )
    } catch {
      setClaimableRosterIds([])
    }
  }, [leagueId])

  useEffect(() => {
    if (!session?.id) return
    if (currentUserRosterId) {
      setClaimableRosterIds([])
      return
    }
    void fetchClaimableRosters()
  }, [session?.id, currentUserRosterId, fetchClaimableRosters])

  useEffect(() => {
    if (typeof window === 'undefined' || !leagueId) return
    try {
      const raw = window.localStorage.getItem(localPrefsKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        autoPickFromQueue?: boolean
        awayMode?: boolean
        aiQueueReorderEnabled?: boolean
        draftAiExplanationEnabled?: boolean
        showAiOverlays?: boolean
      }
      if (typeof parsed.autoPickFromQueue === 'boolean') setAutoPickFromQueue(parsed.autoPickFromQueue)
      if (typeof parsed.awayMode === 'boolean') setAwayMode(parsed.awayMode)
      if (typeof parsed.aiQueueReorderEnabled === 'boolean') {
        setAiQueueReorderEnabled(parsed.aiQueueReorderEnabled)
      }
      if (typeof parsed.draftAiExplanationEnabled === 'boolean') {
        setDraftAiExplanationEnabled(parsed.draftAiExplanationEnabled)
      }
      if (typeof parsed.showAiOverlays === 'boolean') {
        setShowAiOverlays(parsed.showAiOverlays)
      }
    } catch {
      // Ignore malformed local preferences.
    }
  }, [leagueId, localPrefsKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !leagueId) return
    try {
      window.localStorage.setItem(
        localPrefsKey,
        JSON.stringify({
          autoPickFromQueue,
          awayMode,
          aiQueueReorderEnabled,
          draftAiExplanationEnabled,
          showAiOverlays,
        })
      )
    } catch {
      // Ignore storage failures.
    }
  }, [
    leagueId,
    localPrefsKey,
    autoPickFromQueue,
    awayMode,
    aiQueueReorderEnabled,
    draftAiExplanationEnabled,
    showAiOverlays,
  ])

  const fetchLeagueAiAdp = useCallback(async () => {
    if (!draftUISettings?.aiAdpEnabled) {
      setLeagueAiAdp(null)
      return
    }
    try {
      // D.5-proper — when the feature flag is on, hit the AllFantasy snapshot path.
      // When off, keep the legacy URL so existing production traffic is unchanged.
      const url = useAllFantasyAdp
        ? buildAllFantasyAdpUrl(leagueId, { draftMode: allFantasyAdpDraftMode })
        : `/api/leagues/${encodeURIComponent(leagueId)}/ai-adp`
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setLeagueAiAdp({
          enabled: data.enabled ?? false,
          entries: Array.isArray(data.entries) ? data.entries : [],
          totalDrafts: data.totalDrafts ?? 0,
          computedAt: data.computedAt ?? null,
          stale: data.stale ?? false,
          ageHours: data.ageHours ?? null,
          message: data.message ?? null,
        })
      } else {
        setLeagueAiAdp({ enabled: true, entries: [], totalDrafts: 0, computedAt: null, stale: true, ageHours: null, message: 'AI ADP unavailable' })
      }
    } catch {
      setLeagueAiAdp(draftUISettings?.aiAdpEnabled ? { enabled: true, entries: [], totalDrafts: 0, computedAt: null, stale: true, ageHours: null, message: 'AI ADP unavailable' } : null)
    }
  }, [leagueId, draftUISettings?.aiAdpEnabled, useAllFantasyAdp, allFantasyAdpDraftMode])

  const fetchSession = useCallback(async (): Promise<boolean> => {
    const hadSessionBeforeRequest = Boolean(sessionRef.current)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/session`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setDraftSessionAccess("unauthorized")
        setSession(null)
        return false
      }
      if (res.status === 403) {
        setDraftSessionAccess("forbidden")
        setSession(null)
        return false
      }
      // Slice J — 409 / DRAFT_SESSION_MISMATCH: the server has detected the
      // client is reading a stale or non-canonical draft session for this
      // league. Recover IN-PLACE: keep the same DraftRoomShell + DraftBoard
      // mounted, show an inline banner, and schedule a single refetch.
      // Never `router.push` / `router.replace` / `window.location` here —
      // navigation breaks the unified-state contract locked by Commit E.
      if (res.status === 409 && (data as { code?: unknown })?.code === 'DRAFT_SESSION_MISMATCH') {
        setSessionMismatchRecovering(true)
        sessionMismatchAttemptsRef.current += 1
        if (sessionMismatchRetryTimerRef.current && typeof window !== 'undefined') {
          window.clearTimeout(sessionMismatchRetryTimerRef.current)
        }
        // Cap at 3 retries — past that, the banner exposes an inline retry
        // button instead of looping forever.
        if (sessionMismatchAttemptsRef.current <= 3 && typeof window !== 'undefined') {
          sessionMismatchRetryTimerRef.current = window.setTimeout(() => {
            sessionMismatchRetryTimerRef.current = null
            void fetchSession()
          }, 800)
        }
        return false
      }
      if (res.ok && data.session) {
        setDraftSessionAccess("ok")
        // Recovered (idempotent — safe even if no prior mismatch was observed).
        setSessionMismatchRecovering(false)
        sessionMismatchAttemptsRef.current = 0
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        // Store canonical state from the response for dev-mode divergence logging.
        if (data.canonicalDraftState && typeof data.canonicalDraftState === 'object') {
          const c = data.canonicalDraftState as {
            status?: unknown
            currentPickNumber?: unknown
            picksMade?: unknown
            currentTeamId?: unknown
            timerEndAt?: unknown
          }
          canonicalDraftStateRef.current = {
            status: typeof c.status === 'string' ? c.status : '',
            currentPickNumber: typeof c.currentPickNumber === 'number' ? c.currentPickNumber : null,
            picksMade: typeof c.picksMade === 'number' ? c.picksMade : 0,
            currentTeamId: typeof c.currentTeamId === 'string' ? c.currentTeamId : null,
            timerEndAt: typeof c.timerEndAt === 'string' ? c.timerEndAt : null,
          }
          if (process.env.NODE_ENV !== 'production' && data.canonicalDraftStateParity) {
            const parity = data.canonicalDraftStateParity as {
              statusMatches?: boolean
              currentPickMatches?: boolean
              picksMadeMatches?: boolean
            }
            if (parity.statusMatches === false || parity.currentPickMatches === false || parity.picksMadeMatches === false) {
              console.warn('[draft-room/canonical-parity] client-visible drift', {
                leagueId,
                parity,
                canonical: canonicalDraftStateRef.current,
              })
            }
          }
        }
        return true
      }
      if (res.ok) {
        setDraftSessionAccess("ok")
        if (!hadSessionBeforeRequest) {
          setSession(null)
        }
        return true
      }
      setDraftSessionAccess(null)
      if (!hadSessionBeforeRequest) {
        setSession(null)
      }
      return hadSessionBeforeRequest
    } catch {
      setDraftSessionAccess(null)
      if (!hadSessionBeforeRequest) {
        setSession(null)
      }
      return hadSessionBeforeRequest
    }
  }, [leagueId])

  useEffect(() => {
    if (typeof window === 'undefined' || !leagueId) return
    const handler = (ev: Event) => {
      const d = (ev as CustomEvent<{ leagueId?: string }>).detail
      if (d?.leagueId !== leagueId) return
      void fetchRosterConfig()
      void fetchSession()
      void fetchDraftPool()
    }
    window.addEventListener(LEAGUE_DRAFT_ROOM_REVALIDATE, handler as EventListener)
    return () => window.removeEventListener(LEAGUE_DRAFT_ROOM_REVALIDATE, handler as EventListener)
  }, [leagueId, fetchDraftPool, fetchRosterConfig, fetchSession])

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/queue`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.queue)) {
        const next = data.queue as QueueEntry[]
        setQueue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      }
    } catch {
      setQueue([])
    }
  }, [leagueId])

  const fetchChat = useCallback(async () => {
    if (!leagueId) return
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/chat`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.messages)) {
        const incoming = data.messages as DraftChatMessage[]
        setChatMessages((prev) => {
          const merged = mergeDraftChatWire(prev, incoming)
          return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged
        })
        setChatSyncActive(Boolean(data.syncActive))
      }
    } catch {
      /* Keep last good messages — blanking chat on a flaky network reads like data loss */
      setChatSyncActive(false)
    }
  }, [leagueId])

  const handleChatReconnect = useCallback(() => {
    setChatSendError(null)
    fetchSession()
    fetchQueue()
    fetchDraftSettings()
    fetchDraftAssistantContext()
    fetchChat()
  }, [fetchSession, fetchQueue, fetchDraftSettings, fetchDraftAssistantContext, fetchChat])

  /**
   * Toggle a chat reaction via the shared reactions route. Optimistic update
   * mutates local state immediately (add or remove by emoji+userId) so the UI
   * feels snappy; the next `fetchChat()` reconciles the authoritative counts
   * from the server. Falls through silently on failure — the reconcile fetch
   * restores the correct state.
   */
  const handleReactChat = useCallback(
    async (messageId: string, emoji: string) => {
      if (!viewerAppUserId) return
      let didAdd = true
      setChatMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const reactions = Array.isArray((m as { reactions?: unknown }).reactions)
            ? ([...((m as { reactions: Array<{ emoji: string; count: number; userIds: string[] }> }).reactions)])
            : []
          const idx = reactions.findIndex((r) => r.emoji === emoji)
          if (idx >= 0) {
            const entry = reactions[idx]!
            if (entry.userIds.includes(viewerAppUserId)) {
              const userIds = entry.userIds.filter((id) => id !== viewerAppUserId)
              didAdd = false
              if (userIds.length === 0) reactions.splice(idx, 1)
              else reactions[idx] = { ...entry, userIds, count: userIds.length }
            } else {
              const userIds = [...entry.userIds, viewerAppUserId]
              reactions[idx] = { ...entry, userIds, count: userIds.length }
            }
          } else {
            reactions.push({ emoji, count: 1, userIds: [viewerAppUserId] })
          }
          return { ...m, reactions }
        }),
      )
      try {
        const roomId = `league:${leagueId}`
        await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/reactions`,
          {
            method: didAdd ? 'POST' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
          },
        )
      } catch {
        /* reconcile on next fetch */
      } finally {
        fetchChat()
      }
    },
    [viewerAppUserId, leagueId, fetchChat],
  )

  const [chatSending, setChatSending] = useState(false)
  const [chatSendError, setChatSendError] = useState<string | null>(null)
  const [pickSuccessFlash, setPickSuccessFlash] = useState<string | null>(null)

  const handleSendChat = useCallback(
    async (text: string) => {
      if (!text.trim() || chatSending) return
      setChatSending(true)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.trim() }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.message) {
          setChatSendError(null)
          sendProductAnalyticsBeacon(DRAFT_ROOM.CHAT_SEND, {
            leagueId,
            len: text.trim().length,
            leagueSync: typeof data.syncActive === 'boolean' ? data.syncActive : undefined,
          })
          setChatMessages((prev) => {
            const msg = data.message as (typeof prev)[0]
            if (prev.some((m) => m.id === msg.id)) return prev
            return [...prev, msg].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
          })
          if (typeof data.syncActive === 'boolean') {
            setChatSyncActive(data.syncActive)
          }
        } else {
          setChatSendError(typeof data?.error === 'string' ? data.error : 'Message could not be sent. Try again.')
        }
      } catch (err) {
        draftRoomWarn('chat-send', err)
        setChatSendError('Could not send message. Check your connection and try again.')
      } finally {
        setChatSending(false)
      }
    },
    [leagueId, chatSending],
  )

  const fetchCommissionerLeagues = useCallback(async () => {
    try {
      const res = await fetch('/api/commissioner/leagues', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.leagues)) setCommissionerLeagues(data.leagues)
    } catch {
      setCommissionerLeagues([])
    }
  }, [])

  const handleBroadcastOpen = useCallback(() => {
    setShowBroadcastModal(true)
    setBroadcastSelectedIds(new Set([leagueId]))
    setBroadcastMessage('')
    fetchCommissionerLeagues()
  }, [leagueId, fetchCommissionerLeagues])

  const handleBroadcastSubmit = useCallback(async () => {
    if (broadcastSelectedIds.size === 0 || !broadcastMessage.trim() || broadcastSending) return
    setBroadcastSending(true)
    try {
      const res = await fetch('/api/commissioner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueIds: Array.from(broadcastSelectedIds),
          message: broadcastMessage.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setShowBroadcastModal(false)
        setBroadcastMessage('')
        if (broadcastSelectedIds.has(leagueId)) fetchChat()
      }
    } finally {
      setBroadcastSending(false)
    }
  }, [broadcastSelectedIds, broadcastMessage, broadcastSending, leagueId, fetchChat])

  const fetchRecommendation = useCallback(async () => {
    if (!session || !currentPick || !session.teamCount) return
    const myRoster = session.picks?.filter((p) => p.rosterId === currentUserRosterId).map((p) => ({
      position: p.position,
      team: p.team ?? null,
      byeWeek: p.byeWeek ?? null,
    })) ?? []
    const availablePool = filterPlayersAvailableForDraftAi(players, draftedNames, draftedPlayerIds)
    const available = availablePool.map((p) => ({
      name: p.name,
      position: p.position,
      team: p.team ?? null,
      adp: draftUISettings?.aiAdpEnabled && p.aiAdp != null ? p.aiAdp : p.adp,
      byeWeek: p.byeWeek ?? null,
    }))
    if (available.length === 0) {
      setLiveBrainEnvelope(null)
      setRecommendationResult({
        recommendation: null,
        alternatives: [],
        reachWarning: null,
        valueWarning: null,
        scarcityInsight: null,
        stackInsight: null,
        correlationInsight: null,
        formatInsight: null,
        byeNote: null,
        explanation: '',
        evidence: [],
        caveats: ['No available players.'],
        uncertainty: 'High uncertainty: no available players in pool.',
      })
      return
    }
    setRecommendationLoading(true)
    setRecommendationError(null)
    let brainPromise: Promise<LiveDraftBrainEnvelope | null> = Promise.resolve(null)
    try {
      const aiAdpByKey =
        draftUISettings?.aiAdpEnabled && leagueAiAdp?.entries?.length
          ? expandAiAdpKeysForLookup(leagueAiAdp.entries)
          : {}
      brainPromise = (async (): Promise<LiveDraftBrainEnvelope | null> => {
        try {
          if (!session) return null
          const payload = buildLiveDraftBrainPayload({
            session,
            effectiveDraftSport,
            isDynasty,
            formatType,
            isIdpLeague: Boolean(draftPool?.isIdp),
            isSuperflexFormat,
            isTePremium: effectiveRosterSlots.some((s) => /TE\+|PREM|PREMIUM|TE\s*PREM/i.test(String(s))),
            leagueSiteDraftCount: leagueAiAdp?.totalDrafts,
            currentUserRosterId,
            players,
            draftedNames,
            effectiveRosterSlots,
            aiAdpByKey: Object.keys(aiAdpByKey).length ? aiAdpByKey : undefined,
          })
          if (!payload) return null
          const res = await fetch('/api/draft/live-brain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leagueId, ...payload }),
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.ok && data.envelope) return data.envelope as LiveDraftBrainEnvelope
        } catch {
          /* non-fatal */
        }
        return null
      })()
      const requestRecommendation = async (confirmTokenSpendForFallback: boolean) => {
        const res = await fetch('/api/draft/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            available,
            teamRoster: myRoster,
            rosterSlots: effectiveRosterSlots,
            round: currentPick.round,
            pick: currentPick.slot,
            totalTeams: session.teamCount,
            sport: effectiveDraftSport,
            isDynasty,
            isSF: isSuperflexFormat,
            mode: 'needs',
            includeAIExplanation: draftAiExplanationEnabled,
            leagueId,
            leagueName,
            confirmTokenSpend: confirmTokenSpendForFallback,
            aiAdpByKey: Object.keys(aiAdpByKey).length ? aiAdpByKey : undefined,
            ...(assistantFeedBriefForRecommend.trim()
              ? { assistantFeedBrief: assistantFeedBriefForRecommend }
              : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        return { res, data }
      }

      let { res, data } = await requestRecommendation(false)
      if (
        !res.ok &&
        data?.code === 'token_confirmation_required' &&
        typeof data?.preview?.ruleCode === 'string'
      ) {
        const confirmation = await confirmTokenSpend(data.preview.ruleCode)
        if (!confirmation.confirmed) {
          setLiveBrainEnvelope(await brainPromise)
          setRecommendationError('Token confirmation cancelled. Draft AI explanation was not unlocked.')
          return
        }
        ;({ res, data } = await requestRecommendation(true))
      }

      setLiveBrainEnvelope(await brainPromise)
      if (res.ok && data.ok) {
        let recommendation = data.recommendation ?? null
        let alternatives = Array.isArray(data.alternatives) ? data.alternatives : []
        const caveatsBase = Array.isArray(data.caveats) ? [...data.caveats] : []

        if (
          recommendation &&
          !isAiRecommendationPlayerAvailable(recommendation.player.name, recommendation.player.position)
        ) {
          caveatsBase.push('Copilot pick is no longer available on the board — opponent may have just drafted them.')
          recommendation = null
        }
        alternatives = alternatives.filter((alt: { player?: { name?: string; position?: string } }) =>
          alt?.player?.name && alt?.player?.position
            ? isAiRecommendationPlayerAvailable(alt.player.name, alt.player.position)
            : false,
        )

        setRecommendationResult({
          recommendation,
          alternatives,
          reachWarning: data.reachWarning ?? null,
          valueWarning: data.valueWarning ?? null,
          scarcityInsight: data.scarcityInsight ?? null,
          stackInsight: data.stackInsight ?? null,
          correlationInsight: data.correlationInsight ?? null,
          formatInsight: data.formatInsight ?? null,
          byeNote: data.byeNote ?? null,
          explanation: data.explanation ?? '',
          evidence: Array.isArray(data.evidence) ? data.evidence : [],
          caveats: caveatsBase,
          uncertainty: data.uncertainty ?? null,
          execution: data.execution ?? null,
        })
      } else {
        setRecommendationError(data.error || 'Failed to get recommendation')
      }
    } catch (e: any) {
      setRecommendationError(e?.message || 'Request failed')
      try {
        setLiveBrainEnvelope(await brainPromise)
      } catch {
        setLiveBrainEnvelope(null)
      }
    } finally {
      setRecommendationLoading(false)
    }
  }, [
    currentPick,
    session?.teamCount,
    session?.picks,
    session,
    draftPool,
    draftData,
    draftUISettings?.aiAdpEnabled,
    leagueAiAdp,
    effectiveDraftSport,
    effectiveRosterSlots,
    isSuperflexFormat,
    isDynasty,
    draftAiExplanationEnabled,
    currentUserRosterId,
    leagueId,
    players,
    draftedNames,
    formatType,
    draftedPlayerIds,
    assistantFeedBriefForRecommend,
    leagueName,
    resolvePlayerFromPool,
    isAiRecommendationPlayerAvailable,
  ])

  /** Off-the-clock: clear pick-specific AI so we never show another team's on-clock plan as yours. */
  useEffect(() => {
    if (!session || !currentUserRosterId || !currentPick) return
    if (currentPick.rosterId === currentUserRosterId) return
    setRecommendationResult({
      recommendation: null,
      alternatives: [],
      reachWarning: null,
      valueWarning: null,
      scarcityInsight: null,
      stackInsight: null,
      correlationInsight: null,
      formatInsight: null,
      byeNote: null,
      explanation: '',
      evidence: [],
      caveats: [],
      uncertainty: null,
      execution: null,
    })
    setRecommendationError(null)
    recommendationRequestKeyRef.current = ''
  }, [currentPick?.rosterId, currentUserRosterId, session])

  useEffect(() => {
    if (!session?.teamCount || !currentPick || players.length === 0) return
    if (!currentUserRosterId || currentPick.rosterId !== currentUserRosterId) {
      recommendationRequestKeyRef.current = ''
      return
    }
    const recommendationKey = [
      currentPick.overall ?? 0,
      currentPick.rosterId ?? '',
      session.picks?.length ?? 0,
      players.length,
      draftedPlayerIds.size,
      draftUISettings?.aiAdpEnabled ? 'ai' : 'deterministic',
      draftAiExplanationEnabled ? 'ai-explain-on' : 'ai-explain-off',
      leagueAiAdp?.computedAt ?? 'no-ai-adp',
    ].join('|')
    if (recommendationRequestKeyRef.current === recommendationKey) return
    recommendationRequestKeyRef.current = recommendationKey
    fetchRecommendation()
  }, [
    currentPick?.overall,
    currentPick?.rosterId,
    session?.picks?.length,
    session?.teamCount,
    players.length,
    draftedPlayerIds.size,
    draftUISettings?.aiAdpEnabled,
    draftAiExplanationEnabled,
    leagueAiAdp?.computedAt,
    fetchRecommendation,
    currentUserRosterId,
  ])

  /** Drop copilot picks/alts that were taken while AI was in flight or before the next refresh. */
  useEffect(() => {
    setRecommendationResult((prev) => {
      if (!prev) return prev
      let recommendation = prev.recommendation
      if (recommendation) {
        const rp = recommendation.player
        if (!isAiRecommendationPlayerAvailable(rp.name, rp.position)) {
          recommendationRequestKeyRef.current = ''
          recommendation = null
        }
      }
      const filteredAlts = (prev.alternatives ?? []).filter((a) =>
        isAiRecommendationPlayerAvailable(a.player.name, a.player.position),
      )
      const caveats =
        recommendation !== prev.recommendation && prev.recommendation
          ? [...(prev.caveats ?? []), 'Recommended player is off the board — sync refreshed.'].slice(0, 14)
          : prev.caveats ?? []
      if (
        recommendation === prev.recommendation &&
        filteredAlts.length === (prev.alternatives ?? []).length
      ) {
        return prev
      }
      return { ...prev, recommendation, alternatives: filteredAlts, caveats }
    })
  }, [isAiRecommendationPlayerAvailable])

  useEffect(() => {
    if (!leagueId) return
    let cancelled = false

    const bootstrapDraftRoom = async () => {
      if (initialSnapshot) {
        // Server pre-seeded the session snapshot — skip the blocking session GET
        // and mark access as ok so the board renders immediately on first paint.
        setDraftSessionAccess('ok')
      } else {
        setLoading(true)

        const canAccessDraftRoom = await fetchSession()
        if (cancelled) return

        // Show expired-session / forbidden states as soon as the authoritative
        // draft-session check resolves instead of waiting on slower ancillary
        // draft endpoints that may also 401/403.
        if (!canAccessDraftRoom) {
          setLoading(false)
          return
        }
      }

      // Phase 3b — perf: render the draft room as soon as the CRITICAL fetches
      // resolve. AI-bound fetches and the draft pool are fire-and-forget — panels
      // branch on `null` / poolFetching until data arrives, then re-render.
      // fetchDraftPool was moved out of this group because a cold pool build can
      // take 60–90 s (ADP importer + 30K row fetch). The player panel shows a
      // skeleton via poolFetching state while the pool loads independently.
      await Promise.allSettled([
        fetchQueue(),
        fetchDraftSettings(),
        fetchDraftChromeData(),
        fetchChat(),
      ])

      if (!cancelled) {
        setLoading(false)
      }

      // Deferred — let panels populate after the room is interactive.
      void fetchDraftAssistantContext()
      void fetchDraftPool()
    }

    void bootstrapDraftRoom()

    return () => {
      cancelled = true
    }
  }, [leagueId, initialSnapshot, fetchSession, fetchQueue, fetchDraftSettings, fetchDraftChromeData, fetchChat, fetchDraftPool, fetchDraftAssistantContext])

  useEffect(() => {
    if (!leagueId || !draftUISettings?.aiAdpEnabled) return
    fetchLeagueAiAdp()
  }, [leagueId, draftUISettings?.aiAdpEnabled, fetchLeagueAiAdp])

  useEffect(() => {
    if (!leagueId || !currentUserRosterId) return
    setDraftIntelLoading(true)
    const stream = new EventSource(
      `/api/draft/intel/stream?leagueId=${encodeURIComponent(leagueId)}`
    )

    const handleStateEvent = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as DraftIntelState
        setDraftIntel(next)
      } catch {
        // Ignore malformed SSE payloads.
      } finally {
        setDraftIntelLoading(false)
      }
    }

    stream.addEventListener('snapshot', handleStateEvent as EventListener)
    stream.addEventListener('queue_update', handleStateEvent as EventListener)
    stream.addEventListener('on_clock', handleStateEvent as EventListener)
    stream.addEventListener('recap', handleStateEvent as EventListener)
    stream.onerror = () => {
      setDraftIntelLoading(false)
      draftRoomWarn('intel-sse-disconnect', { leagueId })
      void fetchSession()
    }

    return () => {
      stream.close()
    }
  }, [leagueId, currentUserRosterId, fetchSession])

  /** Prevents double POST before React state catches up with rapid Draft clicks. */
  const pickInflightRef = useRef(false)

  useLiveDraftSync({
    leagueId,
    sessionRef,
    controlActionInflightRef,
    pollSessionFailStreakRef,
    connectionDegradedTimerRef,
    currentUserRosterId,
    showCommissionerModal,
    chatSyncActive,
    aiAdpEnabled: draftUISettings?.aiAdpEnabled,
    aiAdpComputedAt: leagueAiAdp?.computedAt ? new Date(leagueAiAdp.computedAt).getTime() : 0,
    sessionStatus: session?.status,
    timerStatus: session?.timer?.status,
    setSession,
    setQueue,
    setChatMessages,
    setChatSyncActive,
    setConnectionDegraded,
    fetchSession,
    fetchDraftSettings,
    fetchDraftAssistantContext,
    fetchDraftPool,
    fetchLeagueAiAdp,
  })

  // ── Supabase realtime: draft-room presence ────────────────────────────────
  // Presence tracking removed (Supabase removed). Online count is always 0.
  const onlineCount = 0

  useEffect(() => {
    return () => {
      if (governanceSuccessTimeoutRef.current) clearTimeout(governanceSuccessTimeoutRef.current)
      if (connectionDegradedTimerRef.current) clearTimeout(connectionDegradedTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (governanceBanner?.variant !== 'success') return
    if (governanceSuccessTimeoutRef.current) clearTimeout(governanceSuccessTimeoutRef.current)
    governanceSuccessTimeoutRef.current = setTimeout(() => {
      setGovernanceBanner(null)
      governanceSuccessTimeoutRef.current = null
    }, 7000)
    return () => {
      if (governanceSuccessTimeoutRef.current) clearTimeout(governanceSuccessTimeoutRef.current)
    }
  }, [governanceBanner])

  const { handleCommissionerAction, handleCommissionerUndoPick, handleCommissionerResetTimer } =
    useCommissionerActions({
      leagueId,
      controlActionInflightRef,
      setSession,
      setCommissionerLoading,
      setGovernanceBanner,
      fetchSession,
      fetchQueue,
      fetchChat,
      fetchDraftPool,
      fetchDraftAssistantContext,
      fetchDraftSettings,
    })

  const fetchPendingTradesCount = useCallback(async () => {
    if (!leagueId || !currentUserRosterId) return
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.proposals)) {
        const pending = data.proposals.filter((p: any) => p.status === 'pending' && p.receiverRosterId === currentUserRosterId)
        setPendingTradesCount(pending.length)
      }
    } catch {
      setPendingTradesCount(0)
    }
  }, [leagueId, currentUserRosterId])

  useEffect(() => {
    if (session?.status === 'in_progress' && currentUserRosterId) fetchPendingTradesCount()
  }, [session?.status, currentUserRosterId, fetchPendingTradesCount])

  /**
   * Slice F: pre-flight pre-draft validation. When `draftId` is set and the
   * validation route returns `canStartDraft: false`, the wizard overlay
   * opens above the same shell. Failed validation never moves the user.
   *
   * Slice A — lifecycle: start updates `session` in place via `/draft/controls`
   * (no router navigation; same `DraftBoard` mount).
   */
  const handleStartDraft = useCallback(async () => {
    try {
      setPickError(null)
      // Pre-flight validation. Never blocks the start path on transient
      // failures (network error / 5xx) — fails open to the existing
      // commissioner-action path so a flaky route can't strand the draft.
      if (draftId) {
        try {
          const validationRes = await fetch(
            `/api/leagues/${encodeURIComponent(leagueId)}/draft/${encodeURIComponent(draftId)}/validate-pre-draft`,
            { credentials: 'include' },
          )
          if (validationRes.ok) {
            const validationReport = (await validationRes.json().catch(() => null)) as {
              canStartDraft?: boolean
            } | null
            if (validationReport && validationReport.canStartDraft === false) {
              setShowPreDraftValidationWizard(true)
              return
            }
          }
        } catch {
          // Swallow — fail open to the existing start path. The wizard
          // can still be opened on demand, but a broken validation route
          // must not strand the commissioner.
        }
      }
      const result = await handleCommissionerAction('start')
      if (result.ok) {
        draftRoomPickTrace({ event: 'start-draft', leagueId, via: 'controls' })
        sendProductAnalyticsBeacon(DRAFT_ROOM.START_DRAFT, { leagueId, ok: true })
      } else if (!result.cancelled) {
        sendProductAnalyticsBeacon(DRAFT_ROOM.START_DRAFT, { leagueId, ok: false })
        if (typeof result.error === 'string') setPickError(result.error)
      }
    } catch (_) {
      sendProductAnalyticsBeacon(DRAFT_ROOM.START_DRAFT, { leagueId, ok: false, error: true })
      setPickError('Could not start the draft. Try again.')
    }
  }, [handleCommissionerAction, leagueId, draftId])

  const handleSettingsPatch = useCallback(
    async (patch: Partial<DraftUISettings>) => {
      /** Slice C.1: optimistic toggle. Without this, the commissioner control center toggles
       * stay in their old position until the PATCH (slow in dev: cold Neon, AI side-effects)
       * returns. Apply locally first, then bump the in-flight ref so a 2-second poll's
       * fetchDraftSettings can't clobber the optimistic value mid-flight. Roll back on failure. */
      let priorSettings: DraftUISettings | null = null
      controlActionInflightRef.current += 1
      setDraftUISettings((prev) => {
        priorSettings = prev
        if (!prev) return prev
        return { ...prev, ...patch } as DraftUISettings
      })
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.draftUISettings) {
          setDraftUISettings(data.draftUISettings)
        } else if (!res.ok) {
          if (priorSettings) setDraftUISettings(priorSettings)
          const msg =
            (typeof data?.error === 'string' && data.error) || `Failed to save draft setting (${res.status}).`
          setGovernanceBanner({ variant: 'error', message: msg })
        }
      } catch {
        if (priorSettings) setDraftUISettings(priorSettings)
        setGovernanceBanner({ variant: 'error', message: 'Network error — try the toggle again.' })
      } finally {
        controlActionInflightRef.current = Math.max(0, controlActionInflightRef.current - 1)
      }
    },
    [leagueId]
  )

  const handleToggleAutoPick = useCallback(() => {
    handleSettingsPatch({ autoPickEnabled: !(draftUISettings?.autoPickEnabled ?? false) })
  }, [draftUISettings?.autoPickEnabled, handleSettingsPatch])

  const handleAutopickMeUpdate = useCallback((updated: ViewerAutopickData) => {
    setSession((prev) => prev ? { ...prev, viewerAutopick: updated } : prev)
  }, [])

  const handleSaveCommissionerAiDraft = useCallback(
    async (payload: {
      assignedAiTeams: Array<{ teamId: string; aiStyle: string; tradeAggression: string; active: boolean }>
      tradeRules: Record<string, unknown>
    }) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/commissioner-ai-managers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.assignedAiTeams && data.tradeRules) {
        setCommissionerAiDraft({
          assignedAiTeams: data.assignedAiTeams,
          tradeRules: data.tradeRules,
        })
        await fetchSession()
      }
      return data
    },
    [leagueId, fetchSession]
  )

  const handleSaveDevyConfig = useCallback(
    async (input: { enabled: boolean; devyRounds: number[] }) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/devy/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: Boolean(input.enabled),
          devyRounds: Array.isArray(input.devyRounds) ? input.devyRounds : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.session) {
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        await fetchDraftPool()
      }
      return data
    },
    [leagueId, fetchDraftPool]
  )

  const handleSaveC2CConfig = useCallback(
    async (input: { enabled: boolean; collegeRounds: number[] }) => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/c2c/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: Boolean(input.enabled),
          collegeRounds: Array.isArray(input.collegeRounds) ? input.collegeRounds : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.session) {
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        await fetchDraftPool()
      }
      return data
    },
    [leagueId, fetchDraftPool]
  )

  const handleCopyInvite = useCallback(
    async (source: 'inline' | 'menu' = 'menu') => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return

      try {
        if (inviteLink) {
          await navigator.clipboard.writeText(inviteLink)
          sendProductAnalyticsBeacon(DRAFT_ROOM.INVITE_COPY, { leagueId, source })
          return
        }

        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/privacy`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        const resolved = res.ok ? resolveInviteLink(data) : null
        if (!resolved) return
        setInviteLink(resolved)
        await navigator.clipboard.writeText(resolved)
        sendProductAnalyticsBeacon(DRAFT_ROOM.INVITE_COPY, { leagueId, source })
      } catch {
        // Ignore invite copy failures in the shell.
      }
    },
    [inviteLink, leagueId],
  )

  const handleClaimSlot = useCallback(
    async (rosterId: string) => {
      setClaimSlotLoadingRosterId(rosterId)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/claim-roster`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rosterId }),
        })
        const ok = res.ok
        sendProductAnalyticsBeacon(DRAFT_ROOM.CLAIM_SLOT, { leagueId, rosterId, ok })
        if (ok) {
          await fetchSession()
          await fetchDraftChromeData()
          setClaimableRosterIds([])
        }
      } catch {
        sendProductAnalyticsBeacon(DRAFT_ROOM.CLAIM_SLOT, { leagueId, rosterId, ok: false })
      } finally {
        setClaimSlotLoadingRosterId(null)
      }
    },
    [leagueId, fetchSession, fetchDraftChromeData],
  )

  const openPickTradePanel = useCallback(() => {
    setTradeInitialDraft(null)
    setTradePanelGeneration((g) => g + 1)
    setShowTradePanel(true)
  }, [])

  const openPickTradeFromBoard = useCallback(
    (ctx: { round: number; ownerSlot: number; ownerRosterId: string; overall: number }) => {
      if (!currentUserRosterId || !session) return
      const roundsMax = Math.max(1, session.rounds)
      const r = Math.min(Math.max(1, ctx.round), roundsMax)
      const isMine = ctx.ownerRosterId === currentUserRosterId
      setTradeInitialDraft(
        isMine
          ? { giveRound: r, receiveRound: r, receiverRosterId: '' }
          : { giveRound: r, receiveRound: r, receiverRosterId: ctx.ownerRosterId },
      )
      setTradePanelGeneration((g) => g + 1)
      setShowTradePanel(true)
      sendProductAnalyticsBeacon(DRAFT_ROOM.TRADE_OPEN_FROM_BOARD, {
        leagueId,
        round: ctx.round,
        ownerSlot: ctx.ownerSlot,
        overall: ctx.overall,
        targetIsMine: isMine,
      })
    },
    [currentUserRosterId, leagueId, session],
  )

  const handleResync = useCallback(() => {
    setResyncLoading(true)
    Promise.all([
      fetchSession(),
      fetchDraftSettings(),
      fetchDraftChromeData(),
      fetchQueue(),
      fetchChat(),
      fetchDraftPool(),
      fetchDraftAssistantContext(),
      draftUISettings?.aiAdpEnabled ? fetchLeagueAiAdp() : Promise.resolve(),
      fetchPendingTradesCount(),
      fetchClaimableRosters(),
    ]).finally(() => {
      setResyncLoading(false)
      pollSessionFailStreakRef.current = 0
      if (connectionDegradedTimerRef.current != null) {
        clearTimeout(connectionDegradedTimerRef.current)
        connectionDegradedTimerRef.current = null
      }
      setConnectionDegraded(false)
    })
  }, [
    fetchSession,
    fetchDraftSettings,
    fetchDraftChromeData,
    fetchQueue,
    fetchChat,
    fetchDraftPool,
    fetchDraftAssistantContext,
    fetchLeagueAiAdp,
    draftUISettings?.aiAdpEnabled,
    fetchPendingTradesCount,
    fetchClaimableRosters,
  ])

  const handleRunAiPick = useCallback(async () => {
    setRunAiPickLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/ai-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.session) {
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        await fetchDraftPool()
        if (data.usedFallback) {
          setPickError('AI mode used deterministic CPU fallback for this pick.')
        }
      } else {
        setPickError(typeof data?.error === 'string' ? data.error : 'Automated orphan pick failed.')
      }
      await fetchDraftSettings()
    } finally {
      setRunAiPickLoading(false)
    }
  }, [leagueId, fetchDraftSettings, fetchDraftPool])

  const handleMakePick = useCallback(
    async (player: PlayerEntry) => {
      setPickError(null)
      const offlineCommissioner = draftUISettings?.executionMode === 'offline' && isCommissioner
      if (!canDraft) {
        draftRoomPickTrace({
          event: 'pick-blocked',
          reason: 'canDraft_false',
          sessionStatus: session?.status,
          draftStarted: draftCore?.draftStarted,
          currentOverall: draftCore?.currentOverall,
          currentUserRosterId,
          currentTeamId: draftCore?.currentTeamId,
          isCurrentUserOnClock,
          pickSubmitting,
        })
        setPickError('You cannot draft right now.')
        return
      }
      if (!offlineCommissioner) {
        const cp = currentPick
        if (!cp || !currentUserRosterId || cp.rosterId !== currentUserRosterId) {
          draftRoomPickTrace({
            event: 'pick-blocked',
            reason: 'not_on_clock',
            currentPickRosterId: cp?.rosterId,
            currentUserRosterId,
          })
          setPickError('You can only draft when your team is on the clock.')
          return
        }
      }
      const rawDisplayPid = player.display?.playerId?.trim()
      const rawEntryPid = player.playerId?.trim()
      const stablePlayerId =
        rawDisplayPid && !rawDisplayPid.includes(':')
          ? rawDisplayPid
          : rawEntryPid && !rawEntryPid.includes(':')
            ? rawEntryPid
            : rawDisplayPid ?? rawEntryPid ?? null
      const playerImageUrl = player.display?.assets?.headshotUrl?.trim() || null
      if (!player.name?.trim()) {
        console.warn('[draft-pick-debug] handleMakePick blocked: playerName missing', {
          playerNamePresent: false,
          playerId: stablePlayerId,
          position: player.position,
          rosterId: currentUserRosterId,
          currentOverall: draftCore?.currentOverall,
        })
        setPickError('Player name is missing — refresh the page and try again.')
        return
      }
      if (!isPickCommitAllowedByName({ canDraft: true, playerName: player.name, draftedNames })) {
        setPickError('That player is already drafted.')
        return
      }
      if (!isPickCommitAllowed({ canDraft: true, playerId: stablePlayerId, draftedPlayerIds })) {
        setPickError('That player is already drafted.')
        return
      }
      if (pickInflightRef.current) return
      pickInflightRef.current = true
      setPickSubmitting(true)
      const _pickPerfStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
      try {
        draftRoomPickTrace({
          event: 'pick-submit',
          playerNamePresent: Boolean(player.name?.trim()),
          playerIdPresent: Boolean(stablePlayerId),
          position: player.position,
          rosterId: currentUserRosterId,
          currentOverall: draftCore?.currentOverall,
          leagueId,
        })
        const note = player.display?.metadata?.eligibilityNote?.toLowerCase() ?? ''
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/pick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rosterId: currentUserRosterId ?? undefined,
            playerName: player.name,
            position: player.position,
            team: player.team ?? null,
            byeWeek: player.byeWeek ?? null,
            playerId: stablePlayerId,
            playerImageUrl,
            pickMetadata: {
              isRookie: note.includes('rookie') ? true : undefined,
            },
            source:
              draftUISettings?.executionMode === 'offline' && isCommissioner
                ? 'commissioner'
                : player.graduatedToNFL
                  ? 'promoted_devy'
                  : player.poolType === 'college'
                    ? 'college'
                    : player.isDevy
                      ? 'devy'
                      : 'user',
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.session) {
          sendProductAnalyticsBeacon(DRAFT_ROOM.PICK, {
            leagueId,
            position: player.position,
            ok: true,
          })
          setPickSuccessFlash(player.name)
          setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
          setQueue((prev) =>
            prev.filter(
              (e) => normalizeDraftedPlayerName(e.playerName) !== normalizeDraftedPlayerName(player.name),
            ),
          )
          // draftedNames derives from session.picks — player is already marked drafted above.
          // Pool + queue revalidations are background-only; they must not block setPickSubmitting(false).
          void fetchQueue()
          void fetchDraftPool()
          void fetchDraftAssistantContext()
          if (process.env.NODE_ENV !== 'production') {
            console.info('[draft-perf] pick round-trip', {
              playerName: player.name,
              ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - _pickPerfStart),
            })
          }
          pollSessionFailStreakRef.current = 0
          if (connectionDegradedTimerRef.current != null) {
            clearTimeout(connectionDegradedTimerRef.current)
            connectionDegradedTimerRef.current = null
          }
          setConnectionDegraded(false)
        } else if (res.ok) {
          sendProductAnalyticsBeacon(DRAFT_ROOM.PICK, { leagueId, position: player.position, ok: false })
          draftRoomWarn('pick-missing-session', { status: res.status })
          await fetchSession()
          void fetchQueue()
          void fetchDraftPool()
          setPickError('Pick response was incomplete — draft state was refreshed.')
        } else {
          sendProductAnalyticsBeacon(DRAFT_ROOM.PICK, { leagueId, position: player.position, ok: false })
          const errText = typeof data?.error === 'string' ? data.error : null
          const codeText = typeof (data as { code?: unknown }).code === 'string' ? String((data as { code: string }).code) : null
          const detail =
            errText && codeText ? `${errText} (${codeText})` : errText ?? codeText ?? 'Pick failed. Try again.'
          draftRoomPickTrace({ event: 'pick-error', status: res.status, error: errText, code: codeText })
          setPickError(detail)
        }
      } catch (err) {
        draftRoomWarn('pick-network', err)
        setPickError('Network error while submitting your pick. Check your connection and try again.')
        await fetchSession()
      } finally {
        pickInflightRef.current = false
        setPickSubmitting(false)
      }
    },
    [
      leagueId,
      canDraft,
      draftedNames,
      draftedPlayerIds,
      draftUISettings?.executionMode,
      isCommissioner,
      currentPick,
      session?.status,
      draftCore?.draftStarted,
      draftCore?.currentOverall,
      draftCore?.currentTeamId,
      currentUserRosterId,
      isCurrentUserOnClock,
      pickSubmitting,
      fetchQueue,
      fetchDraftPool,
      fetchSession,
      fetchDraftAssistantContext,
    ],
  )

  const handlePoolPreviewSelect = useCallback(
    (rawId: string) => {
      const player = players.find(
        (p) =>
          (p.display?.playerId && p.display.playerId === rawId) ||
          (p.id && p.id === rawId) ||
          p.name === rawId
      )
      if (player) void handleMakePick(player)
    },
    [players, handleMakePick],
  )

  const handleDraftIntelPick = useCallback(() => {
    const top = draftIntel?.queue.find(
      (entry) => !draftedNames.has(normalizeDraftedPlayerName(entry.playerName)),
    )
    if (!top) return
    const player = players.find(
      (candidate) =>
        candidate.name === top.playerName &&
        candidate.position === top.position &&
        (candidate.team ?? null) === (top.team ?? null)
    )
    if (player) {
      void handleMakePick(player)
    }
  }, [draftIntel?.queue, draftedNames, players, handleMakePick])

  const handleAuctionNominate = useCallback(
    async (player: PlayerEntry) => {
      setPickError(null)
      setAuctionNominateLoading(true)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/auction/nominate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerName: player.name,
            position: player.position,
            team: player.team ?? null,
            playerId: player.display?.playerId ?? null,
            byeWeek: player.byeWeek ?? null,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.session) {
          sendProductAnalyticsBeacon(DRAFT_ROOM.NOMINATE, { leagueId, ok: true })
          setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        } else {
          sendProductAnalyticsBeacon(DRAFT_ROOM.NOMINATE, { leagueId, ok: false })
          setPickError(typeof data?.error === 'string' ? data.error : 'Nominate failed.')
        }
      } finally {
        setAuctionNominateLoading(false)
      }
    },
    [leagueId],
  )

  const handleAuctionBid = useCallback(
    async (amount: number) => {
      setPickError(null)
      setAuctionBidLoading(true)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/auction/bid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.session)
          setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        else setPickError(typeof data?.error === 'string' ? data.error : 'Bid failed.')
      } finally {
        setAuctionBidLoading(false)
      }
    },
    [leagueId],
  )

  const handleAuctionResolve = useCallback(async () => {
    setPickError(null)
    setAuctionResolveLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/auction/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.session)
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
      else setPickError(typeof data?.error === 'string' ? data.error : 'Resolve failed.')
    } finally {
      setAuctionResolveLoading(false)
    }
  }, [leagueId])

  const handleAutopickExpired = useCallback(async () => {
    setPickError(null)
    setAutopickExpiredLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/autopick-expired`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.session) {
        setSession((prev) => mergeDraftSessionSnapshot(prev, data.session as DraftSessionSnapshot))
        const name = data.submittedPlayerName ?? data.pick?.playerName
        if (name)
          setQueue((prev) =>
            prev.filter(
              (e) => normalizeDraftedPlayerName(e.playerName) !== normalizeDraftedPlayerName(String(name)),
            ),
          )
        await fetchQueue()
        await fetchDraftPool()
      } else {
        setPickError(typeof data?.error === 'string' ? data.error : 'Use queue failed.')
      }
    } catch (err) {
      draftRoomWarn('autopick-expired', err)
      setPickError('Network error while using your queue. Try again.')
      await fetchSession()
      await fetchQueue()
    } finally {
      setAutopickExpiredLoading(false)
    }
  }, [leagueId, fetchQueue, fetchDraftPool, fetchSession])

  const handleQueueSave = useCallback(
    async (newOrder: QueueEntry[]) => {
      const limitedQueue = trimDraftQueue(newOrder, draftQueueSizeLimit)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/queue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue: limitedQueue }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && Array.isArray(data.queue)) {
          setQueue(data.queue)
          return
        }
        draftRoomWarn('queue-save', { status: res.status, body: data })
      } catch (err) {
        draftRoomWarn('queue-save-network', err)
      }
      await fetchQueue()
    },
    [leagueId, draftQueueSizeLimit, fetchQueue],
  )

  const handleRemoveFromQueue = useCallback(
    (index: number) => {
      const drafted = new Set(session?.picks?.map((p) => normalizeDraftedPlayerName(p.playerName)) ?? [])
      const filtered = queue.filter((e) => !drafted.has(normalizeDraftedPlayerName(e.playerName)))
      const entry = filtered[index]
      if (!entry) return
      const idxInQueue = queue.findIndex((e) => e.playerName === entry.playerName && e.position === entry.position)
      if (idxInQueue < 0) return
      const next = queue.filter((_, i) => i !== idxInQueue)
      setQueue(next)
      handleQueueSave(next)
    },
    [queue, session?.picks, handleQueueSave],
  )

  const handleReorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const drafted = new Set(session?.picks?.map((p) => normalizeDraftedPlayerName(p.playerName)) ?? [])
      const filtered = queue.filter((e) => !drafted.has(normalizeDraftedPlayerName(e.playerName)))
      if (fromIndex < 0 || fromIndex >= filtered.length) return
      // Reorder within the visible (non-drafted) sub-list
      const reordered = [...filtered]
      const [item] = reordered.splice(fromIndex, 1)
      if (item === undefined) return
      reordered.splice(toIndex, 0, item)
      // Rebuild full queue: keep drafted entries in-place, replace non-drafted with reordered order
      let reorderedIdx = 0
      const next = queue
        .map((e) => {
          if (drafted.has(normalizeDraftedPlayerName(e.playerName))) return e
          if (reorderedIdx >= reordered.length) return undefined
          return reordered[reorderedIdx++]
        })
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
      setQueue(next)
      handleQueueSave(next)
    },
    [queue, session?.picks, handleQueueSave],
  )

  const handleAiReorderQueue = useCallback(async () => {
    const requestAiExplanation = Boolean(draftUISettings?.aiQueueReorderEnabled && aiQueueReorderEnabled)
    const drafted = new Set(session?.picks?.map((p) => normalizeDraftedPlayerName(p.playerName)) ?? [])
    const filtered = queue.filter((e) => !drafted.has(normalizeDraftedPlayerName(e.playerName)))
    if (filtered.length < 2) return
    setAiReorderLoading(true)
    setAiReorderExplanation(null)
    setAiReorderExecutionMode(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/queue/ai-reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue: filtered, aiExplanation: requestAiExplanation }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.reordered)) {
        setQueue(data.reordered)
        await handleQueueSave(data.reordered)
        setAiReorderExplanation(data.explanation ?? null)
        setAiReorderExecutionMode(typeof data?.execution?.mode === 'string' ? data.execution.mode : 'rules_engine')
      } else {
        setAiReorderExplanation(typeof data?.error === 'string' ? data.error : 'AI reorder unavailable.')
        setAiReorderExecutionMode(null)
      }
    } finally {
      setAiReorderLoading(false)
    }
  }, [
    leagueId,
    queue,
    session?.picks,
    handleQueueSave,
    draftUISettings?.aiQueueReorderEnabled,
    aiQueueReorderEnabled,
  ])

  const handleAddToQueue = useCallback(
    (player: PlayerEntry) => {
      if (
        !canAddToQueue(
          queue.map((entry) => ({ name: entry.playerName, position: entry.position, team: entry.team ?? null })),
          { name: player.name, position: player.position, team: player.team ?? null }
        )
      ) {
        return
      }
      const entry: QueueEntry = {
        playerName: player.name,
        position: player.position,
        team: player.team ?? null,
      }
      const next = trimDraftQueue([...queue, entry], draftQueueSizeLimit)
      sendProductAnalyticsBeacon(DRAFT_ROOM.QUEUE_ADD, {
        leagueId,
        position: player.position,
      })
      setQueue(next)
      handleQueueSave(next)
    },
    [queue, handleQueueSave, draftQueueSizeLimit, leagueId],
  )

  const handleDraftFromQueue = useCallback(
    (entry: QueueEntry) => {
      handleMakePick({ name: entry.playerName, position: entry.position, team: entry.team ?? null })
    },
    [handleMakePick],
  )

  const queueFiltered = useMemo(
    () => queue.filter((e) => !draftedNames.has(normalizeDraftedPlayerName(e.playerName))),
    [queue, draftedNames],
  )
  const draftIntelQueue = useMemo(
    () =>
      (draftIntel?.queue ?? []).map((entry) => ({
        ...entry,
        isTaken: draftedNames.has(normalizeDraftedPlayerName(entry.playerName)),
      })),
    [draftIntel?.queue, draftedNames]
  )
  const slotOrder = session?.slotOrder ?? []
  const aiManagedRosterIds = useMemo(() => {
    const fromComm = commissionerAiDraft?.assignedAiTeams?.filter((t) => t.active).map((t) => t.teamId) ?? []
    return [...new Set([...fromComm, ...aiOpponentRosterIds])]
  }, [commissionerAiDraft?.assignedAiTeams, aiOpponentRosterIds])
  const draftTeamPanelProps = useMemo(() => {
    const devyRoundsSet = new Set<number>(
      ((session as DraftSessionSnapshot | null)?.c2c?.enabled
        ? []
        : (session as DraftSessionSnapshot | null)?.devy?.devyRounds) ?? [],
    )
    const c2cCollegeRoundsSet = new Set<number>(
      (session as DraftSessionSnapshot | null)?.c2c?.collegeRounds ?? [],
    )
    const showRosterStrip =
      isDynasty ||
      devyRoundsSet.size > 0 ||
      c2cCollegeRoundsSet.size > 0 ||
      presentationVariant === 'redraft_snake'
    return {
      leagueName,
      sport: effectiveDraftSport,
      slotOrder,
      currentUserRosterId: currentUserRosterId ?? null,
      draftedPicks: (session?.picks ?? []).map((p) => ({
        playerName: p.playerName,
        position: p.position,
        overall: p.overall,
        rosterId: p.rosterId,
        // Commit S — flow byeWeek through so the war room can detect
        // bye-week clusters in the focus team's drafted starters.
        byeWeek: (p as { byeWeek?: number | null }).byeWeek ?? null,
        isDevy: devyRoundsSet.has(p.round) || c2cCollegeRoundsSet.has(p.round),
      })),
      teamCount: session?.teamCount ?? 0,
      rounds: session?.rounds ?? 0,
      leaguePicksMade: session?.picks?.length ?? 0,
      commissionerAiTeams: commissionerAiDraft?.assignedAiTeams,
      showRosterStrip,
      isDynasty,
      // Real sport-aware slot config from /api/leagues/{id}/roster-config.
      // Falls back to the DraftRosterStrip's NFL defaults when the fetch
      // hasn't completed or failed.
      starterSlots: rosterConfig?.starterSlots ?? null,
      benchSlots: rosterConfig?.benchSlots ?? null,
      taxiSlots: rosterConfig?.taxiSlots ?? null,
      devySlots: rosterConfig?.devySlots ?? null,
    }
  }, [
    leagueName,
    effectiveDraftSport,
    slotOrder,
    currentUserRosterId,
    session,
    commissionerAiDraft?.assignedAiTeams,
    isDynasty,
    rosterConfig,
    presentationVariant,
  ])
  const aiAdpUnavailable = Boolean(draftUISettings?.aiAdpEnabled && !poolLoading && (!leagueAiAdp?.entries?.length && leagueAiAdp?.message))
  const aiAdpStaleWarning = Boolean(draftUISettings?.aiAdpEnabled && leagueAiAdp?.stale)
  const aiAdpLowSampleWarning = Boolean(leagueAiAdp?.entries?.some((e) => e.lowSample))

  /**
   * D.6 — Results / Roster panel data. Read-only view of every team's roster;
   * defaults to the current user's team. Reuses session.slotOrder for team list
   * + session.picks for drafted players.
   */
  const resultsRosterTeams = useMemo<ResultsRosterPanelTeam[]>(() => {
    const order = session?.slotOrder ?? []
    return order.map((s) => ({
      rosterId: s.rosterId,
      displayName: s.displayName?.trim() ? s.displayName : `Slot ${s.slot}`,
      isCurrentUser: s.rosterId === (currentUserRosterId ?? null),
      isAi: aiManagedRosterIds.includes(s.rosterId),
    }))
  }, [session?.slotOrder, currentUserRosterId, aiManagedRosterIds])

  const resultsRosterPicks = useMemo<ResultsRosterPanelPick[]>(() => {
    return (session?.picks ?? []).map((p) => ({
      rosterId: p.rosterId,
      playerName: p.playerName,
      position: p.position,
      team: p.team ?? null,
      overall: p.overall,
    }))
  }, [session?.picks])

  /**
   * D.6 — War Room popup notification badge. Lights up when a fresh AI
   * recommendation is available and the user hasn't opened the popup yet.
   */
  const warRoomHasNewIntel = Boolean(recommendationResult?.recommendation)

  const viewerDraftedPicks = useMemo(
    () => (session?.picks ?? []).filter((p) => p.rosterId === currentUserRosterId),
    [session?.picks, currentUserRosterId],
  )

  const redraftRibbonOnDeck = useMemo(() => {
    if (!session) return []
    if (session.status === 'pre_draft') {
      const order = session.slotOrder ?? []
      return order.slice(0, 4).map((s) => ({
        slot: s.slot,
        displayName: s.displayName?.trim() ? s.displayName : `Team ${s.slot}`,
      }))
    }
    if (!currentPick || (session.status !== 'in_progress' && session.status !== 'paused')) return []
    const total = session.rounds * session.teamCount
    const next = currentPick.overall + 1
    if (next > total) return []
    return getUpcomingPickOwners(
      next,
      4,
      session.teamCount,
      session.draftType,
      session.thirdRoundReversal,
      session.slotOrder,
      total,
    )
  }, [session, currentPick])

  const redraftBackToBackSoon = useMemo(
    () =>
      session ? detectSnakeBackToBackSoon(session as DraftSessionSnapshot, currentUserRosterId ?? null) : false,
    [session, currentUserRosterId],
  )

  const redraftStarterHints = useMemo(
    () =>
      presentationVariant === 'redraft_snake' && !isDynasty
        ? computeRedraftStarterHints(
            effectiveDraftSport,
            viewerDraftedPicks.map((p) => ({ position: p.position })),
            formatType,
          )
        : undefined,
    [presentationVariant, isDynasty, effectiveDraftSport, viewerDraftedPicks, formatType],
  )

  useEffect(() => {
    if (!pickSuccessFlash) return
    const id = window.setTimeout(() => setPickSuccessFlash(null), 4200)
    return () => window.clearTimeout(id)
  }, [pickSuccessFlash])

  const orphanRosterIds = (session as any)?.orphanRosterIds as string[] | undefined
  const aiManagerEnabled = (session as any)?.aiManagerEnabled as boolean | undefined
  const isOrphanOnClock = Boolean(
    currentPick?.rosterId && Array.isArray(orphanRosterIds) && orphanRosterIds.includes(currentPick.rosterId) && aiManagerEnabled
  )
  const autoPickEnabled = draftUISettings?.autoPickEnabled ?? false
  const chimmyHeadlineSummary = (draftAssistantContext?.headlines ?? [])
    .slice(0, 2)
    .map((item) => item.playerName ? `${item.playerName}: ${item.title}` : item.title)
  const chimmyInjurySummary = (draftAssistantContext?.injuries ?? [])
    .slice(0, 2)
    .map((item) => `${item.playerName}${item.team ? ` (${item.team})` : ''} ${item.status ?? 'watch'}`.trim())
  const chimmyDraftPrompt = [
    buildDraftSummaryForAI({
      sport: effectiveDraftSport,
      round: currentPick?.round,
      pick: currentPick?.slot,
      queueLength: queueFiltered.length,
      queueTopPlayers: queueFiltered.slice(0, 3).map((entry) => entry.playerName),
      currentOnClockManager: currentPick?.displayName,
      rosterPositions: effectiveRosterSlots,
      leagueName,
    }),
    session?.draftType ? `Draft type: ${session.draftType}.` : '',
    presentationVariant === 'redraft_snake' && !isDynasty
      ? 'Scope: live redraft for this season only — prioritize best available, roster holes, and positional scarcity for this draft room (not dynasty stash, devy, or multi-year planning unless the current round explicitly requires it).'
      : '',
    chimmyHeadlineSummary.length ? `Recent news: ${chimmyHeadlineSummary.join(' | ')}.` : '',
    chimmyInjurySummary.length ? `Recent injuries: ${chimmyInjurySummary.join(' | ')}.` : '',
  ].filter(Boolean).join(' ')
  const chimmyToolSummary = [
    session?.draftType ? `${session.draftType} draft` : 'live draft',
    draftAssistantContext?.sportsFeed?.available
      ? `${draftAssistantContext.headlines.length} headlines`
      : 'sports feed standing by',
    draftAssistantContext?.injuries?.length
      ? `${draftAssistantContext.injuries.length} injury notes`
      : null,
    draftUISettings?.aiAdpEnabled ? 'AI ADP ready' : null,
    draftUISettings?.aiQueueReorderEnabled ? 'queue AI ready' : null,
  ].filter(Boolean).join(' • ')
  const chatMessagesWithAi = useMemo(() => {
    const base = [...chatMessages]
    const injected: typeof base = []
    const aiCopilotWire = {
      messageCategory: 'AI_MESSAGE' as const,
      sourceContext: 'draft_room' as const,
      syncToLeagueChat: false as const,
    }
    const rs = presentationVariant === 'redraft_snake'

    const onClockId = `ai-copilot-onclock-${currentPick?.overall ?? 'na'}-${recommendationResult?.recommendation?.player.name ?? 'na'}`
    if (isCurrentUserOnClock && recommendationResult?.recommendation) {
      const rec = recommendationResult.recommendation
      const extra =
        recommendationResult.scarcityInsight?.trim()
          ? ` ${recommendationResult.scarcityInsight.trim()}`
          : ''
      if (!base.some((m) => m.id === onClockId)) {
        const poolRow = players.find(
          (p) =>
            p.name.trim().toLowerCase() === rec.player.name.trim().toLowerCase() &&
            p.position.trim().toLowerCase() === rec.player.position.trim().toLowerCase(),
        )
        const feedSnap = getAssistantFeedForPlayer(assistantFeedByName, rec.player.name)
        const playerContext = poolRow
          ? buildDraftChatPlayerContextFromDisplay(poolRow, {
              headlineSnippet: feedSnap?.headlineTitle ?? null,
            })
          : undefined
        injected.push({
          ...aiCopilotWire,
          id: onClockId,
          from: 'Draft copilot',
          text: `On the clock: ${rec.player.name} (${rec.player.position}${rec.player.team ? `, ${rec.player.team}` : ''}). ${rec.reason}.${extra}`,
          at: new Date().toISOString(),
          isAiSuggestion: true,
          messageType: 'copilot_on_clock',
          ...(playerContext ? { playerContext } : {}),
        })
      }
    }

    const prepId = `ai-copilot-prep-${currentPick?.overall ?? 'x'}-${ribbonPicksUntilUser ?? 'n'}-${warRoomData?.bestPick?.name ?? 'na'}`
    if (
      rs &&
      !isCurrentUserOnClock &&
      warRoomData?.bestPick &&
      ribbonPicksUntilUser != null &&
      ribbonPicksUntilUser > 0 &&
      ribbonPicksUntilUser <= 4
    ) {
      const w = warRoomData.bestPick
      const tip =
        warRoomData.strategyTip?.trim() ||
        warRoomData.reasoning?.[0]?.trim() ||
        'Open the helper panel for full War Room context.'
      if (!base.some((m) => m.id === prepId) && !injected.some((m) => m.id === prepId)) {
        const poolRow = players.find(
          (p) =>
            p.name.trim().toLowerCase() === w.name.trim().toLowerCase() &&
            p.position.trim().toLowerCase() === w.position.trim().toLowerCase(),
        )
        const feedSnap = getAssistantFeedForPlayer(assistantFeedByName, w.name)
        const playerContext = poolRow
          ? buildDraftChatPlayerContextFromDisplay(poolRow, {
              headlineSnippet: feedSnap?.headlineTitle ?? null,
            })
          : undefined
        injected.push({
          ...aiCopilotWire,
          id: prepId,
          from: 'Draft copilot',
          text: `Your pick approaches in ~${ribbonPicksUntilUser} selection(s). Prep idea: ${w.name} (${w.position}) — ${tip}`,
          at: new Date().toISOString(),
          isAiSuggestion: true,
          messageType: 'copilot_prepare',
          ...(playerContext ? { playerContext } : {}),
        })
      }
    }

    if (rs && queueFiltered.length > 0) {
      const top = queueFiltered[0]
      if (draftedNames.has(normalizeDraftedPlayerName(top.playerName))) {
        const qid = `ai-copilot-queue-taken-${currentPick?.overall ?? 'o'}-${normalizeDraftedPlayerName(top.playerName)}`
        if (!base.some((m) => m.id === qid) && !injected.some((m) => m.id === qid)) {
          const poolRow =
            players.find(
              (p) => normalizeDraftedPlayerName(p.name) === normalizeDraftedPlayerName(top.playerName),
            ) ?? null
          const feedSnap = poolRow ? getAssistantFeedForPlayer(assistantFeedByName, poolRow.name) : null
          const playerContext = poolRow
            ? buildDraftChatPlayerContextFromDisplay(poolRow, {
                headlineSnippet: feedSnap?.headlineTitle ?? null,
              })
            : undefined
          injected.push({
            ...aiCopilotWire,
            id: qid,
            from: 'Draft copilot',
            text: `Queue alert: ${top.playerName} is already off the board. Reorder your queue or refresh the helper.`,
            at: new Date().toISOString(),
            isAiSuggestion: true,
            messageType: 'queue_conflict',
            ...(playerContext ? { playerContext } : {}),
          })
        }
      }
    }

    if (injected.length === 0) return base
    return [...base, ...injected]
  }, [
    chatMessages,
    isCurrentUserOnClock,
    recommendationResult,
    currentPick?.overall,
    presentationVariant,
    warRoomData,
    ribbonPicksUntilUser,
    queueFiltered,
    draftedNames,
    assistantFeedByName,
    players,
  ])
  const currentRoster: Array<{ playerName: string; position: string; team: string | null }> = []
  const nextQueuedAvailable = queueFiltered.length > 0 && canDraft ? queueFiltered[0] : null

  const aiRowBadges = useMemo(() => {
    if (!warRoomData?.bestPick) return undefined
    const out: Record<string, 'ai_pick' | 'value' | 'risky'> = {}
    const key = (n: string, pos: string) => `${n.trim().toLowerCase()}|${pos.trim().toLowerCase()}`
    out[key(warRoomData.bestPick.name, warRoomData.bestPick.position)] =
      warRoomData.risk === 'high' ? 'risky' : 'ai_pick'
    for (const alt of warRoomData.alternatives ?? []) {
      const k = key(alt.name, alt.position)
      if (!out[k]) out[k] = 'value'
    }
    return out
  }, [warRoomData])

  const aiOverlaySignals = useMemo(() => {
    const out: Record<string, DraftAiOverlaySignal> = {}
    const keyOf = (n: string, pos: string) => `${n.trim().toLowerCase()}|${pos.trim().toLowerCase()}`
    const resolveValueDelta = (name: string, position: string): number | null => {
      const match = players.find(
        (p) =>
          p.name.trim().toLowerCase() === name.trim().toLowerCase() &&
          p.position.trim().toLowerCase() === position.trim().toLowerCase(),
      )
      if (!match) return null
      if (
        match.adp == null ||
        match.aiAdp == null ||
        !Number.isFinite(Number(match.adp)) ||
        !Number.isFinite(Number(match.aiAdp))
      ) {
        return null
      }
      return Number((Number(match.adp) - Number(match.aiAdp)).toFixed(1))
    }
    const upsert = (name: string, position: string, patch: Partial<DraftAiOverlaySignal>) => {
      const key = keyOf(name, position)
      const base: DraftAiOverlaySignal = out[key] ?? { badge: 'value' }
      out[key] = { ...base, ...patch }
    }

    if (warRoomData?.bestPick) {
      upsert(warRoomData.bestPick.name, warRoomData.bestPick.position, {
        badge: warRoomData.risk === 'high' ? 'risky' : 'ai_pick',
        confidencePct: Math.max(0, Math.min(100, Math.round((warRoomData.confidence || 0) * 100))),
        valueDelta: resolveValueDelta(warRoomData.bestPick.name, warRoomData.bestPick.position),
        strategyNote: warRoomData.strategyTip || null,
        reason: warRoomData.reasoning?.[0] ?? null,
        boomBust: warRoomData.risk === 'high' ? 'boom' : null,
      })
      for (const alt of warRoomData.alternatives ?? []) {
        upsert(alt.name, alt.position, { badge: 'value' })
      }
    }

    const rr = recommendationResult
    if (rr?.recommendation) {
      const rec = rr.recommendation
      upsert(rec.player.name, rec.player.position, {
        badge: 'ai_pick',
        confidencePct: Math.max(0, Math.min(100, Math.round((rec.confidence || 0) * 100))),
        valueDelta: resolveValueDelta(rec.player.name, rec.player.position),
        reason: rec.reason,
      })
      if (rr.scarcityInsight?.trim()) {
        upsert(rec.player.name, rec.player.position, {
          scarcityLevel: /urgent|run|thin|drying|scarce|drop/i.test(rr.scarcityInsight) ? 'high' : 'medium',
          strategyNote: rr.scarcityInsight.trim(),
        })
      }
      if (rr.reachWarning?.trim()) {
        upsert(rec.player.name, rec.player.position, {
          tierDropAlert: /tier|drop|window|run/i.test(rr.reachWarning),
          safetyLevel: 'upside',
          boomBust: 'bust',
        })
      }
      if (rr.valueWarning?.trim()) {
        upsert(rec.player.name, rec.player.position, {
          tierDropAlert: /tier|drop|window|run/i.test(rr.valueWarning) ? true : undefined,
          safetyLevel: 'safe',
          strategyNote: rr.valueWarning.trim(),
        })
      }
      if (rr.stackInsight?.trim()) {
        upsert(rec.player.name, rec.player.position, {
          stackAvailable: true,
          strategyNote: rr.stackInsight.trim(),
        })
      }
      if (rr.byeNote?.trim()) {
        upsert(rec.player.name, rec.player.position, {
          byeWeekConflict: /conflict|collision|same bye|bye/i.test(rr.byeNote),
          strategyNote: rr.byeNote.trim(),
        })
      }
    }

    for (const alt of recommendationResult?.alternatives ?? []) {
      if (!alt?.player?.name || !alt?.player?.position) continue
      upsert(alt.player.name, alt.player.position, {
        badge: out[keyOf(alt.player.name, alt.player.position)]?.badge ?? 'value',
        confidencePct: Math.max(0, Math.min(100, Math.round((alt.confidence || 0) * 100))),
        valueDelta: resolveValueDelta(alt.player.name, alt.player.position),
        safetyLevel: /safe|floor|stable/i.test(alt.reason)
          ? 'safe'
          : /upside|ceiling|swing|boom/i.test(alt.reason)
            ? 'upside'
            : null,
        reason: alt.reason,
      })
    }

    return Object.keys(out).length > 0 ? out : undefined
  }, [players, recommendationResult, warRoomData])

  const recommendationOverlaySummary = useMemo(() => {
    const rec = recommendationResult?.recommendation
    if (!rec || !aiOverlaySignals) return null
    const key = `${rec.player.name.trim().toLowerCase()}|${rec.player.position.trim().toLowerCase()}`
    const signal = aiOverlaySignals[key]
    if (!signal) return null
    return {
      label: signal.badge === 'ai_pick' ? 'Best pick' : signal.badge === 'risky' ? 'Upside' : 'Value',
      playerName: rec.player.name,
      position: rec.player.position,
      team: rec.player.team ?? null,
      confidencePct: signal.confidencePct ?? null,
      valueDelta: signal.valueDelta ?? null,
      stackAvailable: signal.stackAvailable ?? false,
      byeWeekConflict: signal.byeWeekConflict ?? false,
      safetyLevel: signal.safetyLevel ?? null,
      note: signal.reason ?? signal.strategyNote ?? null,
    }
  }, [aiOverlaySignals, recommendationResult?.recommendation])

  const recommendedPlayerResolved = useMemo(() => {
    const r = recommendationResult?.recommendation
    if (!r) return null
    if (!isAiRecommendationPlayerAvailable(r.player.name, r.player.position)) return null
    return resolvePlayerFromPool(r.player.name, r.player.position)
  }, [recommendationResult?.recommendation, resolvePlayerFromPool, isAiRecommendationPlayerAvailable])

  const handleAddIntelQueueSuggestion = useCallback(
    (entry: DraftIntelQueueEntry) => {
      if (entry.isTaken) return
      const pid = entry.playerId?.trim()
      let pool: PlayerEntry | null = null
      if (pid) {
        pool =
          players.find((p) => String(p.display?.playerId ?? p.id ?? '').trim() === pid) ?? null
      }
      pool =
        pool ??
        players.find(
          (p) =>
            normalizeDraftedPlayerName(p.name) === normalizeDraftedPlayerName(entry.playerName) &&
            p.position.trim().toLowerCase() === entry.position.trim().toLowerCase(),
        ) ??
        null
      if (!pool || draftedNames.has(normalizeDraftedPlayerName(pool.name))) return
      handleAddToQueue(pool)
    },
    [players, draftedNames, handleAddToQueue],
  )

  const getDraftCopilotInsight = useCallback(
    (p: PlayerEntry): DraftCopilotInsight | null => {
      if (presentationVariant !== 'redraft_snake' || isDynasty) return null

      const keyOf = (name: string, pos: string) =>
        `${name.trim().toLowerCase()}|${pos.trim().toLowerCase()}`
      const pk = keyOf(p.name, p.position)
      const bullets: string[] = []

      const rec = recommendationResult?.recommendation
      const isTopRec = Boolean(rec && keyOf(rec.player.name, rec.player.position) === pk)

      if (isTopRec && rec) {
        bullets.push(rec.reason)
        const rr = recommendationResult
        if (rr?.scarcityInsight?.trim()) bullets.push(rr.scarcityInsight.trim())
        if (rr?.reachWarning?.trim()) bullets.push(`Reach note: ${rr.reachWarning.trim()}`)
        if (rr?.valueWarning?.trim()) bullets.push(`Value note: ${rr.valueWarning.trim()}`)
      }

      const altMatch = recommendationResult?.alternatives?.find(
        (a) => keyOf(a.player.name, a.player.position) === pk,
      )
      if (altMatch) bullets.push(altMatch.reason)

      const wr = warRoomData
      if (wr?.bestPick && keyOf(wr.bestPick.name, wr.bestPick.position) === pk) {
        bullets.push(...(wr.reasoning ?? []).slice(0, 2))
        if (wr.teamNeedSummary?.trim()) bullets.push(wr.teamNeedSummary.trim())
        if (wr.riskNote?.trim()) bullets.push(`Risk: ${wr.riskNote.trim()}`)
      }

      const filtered = bullets.filter(Boolean).slice(0, 8)
      if (filtered.length === 0) return null

      let stance: DraftCopilotInsight['stance'] | undefined
      if (wr?.bestPick && keyOf(wr.bestPick.name, wr.bestPick.position) === pk) {
        const risk = wr.risk
        if (risk === 'high') stance = 'upside'
        else if (risk === 'low') stance = 'safer'
        else stance = 'balanced'
      }

      let headline = 'Draft context'
      if (isTopRec) headline = 'Copilot recommendation'
      else if (altMatch) headline = 'Copilot alternative'
      else if (wr?.bestPick && keyOf(wr.bestPick.name, wr.bestPick.position) === pk) headline = 'War Room focus'

      return { headline, bullets: filtered, stance }
    },
    [presentationVariant, isDynasty, recommendationResult, warRoomData],
  )

  const fetchWarRoom = useCallback(
    async (force?: boolean) => {
      if (!session || !currentPick || !session.teamCount || players.length === 0) return
      if (session.status !== 'in_progress') return
      if (session.draftType === 'auction' && !isMyTurnToNominateDraft) return

      const cacheKey = `${currentPick.overall}|${session.picks?.length ?? 0}|${draftedPlayerIds.size}|${currentUserRosterId ?? ''}`
      if (force) warRoomCacheRef.current.delete(cacheKey)
      if (!force && warRoomCacheRef.current.has(cacheKey)) {
        setWarRoomData(warRoomCacheRef.current.get(cacheKey)!)
        setWarRoomLoading(false)
        return
      }

      setWarRoomLoading(true)
      setWarRoomError(null)
      try {
        const myRoster =
          session.picks?.filter((p) => p.rosterId === currentUserRosterId).map((p) => ({
            position: p.position,
            team: p.team ?? null,
            byeWeek: p.byeWeek ?? null,
          })) ?? []
        const availablePool = filterPlayersAvailableForDraftAi(players, draftedNames, draftedPlayerIds)
        const available = availablePool.map((p) => ({
            name: p.name,
            position: p.position,
            team: p.team ?? null,
            adp: draftUISettings?.aiAdpEnabled && p.aiAdp != null ? p.aiAdp : p.adp,
          }))
        if (available.length === 0) {
          setWarRoomData(null)
          setWarRoomError(null)
          setWarRoomLoading(false)
          return
        }
        const recentPicks = (session.picks ?? []).slice(-14).map((p) => ({
          playerName: p.playerName,
          position: p.position,
          team: p.team ?? null,
          pickLabel: p.pickLabel,
        }))
        const totalPicks = session.rounds * session.teamCount
        const upcoming = getUpcomingPickOwners(
          currentPick.overall + 1,
          8,
          session.teamCount,
          session.draftType,
          session.thirdRoundReversal,
          session.slotOrder,
          totalPicks,
        )
        const aiAdpByKey =
          draftUISettings?.aiAdpEnabled && leagueAiAdp?.entries?.length
            ? expandAiAdpKeysForLookup(leagueAiAdp.entries)
            : {}
        const res = await fetch('/api/ai/draft/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId,
            availablePlayers: available,
            userRoster: myRoster,
            recentPicks,
            nextTeams: upcoming.map((u) => u.displayName),
            round: currentPick.round,
            pick: currentPick.slot,
            pickInRound: currentPick.slot,
            totalTeams: session.teamCount,
            sport: effectiveDraftSport,
            draftType: session.draftType,
            isDynasty,
            isSuperflex: isSuperflexFormat,
            isSF: isSuperflexFormat,
            rosterSlots: effectiveRosterSlots,
            aiAdpByKey: Object.keys(aiAdpByKey).length ? aiAdpByKey : undefined,
            mode: 'needs',
            currentPick: {
              overall: currentPick.overall,
              round: currentPick.round,
              slot: currentPick.slot,
              rosterId: currentPick.rosterId,
            },
            // Commit U — forward Commit-S team-needs context so the AI
            // helper can prompt against rule-correct positional gaps
            // (driven by the league's actual starterSlots map, not a
            // hardcoded NFL skill heuristic). Pure additive — the
            // recommend route currently doesn't read this field, so
            // older AI helpers continue to function unchanged. Bye-
            // week clusters are surfaced for the same reason: helps the
            // AI avoid recommending another player on an already-stacked
            // bye week.
            teamNeeds: computeTeamNeeds({
              picks: myRoster.map((r) => ({ position: r.position })),
              starterSlots: rosterConfig?.starterSlots ?? null,
            }),
            byeWeekClusters: detectByeWeekClusters(
              myRoster.map((r) => ({ position: r.position, byeWeek: r.byeWeek })),
            ),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) {
          setWarRoomError(typeof data.error === 'string' ? data.error : 'War room unavailable')
          setWarRoomData(null)
          return
        }
        const riskRaw = String(data.risk ?? '').toLowerCase()
        const risk: DraftWarRoomSnapshot['risk'] =
          riskRaw === 'low' || riskRaw === 'medium' || riskRaw === 'high' ? riskRaw : 'medium'
        const snap: DraftWarRoomSnapshot = {
          bestPick: data.bestPick,
          confidence: Number(data.confidence) || 0,
          reasoning: Array.isArray(data.reasoning) ? data.reasoning : [],
          strategyTip: String(data.strategyTip ?? ''),
          risk,
          riskNote: String(data.riskNote ?? ''),
          alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
          teamNeedSummary: typeof data.teamNeedSummary === 'string' ? data.teamNeedSummary : undefined,
          fallback: Boolean(data.fallback),
        }
        warRoomCacheRef.current.set(cacheKey, snap)
        setWarRoomData(snap)
      } catch (e) {
        setWarRoomError(e instanceof Error ? e.message : 'War room failed')
        setWarRoomData(null)
      } finally {
        setWarRoomLoading(false)
      }
    },
    [
      session,
      currentPick,
      players,
      draftedNames,
      draftedPlayerIds,
      draftUISettings?.aiAdpEnabled,
      leagueAiAdp,
      effectiveDraftSport,
      effectiveRosterSlots,
      isSuperflexFormat,
      isDynasty,
      currentUserRosterId,
      leagueId,
      isMyTurnToNominateDraft,
    ],
  )

  const scheduleWarRoomFetch = useCallback(
    (force?: boolean) => {
      if (warRoomDebounceRef.current) clearTimeout(warRoomDebounceRef.current)
      warRoomDebounceRef.current = setTimeout(() => {
        warRoomDebounceRef.current = null
        void fetchWarRoom(force)
      }, 420)
    },
    [fetchWarRoom],
  )

  useEffect(() => {
    if (!session?.teamCount || !currentPick || players.length === 0) return
    if (session.status !== 'in_progress') return
    scheduleWarRoomFetch(false)
    return () => {
      if (warRoomDebounceRef.current) clearTimeout(warRoomDebounceRef.current)
    }
  }, [
    currentPick?.overall,
    session?.picks?.length,
    session?.status,
    session?.draftType,
    session?.teamCount,
    players.length,
    currentUserRosterId,
    isMyTurnToNominateDraft,
    scheduleWarRoomFetch,
  ])

  const playerPoolNode = useMemo(
    () => (
      <SportAwareDraftRoom
        players={players}
        draftedNames={draftedNames}
        draftedPlayerIds={draftedPlayerIds}
        presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
        sport={effectiveDraftSport}
        canDraft={!draftRoomState.isAuction && canDraft}
        onAddToQueue={handleAddToQueue}
        onMakePick={handleMakePick}
        currentRoster={currentRoster}
        loading={poolLoading}
        poolError={poolError}
        useAiAdp={draftUISettings?.aiAdpEnabled ?? false}
        aiAdpUnavailable={aiAdpUnavailable}
        aiAdpUnavailableMessage={leagueAiAdp?.message ?? null}
        aiAdpStaleWarning={aiAdpStaleWarning}
        aiAdpLowSampleWarning={aiAdpLowSampleWarning}
        canNominate={draftRoomState.isAuction ? draftRoomState.canNominate : false}
        onNominate={draftRoomState.isAuction ? handleAuctionNominate : undefined}
        devyConfig={
          draftPool?.devyConfig
            ? draftPool.devyConfig
            : (session as DraftSessionSnapshot | null)?.devy?.enabled
              ? { enabled: true, devyRounds: (session as DraftSessionSnapshot).devy?.devyRounds ?? [] }
              : undefined
        }
        c2cConfig={
          draftPool?.c2cConfig
            ? draftPool.c2cConfig
            : (session as DraftSessionSnapshot | null)?.c2c?.enabled
              ? { enabled: true, collegeRounds: (session as DraftSessionSnapshot).c2c?.collegeRounds ?? [] }
              : undefined
        }
        currentRound={currentPick?.round}
        formatType={formatType === 'IDP' || Boolean((draftPool as { isIdp?: boolean } | null)?.isIdp) ? 'IDP' : undefined}
        selectedPlayerTarget={helperSelectedPlayer}
        leagueId={leagueId}
        aiRowBadges={aiRowBadges}
        aiOverlaySignals={aiOverlaySignals}
        showAiOverlays={showAiOverlays}
        onShowAiOverlaysChange={setShowAiOverlays}
        getDraftCopilotInsight={presentationVariant === 'redraft_snake' ? getDraftCopilotInsight : undefined}
        getAssistantRoomContext={
          presentationVariant === 'redraft_snake' ? getAssistantRoomContext : undefined
        }
        isPlayerQueued={(p) =>
          queue.some(
            (q) =>
              normalizeDraftedPlayerName(q.playerName) === normalizeDraftedPlayerName(p.name) &&
              String(q.position).trim().toLowerCase() === String(p.position).trim().toLowerCase(),
          )
        }
      />
    ),
    [
      players,
      draftedNames,
      draftedPlayerIds,
      queue,
      effectiveDraftSport,
      draftRoomState.isAuction,
      draftRoomState.canNominate,
      canDraft,
      handleAddToQueue,
      handleMakePick,
      currentRoster,
      poolLoading,
      poolError,
      draftUISettings?.aiAdpEnabled,
      aiAdpUnavailable,
      leagueAiAdp?.message,
      aiAdpStaleWarning,
      aiAdpLowSampleWarning,
      handleAuctionNominate,
      draftPool?.devyConfig,
      draftPool?.c2cConfig,
      session,
      draftRoomState.isAuction,
      formatType,
      helperSelectedPlayer,
      leagueId,
      aiRowBadges,
      aiOverlaySignals,
      showAiOverlays,
      presentationVariant,
      getDraftCopilotInsight,
      getAssistantRoomContext,
    ]
  )

  const draftHelperBadgeCount = useMemo(
    () =>
      calculateDraftHelperBadgeCount({
        recommendation: recommendationResult?.recommendation ?? null,
        warRoom: warRoomData ? { snapshot: warRoomData } : null,
        aiFeatureStatus: {
          chimmyReady: hasAiAccess && resolvedOrphanAiProviderAvailable,
          liveBrainReady: Boolean(liveBrainEnvelope),
          aiAdpEnabled: Boolean(draftUISettings?.aiAdpEnabled),
          queueReorderEnabled: Boolean(draftUISettings?.aiQueueReorderEnabled),
          draftExplanationEnabled: draftAiExplanationEnabled,
          orphanAiEnabled: Boolean(draftUISettings?.orphanTeamAiManagerEnabled),
          commissionerAiManagersCount: (commissionerAiDraft?.assignedAiTeams ?? []).filter((team) => team.active)
            .length,
        },
        sportsFeed: draftAssistantContext
          ? {
              available: Boolean(draftAssistantContext.sportsFeed?.available),
              headlines: draftAssistantContext.headlines,
              injuries: draftAssistantContext.injuries,
            }
          : null,
      }),
    [
      recommendationResult?.recommendation,
      warRoomData,
      hasAiAccess,
      resolvedOrphanAiProviderAvailable,
      liveBrainEnvelope,
      draftUISettings?.aiAdpEnabled,
      draftUISettings?.aiQueueReorderEnabled,
      draftAiExplanationEnabled,
      draftUISettings?.orphanTeamAiManagerEnabled,
      commissionerAiDraft?.assignedAiTeams,
      draftAssistantContext,
    ]
  )

  const hasDraftHelperData = useMemo(
    () =>
      hasDraftHelperContent({
        recommendation: recommendationResult?.recommendation ?? null,
        warRoom: warRoomData ? { snapshot: warRoomData } : null,
        aiFeatureStatus: {
          chimmyReady: hasAiAccess && resolvedOrphanAiProviderAvailable,
          liveBrainReady: Boolean(liveBrainEnvelope),
          aiAdpEnabled: Boolean(draftUISettings?.aiAdpEnabled),
          queueReorderEnabled: Boolean(draftUISettings?.aiQueueReorderEnabled),
          draftExplanationEnabled: draftAiExplanationEnabled,
          orphanAiEnabled: Boolean(draftUISettings?.orphanTeamAiManagerEnabled),
          commissionerAiManagersCount: (commissionerAiDraft?.assignedAiTeams ?? []).filter((team) => team.active)
            .length,
        },
        sportsFeed: draftAssistantContext
          ? {
              available: Boolean(draftAssistantContext.sportsFeed?.available),
              headlines: draftAssistantContext.headlines,
              injuries: draftAssistantContext.injuries,
            }
          : null,
      }),
    [
      recommendationResult?.recommendation,
      warRoomData,
      hasAiAccess,
      resolvedOrphanAiProviderAvailable,
      liveBrainEnvelope,
      draftUISettings?.aiAdpEnabled,
      draftUISettings?.aiQueueReorderEnabled,
      draftAiExplanationEnabled,
      draftUISettings?.orphanTeamAiManagerEnabled,
      commissionerAiDraft?.assignedAiTeams,
      draftAssistantContext,
    ]
  )

  const queueStackNode = useMemo(
    () => {
      const queuePlayerMetaById = players.reduce<Record<string, { headshotUrl?: string | null; teamLogoUrl?: string | null; adp?: number | null; rank?: number | null }>>((acc, player, idx) => {
        const pid = String(player.playerId ?? player.display?.playerId ?? player.id ?? '').trim()
        if (!pid) return acc
        acc[pid] = {
          headshotUrl: player.display?.assets?.headshotUrl ?? player.display?.assets?.headshotFallbackUrl ?? null,
          teamLogoUrl: player.display?.assets?.teamLogoUrl ?? player.display?.assets?.teamLogoFallbackUrl ?? null,
          adp: player.adp ?? null,
          rank: Number.isFinite(player.aiAdp ?? NaN) ? (player.aiAdp ?? null) : idx + 1,
        }
        return acc
      }, {})

      return <div className={`space-y-1.5 p-1 ${presentationVariant === 'redraft_snake' ? 'rounded-lg border border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,20,40,0.95),rgba(8,14,28,0.95))] p-1.5' : ''}`}>
        {hasDraftHelperData ? (
          <button
            type="button"
            onClick={() => floatingHelperState.setVisible(true)}
            data-testid="draft-helper-docked-trigger"
            className="flex w-full items-center justify-between rounded-lg border border-white/[0.08] bg-[linear-gradient(90deg,rgba(13,20,40,0.96),rgba(16,26,48,0.96))] px-2.5 py-1.5 text-left text-xs text-cyan-50 hover:bg-[linear-gradient(90deg,rgba(24,36,64,0.98),rgba(16,26,48,0.98))]"
          >
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Draft intelligence</span>
              <span className="block text-[11px] text-white/72">Open Copilot, War Room, and AI context</span>
            </span>
            {draftHelperBadgeCount > 0 ? (
              <span className="rounded-full border border-cyan-300/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                {draftHelperBadgeCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <DraftIntelQueuePanel
          loading={draftIntelLoading}
          headline={draftIntel?.headline ?? null}
          picksUntilUser={ribbonPicksUntilUser}
          onClock={draftIntel?.status === 'on_clock' || isCurrentUserOnClock}
          queue={draftIntelQueue}
          canDraft={Boolean(canDraft && (draftIntel?.status === 'on_clock' || isCurrentUserOnClock))}
          onDraftTopChoice={
            canDraft && (draftIntel?.status === 'on_clock' || isCurrentUserOnClock) ? handleDraftIntelPick : undefined
          }
          presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
          onAddIntelSuggestion={presentationVariant === 'redraft_snake' ? handleAddIntelQueueSuggestion : undefined}
        />
        <QueuePanel
          queue={queueFiltered}
          playerMetaById={queuePlayerMetaById}
          canDraft={canDraft}
          onRemove={handleRemoveFromQueue}
          onReorder={handleReorderQueue}
          onDraftFromQueue={canDraft && queueFiltered.length > 0 ? handleDraftFromQueue : undefined}
          onAiReorder={handleAiReorderQueue}
          aiReorderLoading={aiReorderLoading}
          aiReorderEnabled={aiQueueReorderEnabled}
          onAiReorderEnabledChange={draftUISettings?.aiQueueReorderEnabled ? setAiQueueReorderEnabled : undefined}
          autoPickFromQueue={autoPickFromQueue}
          onAutoPickFromQueueChange={setAutoPickFromQueue}
          awayMode={awayMode}
          onAwayModeChange={setAwayMode}
          autoPickEnabled={autoPickEnabled}
          nextQueuedAvailable={nextQueuedAvailable}
          aiReorderExplanation={aiReorderExplanation}
          aiReorderExecutionMode={aiReorderExecutionMode}
          analyticsLeagueId={leagueId}
          aiOverlaySignals={aiOverlaySignals}
          showAiOverlays={showAiOverlays}
          presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
        />
      </div>
    },
    [
      players,
      presentationVariant,
      draftIntelLoading,
      draftIntel?.headline,
      ribbonPicksUntilUser,
      draftIntel?.status,
      draftIntelQueue,
      handleAddIntelQueueSuggestion,
      canDraft,
      isCurrentUserOnClock,
      handleDraftIntelPick,
      queueFiltered,
      draftHelperBadgeCount,
      handleRemoveFromQueue,
      handleReorderQueue,
      handleDraftFromQueue,
      handleAiReorderQueue,
      aiReorderLoading,
      aiQueueReorderEnabled,
      draftUISettings?.aiQueueReorderEnabled,
      autoPickFromQueue,
      awayMode,
      autoPickEnabled,
      nextQueuedAvailable,
      aiReorderExplanation,
      aiReorderExecutionMode,
      aiOverlaySignals,
      showAiOverlays,
      floatingHelperState,
      hasDraftHelperData,
      leagueId,
    ]
  )

  const chatPanelNode = useMemo(
    () => (
      <DraftChatDock
        messages={chatMessagesWithAi}
        onSend={handleSendChat}
        sending={chatSending}
        leagueChatSync={chatSyncActive}
        isCommissioner={isCommissioner}
        onBroadcast={isCommissioner ? handleBroadcastOpen : undefined}
        onAiSuggestionClick={() => setMobileTab('helper')}
        onReconnect={handleChatReconnect}
        currentUserId={viewerAppUserId}
        onReact={viewerAppUserId ? handleReactChat : undefined}
        presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
        sendError={chatSendError}
        onDismissSendError={() => setChatSendError(null)}
        leagueId={leagueId}
        unreadCount={chatMessagesWithAi.filter((m) => m.unread).length}
      />
    ),
    [
      chatMessagesWithAi,
      handleSendChat,
      chatSending,
      chatSendError,
      chatSyncActive,
      isCommissioner,
      handleBroadcastOpen,
      setMobileTab,
      handleChatReconnect,
      viewerAppUserId,
      handleReactChat,
      presentationVariant,
      leagueId,
    ]
  )

  const lastPrunedQueueRef = useRef<string>('')
  useEffect(() => {
    if (autoPickEnabled) return
    if (!autoPickFromQueue && !awayMode) return
    setAutoPickFromQueue(false)
    setAwayMode(false)
  }, [autoPickEnabled, autoPickFromQueue, awayMode])

  useEffect(() => {
    if (draftUISettings?.aiQueueReorderEnabled !== false) return
    if (!aiQueueReorderEnabled) return
    setAiQueueReorderEnabled(false)
  }, [draftUISettings?.aiQueueReorderEnabled, aiQueueReorderEnabled])

  useEffect(() => {
    if (!session?.picks?.length || queue.length === 0) return
    const drafted = new Set(session.picks.map((p) => normalizeDraftedPlayerName(p.playerName)))
    const filtered = queue.filter((e) => !drafted.has(normalizeDraftedPlayerName(e.playerName)))
    if (filtered.length >= queue.length) return
    const key = filtered.map((e) => e.playerName).join(',')
    if (lastPrunedQueueRef.current === key) return
    lastPrunedQueueRef.current = key
    setQueue(filtered)
    handleQueueSave(filtered)
  }, [session?.picks?.length, queue, handleQueueSave])

  const autoPickFiredRef = useRef<string>('')
  useEffect(() => {
    if (!canDraft || !isCurrentUserOnClock || pickSubmitting) return
    if (!autoPickEnabled) return
    if (!autoPickFromQueue && !awayMode) return
    if ((session?.timer?.status ?? 'none') !== 'expired') return
    const key = `${currentPick?.overall ?? 0}-expired`
    if (autoPickFiredRef.current === key) return
    autoPickFiredRef.current = key
    const t = setTimeout(() => {
      handleAutopickExpired()
    }, 600)
    return () => clearTimeout(t)
  }, [canDraft, isCurrentUserOnClock, pickSubmitting, autoPickEnabled, autoPickFromQueue, awayMode, currentPick?.overall, handleAutopickExpired, session?.timer?.status])
  const tradedPickColorMode = draftUISettings?.tradedPickColorModeEnabled ?? false
  const showNewOwnerInRed = draftUISettings?.tradedPickOwnerNameRedEnabled ?? false
  const teamMetaByRoster = useMemo<Record<string, DraftTeamStripTeamMeta>>(() => {
    const map: Record<string, DraftTeamStripTeamMeta> = {}
    for (const entry of slotOrder) {
      const team = resolveManagerChromeTeam(entry, leagueTeams)
      map[entry.rosterId] = {
        rosterId: entry.rosterId,
        teamName: team?.teamName ?? null,
        ownerName: team?.ownerName ?? entry.displayName ?? null,
        avatarUrl: team?.avatarUrl ?? null,
        isOrphan: Array.isArray(orphanRosterIds) && orphanRosterIds.includes(entry.rosterId),
        aiArchetypeLabel: aiArchetypeByRoster[entry.rosterId] ?? null,
      }
    }
    return map
  }, [slotOrder, leagueTeams, orphanRosterIds, aiArchetypeByRoster])

  const onClockSpotlight = useMemo(() => {
    const rid = currentPick?.rosterId
    if (!rid) return null
    const m = teamMetaByRoster[rid]
    if (!m) return null
    return {
      teamName: m.teamName ?? null,
      ownerName: m.ownerName ?? null,
      avatarUrl: m.avatarUrl ?? null,
    }
  }, [currentPick?.rosterId, teamMetaByRoster])

  if (loading && !session) {
    return (
      <div
        className={`flex min-h-[50vh] flex-col items-center justify-center px-4 ${presentationVariant === 'redraft_snake' ? 'bg-[linear-gradient(180deg,rgba(8,18,36,0.35),transparent)]' : ''}`}
        data-testid="draft-room-loading-state"
        aria-busy="true"
        aria-live="polite"
      >
        <div
          className={`mb-4 h-12 w-12 animate-pulse rounded-2xl border ${presentationVariant === 'redraft_snake' ? 'border-cyan-400/25 bg-cyan-500/10' : 'border-white/15 bg-white/5'}`}
          aria-hidden
        />
        <p className="text-center text-white/75">Loading draft room…</p>
        <p className="mt-1 max-w-sm text-center text-xs text-white/45">
          Hang tight while we sync your league session and player pool.
        </p>
      </div>
    )
  }

  if (!session) {
    if (draftSessionAccess === "forbidden") {
      return (
        <div className="container mx-auto max-w-md px-4 py-12 text-center" data-testid="draft-room-access-denied">
          <p className="text-white/80">You don&apos;t have access to this draft room.</p>
          <p className="mt-2 text-sm text-white/50">
            Only league members and commissioners can open the live draft. Ask the commissioner for an invite or join the league first.
          </p>
          <Link href={`/league/${leagueId}`} className="mt-4 inline-block text-cyan-400 hover:underline">
            Back to league
          </Link>
          <Link href="/dashboard" className="mt-2 block text-sm text-white/40 hover:text-white/60">
            Dashboard
          </Link>
        </div>
      )
    }
    if (draftSessionAccess === "unauthorized") {
      return (
        <div className="container mx-auto max-w-md px-4 py-12 text-center" data-testid="draft-room-session-expired">
          <p className="text-white/80">Sign in to load this draft.</p>
          <p className="mt-2 text-sm text-white/50">Your session may have expired.</p>
          <Link
            href={
              typeof window !== "undefined"
                ? `/login?callbackUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
                : "/login"
            }
            className="mt-4 inline-block text-cyan-400 hover:underline"
          >
            Sign in
          </Link>
        </div>
      )
    }
    return (
      <div className="container mx-auto max-w-md px-4 py-12 text-center" data-testid="draft-room-empty-state">
        <p className="text-white/80">No draft session for this league.</p>
        <p className="mt-2 text-sm text-white/50">
          Commissioner can create and start a draft from league settings or the draft tab.
        </p>
        <Link href={`/league/${leagueId}`} className="mt-4 inline-block text-cyan-400 hover:underline">
          Back to league
        </Link>
      </div>
    )
  }

  const auctionSnapshot = (session as any).auction
  const isDraftCompleted = draftRoomState.isDraftCompleted
  /** Prevent blank board loop when corrupted API rows have rounds/teamCount = 0 */
  const safeBoardRounds = Math.max(1, session.rounds ?? 1)
  const safeBoardTeamCount = Math.max(1, session.teamCount ?? 1)
  const totalBoardPicksPlanned = safeBoardRounds * safeBoardTeamCount
  const boardHasOpenPicks = (session.picks?.length ?? 0) < totalBoardPicksPlanned
  /** DB row occasionally missing timerEndAt — TopBar shows "—"; nudge user to resync rather than implying a dead room. */
  const showPickClockAnchorWarning =
    session.status === 'in_progress' &&
    boardHasOpenPicks &&
    session.timer?.status === 'none' &&
    !(session.timer?.timerEndAt || session.timerEndAt)

  const myDraftedPicks = viewerDraftedPicks
  const myDevyAssetCount = myDraftedPicks.filter((p) => {
    const source = String((p as { source?: string | null }).source ?? '').toLowerCase()
    if (source === 'devy' || source === 'college') return true
    if ((session as DraftSessionSnapshot).devy?.enabled && (session as DraftSessionSnapshot).devy?.devyRounds?.includes(p.round)) return true
    if ((session as DraftSessionSnapshot).c2c?.enabled && (session as DraftSessionSnapshot).c2c?.collegeRounds?.includes(p.round)) return true
    return false
  }).length
  const myPromotedAssetCount = myDraftedPicks.filter((p) => {
    const source = String((p as { source?: string | null }).source ?? '').toLowerCase()
    return source === 'promoted_devy'
  }).length
  const devySlotTotal = (session as DraftSessionSnapshot).devy?.enabled
    ? ((session as DraftSessionSnapshot).devy?.devyRounds?.length ?? 0)
    : 0
  const sportAccent = {
    NFL: '34, 211, 238',
    NHL: '129, 140, 248',
    NBA: '251, 146, 60',
    MLB: '52, 211, 153',
    NCAAB: '244, 114, 182',
    NCAAF: '167, 139, 250',
    SOCCER: '56, 189, 248',
  }[(effectiveDraftSport || 'NFL').toUpperCase()] ?? '34, 211, 238'
  const draftBoardSurfaceStyle =
    presentationVariant === 'redraft_snake'
      ? ({
          backgroundImage: [
            `radial-gradient(ellipse 80% 60% at 80% 20%, rgba(${sportAccent},0.22), transparent 55%)`,
            `radial-gradient(ellipse 50% 40% at 10% 90%, rgba(167,139,250,0.08), transparent 50%)`,
            `linear-gradient(175deg, rgba(4,9,21,0.55) 0%, rgba(6,15,28,0.92) 100%)`,
          ].join(', '),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        } as const)
      : ({
          backgroundImage: `linear-gradient(180deg, rgba(${sportAccent},0.1), rgba(4,9,21,0.75)), url('/branding/allfantasy-ai-for-fantasy-sports-logo.png')`,
          backgroundSize: 'cover, 340px',
          backgroundPosition: 'center, right -36px bottom -30px',
          backgroundRepeat: 'no-repeat, no-repeat',
        } as const)
  const boardOrderSourceLabel =
    (session as { draftOrderMode?: string; lotteryLastRunAt?: string } | null)?.draftOrderMode === 'weighted_lottery' &&
    (session as { lotteryLastRunAt?: string } | null)?.lotteryLastRunAt
      ? 'Weighted Lottery Order'
      : undefined
  const openMobilePlayerSearch = () => {
    setMobileTab('players')
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.dispatchEvent(new Event('af:draft-player-search-focus'))
      }, 40)
    }
  }

  const mobileTimerLabel = (() => {
    const status = session.timer?.status ?? 'none'
    const remaining = session.timer?.remainingSeconds ?? null
    if (status === 'paused') return 'Paused'
    if (status === 'expired') return '0:00'
    if (status === 'none' || remaining == null || !Number.isFinite(remaining)) return '—'
    const n = Math.max(0, Math.floor(remaining))
    const min = Math.floor(n / 60)
    const sec = String(n % 60).padStart(2, '0')
    return `${min}:${sec}`
  })()

  // Product decision (Phase 3 Slice 4): mobile draft clock/header stays visible
  // across Board, Players, Queue, Roster, and Chat tabs at all times.
  const showMobileStickyBar = true

  const mobileStickyBar =
    showMobileStickyBar ? (
      <div className="space-y-1 px-2.5 py-1.5 text-xs" data-testid="draft-mobile-sticky-bar">
        <div className="flex items-center justify-between gap-1.5">
          {currentPick != null ? (
            <span className="font-medium text-cyan-200" data-testid="draft-mobile-current-pick">
              {currentPick.pickLabel}
              {currentPick.overall != null && (
                <span className="ml-1 text-white/50">#{currentPick.overall}</span>
              )}
            </span>
          ) : (
            <span className="font-medium text-cyan-200" data-testid="draft-mobile-current-pick">
              Draft room
            </span>
          )}
          <div className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
            <span className="text-cyan-200/80">Clock</span>
            <span className="font-mono tabular-nums">{mobileTimerLabel}</span>
          </div>
        </div>
        {currentPick != null ? (
          <p className="truncate text-white/80">On clock: {currentPick.displayName}</p>
        ) : null}
        {presentationVariant === 'redraft_snake' &&
        ribbonPicksUntilUser != null &&
        ribbonPicksUntilUser > 0 &&
        !isCurrentUserOnClock ? (
          <p className="text-[10px] text-cyan-200/75" data-testid="draft-mobile-picks-until-you">
            ~{ribbonPicksUntilUser} pick{ribbonPicksUntilUser === 1 ? '' : 's'} until your turn
          </p>
        ) : null}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scroll-smooth" data-testid="draft-mobile-quick-actions">
          <button
            type="button"
            data-testid="draft-mobile-quick-search"
            onClick={openMobilePlayerSearch}
            className="rounded border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] text-cyan-100 whitespace-nowrap"
          >
            Search
          </button>
          <button
            type="button"
            data-testid="draft-mobile-quick-queue"
            onClick={() => setMobileTab('queue')}
            className="rounded border border-white/20 bg-black/30 px-2.5 py-1.5 text-[10px] text-white/75 whitespace-nowrap"
          >
            Queue
          </button>
          <button
            type="button"
            data-testid="draft-mobile-quick-roster"
            onClick={() => setMobileTab('roster')}
            className="rounded border border-white/20 bg-black/30 px-2.5 py-1.5 text-[10px] text-white/75 whitespace-nowrap"
          >
            Roster
          </button>
          <button
            type="button"
            data-testid="draft-mobile-quick-chat"
            onClick={() => setMobileTab('chat')}
            className="rounded border border-white/20 bg-black/30 px-2.5 py-1.5 text-[10px] text-white/75 whitespace-nowrap"
          >
            Chat
          </button>
          <button
            type="button"
            data-testid="draft-mobile-quick-helper"
            onClick={() => setMobileTab('helper')}
            className="rounded border border-white/20 bg-black/30 px-2.5 py-1.5 text-[10px] text-white/75 whitespace-nowrap"
          >
            AI helper
          </button>
        </div>
      </div>
    ) : null

  const OFFENSE_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])
  const IDP_POS = new Set(['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS'])
  const idpNeeds = formatType === 'IDP' && idpRosterSummary && (() => {
    const slots = idpRosterSummary.starterSlots
    let offenseNeed = 0
    let idpNeed = 0
    for (const [name, count] of Object.entries(slots)) {
      if (name === 'FLEX' || OFFENSE_POS.has(name)) offenseNeed += count
      else if (name === 'DL' || name === 'DB' || name === 'IDP_FLEX' || IDP_POS.has(name)) idpNeed += count
    }
    const benchNeed = idpRosterSummary.benchSlots ?? 0
    const myOffense = myDraftedPicks.filter((p) => OFFENSE_POS.has(p.position ?? '') || p.position === 'FLEX').length
    const myIdp = myDraftedPicks.filter((p) => IDP_POS.has(p.position ?? '')).length
    const myBench = Math.max(0, myDraftedPicks.length - myOffense - myIdp)
    return { offenseNeed, idpNeed, benchNeed, myOffense, myIdp, myBench }
  })()

  const rosterPanel = (
    <div className="space-y-2 p-2">
      <div className="md:hidden">
        <DraftTeamPanel {...draftTeamPanelProps} redraftStarterHints={redraftStarterHints} />
      </div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">My roster</h3>
      {draftTeamPanelProps.showRosterStrip ? (
        <DraftRosterStrip
          picks={myDraftedPicks.map((p) => ({
            playerName: p.playerName,
            position: p.position,
            overall: p.overall,
            isDevy:
              ((session as DraftSessionSnapshot).c2c?.enabled ? [] : (session as DraftSessionSnapshot).devy?.devyRounds ?? []).includes(
                p.round,
              ) || ((session as DraftSessionSnapshot).c2c?.collegeRounds ?? []).includes(p.round),
          }))}
          starterSlots={draftTeamPanelProps.starterSlots ?? null}
          benchSlots={draftTeamPanelProps.benchSlots ?? null}
          taxiSlots={draftTeamPanelProps.taxiSlots ?? null}
          devySlots={draftTeamPanelProps.devySlots ?? null}
          isDynasty={isDynasty}
          teamLabel={slotOrder.find((s) => s.rosterId === currentUserRosterId)?.displayName ?? null}
          sport={effectiveDraftSport}
        />
      ) : null}
      {formatType === 'IDP' && (
        <IdpDraftExplainerCard
          scoringPreset={idpScoringPreset}
          positionMode={idpPositionMode}
          className="mb-2"
        />
      )}
      {formatType === 'IDP' && idpNeeds && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-2 py-1.5 text-xs text-cyan-200">
          <div className="font-medium text-cyan-100 mb-1">Starters remaining</div>
          <div>Offense: {idpNeeds.myOffense} / {idpNeeds.offenseNeed}</div>
          <div>IDP: {idpNeeds.myIdp} / {idpNeeds.idpNeed}</div>
          <div>Bench: {idpNeeds.myBench} / {idpNeeds.benchNeed}</div>
        </div>
      )}
      {devySlotTotal > 0 && (
        <div className="rounded-lg border border-violet-400/25 bg-violet-500/10 px-2 py-1.5 text-xs text-violet-100" data-testid="draft-devy-slot-summary">
          <div className="font-medium mb-1">Devy slots</div>
          <div>Filled: {myDevyAssetCount} / {devySlotTotal}</div>
          <div>Promoted markers: {myPromotedAssetCount}</div>
        </div>
      )}
      {myDraftedPicks.length > 0 ? (
        <ul className="space-y-1.5">
          {myDraftedPicks.map((p) => {
            const source = String((p as { source?: string | null }).source ?? '').toLowerCase()
            const c2cCollegeRounds = (session as DraftSessionSnapshot).c2c?.collegeRounds ?? []
            const isCollegeAsset = Boolean((session as DraftSessionSnapshot).c2c?.enabled) && (source === 'college' || c2cCollegeRounds.includes(p.round))
            const isProAsset = Boolean((session as DraftSessionSnapshot).c2c?.enabled) && !isCollegeAsset
            return (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span className="font-medium text-white/90 truncate">
                  {p.playerName}
                  {isCollegeAsset && (
                    <span className="ml-1 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-100">College</span>
                  )}
                  {isProAsset && (
                    <span className="ml-1 rounded bg-cyan-500/20 px-1 py-0.5 text-[9px] font-medium text-cyan-100">Pro</span>
                  )}
                </span>
                <span className="text-white/50 shrink-0 ml-2">{p.position}</span>
                <span className="text-[10px] text-white/40">#{p.overall}</span>
              </li>
            )
          })}
        </ul>
      ) : draftTeamPanelProps.showRosterStrip ? (
        <p className="text-[11px] text-white/40">Starter and bench slots above fill as you draft.</p>
      ) : (
        <p className="text-white/50 text-sm">No picks yet.</p>
      )}
    </div>
  )

  const hasKeeperConfig =
    (session as DraftSessionSnapshot).keeper?.config != null &&
    ((session as DraftSessionSnapshot).keeper?.config?.maxKeepers ?? 0) > 0
  const showKeeperPanel = hasKeeperConfig || isCommissioner
  const requestedOrphanDrafterMode =
    draftUISettings?.orphanDrafterMode
    ?? (session as { orphanDrafterMode?: 'cpu' | 'ai' }).orphanDrafterMode
    ?? 'cpu'
  const sessionRequestedOrphanMode =
    (session as { orphanDrafterMode?: 'cpu' | 'ai' }).orphanDrafterMode ?? requestedOrphanDrafterMode
  const effectiveOrphanDrafterMode =
    sessionRequestedOrphanMode === requestedOrphanDrafterMode
      ? (
        (session as { orphanDrafterEffectiveMode?: 'cpu' | 'ai' }).orphanDrafterEffectiveMode
        ?? (requestedOrphanDrafterMode === 'ai' && !resolvedOrphanAiProviderAvailable ? 'cpu' : requestedOrphanDrafterMode)
      )
      : (requestedOrphanDrafterMode === 'ai' && !resolvedOrphanAiProviderAvailable ? 'cpu' : requestedOrphanDrafterMode)
  const orphanDrafterFallbackActive =
    requestedOrphanDrafterMode === 'ai' && effectiveOrphanDrafterMode === 'cpu'
  const keeperPanel = showKeeperPanel ? (
    <KeeperPanel
      leagueId={leagueId}
      isCommissioner={isCommissioner}
      slotOrder={slotOrder}
      currentUserRosterId={currentUserRosterId ?? null}
      rounds={session.rounds}
      onSessionUpdate={fetchSession}
    />
  ) : undefined

  return (
    <>
    <DraftIntroGate
      leagueId={leagueId}
      draftSessionId={session.id}
      shouldPlayIntro={true}
    />
    {showPreDraftValidationWizard && draftId ? (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pre-draft-validation-wizard-title"
        data-testid="pre-draft-validation-wizard"
      >
        <div className="w-full max-w-xl rounded-2xl border border-white/[0.08] bg-[#0d1117] p-6 shadow-2xl">
          <PreDraftWizard
            leagueId={leagueId}
            draftId={draftId}
            onClose={() => setShowPreDraftValidationWizard(false)}
            onValidationComplete={(canStart) => {
              if (canStart) {
                setShowPreDraftValidationWizard(false)
                void handleCommissionerAction('start')
              }
            }}
            onFixAction={(action) => {
              // Slice G — Target A: the draft route does NOT host
              // `LeagueSettingsModal` (that modal lives on the league
              // dashboard `/league/[id]` route via `LeagueShell`). Auto-
              // opening it from here would require either a navigation
              // call (forbidden by the unified-state contract locked in
              // Commit E) or mounting the league shell inside the draft
              // room (a separate refactor).
              //
              // For now we forward the canonical action key to the
              // settings-fix-action event bus and close the wizard. The
              // commissioner closes the draft tab and walks to League →
              // Settings → {panel} themselves. Phase 2 will pick up
              // `af-pre-draft-fix-action` on the dashboard side and deep-
              // link into the right panel automatically.
              const panelByAction: Record<string, string> = {
                invite_managers: 'invite',
                set_draft_order: 'draft',
                configure_roster: 'roster',
                configure_scoring: 'scoring',
                fix_duplicate_managers: 'members-commish',
                configure_draft_type: 'draft',
              }
              const panel = panelByAction[action] ?? null
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('af-pre-draft-fix-action', {
                    detail: { leagueId, action, panel },
                  }),
                )
              }
              setShowPreDraftValidationWizard(false)
            }}
          />
        </div>
      </div>
    ) : null}
    {presentationVariant === 'redraft_snake' && !isDynasty ? (
      <DraftRoundOneAnnouncementOverlay
        presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
        leagueName={leagueName}
        sportLabel={typeof sport === 'string' ? sport.toUpperCase() : ''}
        queue={roundOneAnnouncementQueue}
        onDismissFront={dismissRoundOneAnnouncement}
      />
    ) : null}
    <DraftRoomShell
      layout="premium"
      surfaceVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
      // D.6 — War Room moved out of the left aside. teamPanel=null collapses the
      // aside; the WarRoomPopup below renders the same DraftTeamPanel content as
      // a floating bottom-right popup with notification badge.
      teamPanel={null}
      centerColumn={
        <div
          className={
            presentationVariant === 'redraft_snake'
              ? 'flex h-full min-h-0 flex-col bg-[radial-gradient(ellipse_100%_80%_at_50%_-10%,rgba(34,211,238,0.06),transparent),linear-gradient(180deg,#071826_0%,#050c18_50%,#040a14_100%)]'
              : 'flex h-full min-h-0 flex-col bg-[#060d1e]'
          }
        >
          <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
            <div
              className={`flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden border-r xl:flex-[13] ${
                presentationVariant === 'redraft_snake' ? 'border-cyan-500/10' : 'border-white/8'
              }`}
              data-testid="draft-bottom-dock-pool"
            >
              {!isDraftCompleted ? (
                <div className="min-h-0 flex-1 overflow-hidden">{playerPoolNode}</div>
              ) : (
                <>
                  <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-950/25 px-4 py-3 text-center text-sm text-emerald-100/90">
                    Draft is complete — browse the recap below. The live board stays visible above.
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <PostDraftView
                      leagueId={leagueId}
                      leagueName={leagueName}
                      sport={effectiveDraftSport}
                      session={session}
                      currentUserRosterId={currentUserRosterId ?? null}
                      slotOrder={slotOrder}
                    />
                  </div>
                </>
              )}
            </div>

            {/* D.6 — at xl+ widths, render the 3-column dock (Queue | Results | Chat)
                directly instead of the tab system. The tab system below stays for
                narrower viewports as a graceful fallback. */}
            {/* D.6.1 — single shared right-dock with QUEUE / ROSTER / CHAT tabs.
                Only the active tab body is visible; inactive bodies stay mounted
                (display:none) so Roster keeps updating in real-time when picks
                land while you're looking at Queue, and Chat scroll position
                survives a tab switch. */}
            <div
              className="hidden min-h-0 min-w-0 basis-0 flex-col overflow-hidden xl:flex xl:flex-[7]"
              data-testid="draft-right-dock"
            >
              <DraftRightDockTabs
                queueBody={<div className="flex h-full min-h-0 flex-col overflow-auto bg-[linear-gradient(180deg,rgba(7,14,28,0.65),rgba(6,12,24,0.88))] px-1 py-1">{queueStackNode}</div>}
                rosterBody={
                  <ResultsRosterPanel
                    teams={resultsRosterTeams}
                    picks={resultsRosterPicks}
                    currentUserRosterId={currentUserRosterId ?? null}
                    starterSlots={rosterConfig?.starterSlots ?? null}
                    benchSlots={rosterConfig?.benchSlots ?? null}
                    idpEnabled={Boolean(idpRosterSummary)}
                  />
                }
                chatBody={<div className="flex h-full min-h-0 flex-col overflow-hidden">{chatPanelNode}</div>}
                queueCount={draftIntel?.queue?.length ?? 0}
                defaultTab="queue"
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden xl:hidden">
              <div className="flex h-full min-h-0 w-full flex-col" data-testid="draft-bottom-dock-tabs">
                <div
                  className={`grid ${isCommissioner ? 'grid-cols-4' : 'grid-cols-3'} gap-1 border-b px-2 py-1.5 ${
                    presentationVariant === 'redraft_snake'
                      ? 'border-cyan-500/15 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(5,12,24,0.98))] shadow-[inset_0_1px_0_rgba(34,211,238,0.08)]'
                      : 'border-white/8 bg-[#0a1228]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setCenterDockTab('queue')}
                    data-testid="draft-bottom-tab-queue"
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                      centerDockTab === 'queue'
                        ? presentationVariant === 'redraft_snake'
                          ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/15 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.15)]'
                          : 'bg-white/12 text-cyan-100'
                        : 'text-white/55 hover:bg-white/5'
                    }`}
                  >
                    Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterDockTab('chat')}
                    data-testid="draft-bottom-tab-chat"
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                      centerDockTab === 'chat'
                        ? presentationVariant === 'redraft_snake'
                          ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/15 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.15)]'
                          : 'bg-white/12 text-cyan-100'
                        : 'text-white/55 hover:bg-white/5'
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterDockTab('ai')}
                    data-testid="draft-bottom-tab-ai"
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                      centerDockTab === 'ai'
                        ? presentationVariant === 'redraft_snake'
                          ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/15 text-violet-50 shadow-[0_0_22px_rgba(167,139,250,0.2)]'
                          : 'bg-white/12 text-cyan-100'
                        : 'text-white/55 hover:bg-white/5'
                    }`}
                  >
                    AI
                  </button>
                  {isCommissioner ? (
                    <button
                      type="button"
                      onClick={() => setCenterDockTab('commish')}
                      data-testid="draft-bottom-tab-commish"
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                        centerDockTab === 'commish'
                          ? 'bg-white/12 text-amber-100'
                          : 'text-white/55 hover:bg-white/5'
                      }`}
                    >
                      Commish Edit
                    </button>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                  {centerDockTab === 'queue' ? (
                    <div className="h-full overflow-auto px-1.5 py-1">{queueStackNode}</div>
                  ) : null}

                  {centerDockTab === 'chat' ? (
                    <div className="h-full overflow-hidden">{chatPanelNode}</div>
                  ) : null}

                  {centerDockTab === 'ai' ? (
                    <div
                      className={`h-full overflow-auto p-3 text-xs text-white/75 ${
                        presentationVariant === 'redraft_snake'
                          ? 'bg-[linear-gradient(180deg,rgba(76,29,149,0.12),transparent)]'
                          : ''
                      }`}
                      data-testid="draft-bottom-ai-panel"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200/90">Draft AI</p>
                      {entitlements.loading ? (
                        <div className="mt-2 rounded-lg border border-white/12 bg-black/25 p-3">
                          <p className="text-white/55">Checking access…</p>
                        </div>
                      ) : !hasAiAccess ? (
                        <div
                          className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3"
                          data-testid="draft-bottom-ai-locked"
                        >
                          <p className="text-sm font-semibold text-amber-100">AI recommendations locked</p>
                          <p className="mt-1 text-[11px] text-white/65">
                            Subscribe (Pro, Commissioner, All-Access, or Supreme) for unlimited AI picks — or top up tokens to pay per-use.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a
                              href="/pricing"
                              className="inline-flex items-center rounded border border-amber-300/45 bg-amber-500/20 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100 hover:bg-amber-500/30"
                              data-testid="draft-bottom-ai-upgrade-cta"
                            >
                              Upgrade
                            </a>
                            <a
                              href="/tokens"
                              className="inline-flex items-center rounded border border-cyan-300/45 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-500/25"
                              data-testid="draft-bottom-ai-tokens-cta"
                            >
                              Buy tokens
                            </a>
                          </div>
                        </div>
                      ) : recommendationResult?.recommendation ? (
                        <div className="mt-2 space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3">
                          <p className="text-sm font-semibold text-white">
                            {recommendationResult.recommendation.player.name}
                            <span className="ml-1 text-cyan-100/80">
                              {recommendationResult.recommendation.player.position}
                              {recommendationResult.recommendation.player.team ? ` - ${recommendationResult.recommendation.player.team}` : ''}
                            </span>
                          </p>
                          <p className="text-[11px] text-white/70">{recommendationResult.recommendation.reason}</p>
                          <button
                            type="button"
                            onClick={() => setMobileTab('helper')}
                            className="rounded border border-cyan-300/35 bg-cyan-500/12 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-500/20"
                            data-testid="draft-bottom-ai-open-helper"
                          >
                            Open Full AI Panel
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 rounded-lg border border-white/12 bg-black/25 p-3">
                          <p className="text-white/65">No recommendation yet. AI updates when draft context changes.</p>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {centerDockTab === 'commish' && isCommissioner ? (
                    <div className="flex h-full flex-col gap-2 overflow-auto px-1.5 py-1" data-testid="draft-bottom-commish-panel">
                      <PreDraftSlotSetupCard
                        leagueId={leagueId}
                        session={session}
                        onSlotOrderUpdated={(nextSlotOrder) => {
                          setSession((prev) => (prev ? { ...prev, slotOrder: nextSlotOrder } : prev))
                          setGovernanceBanner({
                            variant: 'success',
                            message: 'Placeholder slots replaced with real rosters.',
                          })
                        }}
                      />
                      <CommissionerPickEditorPanel
                        leagueId={leagueId}
                        session={session}
                        players={commissionerPickEditorPlayers}
                        selectedOverall={commissionerEditOverall}
                        onSelectedOverallConsumed={() => setCommissionerEditOverall(null)}
                        onSnapshotUpdated={(next) => {
                          setSession((prev) => mergeDraftSessionSnapshot(prev, next))
                          setGovernanceBanner({ variant: 'success', message: 'Pick updated. Draft remains paused.' })
                        }}
                      />
                      <CommissionerAuditLogList
                        leagueId={leagueId}
                        slotOrder={session?.slotOrder}
                        refreshKey={session?.version}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
      topBar={
        <>
          {pickError && (
          <div className="flex items-center justify-between gap-2 border-b border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-100">
              <span>{pickError}</span>
              <button type="button" onClick={() => setPickError(null)} className="rounded px-2 py-1 text-red-200 hover:bg-red-500/20" aria-label="Dismiss">×</button>
            </div>
          )}
          {pickSuccessFlash ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-between gap-2 border-b border-emerald-400/35 bg-[linear-gradient(90deg,rgba(52,211,153,0.14),rgba(15,23,42,0.85))] px-3 py-1.5 text-xs text-emerald-50 shadow-[0_8px_32px_rgba(52,211,153,0.12)]"
              data-testid="draft-pick-success-banner"
            >
              <span className="font-medium">
                Pick locked in: <span className="text-white">{pickSuccessFlash}</span>
              </span>
              <button
                type="button"
                onClick={() => setPickSuccessFlash(null)}
                className="rounded px-2 py-1 text-emerald-200/90 hover:bg-emerald-500/15"
                aria-label="Dismiss confirmation"
              >
                ×
              </button>
            </div>
          ) : null}
          {draftRoomState.rosterConfigurationIncomplete ? (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="draft-roster-config-incomplete-banner"
              className="flex flex-wrap items-center gap-2 border-b border-rose-400/35 bg-rose-950/45 px-3 py-1.5 text-xs text-rose-50"
            >
              <span className="font-semibold text-rose-100">Roster configuration incomplete.</span>
              <span className="text-rose-100/90">
                {draftRoomState.rosterConfigurationMessage ??
                  'The commissioner must save roster slots in league settings before drafting. The pick clock and player picks stay disabled until this is fixed.'}
              </span>
            </div>
          ) : governanceBanner ? (
            <div
              role={governanceBanner.variant === 'error' ? 'alert' : 'status'}
              aria-live={governanceBanner.variant === 'error' ? 'assertive' : 'polite'}
              data-testid="draft-governance-banner"
              className={`draft-live-governance-banner flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs ${
                governanceBanner.variant === 'success'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
                  : governanceBanner.variant === 'error'
                    ? 'border-rose-400/35 bg-rose-500/12 text-rose-50'
                    : 'border-amber-400/35 bg-amber-500/12 text-amber-50'
              }`}
            >
              <span className="font-medium">{governanceBanner.message}</span>
              <button
                type="button"
                onClick={() => setGovernanceBanner(null)}
                className="rounded px-2 py-1 opacity-90 hover:bg-white/10"
                aria-label="Dismiss notice"
              >
                ×
              </button>
            </div>
          ) : session?.status === 'paused' ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="draft-paused-room-banner"
              className="draft-live-pause-banner flex items-center gap-2 border-b border-amber-400/35 bg-[linear-gradient(90deg,rgba(251,191,36,0.12),rgba(15,23,42,0.92))] px-3 py-1.5 text-xs text-amber-50"
            >
              <span className="font-semibold uppercase tracking-[0.12em] text-amber-200/95">Paused</span>
              <span className="text-amber-50/95">
                Pick clock is frozen until the commissioner resumes the draft.
              </span>
            </div>
          ) : session?.status === 'in_progress' && session.timer?.pauseReason === 'overnight_window' ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="draft-overnight-pause-banner"
              className="flex flex-wrap items-center gap-2 border-b border-slate-400/35 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-100"
            >
              <span className="font-semibold uppercase tracking-[0.12em] text-slate-200/95">Overnight pause</span>
              <span className="text-slate-100/90">
                Pick clock is frozen for the quiet window.
                {draftUISettings?.allowPicksDuringOvernightPause
                  ? ' Picks are still allowed if your league permits them.'
                  : ' Picks are disabled until the window ends.'}
              </span>
            </div>
          ) : showPickClockAnchorWarning ? (
            <div
              role="status"
              data-testid="draft-clock-anchor-warning"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-400/30 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-50"
            >
              <span className="text-cyan-100/95">
                Pick timer is syncing — tap <span className="font-semibold">Resync</span> if the clock stays blank.
              </span>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-cyan-50 hover:bg-cyan-500/25"
                onClick={() => void handleResync()}
              >
                Resync
              </button>
            </div>
          ) : session?.status === 'in_progress' && !currentUserRosterId ? (
            <div
              role="status"
              data-testid="draft-room-no-roster-banner"
              className="border-b border-amber-400/40 bg-amber-950/35 px-3 py-1.5 text-xs text-amber-50"
            >
              <span className="font-semibold text-amber-100">No roster linked to your account in this league.</span>{' '}
              <span className="text-amber-100/85">
                Claim your team from the league page to submit picks when you&apos;re on the clock.
              </span>
            </div>
          ) : null}
          <DraftTopBar
            leagueName={leagueName}
            leagueLogoUrl={leagueLogoUrl ?? null}
            sport={effectiveDraftSport}
            draftType={session.draftType}
            teamCount={session.teamCount}
            rounds={session.rounds}
            currentManagerOnClock={currentPick?.displayName ?? null}
            pickLabel={currentPick?.pickLabel ?? null}
            overallPickNumber={currentPick?.overall ?? null}
            timerStatus={draftRoomState.timerMode === 'blocked' ? 'none' : (session.timer?.status ?? 'none')}
            timerRemainingSeconds={draftRoomState.timerMode === 'blocked' ? null : (session.timer?.remainingSeconds ?? null)}
            timerEndAtIso={draftRoomState.timerEndAt}
            timerSeconds={session.timerSeconds ?? null}
            timerPauseReason={session.timer?.pauseReason ?? null}
            overnightResumeAtIso={session.timer?.overnightResumeAt ?? null}
            timerMode={draftUISettings?.timerMode ?? 'per_pick'}
            autoPickEnabled={autoPickEnabled}
            isCommissioner={isCommissioner}
            draftStatus={session.status}
            inviteLink={inviteLink}
            onCopyInvite={(source) => {
              void handleCopyInvite(source)
            }}
            onStartDraft={draftRoomState.canStart ? () => void handleStartDraft() : undefined}
            onPause={() => void handleCommissionerAction('pause')}
            onResume={() => void handleCommissionerAction('resume')}
            onResetTimer={() => void handleCommissionerResetTimer()}
            onUndoPick={() => void handleCommissionerUndoPick()}
            commissionerPauseControlsEnabled={draftUISettings?.commissionerPauseControlsEnabled ?? true}
            commissionerLoading={commissionerLoading}
            isReconnecting={connectionDegraded}
            isOrphanOnClock={isOrphanOnClock}
            orphanDrafterMode={effectiveOrphanDrafterMode}
            orphanDrafterRequestedMode={requestedOrphanDrafterMode}
            orphanFallbackActive={orphanDrafterFallbackActive}
            onRunAiPick={isCommissioner && isOrphanOnClock ? handleRunAiPick : undefined}
            runAiPickLoading={runAiPickLoading}
            onCommissionerOpen={isCommissioner ? () => setShowCommissionerModal(true) : undefined}
            onTradesClick={openPickTradePanel}
            pendingTradesCount={pendingTradesCount}
            showUseQueue={
              !draftRoomState.isAuction &&
              autoPickEnabled &&
              session.timer?.status === 'expired' &&
              isCurrentUserOnClock &&
              queueFiltered.length > 0
            }
            onUseQueue={handleAutopickExpired}
            useQueueLoading={autopickExpiredLoading}
            onResync={handleResync}
            resyncLoading={resyncLoading}
            backHref={`/league/${leagueId}`}
            onOpenDraftRoomSettings={() => setDraftRoomSettingsOpen(true)}
            onlineCount={onlineCount > 0 ? onlineCount : undefined}
            draftRoomPresentation={presentationVariant}
            onToggleAutoPick={handleToggleAutoPick}
            thirdRoundReversal={Boolean(session.thirdRoundReversal)}
            aiRecommendationOverlay={showAiOverlays ? recommendationOverlaySummary : null}
            showAiOverlays={showAiOverlays}
          />
          <AutopickMeToggle
            viewerAutopick={session.viewerAutopick}
            leagueId={leagueId}
            onUpdate={handleAutopickMeUpdate}
          />
        </>
      }
      managerStrip={null}
      draftBoard={
        <div
          className="flex min-h-0 flex-col gap-1.5 p-1.5 lg:gap-2.5 lg:p-2.5"
          style={draftBoardSurfaceStyle}
        >
          {/*
            Full-width chrome stays above the lg:flex-row (LiveDraftStatusColumn + board).
            Mount for pre_draft too on redraft_snake so Start does not jump the board stack height.
          */}
          {presentationVariant === 'redraft_snake' && !isDynasty && !isDraftCompleted ? (
            <div className="w-full shrink-0">
              <RedraftPlanningRibbon
                preDraft={session.status === 'pre_draft'}
                picksUntilUser={ribbonPicksUntilUser}
                userOnClock={isCurrentUserOnClock}
                onDeck={redraftRibbonOnDeck}
                thirdRoundReversal={session.thirdRoundReversal}
                backToBackSoon={redraftBackToBackSoon}
                viewerRosterMissing={
                  (session.status === 'in_progress' || session.status === 'paused') &&
                  !(session as DraftSessionSnapshot & { currentUserRosterId?: string }).currentUserRosterId
                }
              />
            </div>
          ) : null}
          {draftUISettings?.executionMode === 'offline' ? (
            <div
              className="w-full shrink-0 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"
              data-testid="draft-room-offline-banner"
              role="status"
            >
              <p className="font-semibold uppercase tracking-[0.14em] text-amber-200">Offline draft</p>
              <p className="mt-0.5 text-amber-100/85">
                {isCommissioner
                  ? 'You are logging picks from an in-person draft. Selecting a player submits on behalf of the team on the clock.'
                  : 'This league is running an offline draft. Picks are being entered by the commissioner as they happen in person.'}
              </p>
            </div>
          ) : null}
          {isDraftCompleted ? (
            <div
              className="w-full shrink-0 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-50 shadow-[0_8px_32px_rgba(16,185,129,0.12)]"
              role="status"
              data-testid="draft-complete-board-banner"
            >
              <span className="font-semibold uppercase tracking-[0.12em] text-emerald-200/95">Draft complete</span>
              <span className="mt-1 block text-[13px] font-normal text-emerald-50/90">
                Final board is below — open the player column for recap & export.
              </span>
            </div>
          ) : null}
          {!isDraftCompleted &&
          (session.status === 'in_progress' || session.status === 'paused') &&
          (!Array.isArray(session.slotOrder) || session.slotOrder.length < safeBoardTeamCount) ? (
            <div
              role="status"
              data-testid="draft-board-order-incomplete-banner"
              className="w-full shrink-0 rounded-lg border border-amber-400/40 bg-amber-950/35 px-3 py-2 text-[11px] text-amber-50"
            >
              Draft order is still syncing — board cells stay open below. Use <span className="font-semibold">Resync</span>{' '}
              in the header if this message persists.
            </div>
          ) : null}
          {sessionMismatchRecovering ? (
            <div
              role="status"
              data-testid="draft-session-mismatch-banner"
              className="flex w-full shrink-0 items-center justify-between gap-3 rounded-lg border border-cyan-400/40 bg-cyan-950/35 px-3 py-2 text-[11px] text-cyan-50"
            >
              <span>Draft status changed. Refreshing room state…</span>
              {sessionMismatchAttemptsRef.current > 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    sessionMismatchAttemptsRef.current = 0
                    void fetchSession()
                  }}
                  data-testid="draft-session-mismatch-retry"
                  className="rounded-md border border-cyan-400/50 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100 hover:bg-cyan-500/25"
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
          {/* D.6.2 — LiveDraftStatusColumn removed from the live snake layout.
              The status column produced a side-by-side split with the board that
              cramped horizontal real estate. The clock pill in DraftTopBar and
              the on-the-clock cell in DraftBoard now carry that information. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-h-[120px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
              <div className="shrink-0">
                <DraftTeamStrip
                  teamCount={safeBoardTeamCount}
                  slotOrder={slotOrder}
                  teamMetaByRoster={teamMetaByRoster}
                  currentUserRosterId={currentUserRosterId ?? null}
                  onClockRosterId={currentPick?.rosterId ?? null}
                  canInvite={isCommissioner}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none]">
                <DraftBoard
                  picks={session.picks ?? []}
                  slotOrder={slotOrder}
                  tradedPicks={(session as any).tradedPicks ?? []}
                  teamCount={safeBoardTeamCount}
                  rounds={safeBoardRounds}
                  draftType={session.draftType}
                  thirdRoundReversal={session.thirdRoundReversal}
                  tradedPickColorMode={tradedPickColorMode}
                  showNewOwnerInRed={showNewOwnerInRed}
                  keeperLocks={(session as DraftSessionSnapshot).keeper?.locks}
                  devyRounds={(session as DraftSessionSnapshot).c2c?.enabled ? [] : ((session as DraftSessionSnapshot).devy?.devyRounds ?? [])}
                  c2cCollegeRounds={(session as DraftSessionSnapshot).c2c?.collegeRounds ?? []}
                  currentOverallPick={currentPick?.overall ?? null}
                  sport={effectiveDraftSport}
                  currentUserRosterId={currentUserRosterId ?? null}
                  aiManagedRosterIds={aiManagedRosterIds}
                  orderSourceLabel={boardOrderSourceLabel}
                  presentationVariant={presentationVariant === 'redraft_snake' ? 'redraft_snake' : 'default'}
                  onCellTrade={currentUserRosterId ? openPickTradeFromBoard : undefined}
                  onOpenTradeHistory={() => {
                    setTradeHistoryFocus(null)
                    setTradeHistoryOpen(true)
                  }}
                  onViewCellTradeHistory={(ctx) => {
                    setTradeHistoryFocus({
                      round: ctx.round,
                      originalRosterId: ctx.originalRosterId,
                    })
                    setTradeHistoryOpen(true)
                  }}
                  canCommissionerEditPicks={
                    isCommissioner && session?.status === 'paused' && session?.draftType !== 'auction'
                  }
                  onCommissionerEditPick={isCommissioner ? openCommissionerPickEditor : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      }
      auctionStrip={
        draftRoomState.isAuction && auctionSnapshot ? (
          <AuctionSpotlightPanel
            auction={auctionSnapshot}
            currentUserRosterId={currentUserRosterId ?? null}
            isCommissioner={isCommissioner}
            onNominate={(player) => handleAuctionNominate({ name: player.playerName, position: player.position, team: player.team ?? null })}
            onBid={handleAuctionBid}
            onResolve={handleAuctionResolve}
            timerRemainingSeconds={
              draftRoomState.timerMode === 'blocked' ? null : (session.timer?.remainingSeconds ?? null)
            }
            timerStatus={draftRoomState.timerMode === 'blocked' ? 'none' : (session.timer?.status ?? 'none')}
            nominateLoading={auctionNominateLoading}
            bidLoading={auctionBidLoading}
            resolveLoading={auctionResolveLoading}
            rosterGateBlocksAuctionActions={draftRoomState.rosterConfigurationIncomplete}
          />
        ) : undefined
      }
      playerPanel={playerPoolNode}
      queuePanel={queueStackNode}
      helperPanel={undefined}
      chatPanel={chatPanelNode}
      rosterPanel={rosterPanel}
      keeperPanel={keeperPanel}
      mobileStickyBar={mobileStickyBar}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    />
    {/* D.6 — Sleeper-style War Room as floating bottom-right popup. The same
        DraftTeamPanel content that used to live in the left aside lives inside
        the popup body now, so power users still have one-click access to
        starter balance / positional mix / AI guidance, but the layout reclaims
        that left column for the player table. */}
    <WarRoomPopup hasNewIntel={warRoomHasNewIntel} triggerLabel="War Room">
      <DraftTeamPanel {...draftTeamPanelProps} redraftStarterHints={redraftStarterHints} />
    </WarRoomPopup>
    <DraftRoomSettingsModal
      open={draftRoomSettingsOpen}
      onClose={() => setDraftRoomSettingsOpen(false)}
      leagueId={leagueId}
      leagueName={leagueName}
      draftSessionStatus={session?.status ?? 'pre_draft'}
      isCommissioner={isCommissioner}
      presentationVariant={presentationVariant}
      draftIsAuction={session?.draftType === 'auction'}
      onSaved={() => {
        void fetchDraftSettings()
      }}
    />
    {commissionerEditModalOpen && isCommissioner && (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 sm:items-center"
        role="dialog"
        aria-label="Commissioner pick editor"
        data-testid="draft-commish-edit-overlay"
        onClick={(e) => { if (e.target === e.currentTarget) setCommissionerEditModalOpen(false) }}
      >
        <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-lg border border-white/10 bg-[#0b1426] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-100">Commissioner Pick Editor</h2>
            <button
              type="button"
              onClick={() => setCommissionerEditModalOpen(false)}
              className="rounded px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close commissioner pick editor"
              data-testid="draft-commish-edit-overlay-close"
            >
              ×
            </button>
          </div>
          <div className="p-3">
            <CommissionerPickEditorPanel
              leagueId={leagueId}
              session={session}
              players={commissionerPickEditorPlayers}
              selectedOverall={commissionerEditOverall}
              onSelectedOverallConsumed={() => setCommissionerEditOverall(null)}
              onSnapshotUpdated={(next) => {
                setSession((prev) => mergeDraftSessionSnapshot(prev, next))
                setGovernanceBanner({ variant: 'success', message: 'Pick updated. Draft remains paused.' })
              }}
            />
          </div>
        </div>
      </div>
    )}
    {showCommissionerModal && isCommissioner && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Commissioner control center" data-testid="draft-commissioner-overlay">
        <div className="w-full max-w-md max-h-[90vh] overflow-auto">
          <CommissionerControlCenterModal
            leagueId={leagueId}
            draftStatus={session?.status ?? 'pre_draft'}
            draftType={session?.draftType}
            draftUISettings={draftUISettings}
            skipPickAllowed={skipPickAllowed}
            orphanStatus={orphanAiStatus}
            isOrphanOnClock={isOrphanOnClock}
            orphanDrafterMode={requestedOrphanDrafterMode}
            orphanDrafterEffectiveMode={effectiveOrphanDrafterMode}
            orphanAiProviderAvailable={resolvedOrphanAiProviderAvailable}
            timerSeconds={session?.timerSeconds ?? null}
            rounds={session?.rounds ?? 15}
            devyConfig={(session as DraftSessionSnapshot)?.devy ?? null}
            c2cConfig={(session as DraftSessionSnapshot)?.c2c ?? null}
            onClose={() => setShowCommissionerModal(false)}
            onAction={handleCommissionerAction}
            onSettingsPatch={handleSettingsPatch}
            onSaveDevyConfig={handleSaveDevyConfig}
            onSaveC2CConfig={handleSaveC2CConfig}
            onStartDraft={draftRoomState.canStart ? handleStartDraft : undefined}
            onRunAiPick={isCommissioner && isOrphanOnClock ? handleRunAiPick : undefined}
            runAiPickLoading={runAiPickLoading}
            onBroadcast={() => { setShowCommissionerModal(false); setShowBroadcastModal(true) }}
            onResync={handleResync}
            loading={commissionerLoading}
            commissionerAiDraft={commissionerAiDraft ?? undefined}
            onSaveCommissionerAiDraft={handleSaveCommissionerAiDraft}
          />
        </div>
      </div>
    )}
    {showTradePanel && session && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-4"
        role="dialog"
        aria-label="Draft pick trades"
        data-testid="draft-trade-panel-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowTradePanel(false)
        }}
      >
        <div
          className="max-h-[min(92vh,960px)] w-full max-w-6xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <DraftPickTradePanel
            leagueId={leagueId}
            leagueName={leagueName}
            draftSessionStatus={session.status}
            pickTradeEnabled={draftUISettings?.pickTradeEnabled ?? true}
            presentationVariant={presentationVariant}
            sessionId={session.id}
            draftStateFingerprint={tradeDraftStateFingerprint}
            slotOrder={slotOrder}
            teamCount={session.teamCount}
            rounds={session.rounds}
            currentUserRosterId={currentUserRosterId ?? null}
            tradePanelGeneration={tradePanelGeneration}
            initialTradeDraft={tradeInitialDraft}
            onClose={() => setShowTradePanel(false)}
            onTradeAccepted={(updatedSession?: unknown) => {
              if (updatedSession != null)
                setSession((prev) =>
                  mergeDraftSessionSnapshot(prev, updatedSession as DraftSessionSnapshot),
                )
              fetchPendingTradesCount()
            }}
          />
        </div>
      </div>
    )}
    {showBroadcastModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Broadcast to leagues" data-testid="draft-broadcast-overlay">
        <div className="w-full max-w-md rounded-xl border border-white/12 bg-[#070f21] p-4 shadow-xl" data-testid="draft-broadcast-modal">
          <h3 className="mb-3 text-sm font-semibold text-white">@everyone Broadcast</h3>
          <p className="mb-2 text-[10px] text-white/60">Select leagues to send the message to.</p>
          <div className="mb-3 max-h-40 overflow-y-auto rounded border border-white/12 bg-black/20 p-2">
            {commissionerLeagues.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-white">
                <input
                  type="checkbox"
                  checked={broadcastSelectedIds.has(l.id)}
                  onChange={(e) => {
                    setBroadcastSelectedIds((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(l.id)
                      else next.delete(l.id)
                      return next
                    })
                  }}
                  className="rounded border-white/20"
                  data-testid={`draft-broadcast-league-${l.id}`}
                />
                {l.name || l.id}
              </label>
            ))}
          </div>
          <textarea
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            placeholder="Message to send as @everyone"
            className="mb-3 w-full rounded border border-white/12 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-white/40"
            rows={3}
            data-testid="draft-broadcast-message-input"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBroadcastModal(false)}
              data-testid="draft-broadcast-cancel"
              className="rounded border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBroadcastSubmit}
              disabled={broadcastSending || broadcastSelectedIds.size === 0 || !broadcastMessage.trim()}
              data-testid="draft-broadcast-send"
              className="rounded border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {broadcastSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    )}
    <PickTradeHistoryModal
      open={tradeHistoryOpen}
      onClose={() => setTradeHistoryOpen(false)}
      tradedPicks={((session as DraftSessionSnapshot | null)?.tradedPicks) ?? []}
      focusRound={tradeHistoryFocus?.round ?? null}
      focusOriginalRosterId={tradeHistoryFocus?.originalRosterId ?? null}
    />

    {/* Draft Helper Floating Bubble */}
    {hasDraftHelperData && (
      <DraftHelperFloatingBubble
        badgeCount={draftHelperBadgeCount}
        hasContent={hasDraftHelperData}
        onClick={() => floatingHelperState.setVisible(true)}
        className="xl:hidden"
      />
    )}

    {/* Draft Helper Floating Window */}
    {hasDraftHelperData && (
      <DraftHelperFloatingWindow
        visible={floatingHelperState.state.visible}
        onClose={() => floatingHelperState.setVisible(false)}
        state={floatingHelperState.state}
        onPositionChange={floatingHelperState.setPosition}
        onSizeChange={floatingHelperState.setSize}
        onToggleSection={floatingHelperState.toggleSection}
        badgeCount={draftHelperBadgeCount}
        copilotProps={{
          loading: recommendationLoading,
          recommendation: recommendationResult?.recommendation ?? null,
          alternatives: recommendationResult?.alternatives ?? [],
          onRefresh: fetchRecommendation,
          explanation: recommendationResult?.explanation ?? '',
          evidence: recommendationResult?.evidence ?? [],
          caveats: recommendationResult?.caveats ?? [],
          round: currentPick?.round ?? 1,
          pick: currentPick?.slot ?? 1,
          sport: effectiveDraftSport,
          showAiOverlays,
          recommendationOverlay: recommendationOverlaySummary,
        }}
        intelligenceProps={{
          aiFeatureStatus: {
            chimmyReady: hasAiAccess && resolvedOrphanAiProviderAvailable,
            liveBrainReady: Boolean(liveBrainEnvelope),
            aiAdpEnabled: Boolean(draftUISettings?.aiAdpEnabled),
            queueReorderEnabled: Boolean(draftUISettings?.aiQueueReorderEnabled),
            draftExplanationEnabled: draftAiExplanationEnabled,
            orphanAiEnabled: Boolean(draftUISettings?.orphanTeamAiManagerEnabled),
            commissionerAiManagersCount: (commissionerAiDraft?.assignedAiTeams ?? []).filter((team) => team.active)
              .length,
          },
          sportsFeed: draftAssistantContext
            ? {
                available: Boolean(draftAssistantContext.sportsFeed?.available),
                updatedAt: draftAssistantContext.sportsFeed?.updatedAt ?? null,
                sourceKeys: draftAssistantContext.sportsFeed?.sourceKeys ?? [],
                headlines: draftAssistantContext.headlines,
                injuries: draftAssistantContext.injuries,
              }
            : null,
          showAiOverlays,
          recommendationOverlay: recommendationOverlaySummary
            ? {
                label: recommendationOverlaySummary.label,
                confidencePct: recommendationOverlaySummary.confidencePct,
                stackAvailable: recommendationOverlaySummary.stackAvailable,
                byeWeekConflict: recommendationOverlaySummary.byeWeekConflict,
                safetyLevel: recommendationOverlaySummary.safetyLevel,
              }
            : null,
        }}
      />
    )}
  </>
  )
}
