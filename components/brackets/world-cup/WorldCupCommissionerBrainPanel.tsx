"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Lock, Send, Settings, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import {
  confirmWorldCupTokenSpend,
  isWorldCupTokenConfirmationResponse,
} from "@/lib/world-cup/worldCupClientTokenConfirm"
import WorldCupLeagueEventFeed from "./WorldCupLeagueEventFeed"
import WorldCupCommissionerChecklistCard from "./WorldCupCommissionerChecklistCard"
import { InsightCardView, type InsightCard } from "./InsightCards"

type Snapshot = {
  incompleteBracketCount: number
  completedBracketCount: number
  totalEntries: number
  totalMissingPicks: number
  maxEntriesPerParticipant: number
  lockCountdownMs: number | null
  effectiveLockAt: string | null
  isLocked: boolean
  mostPopularChampion: { teamName: string; count: number } | null
  mostUniqueLean: string | null
  usersMaxedEntries: number
  biggestUpsetLean: string | null
  usersWithIncompleteBrackets: Array<{
    userId: string
    displayName: string
    incompleteEntryCount: number
    missingPicks: number
  }>
  entriesMissingPicks: Array<{
    entryId: string
    entryName: string
    missingPicks: number
    userId: string
  }>
}

type CommissionerPrefs = {
  enableSystemEvents: boolean
  enableAiSummaries: boolean
  enableUpsetAlerts: boolean
  enableLeaderboardAlerts: boolean
  enableChampionBustAlerts: boolean
  enableLockReminders: boolean
}

type RecapTone = "fun" | "serious" | "hype"

type BrainAction =
  | "hype"
  | "standings"
  | "watch"
  | "recap"
  | "drama_recap"
  | "chalk_bust"
  | "match_swing"
  | "trash_talk"
  | "at_risk"
  | "social_invite"
  | "quiet_pool"
  | "tomorrow_hype"

type CardAction = "pool_swing_card" | "rooting_guide_card" | "champion_risk_card" | "commissioner_recap_card"

type BrainActionResult = {
  action: BrainAction
  lines: string[]
  posted: boolean
  proLocked?: boolean
}

type BrainPostResult = {
  ok: boolean
  data: Record<string, any>
  cancelled?: boolean
}

