"use client"

/**
 * WorldCupDailyEdgeReportCard
 *
 * Renders the World Cup Daily Edge Report for the authenticated user.
 *
 * ── Free sections (always visible, no token) ────────────────────────────────
 *  1. Match That Matters
 *  2. Root For
 *  3. Who Can Pass You
 *  4. Best Path to Climb
 *  5. Mistake to Avoid
 *
 * ── Coaching layer (optional, 1 token for free users) ───────────────────────
 *  - If cached from earlier today: shown immediately on GET response
 *  - If user has a paid AI plan: "Included in your plan" with auto-fetch
 *  - If free user: "Unlock today's coaching · 1 token" button
 *    → confirms token spend via window.confirm
 *    → POST confirmedTokenSpend=true
 *    → renders coaching insight + commissioner post idea
 *
 * ── Billing clarity ──────────────────────────────────────────────────────────
 *  After coaching loads, shows one of:
 *  - "No token used · coaching was already unlocked today"
 *  - "Included with your plan"
 *  - "1 token used"
 *
 * ── Feedback ─────────────────────────────────────────────────────────────────
 *  Helpful / Not helpful buttons on coaching block.
 *  "Not helpful" expands reason chips: too_basic, not_actionable, wrong_data, great_insight
 *  Posts to /api/ai/feedback + fires analytics beacon.
 *
 * ── Commissioner post ────────────────────────────────────────────────────────
 *  Commissioners (isOwner / AF Commissioner) see a "Post to pool chat" button.
 *
 * ── Analytics dedup ──────────────────────────────────────────────────────────
 *  "viewed" fires at most once per mount via useRef guard.
 *  "cache_hit" fires inside the same mount guard.
 *
 * ── Analytics events ─────────────────────────────────────────────────────────
 *  edge_report_viewed, edge_report_unlock_clicked, edge_report_token_confirmed,
 *  edge_report_cache_hit, edge_report_coaching_loaded, edge_report_error,
 *  edge_report_post_to_chat_clicked, edge_report_feedback_clicked
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Trophy,
  Users,
  Zap,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import {
  confirmWorldCupTokenSpend,
  isWorldCupTokenConfirmationResponse,
} from "@/lib/world-cup/worldCupClientTokenConfirm"
import {
  trackEdgeReportViewed,
  trackEdgeReportUnlockClicked,
  trackEdgeReportTokenConfirmed,
  trackEdgeReportCacheHit,
  trackEdgeReportCoachingLoaded,
  trackEdgeReportError,
  trackEdgeReportPostToChatClicked,
  trackEdgeReportFeedbackClicked,
} from "@/lib/world-cup/worldCupEdgeReportAnalytics"
import type { EdgeSection, WorldCupEdgeReport } from "@/lib/world-cup/worldCupEdgeReport"
import type { EdgeReportCoaching } from "@/lib/world-cup/worldCupEdgeReportAi"
import type { WorldCupDataTrustReport } from "@/lib/world-cup/worldCupDataTrustService"
import { ChimmyFreshnessChip } from "./ChimmyFreshnessChip"

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorldCupDailyEdgeReportCardProps = {
  challengeId: string
  /** Whether the user has AI entitlement (subscription covers coaching). */
  aiEntitled: boolean
  /** Whether the user is a pool commissioner / owner. Shows "Post to chat" button. */
  isCommissioner: boolean
  /**
   * Called when the commissioner clicks "Post to pool chat" on the post idea.
   * Receives the post text. The parent is responsible for the actual POST to chat.
   */
  onPostToChat?: (text: string) => void
}

type LoadState = "idle" | "loading" | "loaded" | "error"
type CoachingState = "idle" | "loading" | "loaded" | "error"

type BillingInfo = {
  tokenCharged: boolean
  fromCache: boolean
  coveredByPlan: boolean
}

type ReportResponse = {
  report: WorldCupEdgeReport
  dataTrust?: WorldCupDataTrustReport | null
  coachingAvailable: boolean
  coachingFromCache: boolean
  billing: {
    deterministicSections: string
    coachingTokenCost: number
    coachingCached: boolean
  }
}

