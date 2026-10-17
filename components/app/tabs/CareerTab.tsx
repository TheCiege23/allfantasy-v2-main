"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useGMLeaderboard } from "@/hooks/useGMLeaderboard"
import type { ManagerFranchiseProfileRow } from "@/hooks/useGMLeaderboard"
import { useGMProgression } from "@/hooks/useGMProgression"
import { useXPProfile } from "@/hooks/useXPProfile"
import { useXPLeaderboard } from "@/hooks/useXPLeaderboard"
import { useXPEvents } from "@/hooks/useXPEvents"
import { useCareerPrestigeProfile, useLeaguePrestige, useCareerLeaderboard } from "@/hooks/useCareerPrestige"
import type { LeagueTabProps } from "@/components/app/tabs/types"
import { RefreshCw, Building2, Zap, Crown, Sparkles } from "lucide-react"
import { XPTierBadge } from "@/components/XPTierBadge"
import { XPProgressBar } from "@/components/XPProgressBar"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { useUserTimezone } from "@/hooks/useUserTimezone"

const GM_EVENT_LABELS: Record<string, string> = {
  league_joined: "League joined",
  season_completed: "Season completed",
  playoff_appearance: "Playoff appearance",
  finals_appearance: "Finals appearance",
  championship: "Championship",
  reputation_tier_up: "Reputation tier up",
  legacy_milestone: "Legacy milestone",
  hall_of_fame_induction: "Hall of Fame",
}

