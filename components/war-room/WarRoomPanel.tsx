'use client'

import React, { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw, Sparkles } from 'lucide-react'
import type { LiveDraftBrainInput } from '@/lib/live-draft-brain'
import type { WarRoomIntelligenceResult } from '@/lib/war-room/draft-intelligence-engine'
import type { WarRoomNarrativeLayer } from '@/lib/war-room/war-room-narrative'
import { buildDemoLiveBrainInput } from '@/lib/war-room/demo-board-seed'
import { WAR_ROOM_STRATEGY_OPTIONS } from '@/lib/war-room/strategy-mode-map'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { DraftHelperCopilot } from '@/components/app/draft-room/DraftHelperCopilot'
import { DraftHelperIntelligence } from '@/components/app/draft-room/DraftHelperIntelligence'
import { cn } from '@/lib/utils'
import { WarRoomTierBoard } from './WarRoomTierBoard'
import { WarRoomQueue } from './WarRoomQueue'
import { WarRoomCompareModal } from './WarRoomCompareModal'
import { PlayerOutlookDrawer } from './PlayerOutlookDrawer'
import { WarRoomContingencyCard } from './WarRoomContingencyCard'
import { WarRoomManagerIntel } from './WarRoomManagerIntel'
import { PostDraftReportModal } from './PostDraftReportModal'
import {
  openDraftFromEmbeddedLeague,
  parseLeagueDraftNavigationIntent,
  postOpenDraftOverlayMessage,
} from '@/lib/dashboard/dashboard-draft-overlay-bridge'

export type DraftCompanionCopilotProps = Partial<ComponentProps<typeof DraftHelperCopilot>>

export type WarRoomPanelProps = {
  leagueId: string
  sport: string
  draftSessionId?: string | null
  /**
   * When true, uses a small demo player pool so recommendations render without a live draft client.
   * When false, pass `brainInput` with `available` from your draft room for real intel.
   */
  useDemoBoard?: boolean
  /** Merge into the live brain payload (e.g. full `available` from draft sync). */
  brainInput?: Partial<LiveDraftBrainInput> | null
  /** When true, request optional OpenAI voice layer (deterministic scores unchanged). */
  includeNarrative?: boolean
  className?: string
  /**
   * When `active`, shows Draft Copilot + Draft Intelligence strips (same building blocks as the draft-room helper).
   * Omit or use `active: false` after the draft completes.
   */
  companionDraft?: { active: boolean; draftRoomHref?: string }
  /** Optional live copilot payload from the draft room; without it, users see a CTA into the draft room. */
  draftCompanionCopilot?: DraftCompanionCopilotProps | null
  /** Optional AI feature + headlines/injuries feed for `DraftHelperIntelligence`. */
  draftCompanionIntelligence?: ComponentProps<typeof DraftHelperIntelligence> | null
  /** Server / hook-driven empty state when copilot has no primary pick (not on clock, auction, etc.). */
  draftCopilotEmptyMessage?: string | null
  /** First-load or polling refresh from league draft companion hook. */
  draftCompanionDataLoading?: boolean
  /** Manual resync (league tab) — session, pool, intel, and copilot when on the clock. */
  onDraftCompanionRefresh?: () => void
  /** Dashboard iframe — intercept draft room links for parent overlay */
  dashboardEmbed?: boolean
}

function mergeBrainPayload(
  demo: LiveDraftBrainInput,
  partial: Partial<LiveDraftBrainInput> | null | undefined
): LiveDraftBrainInput {
  if (!partial) return demo
  return {
    ...demo,
    ...partial,
    context: { ...demo.context, ...partial.context },
    myTeam: partial.myTeam ?? demo.myTeam,
    available: partial.available && partial.available.length > 0 ? partial.available : demo.available,
    mode: partial.mode ?? demo.mode,
  }
}

/**
 * War Room command center — session bootstrap, strategy mode, live draft intelligence API.
 */