function formatSyncAgo(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ageMs = Date.now() - new Date(iso).getTime()
  if (ageMs < 0) return null
  const m = Math.floor(ageMs / 60_000)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.floor(h / 24)}d ago`
}

function trustChipProps(
  dataTrust: WorldCupDataTrustReport | null | undefined,
  hasLiveData: boolean
): { tier: string; label: string } {
  if (!dataTrust) {
    return hasLiveData
      ? { tier: "live", label: "Live scores" }
      : { tier: "cached", label: "Pool data" }
  }
  const { dataFreshness, lastScoreSyncAt, lastFixtureSyncAt } = dataTrust
  switch (dataFreshness) {
    case "live": {
      const ago = formatSyncAgo(lastScoreSyncAt)
      return { tier: "live", label: ago ? `Live · synced ${ago}` : "Live scores active" }
    }
    case "cached": {
      const ago = formatSyncAgo(lastFixtureSyncAt)
      return { tier: "cached", label: ago ? `Cached · synced ${ago}` : "Updated within 24 hrs" }
    }
    case "schedule_only":
      return { tier: "schedule_only", label: "Schedule only" }
    case "pool_only":
      return { tier: "pool_only", label: "Pool data only" }
    default:
      return { tier: "none", label: "No data loaded" }
  }
}

type CoachingResponse = {
  report: WorldCupEdgeReport
  coaching: EdgeReportCoaching
  billing: BillingInfo
}

type FeedbackRating = "helpful" | "not_helpful"
type FeedbackReason = "too_basic" | "not_actionable" | "wrong_data" | "great_insight"
type FeedbackState = "idle" | "choosing_reason" | "submitting" | "done"

// ── Section icons ─────────────────────────────────────────────────────────────

const SECTION_ICONS = {
  matchThatMatters: <Target className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  rootFor: <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  threats: <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  bestPath: <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  mistakeToAvoid: <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />,
} as const

// ── Section row subcomponent ──────────────────────────────────────────────────

function SectionRow({
  sectionKey,
  label,
  section,
}: {
  sectionKey: keyof typeof SECTION_ICONS
  label: string
  section: EdgeSection
}) {
  const [open, setOpen] = useState(true)
  const icon = SECTION_ICONS[sectionKey]

  const confidenceColor =
    section.confidence === "high"
      ? "text-emerald-300/60"
      : section.confidence === "medium"
      ? "text-amber-300/50"
      : "text-white/25"

  return (
    <div
      className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5"
      data-testid={`edge-report-section-${sectionKey}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-white/40">{icon}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-white/35">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`text-[9px] font-bold uppercase tracking-wider ${confidenceColor}`}
            aria-label={`Data confidence: ${section.confidence}`}
          >
            ●
          </span>
          {open
            ? <ChevronUp className="h-3 w-3 text-white/25" aria-hidden />
            : <ChevronDown className="h-3 w-3 text-white/25" aria-hidden />
          }
        </div>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5" data-testid={`edge-report-section-${sectionKey}-body`}>
          <p className="text-[13px] font-black leading-snug text-white/90">
            {section.headline}
          </p>
          {section.subtext && (
            <p className="text-[11px] leading-relaxed text-white/60">
              {section.subtext}
            </p>
          )}
          {section.bullets.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {section.bullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-[11px] leading-relaxed text-white/50"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-white/25" aria-hidden />
                  {bullet}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Feedback subcomponent ─────────────────────────────────────────────────────

const NOT_HELPFUL_REASONS: Array<{ code: FeedbackReason; labelKey: string }> = [
  { code: "too_basic",       labelKey: "wc.edgeReport.feedback.tooBasic" },
  { code: "not_actionable",  labelKey: "wc.edgeReport.feedback.notActionable" },
  { code: "wrong_data",      labelKey: "wc.edgeReport.feedback.wrongData" },
  { code: "great_insight",   labelKey: "wc.edgeReport.feedback.greatInsight" },
]

function FeedbackRow({
  challengeId,
  t,
}: {
  challengeId: string
  t: ReturnType<typeof makeWcT>
}) {
  const [state, setState] = useState<FeedbackState>("idle")

  async function submitFeedback(rating: FeedbackRating, reason?: FeedbackReason) {
    setState("submitting")
    trackEdgeReportFeedbackClicked({ challengeId, rating, reason: reason ?? null })
    try {
      await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: "world_cup_daily_edge_report",
          rating,
          sport: "world_cup",
          // reason is optional — only sent when user selects a chip
          ...(reason ? { reason } : {}),
        }),
        keepalive: true,
      })
    } catch {
      // Non-fatal — analytics beacon already fired
    }
    setState("done")
  }

  function handleHelpful() {
    void submitFeedback("helpful")
  }

  function handleNotHelpful() {
    // Show reason chips before submitting
    setState("choosing_reason")
    trackEdgeReportFeedbackClicked({ challengeId, rating: "not_helpful", reason: null })
  }

  function handleReason(reason: FeedbackReason) {
    void submitFeedback("not_helpful", reason)
  }

  if (state === "done") {
    return (
      <p
        className="text-[10px] text-white/40"
        data-testid="edge-report-feedback-thanks"
      >
        {t("wc.edgeReport.feedback.thanks")}
      </p>
    )
  }

  if (state === "choosing_reason") {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="edge-report-feedback-reasons">
        {NOT_HELPFUL_REASONS.map(({ code, labelKey }) => (
          <button
            key={code}
            type="button"
            onClick={() => handleReason(code)}
            data-testid={`edge-report-feedback-reason-${code}`}
            className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-white/60 transition hover:border-white/20 hover:text-white/80"
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2"
      data-testid="edge-report-feedback-row"
    >
      <span className="text-[10px] text-white/35">
        {t("wc.edgeReport.feedback.title")}
      </span>
      <button
        type="button"
        onClick={handleHelpful}
        disabled={state === "submitting"}
        data-testid="edge-report-feedback-helpful"
        aria-label={t("wc.edgeReport.feedback.helpful")}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[10px] text-emerald-300/70 transition hover:bg-emerald-300/[0.12] disabled:opacity-40"
      >
        <ThumbsUp className="h-3 w-3" aria-hidden />
        {t("wc.edgeReport.feedback.helpful")}
      </button>
      <button
        type="button"
        onClick={handleNotHelpful}
        disabled={state === "submitting"}
        data-testid="edge-report-feedback-not-helpful"
        aria-label={t("wc.edgeReport.feedback.notHelpful")}
        className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.03] px-2 py-1 text-[10px] text-white/40 transition hover:bg-white/[0.08] disabled:opacity-40"
      >
        <ThumbsDown className="h-3 w-3" aria-hidden />
        {t("wc.edgeReport.feedback.notHelpful")}
      </button>
    </div>
  )
}

// ── Coaching block subcomponent ────────────────────────────────────────────────

function CoachingBlock({
  coaching,
  billingInfo,
  challengeId,
  isCommissioner,
  isPostingToChat,
  onPostToChat,
  t,
}: {
  coaching: EdgeReportCoaching
  billingInfo: BillingInfo | null
  challengeId: string
  isCommissioner: boolean
  isPostingToChat: boolean
  onPostToChat?: (text: string) => void
  t: ReturnType<typeof makeWcT>
}) {
  // ── Billing clarity label ────────────────────────────────────────────────
  const billingLabel = billingInfo
    ? billingInfo.fromCache
      ? t("wc.edgeReport.billing.cached")
      : billingInfo.coveredByPlan
      ? t("wc.edgeReport.billing.included")
      : billingInfo.tokenCharged
      ? t("wc.edgeReport.billing.charged")
      : null
    : null

  return (
    <div
      className="space-y-3"
      data-testid="edge-report-coaching-block"
    >
      {/* Coaching insight */}
      <div
        className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3.5 py-3"
        data-testid="edge-report-coaching-insight"
      >
        <div className="mb-1.5 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-cyan-300/60" aria-hidden />
          <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300/50">
            {t("wc.edgeReport.coaching.title")}
          </span>
          {coaching.fromCache && (
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-300/60">
              {t("wc.edgeReport.coaching.cachedBadge")}
            </span>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-white/80">
          {coaching.coachingInsight}
        </p>

        {/* Billing clarity */}
        {billingLabel && (
          <p
            className="mt-2 text-[9px] text-white/30"
            data-testid="edge-report-billing-label"
          >
            {billingLabel}
          </p>
        )}
      </div>

      {/* Commissioner post idea */}
      <div
        className="rounded-xl border border-amber-300/15 bg-amber-400/[0.04] px-3.5 py-3"
        data-testid="edge-report-commissioner-post"
      >
        <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300/50">
          {t("wc.edgeReport.commissionerPost.title")}
        </p>
        <p className="text-[12px] leading-relaxed text-white/75">
          {coaching.commissionerPost}
        </p>

        {/* "Post to chat" button — commissioner only */}
        {isCommissioner && onPostToChat && (
          <button
            type="button"
            onClick={() => onPostToChat(coaching.commissionerPost)}
            disabled={isPostingToChat}
            data-testid="edge-report-post-to-chat-btn"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-400/[0.08] px-3 py-1.5 text-[11px] font-bold text-white/70 transition hover:bg-amber-400/[0.14] hover:text-white disabled:opacity-50"
          >
            {isPostingToChat
              ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              : <Send className="h-3 w-3" aria-hidden />
            }
            {isPostingToChat
              ? t("wc.edgeReport.commissionerPost.posting")
              : t("wc.edgeReport.commissionerPost.postBtn")
            }
          </button>
        )}
      </div>

      {/* Feedback */}
      <FeedbackRow challengeId={challengeId} t={t} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WorldCupDailyEdgeReportCard({
  challengeId,
  aiEntitled,
  isCommissioner,
  onPostToChat,
}: WorldCupDailyEdgeReportCardProps) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const [loadState, setLoadState] = useState<LoadState>("idle")
  const [coachingState, setCoachingState] = useState<CoachingState>("idle")
  const [reportData, setReportData] = useState<ReportResponse | null>(null)
  const [coachingData, setCoachingData] = useState<EdgeReportCoaching | null>(null)
  const [coachingBilling, setCoachingBilling] = useState<BillingInfo | null>(null)
  const [isPostingToChat, setIsPostingToChat] = useState(false)

  // ── Analytics dedup guard — "viewed" fires at most once per mount ─────────
  const viewedFiredRef = useRef(false)

  // ── Load report on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoadState("loading")

    fetch(`/api/brackets/world-cup/${challengeId}/edge-report`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as ReportResponse | null
        if (cancelled) return

        /*
         * 🛑 A 200 IS NOT A CONTRACT, AND THE CAST ABOVE IS NOT A CHECK.
         *
         * `as ReportResponse` is a compile-time assertion about a value that
         * arrived over the wire at runtime. Without this guard the next lines
         * set `loadState = "loaded"` and then read `data.report.noEntry`, so a
         * response that is JSON, is 200, and simply lacks `report` throws AFTER
         * the component has committed to rendering the loaded branch — and that
         * branch dereferences `reportData.report` in five more places.
         *
         * ⚠ THE BLAST RADIUS IS THE WHOLE TREE, NOT THIS CARD. The throw happens
         * during render, so React unmounts everything above it. That is why one
         * malformed edge-report response failed 18 tests in
         * `world-cup-components.test.tsx` that have nothing to do with the edge
         * report — chat, the entry video, participant lists, Chimmy prompt chips
         * — and why the log carries React's "add an error boundary" notice
         * rather than an assertion failure. A reader of that output would
         * reasonably go looking in the chat code.
         *
         * The `.catch` below already owns this case: it sets the error state and
         * reports `phase: "load"` telemetry. Failing into it is strictly better
         * than a white screen, and it is what the card does for a 500 today.
         */
        if (!data || !data.report) {
          throw new Error("edge-report response carried no report")
        }

        setReportData(data)
        setLoadState("loaded")

        const hasEntry = !data.report.noEntry
        const fromCache = data.coachingFromCache

        // Fire "viewed" exactly once
        if (!viewedFiredRef.current) {
          viewedFiredRef.current = true
          trackEdgeReportViewed({
            challengeId,
            hasEntry,
            coachingFromCache: fromCache,
            aiEntitled,
          })
          if (fromCache) {
            trackEdgeReportCacheHit({ challengeId })
          }
        }

        if (fromCache) {
          // Fetch cached coaching immediately — free, no token
          void fetchCoaching(false)
        } else if (aiEntitled) {
          // Paid users: auto-fetch coaching (covered by plan)
          void fetchCoaching(false)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadState("error")
        const msg = err instanceof Error ? err.message : "Unknown error"
        trackEdgeReportError({ challengeId, phase: "load", errorMessage: msg })
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId])

  // ── Fetch coaching (with optional token confirmation loop) ────────────────
  const fetchCoaching = useCallback(
    async (requiresConfirm: boolean): Promise<void> => {
      setCoachingState("loading")
      try {
        const res = await fetch(`/api/brackets/world-cup/${challengeId}/edge-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmedTokenSpend: requiresConfirm }),
        })
        const data = (await res.json()) as Record<string, unknown>

        // Token confirmation required (409)
        if (isWorldCupTokenConfirmationResponse(res.status, data)) {
          const preview = data.preview as Record<string, unknown> | undefined
          const tokenCost = typeof preview?.tokenCost === "number" ? preview.tokenCost : 1

          setCoachingState("idle")  // Reset so button is visible again

          trackEdgeReportUnlockClicked({ challengeId })

          const confirmed = confirmWorldCupTokenSpend(
            data as Parameters<typeof confirmWorldCupTokenSpend>[0]
          )
          if (!confirmed) return

          trackEdgeReportTokenConfirmed({ challengeId, tokenCost })
          return fetchCoaching(true)
        }

        if (!res.ok) {
          const errMsg =
            typeof data.error === "string" ? data.error : t("wc.edgeReport.coaching.error")
          const code = typeof data.code === "string" ? data.code : ""
          const displayMsg =
            code === "edge_report_spend_failed"
              ? t("wc.edgeReport.coaching.spendFailed")
              : errMsg
          setCoachingState("error")
          toast.error(displayMsg)
          trackEdgeReportError({ challengeId, phase: "coaching", errorMessage: errMsg })
          return
        }

        const coachingResponse = data as CoachingResponse
        setCoachingData(coachingResponse.coaching)
        setCoachingBilling(coachingResponse.billing ?? null)
        setCoachingState("loaded")

        // Determine billing mode for analytics
        const billing = coachingResponse.billing
        const billingMode = billing?.fromCache
          ? "cache"
          : billing?.coveredByPlan
          ? "plan"
          : "token_charged"
        trackEdgeReportCoachingLoaded({
          challengeId,
          billingMode,
          fromCache: Boolean(billing?.fromCache),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error"
        setCoachingState("error")
        toast.error(t("wc.edgeReport.coaching.error"))
        trackEdgeReportError({ challengeId, phase: "coaching", errorMessage: msg })
      }
    },
    [challengeId, t]
  )

  // ── Post to chat ──────────────────────────────────────────────────────────
  const handlePostToChat = useCallback(
    async (text: string) => {
      if (isPostingToChat || !onPostToChat) return
      setIsPostingToChat(true)
      trackEdgeReportPostToChatClicked({ challengeId })
      try {
        await Promise.resolve(onPostToChat(text))
        toast.success(t("wc.edgeReport.commissionerPost.posted"))
      } catch {
        toast.error("Could not post to chat.")
      } finally {
        setIsPostingToChat(false)
      }
    },
    [challengeId, isPostingToChat, onPostToChat, t]
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 space-y-4"
      data-testid="world-cup-daily-edge-report"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-300/70" aria-hidden />
          <div>
            <h3 className="text-sm font-black text-white">
              {t("wc.edgeReport.title")}
            </h3>
            <p className="text-[10px] text-white/40">
              {t("wc.edgeReport.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {loadState === "loaded" && reportData && (() => {
            const cp = trustChipProps(reportData.dataTrust, reportData.report.hasLiveData)
            return (
              <ChimmyFreshnessChip tier={cp.tier} label={cp.label} />
            )
          })()}
          {loadState === "loaded" && (
            <span
              className="flex items-center gap-1 rounded-full border border-green-400/25 bg-green-400/[0.08] px-2 py-0.5 text-[9px] font-semibold text-green-300/80"
              data-testid="edge-report-cue-ready"
              aria-live="polite"
            >
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
              </span>
              {t("wc.edgeReport.cue.ready")}
            </span>
          )}
          <span
            className="rounded-full border border-emerald-300/25 bg-emerald-300/[0.07] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300/70"
            data-testid="edge-report-free-badge"
          >
            {t("wc.edgeReport.badge.free")}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loadState === "loading" && (
        <div
          className="flex items-center gap-2 py-4 text-white/40"
          data-testid="edge-report-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-xs">{t("wc.edgeReport.loading")}</span>
        </div>
      )}

      {/* Error state */}
      {loadState === "error" && (
        <p
          className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-xs text-rose-300"
          data-testid="edge-report-error"
        >
          {t("wc.edgeReport.error")}
        </p>
      )}

      {/* Loaded — deterministic sections */}
      {loadState === "loaded" && reportData && (
        <>
          {reportData.report.noEntry ? (
            <p
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50"
              data-testid="edge-report-no-entry"
            >
              {t("wc.edgeReport.noEntry")}
            </p>
          ) : (
            <div className="space-y-2" data-testid="edge-report-sections">
              <SectionRow
                sectionKey="matchThatMatters"
                label={t("wc.edgeReport.section.matchThatMatters")}
                section={reportData.report.sections.matchThatMatters}
              />
              <SectionRow
                sectionKey="rootFor"
                label={t("wc.edgeReport.section.rootFor")}
                section={reportData.report.sections.rootFor}
              />
              <SectionRow
                sectionKey="threats"
                label={t("wc.edgeReport.section.threats")}
                section={reportData.report.sections.threats}
              />
              <SectionRow
                sectionKey="bestPath"
                label={t("wc.edgeReport.section.bestPath")}
                section={reportData.report.sections.bestPath}
              />
              <SectionRow
                sectionKey="mistakeToAvoid"
                label={t("wc.edgeReport.section.mistakeToAvoid")}
                section={reportData.report.sections.mistakeToAvoid}
              />
            </div>
          )}

          {/* ── Coaching section ─────────────────────────────────────────── */}
          <div
            className="border-t border-white/8 pt-4"
            data-testid="edge-report-coaching-section"
          >
            {/* Coaching loaded */}
            {coachingState === "loaded" && coachingData && (
              <CoachingBlock
                coaching={coachingData}
                billingInfo={coachingBilling}
                challengeId={challengeId}
                isCommissioner={isCommissioner}
                isPostingToChat={isPostingToChat}
                onPostToChat={handlePostToChat}
                t={t}
              />
            )}

            {/* Coaching loading */}
            {coachingState === "loading" && (
              <div
                className="flex items-center gap-2 py-2 text-white/40"
                data-testid="edge-report-coaching-loading"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                <span className="text-xs">{t("wc.edgeReport.coaching.loading")}</span>
              </div>
            )}

            {/* Coaching error */}
            {coachingState === "error" && (
              <p
                className="text-xs text-rose-300/80"
                data-testid="edge-report-coaching-error"
              >
                {t("wc.edgeReport.coaching.error")}
              </p>
            )}

            {/* Coaching idle — show unlock CTA */}
            {coachingState === "idle" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {aiEntitled ? (
                    <p
                      className="text-[11px] text-white/40"
                      data-testid="edge-report-coaching-included"
                    >
                      {t("wc.edgeReport.coaching.includedLabel")}
                    </p>
                  ) : (
                    <p
                      className="text-[11px] text-white/40"
                      data-testid="edge-report-coaching-free-hint"
                    >
                      {t("wc.edgeReport.coaching.unlockBtn")} ·{" "}
                      <span className="text-amber-300/70 font-bold">
                        {t("wc.edgeReport.coaching.tokenCost")}
                      </span>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void fetchCoaching(false)}
                  data-testid="edge-report-unlock-btn"
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-300/[0.07] px-3 py-1.5 text-[11px] font-bold text-white/75 transition hover:bg-cyan-300/[0.13] hover:text-white active:scale-[0.97]"
                >
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {aiEntitled
                    ? t("wc.edgeReport.badge.included")
                    : t("wc.edgeReport.coaching.unlockBtn")
                  }
                </button>
              </div>
            )}
          </div>

          {/* Freshness footer */}
          <p className="text-[10px] text-white/25" data-testid="edge-report-freshness">
            {t("wc.edgeReport.freshness")}
          </p>
        </>
      )}
    </div>
  )
}