export default function WorldCupCommissionerBrainPanel({
  challengeId,
  hasAfCommissioner,
  onOpenLeagueSettings,
  poolName,
  poolUrl,
}: {
  challengeId: string
  hasAfCommissioner?: boolean
  onOpenLeagueSettings?: () => void
  /** Pool display name — used by the checklist's reminder copy. */
  poolName?: string
  /** Public pool URL — used by the checklist's reminder copy. */
  poolUrl?: string | null
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<CommissionerPrefs | null>(null)
  const [hasAi, setHasAi] = useState(Boolean(hasAfCommissioner))
  const [bracketBrainEnabled, setBracketBrainEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aiReminderPolish, setAiReminderPolish] = useState(false)
  const [recapTone, setRecapTone] = useState<RecapTone>("fun")
  const [recapLines, setRecapLines] = useState<string[]>([])
  const [brainActionResult, setBrainActionResult] = useState<BrainActionResult | null>(null)
  const [insightCard, setInsightCard] = useState<InsightCard | null>(null)
  const [cardBusy, setCardBusy] = useState<CardAction | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/commissioner-brain`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSnapshot(data.snapshot ?? null)
        setSettings(data.settings ?? null)
        setHasAi(Boolean(data.hasBracketBrainAi || data.hasAfCommissioner || hasAfCommissioner))
        setBracketBrainEnabled(data.bracketBrainEnabled !== false)
        return
      }
      setLoadError(data.error || t("wc.brain.loadError"))
    } catch {
      setLoadError(t("wc.brain.loadError"))
    } finally {
      setLoading(false)
    }
  }, [challengeId, hasAfCommissioner, t])

  useEffect(() => {
    void reload()
  }, [reload])

  async function postCommissionerBrain(payload: Record<string, unknown>): Promise<BrainPostResult> {
    const res = await fetch(`/api/brackets/world-cup/${challengeId}/commissioner-brain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (isWorldCupTokenConfirmationResponse(res.status, data)) {
      if (!confirmWorldCupTokenSpend(data)) {
        return {
          ok: false,
          data: { error: "Token spend was not confirmed." },
          cancelled: true,
        }
      }
      return postCommissionerBrain({ ...payload, confirmTokenSpend: true })
    }
    return { ok: res.ok, data }
  }

  async function runBrain(action: BrainAction) {
    if (!bracketBrainEnabled) {
      toast.error("Bracket Brain is disabled — turn it on under Pool settings.")
      return
    }
    setBusy(action)
    setBrainActionResult(null)
    try {
      const { ok, data, cancelled } = await postCommissionerBrain({
        action,
        round: action === "recap" ? "round_of_16" : undefined,
        tone: action === "drama_recap" ? recapTone : undefined,
      })
      if (!ok) {
        toast[cancelled ? "info" : "error"](data.error || "Could not generate")
        return
      }
      const lines = Array.isArray(data.lines) ? data.lines.filter((line: unknown): line is string => typeof line === "string") : []
      setBrainActionResult({
        action,
        lines,
        posted: data.posted === true,
        proLocked: data.proLocked === true,
      })
      toast.success(data.proLocked === true ? "Limited preview generated." : data.posted === true ? "Posted to pool chat." : "Generated.")
      if (data.posted === true) void reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate")
    } finally {
      setBusy(null)
    }
  }

  async function sendIncompleteReminder() {
    setBusy("inc-reminder")
    try {
      const res = await fetch(
        `/api/brackets/world-cup/${challengeId}/commissioner-brain/send-reminder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: "incomplete",
            useAi: Boolean(hasAi && aiReminderPolish),
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Could not send reminder")
        return
      }
      toast.success("Reminder posted to pool activity.")
      void reload()
    } finally {
      setBusy(null)
    }
  }

  async function sendBroadcastReminder() {
    setBusy("broadcast-reminder")
    try {
      const res = await fetch(
        `/api/brackets/world-cup/${challengeId}/commissioner-brain/send-reminder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: "broadcast",
            useAi: Boolean(hasAi && aiReminderPolish),
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Could not send reminder")
        return
      }
      toast.success("Pool reminder posted.")
      void reload()
    } finally {
      setBusy(null)
    }
  }

  async function runCardAction(action: CardAction) {
    if (!bracketBrainEnabled) {
      toast.error("Bracket Brain is disabled — turn it on under Pool settings.")
      return
    }
    setCardBusy(action)
    setInsightCard(null)
    try {
      const { ok, data, cancelled } = await postCommissionerBrain({ action })
      if (!ok) {
        toast[cancelled ? "info" : "error"](data.error || "Could not generate card")
        return
      }
      if (data.card) {
        setInsightCard(data.card as InsightCard)
        toast.success("Insight card generated.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate card")
    } finally {
      setCardBusy(null)
    }
  }

  async function postCardNarrativeToChat(text: string) {
    try {
      // post_recap with explicit lines posts immediately without re-generating
      const { ok, data, cancelled } = await postCommissionerBrain({
        action: "post_recap",
        lines: [text],
      })
      if (!ok) {
        toast[cancelled ? "info" : "error"](data.error || "Could not post to chat")
        return
      }
      toast.success("Posted to pool chat.")
      void reload()
    } catch {
      toast.error("Could not post to chat")
    }
  }

  async function generateRecapPreview() {
    if (!bracketBrainEnabled) {
      toast.error("Bracket Brain is disabled — turn it on under Pool settings.")
      return
    }
    setBusy("preview-recap")
    try {
      const { ok, data, cancelled } = await postCommissionerBrain({
        action: "preview_recap",
        tone: recapTone,
      })
      if (!ok) {
        toast[cancelled ? "info" : "error"](data.error || "Could not generate recap preview")
        return
      }
      setRecapLines(Array.isArray(data.lines) ? data.lines : [])
      toast.success("AI recap preview ready.")
    } finally {
      setBusy(null)
    }
  }

  async function postRecapToChat() {
    if (recapLines.length === 0) {
      toast.info("Generate a recap preview first.")
      return
    }
    setBusy("post-recap")
    try {
      const { ok, data, cancelled } = await postCommissionerBrain({
        action: "post_recap",
        tone: recapTone,
        lines: recapLines,
      })
      if (!ok) {
        toast[cancelled ? "info" : "error"](data.error || "Could not post recap")
        return
      }
      toast.success("AI recap posted to pool chat.")
      setRecapLines([])
      void reload()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("wc.brain.loading")}
      </div>
    )
  }

  if (loadError || !snapshot || !settings) {
    return (
      <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-white/85">
        <p className="font-bold">Commissioner tools could not load.</p>
        <p className="mt-1 text-xs text-white/60">
          {loadError ?? "The server returned an incomplete commissioner response."}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-3 rounded-lg border border-rose-200/25 bg-white/10 px-3 py-1.5 text-xs font-bold text-white"
        >
          Try again
        </button>
      </div>
    )
  }

  const lockLabel =
    snapshot.lockCountdownMs != null && snapshot.lockCountdownMs > 0
      ? `${Math.max(0, Math.round(snapshot.lockCountdownMs / 3600000))}h to lock`
      : snapshot.isLocked
        ? "Locked"
        : "Lock TBD"

  const lockLocal =
    snapshot.effectiveLockAt != null
      ? new Date(snapshot.effectiveLockAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—"

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <Sparkles className="h-4 w-4 text-white/85" />
          Bracket Brain
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/55">
          Basic lock reminders post for every commissioner. AI-enhanced Bracket Brain reports require{" "}
          <span className="font-semibold text-white/85">AF Commissioner</span> or a confirmed token spend.
        </p>
        {hasAi ? (
          <p className="mt-1 text-[11px] text-white/65">Commissioner AI access active.</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Incomplete brackets" value={String(snapshot.incompleteBracketCount)} />
        <Stat label="Completed brackets" value={String(snapshot.completedBracketCount)} />
        <Stat label="Total entries" value={String(snapshot.totalEntries)} />
        <Stat label="Picks missing (pool)" value={String(snapshot.totalMissingPicks)} />
        <Stat label="Lock countdown" value={lockLabel} />
        <Stat label="Lock time (local)" value={lockLocal} />
        <Stat
          label="Popular champion"
          value={
            snapshot.mostPopularChampion
              ? `${snapshot.mostPopularChampion.teamName} (${snapshot.mostPopularChampion.count})`
              : "—"
          }
        />
        <Stat
          label="Biggest swing (heuristic)"
          value={snapshot.biggestUpsetLean ?? "—"}
        />
        <Stat label="Max entries used (users)" value={String(snapshot.usersMaxedEntries)} />
      </div>

      <WorldCupCommissionerChecklistCard
        snapshot={snapshot}
        poolName={poolName ?? "this pool"}
        poolUrl={poolUrl ?? null}
        lockDeadlineLabel={lockLocal !== "—" ? lockLocal : null}
        isCommissioner
      />

      {(snapshot.usersWithIncompleteBrackets.length > 0 ||
        snapshot.entriesMissingPicks.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {snapshot.usersWithIncompleteBrackets.length > 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
                Users with incomplete brackets
              </p>
              <ul className="mt-1 space-y-1 text-[11px] text-white/70">
                {snapshot.usersWithIncompleteBrackets.slice(0, 8).map((u) => (
                  <li key={u.userId}>
                    {u.displayName} · {u.incompleteEntryCount}{" "}
                    {u.incompleteEntryCount === 1 ? "entry" : "entries"} · ~{u.missingPicks} picks
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {snapshot.entriesMissingPicks.length > 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
                Entries missing picks
              </p>
              <ul className="mt-1 space-y-1 text-[11px] text-white/70">
                {snapshot.entriesMissingPicks.slice(0, 10).map((e) => (
                  <li key={e.entryId}>
                    {e.entryName} · missing {e.missingPicks}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {hasAi ? (
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
          <input
            type="checkbox"
            checked={aiReminderPolish}
            onChange={(ev) => setAiReminderPolish(ev.target.checked)}
            className="h-3.5 w-3.5 accent-cyan-400"
          />
          Use AI-enhanced reminder copy (Bracket Brain)
        </label>
      ) : null}

      {/* ── Reminders & classic tools ── */}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <BrainButton
          disabled={
            busy !== null ||
            snapshot.isLocked ||
            snapshot.incompleteBracketCount === 0
          }
          loading={busy === "inc-reminder"}
          onClick={() => void sendIncompleteReminder()}
          icon={<Send className="h-3.5 w-3.5" />}
        >
          Remind Incomplete Brackets
        </BrainButton>
        <BrainButton
          disabled={busy !== null || snapshot.isLocked}
          loading={busy === "broadcast-reminder"}
          onClick={() => void sendBroadcastReminder()}
        >
          Broadcast Pool Reminder
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "hype"}
          onClick={() => void runBrain("hype")}
        >
          Generate Hype
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "standings"}
          onClick={() => void runBrain("standings")}
        >
          Summarize Standings
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "watch"}
          onClick={() => void runBrain("watch")}
        >
          What To Watch
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "recap"}
          onClick={() => void runBrain("recap")}
        >
          Post Round Recap
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "drama_recap"}
          onClick={() => void runBrain("drama_recap")}
        >
          Pool Drama Recap
        </BrainButton>
      </div>

      {/* ── Proactive Insights (new) ── */}
      <section className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-300/70" />
          <h3 className="text-sm font-black text-white">Proactive Insights</h3>
          <span className="ml-auto rounded-full border border-violet-300/25 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/70">
            {hasAi ? "AI active" : "AF Commissioner"}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-white/50">
          Generate ready-to-post messages, alerts, and narratives. Each result posts directly to pool chat.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <InsightButton
            label="Chalk Bust Alert"
            description="Who's riding the chalk pick — and what happens if they get knocked out"
            loading={busy === "chalk_bust"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("chalk_bust")}
          />
          <InsightButton
            label="Match Swing Report"
            description="The upcoming match with the biggest leaderboard impact"
            loading={busy === "match_swing"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("match_swing")}
          />
          <InsightButton
            label="Trash Talk Prompt"
            description="Playful group chat fire-starter based on real pool dynamics"
            loading={busy === "trash_talk"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("trash_talk")}
          />
          <InsightButton
            label="At-Risk Report"
            description="Entries falling behind — who needs results to break their way"
            loading={busy === "at_risk"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("at_risk")}
          />
          <InsightButton
            label="Engagement Nudge"
            description="Ready-to-post message to spark activity if the pool goes quiet"
            loading={busy === "quiet_pool"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("quiet_pool")}
          />
          <InsightButton
            label="Tomorrow's Hype"
            description="Tomorrow's matches and kickoff times — build pre-game energy"
            loading={busy === "tomorrow_hype"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("tomorrow_hype")}
          />
          <InsightButton
            label="Social Invite Post"
            description="Shareable post to recruit new participants before the lock"
            loading={busy === "social_invite"}
            disabled={!bracketBrainEnabled || busy !== null}
            onClick={() => void runBrain("social_invite")}
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      </section>

      {/* ── AI Insight Cards (new) ── */}
      <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-300/70" />
          <h3 className="text-sm font-black text-white">AI Insight Cards</h3>
          <span className="ml-auto rounded-full border border-amber-300/25 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/70">
            Structured
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-white/50">
          Cards built from real pool numbers — deterministic data, not hallucinated stats. AI adds one sentence of analysis.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CardInsightButton
            label="Pool Swing Alert"
            description="Upcoming match with the biggest leaderboard swing potential"
            loading={cardBusy === "pool_swing_card"}
            disabled={!bracketBrainEnabled || cardBusy !== null || busy !== null}
            onClick={() => void runCardAction("pool_swing_card")}
          />
          <CardInsightButton
            label="Rooting Guide"
            description="Who the pool leader needs to win — and what's at stake"
            loading={cardBusy === "rooting_guide_card"}
            disabled={!bracketBrainEnabled || cardBusy !== null || busy !== null}
            onClick={() => void runCardAction("rooting_guide_card")}
          />
          <CardInsightButton
            label="Champion Pick Risk"
            description="Champion pick concentration — crowded vs. contrarian"
            loading={cardBusy === "champion_risk_card"}
            disabled={!bracketBrainEnabled || cardBusy !== null || busy !== null}
            onClick={() => void runCardAction("champion_risk_card")}
          />
          <CardInsightButton
            label="Commissioner Recap"
            description="Round winner, loser, best upcoming match + suggested post"
            loading={cardBusy === "commissioner_recap_card"}
            disabled={!bracketBrainEnabled || cardBusy !== null || busy !== null}
            onClick={() => void runCardAction("commissioner_recap_card")}
          />
        </div>
      </section>

      {/* ── Active insight card display ── */}
      {insightCard ? (
        <section data-testid="world-cup-insight-card">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-wide text-white/40">
              Insight Card
            </p>
            <button
              type="button"
              onClick={() => setInsightCard(null)}
              className="text-[11px] text-white/30 hover:text-white/60"
            >
              Dismiss
            </button>
          </div>
          <InsightCardView
            card={insightCard}
            onPostToChat={(text) => void postCardNarrativeToChat(text)}
          />
        </section>
      ) : null}

      {brainActionResult ? (
        <section data-testid="world-cup-brain-action-result" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-white/60">
              Bracket Brain Result
            </p>
            <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90">
              {brainActionResult.proLocked ? "AF Pro locked preview" : brainActionResult.posted ? "Posted to pool chat" : "Preview only"}
            </span>
          </div>
          <div className="mt-2 space-y-1.5 text-xs leading-5 text-white/75">
            {brainActionResult.lines.length > 0 ? (
              brainActionResult.lines.map((line, index) => (
                <p key={`${brainActionResult.action}-${index}-${line}`}>{line}</p>
              ))
            ) : (
              <p>No copy returned by Bracket Brain.</p>
            )}
          </div>
        </section>
      ) : null}

      <section data-testid="world-cup-ai-recap-panel" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-white">
              <Sparkles className="h-4 w-4 text-white/85" />
              AI Pool Recap
            </h3>
            <p className="mt-1 text-xs leading-5 text-white/55">
              Generate a preview from finalized/public leaderboard data only, then post it to pool chat when it reads right.
            </p>
          </div>
          <span className="rounded-full border border-cyan-200/25 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-white/90">
            {hasAi ? "Commissioner AI active" : "Tokens or AF Commissioner"}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-end">
          <label className="text-[11px] font-bold uppercase tracking-wide text-white/45">
            Tone
            <select
              value={recapTone}
              onChange={(event) => setRecapTone(event.target.value as RecapTone)}
              disabled={busy !== null}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs font-bold normal-case tracking-normal text-white/80 disabled:opacity-45"
            >
              <option value="fun">Fun</option>
              <option value="serious">Serious</option>
              <option value="hype">Hype</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <BrainButton
              disabled={!bracketBrainEnabled || busy !== null}
              loading={busy === "preview-recap"}
              onClick={() => void generateRecapPreview()}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              Generate AI Recap
            </BrainButton>
            <BrainButton
              disabled={busy !== null || recapLines.length === 0}
              loading={busy === "post-recap"}
              onClick={() => void postRecapToChat()}
              icon={<Send className="h-3.5 w-3.5" />}
            >
              Post to Pool Chat
            </BrainButton>
          </div>
        </div>

        {!hasAi ? (
          <p className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/60">
            AF Commissioner unlocks advanced commissioner reports. Token users can confirm a one-off spend before generation.
          </p>
        ) : null}

        {recapLines.length > 0 ? (
          <div data-testid="world-cup-ai-recap-preview" className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-white/40">Preview</p>
            <div className="mt-2 space-y-1.5 text-xs leading-5 text-white/75">
              {recapLines.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {onOpenLeagueSettings ? (
        <button
          type="button"
          onClick={() => onOpenLeagueSettings()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 text-xs font-bold text-white/80 hover:bg-white/[0.08]"
        >
          <Settings className="h-4 w-4 text-white/80" />
          League alerts, scoring & visibility — Settings
        </button>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-black/25 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/45">
          <Lock className="h-3.5 w-3.5" />
          Activity feed
        </h3>
        <WorldCupLeagueEventFeed challengeId={challengeId} />
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  )
}

function BrainButton({
  children,
  onClick,
  disabled,
  loading,
  icon,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2.5 text-[11px] font-bold text-white/90 disabled:opacity-40 sm:min-h-0 sm:w-auto sm:justify-start sm:py-2"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}

function InsightButton({
  label,
  description,
  onClick,
  disabled,
  loading,
  className = "",
}: {
  label: string
  description: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`group flex min-h-[4.5rem] w-full flex-col items-start gap-1 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2.5 text-left transition-colors hover:border-violet-400/35 hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <span className="flex w-full items-center gap-2 text-[11px] font-bold text-white/90">
        {loading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-300" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0 text-violet-300/70 transition-colors group-hover:text-violet-300" />
        )}
        {label}
      </span>
      <span className="text-[11px] leading-snug text-white/40">{description}</span>
    </button>
  )
}

/** Amber-tinted button for structured card actions. */
function CardInsightButton({
  label,
  description,
  onClick,
  disabled,
  loading,
  className = "",
}: {
  label: string
  description: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`group flex min-h-[4.5rem] w-full flex-col items-start gap-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-left transition-colors hover:border-amber-400/35 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <span className="flex w-full items-center gap-2 text-[11px] font-bold text-white/90">
        {loading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-300" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0 text-amber-300/70 transition-colors group-hover:text-amber-300" />
        )}
        {label}
      </span>
      <span className="text-[11px] leading-snug text-white/40">{description}</span>
    </button>
  )
}

