"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Loader2, Lock, Send, Settings, Sparkles } from "lucide-react"
import { toast } from "sonner"
import WorldCupLeagueEventFeed from "./WorldCupLeagueEventFeed"

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

export default function WorldCupCommissionerBrainPanel({
  challengeId,
  onOpenLeagueSettings,
}: {
  challengeId: string
  onOpenLeagueSettings?: () => void
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<CommissionerPrefs | null>(null)
  const [hasAi, setHasAi] = useState(false)
  const [bracketBrainEnabled, setBracketBrainEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [aiReminderPolish, setAiReminderPolish] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/commissioner-brain`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSnapshot(data.snapshot ?? null)
        setSettings(data.settings ?? null)
        setHasAi(Boolean(data.hasBracketBrainAi))
        setBracketBrainEnabled(data.bracketBrainEnabled !== false)
      }
    } finally {
      setLoading(false)
    }
  }, [challengeId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runBrain(action: "hype" | "standings" | "watch" | "recap") {
    if (!bracketBrainEnabled) {
      toast.error("Bracket Brain is disabled — turn it on under League settings.")
      return
    }
    if (!hasAi) {
      toast.info("Upgrade to AF Pro to generate Bracket Brain messages.")
      return
    }
    setBusy(action)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/commissioner-brain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          round: action === "recap" ? "round_of_16" : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Could not generate")
        return
      }
      toast.success((data.lines as string[])?.slice(0, 2).join(" · ") ?? "Generated.")
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
      toast.success("Reminder posted to league activity.")
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

  if (loading || !snapshot || !settings) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading commissioner tools…
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
          <Sparkles className="h-4 w-4 text-cyan-300" />
          Bracket Brain
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/55">
          Basic lock reminders post for every commissioner. AI-enhanced Bracket Brain copy (optional checkbox below)
          requires{" "}
          <span className="font-semibold text-cyan-200">AF Pro</span>. Hype, standings, watch list, and recaps remain
          AF Pro–only.
        </p>
        {hasAi ? (
          <p className="mt-1 text-[11px] text-cyan-200/80">AF Pro active — you can polish reminders with AI.</p>
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

      {(snapshot.usersWithIncompleteBrackets.length > 0 ||
        snapshot.entriesMissingPicks.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {snapshot.usersWithIncompleteBrackets.length > 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
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
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
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

      {!hasAi && (
        <div className="rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-transparent p-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200/90" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-white">AF Pro required for AI actions</p>
              <p className="mt-1 text-xs leading-relaxed text-white/55">
                Generate Hype, Summarize Standings, What To Watch, and Post Round Recap use
                Bracket Brain AI — exclusive to AF Pro commissioners.
              </p>
              <Link
                href="/pricing"
                className="mt-3 inline-flex rounded-lg bg-cyan-300 px-4 py-2 text-xs font-black text-black"
              >
                Upgrade to AF Pro
              </Link>
            </div>
          </div>
        </div>
      )}

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
          proGated={!hasAi}
        >
          Generate Hype
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "standings"}
          onClick={() => void runBrain("standings")}
          proGated={!hasAi}
        >
          Summarize Standings
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "watch"}
          onClick={() => void runBrain("watch")}
          proGated={!hasAi}
        >
          What To Watch
        </BrainButton>
        <BrainButton
          disabled={!bracketBrainEnabled || busy !== null}
          loading={busy === "recap"}
          onClick={() => void runBrain("recap")}
          proGated={!hasAi}
        >
          Post Round Recap
        </BrainButton>
      </div>

      {onOpenLeagueSettings ? (
        <button
          type="button"
          onClick={() => onOpenLeagueSettings()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 text-xs font-bold text-white/80 hover:bg-white/[0.08]"
        >
          <Settings className="h-4 w-4 text-cyan-200/90" />
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
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">{label}</p>
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
  proGated,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  proGated?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2.5 text-[11px] font-bold text-cyan-100 transition disabled:opacity-40 hover:enabled:bg-cyan-400/20 sm:min-h-0 sm:w-auto sm:justify-start sm:py-2"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : proGated ? <Lock className="h-3.5 w-3.5 text-cyan-300/60" /> : icon}
      {children}
    </button>
  )
}

