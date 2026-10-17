"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { BarChart3, Check, Copy, Loader2, RefreshCcw, Sparkles, Users } from "lucide-react"
import { ReferralCTACard } from "./ReferralCTACard"
import { ReferralLeaderboard } from "./ReferralLeaderboard"
import { ReferralProgressWidget } from "./ReferralProgressWidget"
import { ReferralShareBar } from "./ReferralShareBar"
// Shared with Settings › Referrals: async clipboard first, the legacy copy command as fallback.
import { copyText } from "@/lib/clipboard/copyText"
import type { ReferralDashboardData, ReferralRewardView } from "@/lib/referral"

type DashboardTab = "overview" | "rewards" | "leaderboard"

function resolveTab(input: string | null | undefined): DashboardTab {
  if (input === "rewards" || input === "leaderboard") return input
  return "overview"
}


function formatRewardValue(reward: ReferralRewardView): string {
  if (reward.rewardKind === "xp") return `${reward.value} XP`
  if (reward.rewardKind === "badge") return reward.value > 0 ? `${reward.value} XP badge` : "Badge reward"
  return reward.value > 0 ? `${reward.value}` : reward.label
}

export function ReferralDashboard() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<DashboardTab>(resolveTab(searchParams?.get("tab")))
  const [dashboard, setDashboard] = useState<ReferralDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async (mode: "initial" | "reload" = "initial") => {
    if (mode === "reload") setReloading(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/referral/dashboard", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.ok || !data.dashboard) {
        throw new Error(data.error ?? "Failed to load dashboard")
      }
      setDashboard(data.dashboard)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load dashboard")
      setDashboard(null)
    } finally {
      setLoading(false)
      setReloading(false)
    }
  }, [])

  useEffect(() => {
    setTab(resolveTab(searchParams?.get("tab")))
  }, [searchParams])

  useEffect(() => {
    void fetchDashboard("initial")
  }, [fetchDashboard])

  const copyCode = useCallback(async () => {
    if (!dashboard?.code) return
    const copied = await copyText(dashboard.code)
    if (!copied) return
    setCopiedCode(true)
    window.setTimeout(() => setCopiedCode(false), 2000)
  }, [dashboard?.code])

  const copyLink = useCallback(async () => {
    if (!dashboard?.link) return
    const copied = await copyText(dashboard.link)
    if (!copied) return
    setCopiedLink(true)
    window.setTimeout(() => setCopiedLink(false), 2000)
  }, [dashboard?.link])

  const claimReward = useCallback(
    async (rewardId: string) => {
      setClaimingRewardId(rewardId)
      try {
        const response = await fetch("/api/referral/rewards/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rewardId }),
        })
        const data = await response.json()
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Failed to claim reward")
        }

        setDashboard((current) =>
          current
            ? {
                ...current,
                rewards: current.rewards.map((reward) => (reward.id === rewardId ? data.reward : reward)),
                stats: data.stats ?? current.stats,
                progress: data.stats
                  ? {
                      ...current.progress,
                      claimableRewards: data.stats.claimableRewards ?? current.progress.claimableRewards,
                      pendingRewards: data.stats.pendingRewards ?? current.progress.pendingRewards,
                      redeemedRewards: data.stats.redeemedRewards ?? current.progress.redeemedRewards,
                    }
                  : current.progress,
              }
            : current
        )
      } catch (claimError) {
        setError(claimError instanceof Error ? claimError.message : "Failed to claim reward")
      } finally {
        setClaimingRewardId(null)
      }
    },
    []
  )

  const shareHandler = useCallback(() => {
    void fetchDashboard("reload")
  }, [fetchDashboard])

  const claimableRewards = useMemo(
    () => dashboard?.rewards.filter((reward) => reward.status === "claimable") ?? [],
    [dashboard?.rewards]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)" }}>
        <p style={{ color: "var(--muted)" }}>{error ?? "Could not load referral dashboard."}</p>
        <button
          type="button"
          onClick={() => void fetchDashboard("reload")}
          className="mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          <RefreshCcw className="h-4 w-4" />
          Reload
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>
            Referral System
          </p>
          <h1 className="mt-2 text-3xl font-bold" style={{ color: "var(--text)" }}>
            Grow the league, earn the upside
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
            Track referral signups, onboarding completion, creator momentum, and claimable rewards from one dashboard.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchDashboard("reload")}
          data-testid="referral-dashboard-reload"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          {reloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Reload data
        </button>
      </div>

      <div
        className="rounded-3xl border p-5"
        style={{
          borderColor: "var(--border)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--panel) 92%, transparent))",
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                  Referral code
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={dashboard.code}
                    className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm font-mono"
                    style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void copyCode()}
                    data-testid="referral-copy-code"
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedCode ? "Copied" : "Copy code"}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                  Referral link
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={dashboard.link}
                    className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    data-testid="referral-copy-link"
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedLink ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
            </div>

            <ReferralShareBar referralLink={dashboard.link} onShare={shareHandler} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Signups
              </p>
              <p data-testid="referral-stat-signups" className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {dashboard.stats.signups}
              </p>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Claimable rewards
              </p>
              <p
                data-testid="referral-stat-claimable-rewards"
                className="mt-2 text-2xl font-bold"
                style={{ color: "var(--text)" }}
              >
                {dashboard.stats.claimableRewards}
              </p>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Onboarded
              </p>
              <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {dashboard.stats.onboarded}
              </p>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Conversion
              </p>
              <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {dashboard.stats.conversionRate}%
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <ReferralProgressWidget progress={dashboard.progress} />

        <div className="grid gap-4 sm:grid-cols-3">
          {dashboard.ctaCards.map((card) => (
            <ReferralCTACard
              key={card.id}
              title={card.title}
              description={card.description}
              ctaLabel={card.label}
              ctaHref={card.href}
              variant={card.variant}
              testId={card.id === "leaderboard" ? "referral-open-leaderboard" : undefined}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["overview", "rewards", "leaderboard"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            data-testid={`referral-tab-${value}`}
            className="rounded-full border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: "var(--border)",
              background: tab === value ? "var(--accent)" : "transparent",
              color: tab === value ? "var(--bg)" : "var(--text)",
            }}
          >
            {value === "overview" ? "Overview" : value === "rewards" ? "Rewards" : "Leaderboard"}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          {error}
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" style={{ color: "var(--muted)" }} />
                  <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    Funnel snapshot
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Clicks", value: dashboard.funnel.clicked },
                    { label: "Signed up", value: dashboard.funnel.signedUp },
                    { label: "Engaged", value: dashboard.funnel.engaged },
                    { label: "Onboarded", value: dashboard.funnel.onboarded },
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {metric.label}
                      </p>
                      <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text)" }}>
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" style={{ color: "var(--muted)" }} />
                  <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    Reward pulse
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {claimableRewards.length > 0
                      ? `${claimableRewards.length} reward${claimableRewards.length === 1 ? "" : "s"} ready to claim now.`
                      : "No claimable rewards yet. Reload after new referrals land."}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Pending
                      </p>
                      <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text)" }}>
                        {dashboard.stats.pendingRewards}
                      </p>
                    </div>
                    <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Redeemed XP value
                      </p>
                      <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text)" }}>
                        {dashboard.stats.totalRewardValue}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" style={{ color: "var(--muted)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                  Referral onboarding
                </span>
              </div>
              {dashboard.referred.length === 0 ? (
                <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  No referred users yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {dashboard.referred.slice(0, 8).map((entry) => (
                    <li
                      key={entry.referredUserId}
                      className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                          {entry.displayName || "Friend"}
                        </p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          {entry.kind === "creator" ? "Creator referral" : "User referral"} • {entry.status.replace(/_/g, " ")}
                        </p>
                      </div>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <ReferralLeaderboard entries={dashboard.leaderboard.slice(0, 8)} />
        </div>
      ) : null}

      {tab === "rewards" ? (
        <div className="space-y-4">
          {dashboard.rewards.length === 0 ? (
            <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)" }}>
              <p style={{ color: "var(--muted)" }}>No rewards yet. Share your code and reload when new referrals arrive.</p>
            </div>
          ) : (
            dashboard.rewards.map((reward) => {
              const claimable = reward.status === "claimable"
              const pending = reward.status === "pending"
              return (
                <div
                  key={reward.id}
                  className="rounded-2xl border p-4"
                  style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 70%, transparent)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                        {reward.label}
                      </p>
                      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                        {reward.description ?? "Referral reward"}
                      </p>
                      <p className="mt-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
                        {formatRewardValue(reward)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                        {reward.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => void claimReward(reward.id)}
                        disabled={!claimable || claimingRewardId === reward.id}
                        data-testid={`referral-claim-${reward.id}`}
                        className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                        style={{
                          background: claimable ? "var(--accent)" : "var(--panel2)",
                          color: claimable ? "var(--bg)" : "var(--muted)",
                        }}
                      >
                        {claimingRewardId === reward.id ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Claiming
                          </span>
                        ) : pending ? (
                          "Pending"
                        ) : reward.status === "redeemed" ? (
                          "Claimed"
                        ) : (
                          reward.claimLabel
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                    {reward.helperText}
                  </p>
                </div>
              )
            })
          )}
        </div>
      ) : null}

      {tab === "leaderboard" ? (
        <div className="space-y-4">
          <ReferralLeaderboard entries={dashboard.leaderboard} />
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Updated {new Date(dashboard.updatedAt).toLocaleString()}.
            </p>
            <Link
              href="/referral"
              className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              Back to overview
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
