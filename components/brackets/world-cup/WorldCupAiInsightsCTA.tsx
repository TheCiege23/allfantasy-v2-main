"use client"

/**
 * WorldCupAiInsightsCTA
 *
 * A compact, entitlement-aware panel of AI action chips on the WC pool home tab.
 *
 * Two tiers:
 *   ai (AF Pro)          → Chimmy prompts ("Ask Chimmy", "Path to First", "Explain My Bracket")
 *   commissioner         → Card generators + text blasts (Rooting Guide, Pool Swing,
 *                          Champion Risk, Recap, Hype, Find Incomplete)
 *
 * Free users see all buttons but locked, with an upgrade link.
 *
 * Card actions call POST /api/brackets/world-cup/{challengeId}/commissioner-brain
 * and render the result inline via InsightCardView.
 *
 * Chimmy actions invoke the onOpenChimmyWithPrompt callback, which the shell
 * wires to open the Chimmy drawer with a pre-filled message.
 */

import { useState, useMemo, useCallback, useEffect } from "react"
import Link from "next/link"
import {
  Loader2,
  Lock,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
  Target,
  Users,
  RadioTower,
  Shield,
  BarChart3,
} from "lucide-react"
import { toast } from "sonner"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import type { resolveWorldCupEntitlementSummary } from "@/lib/world-cup/worldCupEntitlements"
import {
  confirmWorldCupTokenSpend,
  isWorldCupTokenConfirmationResponse,
} from "@/lib/world-cup/worldCupClientTokenConfirm"
import { InsightCardView, type InsightCard } from "./InsightCards"
import {
  trackWcCtaViewed,
  trackWcCtaClicked,
  trackWcCtaLockedClicked,
  trackWcCtaUpgradeClicked,
  trackWcCtaSuccess,
  trackWcCtaError,
  trackWcTokenConfirmOpened,
  trackWcTokenConfirmAccepted,
} from "@/lib/world-cup/worldCupCtaAnalytics"

// ─── Types ────────────────────────────────────────────────────────────────────

type EntitlementSummary = ReturnType<typeof resolveWorldCupEntitlementSummary>

export type WorldCupAiInsightsCTAProps = {
  challengeId: string
  entitlementSummary: EntitlementSummary
  selectedEntryId: string | null
  selectedEntryName: string | null
  onOpenChimmyWithPrompt: (prompt: string) => void
  onSwitchToReviewTab: () => void
}

type CardActionKey =
  | "rooting_guide_card"
  | "pool_swing_card"
  | "champion_risk_card"
  | "commissioner_recap_card"

type TextActionKey = "hype" | "preview_recap" | "at_risk"

type CTA = {
  key: string
  label: string
  description: string
  icon: React.ReactNode
  tier: "ai" | "commissioner"
  kind: "chimmy" | "tab" | "card" | "text"
  action?: CardActionKey | TextActionKey
  chimmyPrompt?: string
}

// ─── CTA definitions ─────────────────────────────────────────────────────────