export default function CareerTab({ leagueId, isCommissioner = false }: LeagueTabProps & { isCommissioner?: boolean }) {
  const { formatDateInTimezone } = useUserTimezone()
  const { data: session } = useSession()
  const managerId = (session?.user as { id?: string })?.id ?? null

  const [careerSportFilter, setCareerSportFilter] = useState<string>("")
  const {
    profile: careerProfile,
    loading: careerProfileLoading,
    error: careerProfileError,
    refresh: refreshCareerProfile,
  } = useCareerPrestigeProfile(managerId, leagueId || null, careerSportFilter || undefined)
  const {
    summary: leaguePrestige,
    loading: leaguePrestigeLoading,
    error: leaguePrestigeError,
    refresh: refreshLeaguePrestige,
  } = useLeaguePrestige(leagueId || null, careerSportFilter || undefined)
  const {
    leaderboard: careerLeaderboard,
    loading: careerLeaderboardLoading,
    error: careerLeaderboardError,
    refresh: refreshCareerLeaderboard,
  } = useCareerLeaderboard(leagueId || null, careerSportFilter || undefined)
  const [careerExplainNarrative, setCareerExplainNarrative] = useState<string | null>(null)
  const [careerExplainLoading, setCareerExplainLoading] = useState(false)
  const [careerExplainError, setCareerExplainError] = useState<string | null>(null)
  const [leagueExplainNarrative, setLeagueExplainNarrative] = useState<string | null>(null)
  const [leagueExplainLoading, setLeagueExplainLoading] = useState(false)
  const [prestigeRunLoading, setPrestigeRunLoading] = useState(false)
  const [prestigeRunStatus, setPrestigeRunStatus] = useState<string | null>(null)
  const [prestigeRunStatusError, setPrestigeRunStatusError] = useState(false)

  const [orderBy, setOrderBy] = useState<"franchiseValue" | "gmPrestigeScore">("franchiseValue")
  const [gmSportFilter, setGmSportFilter] = useState<string>("")
  const [runLoading, setRunLoading] = useState(false)
  const [gmRunError, setGmRunError] = useState<string | null>(null)
  const [explainManagerId, setExplainManagerId] = useState<string | null>(null)
  const [explainNarrative, setExplainNarrative] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState<string | null>(null)
  const [compareManagerA, setCompareManagerA] = useState<string>("")
  const [compareManagerB, setCompareManagerB] = useState<string>("")
  const [timelineManagerId, setTimelineManagerId] = useState<string>("")
  const [timelineSportFilter, setTimelineSportFilter] = useState<string>("")
  const [timelineEventType, setTimelineEventType] = useState<string>("")

  const [xpRunLoading, setXpRunLoading] = useState(false)
  const [xpRunError, setXpRunError] = useState<string | null>(null)
  const [xpExplainManagerId, setXpExplainManagerId] = useState<string | null>(null)
  const [xpExplainNarrative, setXpExplainNarrative] = useState<string | null>(null)
  const [xpExplainLoading, setXpExplainLoading] = useState<string | null>(null)
  const [xpTierFilter, setXpTierFilter] = useState<string>("")
  const [xpSportFilter, setXpSportFilter] = useState<string>("")
  const [xpEventTypeFilter, setXpEventTypeFilter] = useState<string>("")
  const [xpHistoryManagerId, setXpHistoryManagerId] = useState<string | null>(null)

  const {
    profile: xpProfile,
    loading: xpProfileLoading,
    error: xpProfileError,
    refresh: refreshXPProfile,
  } = useXPProfile(managerId)
  const {
    leaderboard: xpLeaderboard,
    loading: xpLeaderboardLoading,
    error: xpLeaderboardError,
    refresh: refreshXPLeaderboard,
  } = useXPLeaderboard({
    tier: xpTierFilter || undefined,
    sport: xpSportFilter || undefined,
    limit: 25,
  })
  const {
    events: xpEvents,
    loading: xpEventsLoading,
    error: xpEventsError,
    refresh: refreshXPEvents,
  } = useXPEvents(xpHistoryManagerId, {
    sport: xpSportFilter || undefined,
    eventType: xpEventTypeFilter || undefined,
    limit: 100,
  })

  const { profiles, total, loading, error, refresh } = useGMLeaderboard({
    orderBy,
    limit: 30,
    sport: gmSportFilter || null,
  })
  const {
    events: progressionEvents,
    total: progressionTotal,
    loading: progressionLoading,
    error: progressionError,
    refresh: refreshProgression,
  } = useGMProgression({
    managerId,
    sport: timelineSportFilter || null,
    eventType: timelineEventType || null,
    limit: 40,
  })

  useEffect(() => {
    if (managerId && timelineManagerId !== managerId) {
      setTimelineManagerId(managerId)
    }
  }, [managerId, timelineManagerId])

  useEffect(() => {
    if (!profiles.length) {
      setCompareManagerA("")
      setCompareManagerB("")
      return
    }
    if (!compareManagerA || !profiles.some((profile) => profile.managerId === compareManagerA)) {
      setCompareManagerA(profiles[0]?.managerId ?? "")
    }
    if (!compareManagerB || !profiles.some((profile) => profile.managerId === compareManagerB)) {
      const fallback = profiles[1]?.managerId ?? profiles[0]?.managerId ?? ""
      setCompareManagerB(fallback)
    }
  }, [compareManagerA, compareManagerB, profiles])

  const comparedProfiles = useMemo(() => {
    const profileA = profiles.find((profile) => profile.managerId === compareManagerA) ?? null
    const profileB = profiles.find((profile) => profile.managerId === compareManagerB) ?? null
    return { profileA, profileB }
  }, [compareManagerA, compareManagerB, profiles])

  const runEngine = useCallback(async () => {
    setGmRunError(null)
    setRunLoading(true)
    try {
      const res = await fetch("/api/gm-economy/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error ?? "Could not run GM economy")
      }
      await Promise.all([refresh(), refreshProgression()])
    } catch (e) {
      setGmRunError(e instanceof Error ? e.message : "Could not run GM economy")
    } finally {
      setRunLoading(false)
    }
  }, [refresh, refreshProgression])

  const explain = useCallback((managerId: string) => {
    if (!session?.user?.id || managerId !== session.user.id) return
    if (explainManagerId === managerId && explainNarrative !== null) {
      setExplainManagerId(null)
      setExplainNarrative(null)
      setExplainLoading(null)
      return
    }
    setExplainManagerId(managerId)
    setExplainNarrative(null)
    setExplainLoading(managerId)
    fetch("/api/gm-economy/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managerId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not load explanation.")
        }
        return data
      })
      .then((data) => {
        setExplainNarrative(data?.narrative ?? "No explanation available.")
        setExplainLoading(null)
      })
      .catch(() => {
        setExplainNarrative("Could not load explanation.")
        setExplainLoading(null)
      })
  }, [explainManagerId, explainNarrative, session?.user?.id])

  const runXPEngine = useCallback(() => {
    if (!managerId) {
      setXpRunError("Sign in to run your XP engine.")
      return
    }
    setXpRunLoading(true)
    setXpRunError(null)
    fetch("/api/xp/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ managerId }) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not run XP engine")
        }
        return data
      })
      .then(() => {
        refreshXPProfile()
        refreshXPLeaderboard()
        refreshXPEvents()
      })
      .catch((e) => {
        setXpRunError(e instanceof Error ? e.message : "Could not run XP engine")
      })
      .finally(() => setXpRunLoading(false))
  }, [managerId, refreshXPEvents, refreshXPProfile, refreshXPLeaderboard])

  const explainCareer = useCallback(() => {
    setCareerExplainNarrative(null)
    setCareerExplainError(null)
    setCareerExplainLoading(true)
    fetch("/api/career-prestige/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        managerId: managerId ?? undefined,
        leagueId: leagueId || undefined,
        sport: careerSportFilter || undefined,
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not load explanation.")
        }
        return data
      })
      .then((data) => setCareerExplainNarrative(data?.narrative ?? "No explanation available."))
      .catch((e) => setCareerExplainError(e instanceof Error ? e.message : "Could not load explanation."))
      .finally(() => setCareerExplainLoading(false))
  }, [careerSportFilter, leagueId, managerId])

  const explainLeaguePrestige = useCallback(() => {
    if (!leagueId) return
    setLeagueExplainNarrative(null)
    setCareerExplainError(null)
    setLeagueExplainLoading(true)
    fetch("/api/career-prestige/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId, sport: careerSportFilter || undefined }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not load league explanation.")
        }
        return data
      })
      .then((data) => setLeagueExplainNarrative(data?.narrative ?? "No explanation available."))
      .catch((e) =>
        setCareerExplainError(e instanceof Error ? e.message : "Could not load league explanation.")
      )
      .finally(() => setLeagueExplainLoading(false))
  }, [careerSportFilter, leagueId])

  const runPrestigeEngines = useCallback(() => {
    setPrestigeRunStatus(null)
    setPrestigeRunStatusError(false)
    setPrestigeRunLoading(true)
    fetch("/api/career-prestige/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId: leagueId || undefined, sport: careerSportFilter || undefined }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not run career prestige engines")
        }
        return data
      })
      .then((data) => {
        setPrestigeRunStatus(
          `Run complete: GM ${data?.gmEconomy?.processed ?? 0}, XP ${data?.xp?.processed ?? 0}, Awards ${data?.awards?.awardsCreated ?? 0}.`
        )
        refreshCareerProfile()
        refreshLeaguePrestige()
        refreshCareerLeaderboard()
        refresh()
        refreshProgression()
        refreshXPProfile()
        refreshXPLeaderboard()
        refreshXPEvents()
      })
      .catch((e) => {
        setPrestigeRunStatus(e instanceof Error ? e.message : "Could not run career prestige engines")
        setPrestigeRunStatusError(true)
      })
      .finally(() => setPrestigeRunLoading(false))
  }, [careerSportFilter, leagueId, refreshCareerProfile, refreshLeaguePrestige, refreshCareerLeaderboard, refresh, refreshProgression, refreshXPProfile, refreshXPLeaderboard, refreshXPEvents])

  const explainXP = useCallback((mid: string) => {
    if (!managerId || mid !== managerId) return
    if (xpExplainManagerId === mid && xpExplainNarrative !== null) {
      setXpExplainManagerId(null)
      setXpExplainNarrative(null)
      setXpExplainLoading(null)
      return
    }
    setXpExplainManagerId(mid)
    setXpExplainNarrative(null)
    setXpExplainLoading(mid)
    fetch("/api/xp/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managerId: mid }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(data?.error ?? "Could not load explanation.")
        }
        return data
      })
      .then((data) => {
        setXpExplainNarrative(data?.narrative ?? "No explanation available.")
        setXpExplainLoading(null)
      })
      .catch(() => {
        setXpExplainNarrative("Could not load explanation.")
        setXpExplainLoading(null)
      })
  }, [managerId, xpExplainManagerId, xpExplainNarrative])

  const toggleXPHistory = useCallback((mid: string) => {
    if (!managerId || mid !== managerId) return
    setXpHistoryManagerId((prev) => (prev === mid ? null : mid))
  }, [managerId])

  return (
    <div className="space-y-4 p-4">
      {/* Career Prestige — unified dashboard */}
      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-violet-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Career Prestige</h2>
              <p className="text-xs text-white/60">
                Unified view: GM Economy, XP, Reputation, Legacy, Hall of Fame, Awards, Record Books.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={careerSportFilter}
              onChange={(e) => setCareerSportFilter(e.target.value)}
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((sport) => (
                <option key={`career-sport-${sport}`} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-xl bg-zinc-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={careerProfileLoading || leaguePrestigeLoading || careerLeaderboardLoading}
              onClick={() => { refreshCareerProfile(); refreshLeaguePrestige(); refreshCareerLeaderboard() }}
            >
              <RefreshCw className="h-4 w-4 inline" /> Refresh
            </button>
            <button
              type="button"
              className="rounded-xl bg-violet-600 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={prestigeRunLoading || !leagueId || !isCommissioner}
              onClick={runPrestigeEngines}
            >
              {prestigeRunLoading ? "Running…" : "Run all engines"}
            </button>
            <button
              type="button"
              className="rounded-xl bg-violet-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={leagueExplainLoading || !leagueId}
              onClick={explainLeaguePrestige}
            >
              {leagueExplainLoading ? "Explaining…" : "Explain league"}
            </button>
            {!isCommissioner && leagueId && (
              <span className="text-xs text-zinc-500">Run all engines: commissioner only</span>
            )}
          </div>
        </div>
        {prestigeRunStatus && (
          <div
            className={`mb-3 rounded-lg border p-2 text-xs ${
              prestigeRunStatusError
                ? "border-red-500/30 bg-red-900/20 text-red-200"
                : "border-violet-500/30 bg-violet-900/20 text-violet-100"
            }`}
          >
            {prestigeRunStatus}
          </div>
        )}
        {(careerProfileError || leaguePrestigeError || careerLeaderboardError || careerExplainError) && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-900/20 p-2 text-xs text-red-200">
            {careerProfileError ?? leaguePrestigeError ?? careerLeaderboardError ?? careerExplainError}
          </div>
        )}
        {leagueId && leaguePrestige && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 mb-3">
            <h3 className="text-sm font-semibold text-white/80 mb-2">League prestige</h3>
            <p className="text-xs text-zinc-400">
              {leaguePrestige.managerCount} managers · GM: {leaguePrestige.gmEconomyCoverage} · XP: {leaguePrestige.xpCoverage} · Rep: {leaguePrestige.reputationCoverage} · Legacy: {leaguePrestige.legacyCoverage} · HoF: {leaguePrestige.hallOfFameEntryCount} · Awards: {leaguePrestige.awardsCount} · Records: {leaguePrestige.recordBookCount}
            </p>
            {leagueExplainNarrative && (
              <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">
                {leagueExplainNarrative}
              </div>
            )}
          </div>
        )}
        {managerId && careerProfile && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 mb-3">
            <h3 className="text-sm font-semibold text-white/80 mb-2">Your prestige</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {careerProfile.gmEconomy?.tierLabel && (
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-200">GM {careerProfile.gmEconomy.tierLabel}</span>
              )}
              {careerProfile.xp?.currentTier && (
                <XPTierBadge tier={careerProfile.xp.currentTier} />
              )}
              {careerProfile.reputation?.tier && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200">{careerProfile.reputation.tier}</span>
              )}
              {careerProfile.legacy && (
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-200">Legacy {careerProfile.legacy.overallLegacyScore.toFixed(0)}</span>
              )}
              {careerProfile.hallOfFameEntryCount > 0 && (
                <span className="text-xs text-zinc-400">HoF: {careerProfile.hallOfFameEntryCount}</span>
              )}
              {(careerProfile.awardsWonCount > 0 || careerProfile.recordsHeldCount > 0) && (
                <span className="text-xs text-zinc-400">Awards: {careerProfile.awardsWonCount} · Records: {careerProfile.recordsHeldCount}</span>
              )}
            </div>
            {careerProfile.timelineHints.length > 0 && (
              <p className="text-xs text-zinc-500 mb-2">Timeline: {careerProfile.timelineHints.slice(0, 3).join(" · ")}</p>
            )}
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-cyan-400 hover:bg-zinc-700 disabled:opacity-50"
              disabled={careerExplainLoading}
              onClick={explainCareer}
            >
              <Sparkles className="h-3 w-3" /> {careerExplainLoading ? "…" : "Explain my career"}
            </button>
            {careerExplainNarrative && (
              <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">{careerExplainNarrative}</div>
            )}
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-white/80 mb-2">Prestige leaderboard</h3>
          {careerLeaderboardLoading ? (
            <p className="text-xs text-zinc-500">Loading prestige leaderboard…</p>
          ) : careerLeaderboard.length > 0 ? (
            <div className="space-y-1">
              {careerLeaderboard.slice(0, 10).map((r) => (
                <div key={r.managerId} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/50 px-2 py-1 text-sm">
                  <span className="text-zinc-500 w-5">#{r.rank}</span>
                  <span className="text-white font-medium">{r.managerId}</span>
                  <span className="text-cyan-400 font-mono text-xs">Prestige {r.prestigeScore}</span>
                  <span className="text-zinc-400 text-xs">
                    Val {r.franchiseValue} · XP {r.totalXP} · Champs {r.championshipCount}
                  </span>
                  {r.legacyScore != null && (
                    <span className="text-emerald-300 text-xs">Legacy {r.legacyScore.toFixed(1)}</span>
                  )}
                  {r.reputationTier && (
                    <span className="text-amber-300 text-xs">Rep {r.reputationTier}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No prestige leaderboard entries yet.</p>
          )}
        </div>
      </div>

      {/* Career XP section */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Career XP &amp; Tier</h2>
              <p className="text-xs text-white/60">
                Earn XP from matchup wins, playoffs, championships, trades, season completion. Rise from Bronze GM to Legendary GM.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl bg-zinc-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={xpProfileLoading || xpLeaderboardLoading}
              onClick={() => { refreshXPProfile(); refreshXPLeaderboard(); refreshXPEvents() }}
            >
              <RefreshCw className={`h-4 w-4 inline ${xpProfileLoading || xpLeaderboardLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              className="rounded-xl bg-amber-600 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={xpRunLoading || !managerId}
              onClick={runXPEngine}
            >
              {xpRunLoading ? "Running…" : "Run XP engine"}
            </button>
          </div>
        </div>
        {managerId && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 mb-3">
            <h3 className="text-sm font-semibold text-white/80 mb-2">Your XP</h3>
            {xpProfileLoading ? (
              <div className="text-sm text-white/50">Loading…</div>
            ) : xpProfile ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <XPTierBadge tier={xpProfile.currentTier} tierBadgeColor={xpProfile.tierBadgeColor} />
                  <span className="text-cyan-400 font-mono text-sm">{xpProfile.totalXP} XP</span>
                </div>
                <XPProgressBar
                  progressInTier={xpProfile.progressInTier}
                  totalXP={xpProfile.totalXP}
                  xpRemainingToNextTier={xpProfile.xpToNextTier}
                  currentTier={xpProfile.currentTier}
                />
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className="text-cyan-400 hover:underline disabled:opacity-50"
                    onClick={() => toggleXPHistory(managerId)}
                  >
                    {xpHistoryManagerId === managerId ? "Hide history" : "How did I earn this XP?"}
                  </button>
                  <button
                    type="button"
                    className="text-amber-400 hover:underline disabled:opacity-50"
                    disabled={xpExplainLoading === managerId}
                    onClick={() => explainXP(managerId)}
                  >
                    {xpExplainLoading === managerId ? "…" : "Explain with Chimmy"}
                  </button>
                </div>
                {xpExplainManagerId === managerId && xpExplainNarrative && (
                  <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">
                    {xpExplainNarrative}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-white/60">No XP profile yet. Run the XP engine to compute from season results.</p>
            )}
          </div>
        )}
        {(xpRunError || xpProfileError || xpLeaderboardError) && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-900/20 p-2 text-xs text-red-200">
            {xpRunError ?? xpProfileError ?? xpLeaderboardError}
          </div>
        )}
        <h3 className="text-sm font-semibold text-white/80 mb-2">XP Leaderboard</h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm"
            value={xpTierFilter}
            onChange={(e) => setXpTierFilter(e.target.value)}
          >
            <option value="">All tiers</option>
            <option value="Bronze GM">Bronze GM</option>
            <option value="Silver GM">Silver GM</option>
            <option value="Gold GM">Gold GM</option>
            <option value="Elite GM">Elite GM</option>
            <option value="Legendary GM">Legendary GM</option>
          </select>
          <select
            className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm"
            value={xpSportFilter}
            onChange={(e) => setXpSportFilter(e.target.value)}
          >
            <option value="">All sports</option>
            {SUPPORTED_SPORTS.map((sport) => (
              <option key={`xp-sport-${sport}`} value={sport}>
                {sport}
              </option>
            ))}
          </select>
        </div>
        {xpLeaderboardLoading ? (
          <div className="text-sm text-white/50">Loading leaderboard…</div>
        ) : xpLeaderboard.length > 0 ? (
          <div className="space-y-2">
            {xpLeaderboard.map((row) => (
              <div key={row.managerId} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 w-6">#{row.rank}</span>
                    <span className="font-medium text-white text-sm">{row.managerId}</span>
                    <XPTierBadge tier={row.currentTier} />
                    <span className="text-cyan-400 font-mono text-sm">{row.totalXP} XP</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs text-cyan-400 hover:underline disabled:opacity-50"
                      disabled={row.managerId !== managerId}
                      onClick={() => toggleXPHistory(row.managerId)}
                    >
                      {row.managerId !== managerId
                        ? "Self only"
                        : xpHistoryManagerId === row.managerId
                          ? "Hide history"
                          : "How earned"}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-amber-400 hover:underline disabled:opacity-50"
                      disabled={row.managerId !== managerId || xpExplainLoading === row.managerId}
                      onClick={() => explainXP(row.managerId)}
                    >
                      {row.managerId !== managerId
                        ? "Self only"
                        : xpExplainLoading === row.managerId
                          ? "…"
                          : "Explain with Chimmy"}
                    </button>
                  </div>
                </div>
                {xpExplainManagerId === row.managerId && xpExplainNarrative && (
                  <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">
                    {xpExplainNarrative}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/60">No XP data yet. Run the XP engine to build the leaderboard.</p>
        )}
        {xpHistoryManagerId && (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-white/80">
                XP event history — {xpHistoryManagerId}
              </h4>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
                  value={xpEventTypeFilter}
                  onChange={(e) => setXpEventTypeFilter(e.target.value)}
                >
                  <option value="">All event types</option>
                  <option value="win_matchup">Win matchup</option>
                  <option value="make_playoffs">Make playoffs</option>
                  <option value="championship">Championship</option>
                  <option value="successful_trade">Successful trade</option>
                  <option value="draft_accuracy">Draft accuracy</option>
                  <option value="league_participation">League participation</option>
                  <option value="season_completion">Season completion</option>
                  <option value="commissioner_service">Commissioner service</option>
                </select>
                <button
                  type="button"
                  className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
                  disabled={xpEventsLoading}
                  onClick={() => refreshXPEvents()}
                >
                  Refresh
                </button>
              </div>
            </div>
            {xpEventsError && (
              <div className="mb-2 rounded-md border border-red-500/30 bg-red-900/20 p-2 text-xs text-red-200">
                {xpEventsError}
              </div>
            )}
            {xpEventsLoading ? (
              <p className="text-xs text-zinc-400">Loading XP events…</p>
            ) : xpEvents.length > 0 ? (
              <div className="space-y-1">
                {xpEvents.slice(0, 20).map((event) => (
                  <div
                    key={event.eventId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
                  >
                    <span className="text-zinc-200">
                      {event.eventType} · +{event.xpValue} XP · {event.sport}
                    </span>
                    <span className="text-zinc-500">
                      {event.createdAt ? formatDateInTimezone(event.createdAt) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No XP events found for this filter.</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-lg font-bold text-white">GM Career & Franchise Value</h2>
              <p className="text-xs text-white/60">
                Cross-league career progression: prestige, franchise value, championships, win rate.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={gmSportFilter}
              onChange={(e) => setGmSportFilter(e.target.value)}
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={orderBy}
              onChange={(e) => setOrderBy(e.target.value as "franchiseValue" | "gmPrestigeScore")}
            >
              <option value="franchiseValue">By franchise value</option>
              <option value="gmPrestigeScore">By GM prestige</option>
            </select>
            <button
              type="button"
              className="rounded-xl bg-zinc-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={loading}
              onClick={() => refresh()}
            >
              <RefreshCw className={`h-4 w-4 inline ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              className="rounded-xl bg-cyan-600 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={runLoading}
              onClick={runEngine}
            >
              {runLoading ? "Running…" : "Run GM economy"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-white/55">
          Scope: {gmSportFilter ? `${gmSportFilter} managers` : "All sports combined"}.
        </p>
      </div>

      {(error || gmRunError) && (
        <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-3 text-sm text-red-200">
          {error ?? gmRunError}
        </div>
      )}

      {loading && (
        <div className="text-sm text-white/50">Loading leaderboard…</div>
      )}

      {!loading && profiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white/80">
            Franchise leaderboard ({total})
          </h3>
          <div className="space-y-2">
            {profiles.slice(0, 25).map((p, idx) => (
              <GMCareerCard
                key={p.profileId}
                rank={idx + 1}
                profile={p}
                explainManagerId={explainManagerId}
                explainNarrative={explainNarrative}
                explainLoading={explainLoading}
                canExplain={managerId === p.managerId}
                onExplain={() => explain(p.managerId)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && comparedProfiles.profileA && comparedProfiles.profileB && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-white/85">Manager comparison</h3>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs"
                value={compareManagerA}
                onChange={(e) => setCompareManagerA(e.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={`a-${profile.managerId}`} value={profile.managerId}>
                    {profile.managerId}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs"
                value={compareManagerB}
                onChange={(e) => setCompareManagerB(e.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={`b-${profile.managerId}`} value={profile.managerId}>
                    {profile.managerId}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
              <p className="font-medium text-white">{comparedProfiles.profileA.managerId}</p>
              <p className="text-cyan-300">Value {comparedProfiles.profileA.franchiseValue.toFixed(0)}</p>
              <p className="text-amber-300">Prestige {comparedProfiles.profileA.gmPrestigeScore.toFixed(1)}</p>
              <p className="text-zinc-400">
                {comparedProfiles.profileA.championshipCount} titles · {(comparedProfiles.profileA.careerWinPercentage * 100).toFixed(1)}% win
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
              <p className="font-medium text-white">{comparedProfiles.profileB.managerId}</p>
              <p className="text-cyan-300">Value {comparedProfiles.profileB.franchiseValue.toFixed(0)}</p>
              <p className="text-amber-300">Prestige {comparedProfiles.profileB.gmPrestigeScore.toFixed(1)}</p>
              <p className="text-zinc-400">
                {comparedProfiles.profileB.championshipCount} titles · {(comparedProfiles.profileB.careerWinPercentage * 100).toFixed(1)}% win
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-white/85">Career timeline</h3>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs"
              value={timelineManagerId || managerId || ""}
              onChange={(e) => setTimelineManagerId(e.target.value)}
              disabled
            >
              <option value={managerId ?? ""}>{managerId ?? "Sign in required"}</option>
            </select>
            <select
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs"
              value={timelineSportFilter}
              onChange={(e) => setTimelineSportFilter(e.target.value)}
            >
              <option value="">All sports</option>
              {SUPPORTED_SPORTS.map((sport) => (
                <option key={`timeline-sport-${sport}`} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs"
              value={timelineEventType}
              onChange={(e) => setTimelineEventType(e.target.value)}
            >
              <option value="">All events</option>
              {Object.keys(GM_EVENT_LABELS).map((eventType) => (
                <option key={eventType} value={eventType}>
                  {GM_EVENT_LABELS[eventType]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-zinc-800 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-60"
              disabled={progressionLoading}
              onClick={() => refreshProgression()}
            >
              Refresh
            </button>
          </div>
        </div>
        {progressionError && (
          <div className="rounded-md border border-red-500/40 bg-red-900/20 p-2 text-xs text-red-200 mb-2">
            {progressionError}
          </div>
        )}
        {progressionLoading ? (
          <div className="text-xs text-zinc-400">Loading timeline…</div>
        ) : progressionEvents.length > 0 ? (
          <div className="space-y-1">
            {progressionEvents.map((event) => (
              <div key={event.eventId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-200">
                    {GM_EVENT_LABELS[event.eventType] ?? event.eventType}
                  </span>
                  <span className="text-zinc-400">{event.sport}</span>
                  <span className="text-cyan-300">+{Number(event.valueChange).toFixed(2)}</span>
                </div>
                <span className="text-zinc-500">
                  {formatDateInTimezone(event.createdAt)}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-zinc-500">{progressionTotal} timeline events loaded</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">
            No progression events yet for this filter. Run GM economy to generate/update timeline events.
          </p>
        )}
      </div>

      {!loading && profiles.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
          No franchise profiles yet. Click &quot;Run GM economy&quot; to compute career progression
          from league history (rosters, season results).
        </div>
      )}

      <p className="text-xs text-white/50">
        Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer. Data is aggregated from
        rosters and season results across all leagues.
      </p>
    </div>
  )
}

function GMCareerCard({
  rank,
  profile,
  explainManagerId,
  explainNarrative,
  explainLoading,
  canExplain,
  onExplain,
}: {
  rank: number
  profile: ManagerFranchiseProfileRow
  explainManagerId: string | null
  explainNarrative: string | null
  explainLoading: string | null
  canExplain: boolean
  onExplain: () => void
}) {
  const tierColor =
    profile.tierBadgeColor === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : profile.tierBadgeColor === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : profile.tierBadgeColor === "cyan"
          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
          : "border-white/20 bg-white/5 text-white/70"

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-6">#{rank}</span>
          <span className="font-medium text-white">{profile.managerId}</span>
          {profile.tierLabel && (
            <span
              className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${tierColor}`}
            >
              {profile.tierLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-cyan-400 font-mono">
            Value: {profile.franchiseValue.toFixed(0)}
          </span>
          <span className="text-amber-400 font-mono">
            Prestige: {profile.gmPrestigeScore.toFixed(1)}
          </span>
          <span className="text-xs text-zinc-400">
            {profile.championshipCount} titles · {(profile.careerWinPercentage * 100).toFixed(0)}% W
          </span>
          <button
            type="button"
            className="text-xs text-cyan-400 hover:underline disabled:opacity-50"
            disabled={!canExplain || explainLoading === profile.managerId}
            onClick={onExplain}
          >
            {!canExplain
              ? "Self only"
              : explainLoading === profile.managerId
                ? "…"
                : explainManagerId === profile.managerId && explainNarrative
                  ? "Hide"
                  : "Explain career"}
          </button>
        </div>
      </div>
      {explainManagerId === profile.managerId && explainNarrative && (
        <div className="mt-2 rounded-lg bg-zinc-900 p-2 text-xs text-zinc-300">
          {explainNarrative}
        </div>
      )}
    </div>
  )
}