export function WarRoomPanel({
  leagueId,
  sport,
  draftSessionId: draftSessionIdProp,
  useDemoBoard = true,
  brainInput,
  includeNarrative = false,
  className = '',
  companionDraft,
  draftCompanionCopilot = null,
  draftCompanionIntelligence = null,
  draftCopilotEmptyMessage = null,
  draftCompanionDataLoading = false,
  onDraftCompanionRefresh,
  dashboardEmbed = false,
}: WarRoomPanelProps) {
  const resolvedSport = (normalizeToSupportedSport(sport) ?? 'NFL') as SupportedSport
  const [copilotSectionOpen, setCopilotSectionOpen] = useState(true)
  const [intelligenceSectionOpen, setIntelligenceSectionOpen] = useState(true)
  const [compareOpen, setCompareOpen] = useState(false)
  const [outlookOpen, setOutlookOpen] = useState(false)
  const [postDraftOpen, setPostDraftOpen] = useState(false)

  const [sessionId, setSessionId] = useState<string | null>(draftSessionIdProp ?? null)
  const [strategyMode, setStrategyMode] = useState<string>('balanced')
  const [intel, setIntel] = useState<WarRoomIntelligenceResult | null>(null)
  const [narrative, setNarrative] = useState<WarRoomNarrativeLayer | null>(null)
  const [recommendLogId, setRecommendLogId] = useState<string | null>(null)
  const [telemetryBusy, setTelemetryBusy] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [loadingIntel, setLoadingIntel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (draftSessionIdProp) setSessionId(draftSessionIdProp)
  }, [draftSessionIdProp])

  const loadSession = useCallback(async () => {
    setLoadingSession(true)
    setError(null)
    try {
      const res = await fetch('/api/war-room/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, createIfMissing: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Session failed')
        return
      }
      if (typeof data.draftSessionId === 'string') setSessionId(data.draftSessionId)
      if (typeof data.defaultStrategyMode === 'string') {
        setStrategyMode(data.defaultStrategyMode)
      }
    } catch {
      setError('Network error loading session')
    } finally {
      setLoadingSession(false)
    }
  }, [leagueId])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const recommendPayload = useMemo((): LiveDraftBrainInput | null => {
    const hasLive = Boolean(brainInput?.available && brainInput.available.length > 0)
    if (!hasLive && !useDemoBoard) return null
    const demo = buildDemoLiveBrainInput({
      leagueId,
      sport: resolvedSport,
      strategyMode,
    })
    if (hasLive) return mergeBrainPayload(demo, brainInput)
    return demo
  }, [brainInput, leagueId, resolvedSport, strategyMode, useDemoBoard])

  const loadIntel = useCallback(async () => {
    if (!recommendPayload) {
      setError('Connect live draft data (available players) or enable demo board.')
      return
    }
    setLoadingIntel(true)
    setError(null)
    try {
      const res = await fetch('/api/war-room/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          draftSessionId: sessionId,
          strategyMode,
          includeNarrative,
          ...recommendPayload,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Recommend failed')
        return
      }
      if (data.intelligence) {
        setIntel(data.intelligence as WarRoomIntelligenceResult)
      }
      setNarrative((data.narrative as WarRoomNarrativeLayer | null) ?? null)
      setRecommendLogId(typeof data.logId === 'string' ? data.logId : null)
    } catch {
      setError('Network error')
    } finally {
      setLoadingIntel(false)
    }
  }, [includeNarrative, leagueId, recommendPayload, sessionId, strategyMode])

  const sendTelemetry = useCallback(
    async (accepted: boolean) => {
      if (!recommendLogId || telemetryBusy) return
      setTelemetryBusy(true)
      try {
        await fetch('/api/war-room/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            logId: recommendLogId,
            leagueId,
            accepted,
            pickedPlayerName: intel?.pickNow.playerName,
          }),
        })
      } finally {
        setTelemetryBusy(false)
      }
    },
    [intel?.pickNow.playerName, leagueId, recommendLogId, telemetryBusy],
  )

  useEffect(() => {
    if (recommendPayload) void loadIntel()
  }, [recommendPayload, loadIntel])

  const confWidth = intel ? `${intel.confidencePct}%` : '0%'

  const copilotHasPlayer = Boolean(draftCompanionCopilot?.recommendation?.player?.name)
  const companionActive = Boolean(companionDraft?.active)

  return (
    <section
      className={`space-y-3 rounded-xl border border-cyan-500/15 bg-[#040915]/80 p-3 ${className}`}
      data-testid="war-room-ai-panel"
    >
      {companionActive ? (
        <div
          className="space-y-2 rounded-xl border border-violet-500/25 bg-[linear-gradient(180deg,rgba(76,29,149,0.12),rgba(4,9,21,0.95))] p-3"
          data-testid="war-room-live-draft-companion"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-200/85">Live draft companion</p>
              <p className="text-[11px] text-white/45">
                Same surfaces as the draft-room helper — copilot + intelligence while your draft is live.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {onDraftCompanionRefresh ? (
                <button
                  type="button"
                  onClick={() => onDraftCompanionRefresh()}
                  disabled={draftCompanionDataLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="war-room-companion-refresh"
                  title="Refresh draft board, intelligence, and copilot"
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', draftCompanionDataLoading && 'animate-spin')}
                    aria-hidden
                  />
                  Refresh
                </button>
              ) : null}
              {companionDraft?.draftRoomHref ? (
                <Link
                  href={companionDraft.draftRoomHref}
                  className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                  data-testid="war-room-enter-draft-room"
                  onClick={(e) => void handleDraftRoomLinkClick(e, companionDraft.draftRoomHref ?? '')}
                >
                  Enter draft room
                </Link>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-[#050c1d]/90">
            <button
              type="button"
              onClick={() => setCopilotSectionOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-white/[0.04]"
              aria-expanded={copilotSectionOpen}
              data-testid="war-room-draft-copilot-toggle"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-violet-300/90" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">Draft Copilot</span>
              </span>
              {copilotSectionOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
              )}
            </button>
            {copilotSectionOpen ? (
              <div
                className={cn('border-t border-white/8 px-2 py-2', copilotHasPlayer ? '' : 'pb-3')}
                data-testid="war-room-draft-copilot-section"
              >
                {copilotHasPlayer ? (
                  <DraftHelperCopilot
                    loading={draftCompanionCopilot?.loading ?? false}
                    recommendation={draftCompanionCopilot?.recommendation ?? null}
                    alternatives={draftCompanionCopilot?.alternatives ?? []}
                    onRefresh={draftCompanionCopilot?.onRefresh ?? (() => {})}
                    onPlayerClick={draftCompanionCopilot?.onPlayerClick}
                    explanation={draftCompanionCopilot?.explanation ?? ''}
                    evidence={draftCompanionCopilot?.evidence ?? []}
                    caveats={draftCompanionCopilot?.caveats ?? []}
                    round={draftCompanionCopilot?.round ?? 1}
                    pick={draftCompanionCopilot?.pick ?? 1}
                    sport={draftCompanionCopilot?.sport ?? resolvedSport}
                  />
                ) : (
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-center">
                    {draftCompanionDataLoading ? (
                      <p className="text-[11px] text-white/55">Syncing draft board and copilot…</p>
                    ) : (
                      <>
                        <p className="text-[11px] text-white/55">
                          {draftCopilotEmptyMessage ??
                            'Live Chimmy recommendations and alternates run in the draft room. Open the room to sync the full copilot, or use the War Room engine below with demo or connected board data.'}
                        </p>
                        {companionDraft?.draftRoomHref ? (
                          <Link
                            href={companionDraft.draftRoomHref}
                            className="mt-2 inline-flex text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                            onClick={(e) => void handleDraftRoomLinkClick(e, companionDraft.draftRoomHref ?? '')}
                          >
                            Go to draft room →
                          </Link>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-[#050c1d]/90">
            <button
              type="button"
              onClick={() => setIntelligenceSectionOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-white/[0.04]"
              aria-expanded={intelligenceSectionOpen}
              data-testid="war-room-draft-intelligence-toggle"
            >
              <span className="flex min-w-0 items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-300/90" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">Draft Intelligence</span>
              </span>
              {intelligenceSectionOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
              )}
            </button>
            {intelligenceSectionOpen ? (
              <div className="border-t border-white/8 px-1 py-2" data-testid="war-room-draft-intelligence-section">
                <DraftHelperIntelligence
                  aiFeatureStatus={draftCompanionIntelligence?.aiFeatureStatus}
                  sportsFeed={draftCompanionIntelligence?.sportsFeed}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/70">War Room AI</p>
          <p className="text-[11px] text-white/45">
            Live pick engine · tiers · scarcity · stacks · contingencies · take vs wait
            {useDemoBoard && !brainInput?.available?.length ? (
              <span className="ml-1 text-amber-200/80">· demo board</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={strategyMode}
            onChange={(e) => setStrategyMode(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#0a1228] px-2 py-1 text-[10px] text-white/90"
            data-testid="war-room-strategy-select"
            aria-label="Draft strategy mode"
          >
            {WAR_ROOM_STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadIntel()}
            disabled={loadingIntel || !recommendPayload}
            className="rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
            data-testid="war-room-refresh-intel"
          >
            {loadingIntel ? 'Updating…' : 'Refresh intel'}
          </button>
        </div>
      </div>

      {loadingSession && <p className="text-[10px] text-white/40">Loading draft session…</p>}
      {error && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100/90">
          {error}
        </p>
      )}

      {intel && (
        <div className="space-y-2 rounded-xl border border-white/8 bg-[#060d1e]/80 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Pick now</p>
              <p className="text-sm font-semibold text-white">
                {intel.pickNow.playerName}{' '}
                <span className="text-white/50">
                  {intel.pickNow.position} · {intel.pickNow.team}
                </span>
              </p>
              <p className="text-[10px] text-cyan-200/70">
                Mode: {intel.strategyMode.brainMode}
                {intel.strategyMode.requested ? ` · requested: ${intel.strategyMode.requested}` : ''}
              </p>
            </div>
            <div className="min-w-[120px] flex-1">
              <p className="text-[9px] uppercase tracking-wider text-white/35">Confidence</p>
              <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-cyan-500/70 transition-all" style={{ width: confWidth }} />
              </div>
              <p className="mt-0.5 text-[10px] text-white/50">{intel.confidencePct}%</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: 'Best value', p: intel.bestValue },
              { k: 'Best fit', p: intel.bestFit },
              { k: 'Best upside', p: intel.bestUpside },
              { k: 'Safest', p: intel.bestSafePick },
            ].map((row) => (
              <div key={row.k} className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-white/40">{row.k}</p>
                <p className="text-[11px] font-medium text-white/90">{row.p.playerName}</p>
                <p className="text-[10px] text-white/45">
                  {row.p.position} · {row.p.recommendationType}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/40">Take vs wait</p>
            <p className="text-[11px] text-cyan-100/90">{intel.takeVsWait.headline}</p>
            <ul className="mt-1 list-inside list-disc text-[10px] text-white/55">
              {intel.takeVsWait.bullets.map((b) => (
                <li key={b.slice(0, 24)}>{b}</li>
              ))}
            </ul>
          </div>

          {narrative?.body ? (
            <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2 py-1.5" data-testid="war-room-narrative">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-cyan-200/50">Chimmy voice</p>
              <p className="mt-0.5 text-[11px] text-white/80">{narrative.body}</p>
            </div>
          ) : null}

          {recommendLogId ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={telemetryBusy}
                onClick={() => void sendTelemetry(true)}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
                data-testid="war-room-telemetry-accept"
              >
                Aligns with my plan
              </button>
              <button
                type="button"
                disabled={telemetryBusy}
                onClick={() => void sendTelemetry(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/75 hover:bg-white/10 disabled:opacity-40"
                data-testid="war-room-telemetry-ignore"
              >
                Going another direction
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-2">
        <WarRoomTierBoard sport={sport} tierBoard={intel?.tierBoard} scarcity={intel?.scarcityAlerts} />
        <WarRoomQueue leagueId={leagueId} draftSessionId={sessionId} />
      </div>

      <WarRoomContingencyCard plans={intel?.contingencyPlans} stacks={intel?.stackOpportunities} rosterBuild={intel?.rosterBuild} />

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCompareOpen(true)}
          className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
          data-testid="war-room-open-compare"
        >
          Compare
        </button>
        <button
          type="button"
          onClick={() => setOutlookOpen(true)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/85 hover:bg-white/10"
          data-testid="war-room-open-outlook"
        >
          Outlook
        </button>
        <button
          type="button"
          onClick={() => setPostDraftOpen(true)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/85 hover:bg-white/10"
          data-testid="war-room-open-post-draft"
        >
          Post-draft
        </button>
      </div>

      <WarRoomManagerIntel leagueId={leagueId} />

      <WarRoomCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        leagueId={leagueId}
        sport={sport}
        draftSessionId={sessionId}
      />
      <PlayerOutlookDrawer
        open={outlookOpen}
        onClose={() => setOutlookOpen(false)}
        leagueId={leagueId}
        sport={sport}
      />
      <PostDraftReportModal open={postDraftOpen} onClose={() => setPostDraftOpen(false)} leagueId={leagueId} />
    </section>
  )
}