function buildCtaList(
  entryName: string | null,
  t: ReturnType<typeof makeWcT>
): CTA[] {
  return [
    // ── AI/Pro tier — Chimmy prompts ─────────────────────────────────────────
    {
      key: "ask-chimmy",
      label: t("wc.cta.askChimmy"),
      description: t("wc.cta.askChimmyDesc"),
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      tier: "ai",
      kind: "chimmy",
      chimmyPrompt: t("wc.cta.askChimmyPrompt"),
    },
    {
      key: "path-to-first",
      label: t("wc.cta.pathToFirst"),
      description: t("wc.cta.pathToFirstDesc"),
      icon: <Target className="h-3.5 w-3.5" />,
      tier: "ai",
      kind: "chimmy",
      chimmyPrompt: entryName
        ? t("wc.cta.pathToFirstPrompt", { name: entryName })
        : t("wc.cta.pathToFirstPromptGeneric"),
    },
    {
      key: "explain-bracket",
      label: t("wc.cta.explainBracket"),
      description: t("wc.cta.explainBracketDesc"),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      tier: "ai",
      kind: "tab",
    },
    // ── Commissioner tier — card generators ──────────────────────────────────
    {
      key: "rooting-guide",
      label: t("wc.cta.rootingGuide"),
      description: t("wc.cta.rootingGuideDesc"),
      icon: <Trophy className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "card",
      action: "rooting_guide_card",
    },
    {
      key: "pool-swing",
      label: t("wc.cta.poolSwing"),
      description: t("wc.cta.poolSwingDesc"),
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "card",
      action: "pool_swing_card",
    },
    {
      key: "champion-risk",
      label: t("wc.cta.championRisk"),
      description: t("wc.cta.championRiskDesc"),
      icon: <Shield className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "card",
      action: "champion_risk_card",
    },
    {
      key: "commissioner-recap",
      label: t("wc.cta.commissionerRecap"),
      description: t("wc.cta.commissionerRecapDesc"),
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "text",
      action: "preview_recap",
    },
    {
      key: "post-hype",
      label: t("wc.cta.postHype"),
      description: t("wc.cta.postHypeDesc"),
      icon: <RadioTower className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "text",
      action: "hype",
    },
    {
      key: "find-incomplete",
      label: t("wc.cta.findIncomplete"),
      description: t("wc.cta.findIncompleteDesc"),
      icon: <Users className="h-3.5 w-3.5" />,
      tier: "commissioner",
      kind: "text",
      action: "at_risk",
    },
  ]
}

// ─── State helpers ────────────────────────────────────────────────────────────

type ActionResult =
  | { kind: "card"; card: InsightCard }
  | { kind: "lines"; lines: string[]; posted: boolean }

type ActionState = {
  loading: boolean
  result: ActionResult | null
  error: string | null
}

// ─── Chip subcomponent ────────────────────────────────────────────────────────

function CtaChip({
  cta,
  unlocked,
  state,
  onRun,
  onSwitchToReviewTab,
  onLockedClick,
}: {
  cta: CTA
  unlocked: boolean
  state: ActionState
  onRun: (cta: CTA) => void
  onSwitchToReviewTab: () => void
  onLockedClick?: () => void
}) {
  const isLocked = !unlocked
  const isLoading = state.loading

  const handleClick = () => {
    if (isLocked) {
      onLockedClick?.()
      return
    }
    if (cta.kind === "tab") {
      onSwitchToReviewTab()
      return
    }
    onRun(cta)
  }

  return (
    <button
      type="button"
      title={isLocked ? `Requires ${cta.tier === "ai" ? "AF Pro" : "AF Commissioner"}` : cta.description}
      onClick={handleClick}
      disabled={isLoading}
      aria-disabled={isLocked}
      data-testid={`wc-ai-cta-${cta.key}`}
      className={`
        inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold
        transition-all active:scale-[0.97]
        ${isLocked
          ? "cursor-pointer border-white/10 bg-white/[0.03] text-white/25 hover:border-white/15 hover:bg-white/[0.05]"
          : cta.tier === "commissioner"
            ? "border-amber-300/25 bg-amber-400/[0.07] text-white/75 hover:bg-amber-400/[0.13] hover:text-white disabled:opacity-50"
            : "border-cyan-300/25 bg-cyan-300/[0.07] text-white/75 hover:bg-cyan-300/[0.13] hover:text-white disabled:opacity-50"
        }
      `}
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isLocked ? (
        <Lock className="h-3 w-3 opacity-50" />
      ) : (
        cta.icon
      )}
      {cta.label}
    </button>
  )
}

// ─── Text result block ────────────────────────────────────────────────────────

function TextResultBlock({
  lines,
  posted,
}: {
  lines: string[]
  posted: boolean
}) {
  return (
    <div
      className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-2"
      data-testid="wc-ai-cta-text-result"
    >
      {posted ? (
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/70">
          Posted to pool chat
        </p>
      ) : (
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/30">
          Preview
        </p>
      )}
      <ul className="space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="text-xs leading-relaxed text-white/70">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WorldCupAiInsightsCTA({
  challengeId,
  entitlementSummary,
  selectedEntryId,
  selectedEntryName,
  onOpenChimmyWithPrompt,
  onSwitchToReviewTab,
}: WorldCupAiInsightsCTAProps) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const aiUnlocked = entitlementSummary.ai
  const commissionerUnlocked = entitlementSummary.commissioner

  const ctaList = useMemo(
    () => buildCtaList(selectedEntryName, t),
    [selectedEntryName, t]
  )

  const [actionStates, setActionStates] = useState<Record<string, ActionState>>(
    () => Object.fromEntries(ctaList.map((c) => [c.key, { loading: false, result: null, error: null }]))
  )
  const [activeResultKey, setActiveResultKey] = useState<string | null>(null)

  // Fire once on mount so we can measure CTA panel impressions vs. interactions
  useEffect(() => {
    trackWcCtaViewed({
      challengeId,
      aiUnlocked: aiUnlocked,
      commissionerUnlocked: commissionerUnlocked,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateActionState = useCallback((key: string, patch: Partial<ActionState>) => {
    setActionStates((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }))
  }, [])

  const postCommissionerBrain = useCallback(
    async (payload: Record<string, unknown>, actionKey: string): Promise<{ ok: boolean; data: Record<string, unknown>; cancelled?: boolean }> => {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/commissioner-brain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (isWorldCupTokenConfirmationResponse(res.status, data)) {
        const preview = data.preview as Record<string, unknown> | undefined
        const tokenCost = typeof preview?.tokenCost === "number" ? preview.tokenCost : undefined
        trackWcTokenConfirmOpened({ challengeId, actionKey, tokenCost })
        if (!confirmWorldCupTokenSpend(data)) {
          return { ok: false, data: { error: "Token spend was not confirmed." }, cancelled: true }
        }
        trackWcTokenConfirmAccepted({ challengeId, actionKey, tokenCost })
        return postCommissionerBrain({ ...payload, confirmTokenSpend: true }, actionKey)
      }
      return { ok: res.ok, data }
    },
    [challengeId]
  )

  const runCta = useCallback(async (cta: CTA) => {
    // Chimmy prompt — just open the chat, no API call needed
    if (cta.kind === "chimmy") {
      trackWcCtaClicked({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true })
      onOpenChimmyWithPrompt(cta.chimmyPrompt ?? t("wc.cta.askChimmyPrompt"))
      return
    }

    if (!cta.action) return

    trackWcCtaClicked({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true })
    updateActionState(cta.key, { loading: true, result: null, error: null })
    setActiveResultKey(cta.key)

    try {
      const payload: Record<string, unknown> = { action: cta.action }
      if (cta.kind === "card" && selectedEntryId) {
        payload.entryId = selectedEntryId
      }

      const { ok, data, cancelled } = await postCommissionerBrain(payload, cta.key)

      if (cancelled) {
        updateActionState(cta.key, { loading: false })
        return
      }
      if (!ok) {
        const errMsg = typeof data.error === "string" ? data.error : "Could not generate"
        updateActionState(cta.key, { loading: false, error: errMsg })
        trackWcCtaError({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true, errorMessage: errMsg })
        toast.error(errMsg)
        return
      }

      if (cta.kind === "card") {
        const card = data.card as InsightCard | undefined
        if (!card) {
          const errMsg = "No card data returned."
          updateActionState(cta.key, { loading: false, error: errMsg })
          trackWcCtaError({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true, errorMessage: errMsg })
          return
        }
        updateActionState(cta.key, { loading: false, result: { kind: "card", card } })
        trackWcCtaSuccess({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true, resultKind: "card" })
      } else {
        // text action
        const lines = Array.isArray(data.lines)
          ? (data.lines as unknown[]).filter((l): l is string => typeof l === "string")
          : []
        updateActionState(cta.key, {
          loading: false,
          result: { kind: "lines", lines, posted: data.posted === true },
        })
        trackWcCtaSuccess({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true, resultKind: "lines" })
        if (data.posted === true) {
          toast.success("Posted to pool chat.")
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Could not generate"
      updateActionState(cta.key, { loading: false, error: errMsg })
      trackWcCtaError({ sport: "world_cup", challengeId, actionKey: cta.key, tier: cta.tier, kind: cta.kind, unlocked: true, errorMessage: errMsg })
      toast.error(errMsg)
    }
  }, [challengeId, selectedEntryId, onOpenChimmyWithPrompt, updateActionState, postCommissionerBrain, t])

  const aiCtaList = ctaList.filter((c) => c.tier === "ai")
  const commissionerCtaList = ctaList.filter((c) => c.tier === "commissioner")

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 space-y-4"
      data-testid="wc-ai-insights-cta"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-300/70" aria-hidden />
          <h3 className="text-sm font-black text-white">
            {t("wc.cta.panelTitle")}
          </h3>
        </div>
        {!aiUnlocked && (
          <Link
            href="/pricing?from=wc-ai-cta&highlight=af-pro"
            className="text-[11px] font-bold text-cyan-300/60 hover:text-cyan-300 transition-colors"
            onClick={() => trackWcCtaUpgradeClicked({ challengeId, tier: "ai", source: "panel_header" })}
          >
            Unlock All →
          </Link>
        )}
      </div>

      {/* AI / Pro row */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/30">
            {t("wc.cta.aiRowLabel")}
          </span>
          {!aiUnlocked && (
            <Link
              href="/pricing?from=wc-ai-cta-row&highlight=af-pro"
              className="inline-flex items-center gap-0.5 rounded-full border border-cyan-400/25 bg-cyan-400/[0.07] px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-cyan-300/70 transition hover:text-cyan-300"
              data-testid="wc-ai-cta-upgrade-ai"
              onClick={() => trackWcCtaUpgradeClicked({ challengeId, tier: "ai", source: "row_label" })}
            >
              <Lock className="h-2.5 w-2.5" />
              AF Pro
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2" data-testid="wc-ai-cta-ai-chips">
          {aiCtaList.map((cta) => (
            <CtaChip
              key={cta.key}
              cta={cta}
              unlocked={aiUnlocked}
              state={actionStates[cta.key] ?? { loading: false, result: null, error: null }}
              onRun={runCta}
              onSwitchToReviewTab={onSwitchToReviewTab}
              onLockedClick={() => trackWcCtaLockedClicked({ challengeId, actionKey: cta.key, tier: cta.tier })}
            />
          ))}
        </div>
      </div>

      {/* Commissioner row */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/30">
            {t("wc.cta.commissionerRowLabel")}
          </span>
          {!commissionerUnlocked && (
            <Link
              href="/pricing?from=wc-ai-cta-commissioner-row&highlight=af-commissioner"
              className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/25 bg-amber-400/[0.07] px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-amber-300/70 transition hover:text-amber-300"
              data-testid="wc-ai-cta-upgrade-commissioner"
              onClick={() => trackWcCtaUpgradeClicked({ challengeId, tier: "commissioner", source: "row_label" })}
            >
              <Lock className="h-2.5 w-2.5" />
              AF Commissioner
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2" data-testid="wc-ai-cta-commissioner-chips">
          {commissionerCtaList.map((cta) => (
            <CtaChip
              key={cta.key}
              cta={cta}
              unlocked={commissionerUnlocked}
              state={actionStates[cta.key] ?? { loading: false, result: null, error: null }}
              onRun={runCta}
              onSwitchToReviewTab={onSwitchToReviewTab}
              onLockedClick={() => trackWcCtaLockedClicked({ challengeId, actionKey: cta.key, tier: cta.tier })}
            />
          ))}
        </div>
      </div>

      {/* Active result */}
      {activeResultKey && actionStates[activeResultKey] ? (() => {
        const { result, error, loading } = actionStates[activeResultKey]
        if (loading) return null
        if (error) {
          return (
            <p
              className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-xs text-rose-300"
              data-testid="wc-ai-cta-result-error"
            >
              {error}
            </p>
          )
        }
        if (!result) return null
        if (result.kind === "card") {
          return (
            <div data-testid="wc-ai-cta-card-result">
              <InsightCardView card={result.card} />
            </div>
          )
        }
        return <TextResultBlock lines={result.lines} posted={result.posted} />
      })() : null}
    </div>
  )
}
