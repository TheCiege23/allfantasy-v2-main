"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  Settings,
  Zap,
  Award,
  ChevronRight,
  MessageCircle,
  Trophy,
  BarChart3,
} from "lucide-react"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { useXPProfile } from "@/hooks/useXPProfile"
import { useResolvedCosmetics } from "@/hooks/useMarketplace"
import { XPTierBadge } from "@/components/XPTierBadge"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"
import type { PublicProfileDto, UserProfileForSettings } from "@/lib/user-settings/types"
import { resolveProfilePresentation } from "@/lib/user-settings/ProfilePresentationResolver"
import EditableProfileFormController from "./EditableProfileFormController"
import { EmptyStateRenderer, ErrorStateRenderer, LoadingStateRenderer } from "@/components/ui-states"
import { resolveRecoveryActions } from "@/lib/ui-state"

function formatCosmeticCategory(category: string): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

interface ProfileHighlightsDto {
  gmPrestigeScore: number | null
  gmTierLabel: string | null
  reputationTier: string | null
  reputationScore: number | null
  legacyScore: number | null
  contextLeagueName: string | null
}

export default function ProfilePageClient({
  isOwnProfile: isOwnProfileProp,
  publicUsername,
}: {
  isOwnProfile: boolean
  publicUsername?: string | null
}) {
  const { data: session } = useSession()
  const userId = (session?.user as { id?: string })?.id ?? null

  const { profile, loading, saving, error, updateProfile, fetchProfile } = useSettingsProfile()
  const isOwnProfile =
    isOwnProfileProp ||
    (Boolean(publicUsername) && Boolean(profile?.username === publicUsername))
  const { profile: xpProfile, loading: xpLoading, error: xpError } = useXPProfile(
    isOwnProfile ? userId : null
  )
  const {
    cosmetics,
    loading: cosmeticsLoading,
    error: cosmeticsError,
  } = useResolvedCosmetics(isOwnProfile && Boolean(userId))

  const [publicProfile, setPublicProfile] = useState<PublicProfileDto | null>(null)
  const [publicLoading, setPublicLoading] = useState(!!publicUsername)
  const [publicLoadState, setPublicLoadState] = useState<"idle" | "not_found" | "error">("idle")
  const [highlights, setHighlights] = useState<ProfileHighlightsDto | null>(null)
  const [highlightsLoading, setHighlightsLoading] = useState(false)

  const loadPublic = useCallback(async () => {
    if (!publicUsername?.trim()) return
    setPublicLoading(true)
    setPublicLoadState("idle")
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12000)
    try {
      const res = await fetch(`/api/profile/public?username=${encodeURIComponent(publicUsername)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      const data = await res.json()
      if (res.ok) {
        setPublicProfile(data)
        setPublicLoadState("idle")
      } else {
        setPublicProfile(null)
        setPublicLoadState(res.status === 404 ? "not_found" : "error")
      }
    } catch {
      setPublicProfile(null)
      setPublicLoadState("error")
    } finally {
      window.clearTimeout(timeoutId)
      setPublicLoading(false)
    }
  }, [publicUsername])

  useEffect(() => {
    loadPublic()
  }, [loadPublic])

  const loadHighlights = useCallback(async () => {
    if (!isOwnProfile || !userId) {
      setHighlights(null)
      setHighlightsLoading(false)
      return
    }
    setHighlightsLoading(true)
    try {
      const res = await fetch("/api/profile/highlights", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (res.ok && data) setHighlights(data as ProfileHighlightsDto)
      else setHighlights(null)
    } catch {
      setHighlights(null)
    } finally {
      setHighlightsLoading(false)
    }
  }, [isOwnProfile, userId])

  useEffect(() => {
    loadHighlights()
  }, [loadHighlights])

  const displayProfile: UserProfileForSettings | PublicProfileDto | null = isOwnProfile ? profile : publicProfile
  const presentation = resolveProfilePresentation(displayProfile)
  const displayName = presentation?.displayName ?? publicUsername ?? "—"
  const username = presentation?.username ?? publicUsername ?? "—"
  const accountDisplayName =
    typeof displayProfile?.displayName === "string" && displayProfile.displayName.trim()
      ? displayProfile.displayName.trim()
      : null
  const profileImageUrl = (displayProfile as { profileImageUrl?: string | null })?.profileImageUrl ?? null
  const bio = presentation?.bio ?? null
  const preferredSportsLabels = presentation?.preferredSportsLabels ?? []
  const avatarPreset = displayProfile?.avatarPreset ?? null

  if (!isOwnProfile && publicUsername) {
    if (publicLoading) {
      return (
        <LoadingStateRenderer label="Loading profile..." testId="public-profile-loading-state" />
      )
    }
    if (publicLoadState === "error") {
      return (
        <ErrorStateRenderer
          title="Unable to load public profile"
          message="This profile could not be loaded right now. Try again or return to a stable route."
          onRetry={() => void loadPublic()}
          actions={resolveRecoveryActions("profile").map((action) => ({
            id: action.id,
            label: action.label,
            href: action.href,
          }))}
          testId="public-profile-error-state"
        />
      )
    }
    if (!publicProfile) {
      return (
        <EmptyStateRenderer
          title="Profile not found"
          description={`@${publicUsername} does not have a public profile yet.`}
          actions={[
            { id: "go-home", label: "Go home", href: "/" },
            { id: "open-dashboard", label: "Go to dashboard", href: "/dashboard" },
          ]}
          testId="public-profile-not-found-state"
        />
      )
    }
  }

  if (isOwnProfile && loading && !profile) {
    return (
      <LoadingStateRenderer label="Loading profile..." testId="profile-loading-state" />
    )
  }

  return (
    <div className="space-y-8">
      {/* Identity card */}
      <div
        className="rounded-2xl border p-6 sm:p-8"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <IdentityImageRenderer
              avatarUrl={profileImageUrl}
              avatarPreset={avatarPreset}
              displayName={accountDisplayName ?? displayName}
              username={username}
              size="lg"
            />
            <div>
              <h1 className="text-xl font-bold sm:text-2xl" style={{ color: "var(--text)" }}>
                {displayName}
              </h1>
              {accountDisplayName && accountDisplayName.toLowerCase() !== username.toLowerCase() && (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {accountDisplayName}
                </p>
              )}
              <p className="text-sm" style={{ color: "var(--muted)" }}>@{username}</p>
              {isOwnProfile && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {xpProfile && (
                    <XPTierBadge
                      tier={xpProfile.currentTier}
                      tierBadgeColor={xpProfile.tierBadgeColor}
                    />
                  )}
                  {xpLoading && (
                    <span className="inline-block h-5 w-10 animate-pulse rounded bg-white/10" />
                  )}
                  {xpError && (
                    <span className="text-[11px]" style={{ color: "var(--accent-red-strong)" }}>
                      XP unavailable
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {isOwnProfile && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </div>
          )}
          {!isOwnProfile && username && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/messages?start=${encodeURIComponent(username)}`}
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--accent-cyan)", color: "var(--accent-cyan-strong)", background: "color-mix(in srgb, var(--accent-cyan) 14%, transparent)" }}
              >
                <MessageCircle className="h-4 w-4" />
                Message
              </Link>
            </div>
          )}
        </div>

        {bio && (
          <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{bio}</p>
          </div>
        )}

        {preferredSportsLabels.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>Preferred sports</p>
            <div className="flex flex-wrap gap-2">
              {preferredSportsLabels.map((sportLabel) => (
                <span
                  key={sportLabel}
                  className="rounded-lg border px-3 py-1 text-xs font-medium"
                  style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                >
                  {sportLabel}
                </span>
              ))}
            </div>
          </div>
        )}

        {isOwnProfile && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>Career highlights</p>
            {highlightsLoading ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>Loading highlights…</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(6,182,212,0.2)", background: "rgba(6,182,212,0.05)" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "rgba(103,232,249,0.7)" }}>GM prestige</p>
                  <p className="text-sm font-bold" style={{ color: "rgb(165,243,252)" }}>
                    {highlights?.gmPrestigeScore != null ? highlights.gmPrestigeScore.toFixed(1) : "—"}
                  </p>
                  {highlights?.gmTierLabel && (
                    <p className="text-[11px] text-white/40">{highlights.gmTierLabel}</p>
                  )}
                </div>
                <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.05)" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "rgba(196,181,253,0.7)" }}>Reputation</p>
                  <p className="text-sm font-bold" style={{ color: "rgb(221,214,254)" }}>
                    {highlights?.reputationTier ?? "No data"}
                  </p>
                  <p className="text-[11px] text-white/40">
                    {highlights?.reputationScore != null ? `Score ${highlights.reputationScore.toFixed(1)}` : "Needs league history"}
                  </p>
                </div>
                <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.05)" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "rgba(252,211,77,0.7)" }}>Legacy score</p>
                  <p className="text-sm font-bold" style={{ color: "rgb(253,230,138)" }}>
                    {highlights?.legacyScore != null ? highlights.legacyScore.toFixed(1) : "No data"}
                  </p>
                  <p className="text-[11px] text-white/40">
                    {highlights?.contextLeagueName ? `Context: ${highlights.contextLeagueName}` : "No league context yet"}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {isOwnProfile && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>Cosmetic loadout</p>
            {cosmeticsLoading ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>Loading cosmetics…</p>
            ) : cosmetics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {cosmetics.map((c) => (
                  <span
                    key={`${c.category}-${c.itemId ?? "none"}`}
                    className="rounded-lg border px-3 py-1 text-xs font-medium"
                    style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                  >
                    {formatCosmeticCategory(c.category)}: {c.itemName ?? "None"}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                No cosmetics equipped yet. Visit the league Store tab to buy cosmetic items.
              </p>
            )}
            {cosmeticsError && (
              <p className="mt-1 text-xs" style={{ color: "var(--accent-red-strong)" }}>
                {cosmeticsError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Your stats: record, rankings, achievements (own profile only) */}
      {isOwnProfile && (
        <ProfileStatsSection />
      )}

      {/* Editable form (own profile only) */}
      {isOwnProfile && profile && (
        <EditableProfileFormController
          profile={profile}
          saving={saving}
          error={error}
          onSave={updateProfile}
          onCancel={() => {}}
          onRefetch={fetchProfile}
        />
      )}

      {/* Achievements / quick links (own profile) */}
      {isOwnProfile && (
        <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
            <Award className="h-4 w-4" />
            Quick links
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/core"
              className="flex items-center justify-between rounded-xl border p-4 transition"
              style={{ borderColor: "rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.06)" }}
            >
              <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
                <Zap className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />
                Sports App
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />
            </Link>
            <Link
              href="/settings"
              className="flex items-center justify-between rounded-xl border p-4 transition"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
            >
              <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                <Settings className="h-4 w-4" style={{ color: "var(--muted)" }} />
                Profile & settings
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--muted)" }} />
            </Link>
            <Link
              href="/user/stats"
              className="flex items-center justify-between rounded-xl border p-4 transition"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
              data-testid="profile-quick-link-user-stats"
            >
              <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                <BarChart3 className="h-4 w-4" style={{ color: "var(--muted)" }} />
                Cross-league stats
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--muted)" }} />
            </Link>
            <Link
              href="/settings?tab=preferences"
              className="flex items-center justify-between rounded-xl border p-4 transition"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
            >
              <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                <Settings className="h-4 w-4" style={{ color: "var(--muted)" }} />
                Language, timezone, theme
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--muted)" }} />
            </Link>
            <Link
              href={`/profile/${encodeURIComponent(username)}`}
              className="flex items-center justify-between rounded-xl border p-4 transition"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
            >
              <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                <Award className="h-4 w-4" style={{ color: "var(--muted)" }} />
                View public profile
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: "var(--muted)" }} />
            </Link>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Reputation and legacy highlights use your most recent league context when available.
          </p>
        </div>
      )}

      {!isOwnProfile && publicProfile && (
        <div className="rounded-2xl border p-6 text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Viewing public profile. Only shared info is shown.</p>
          <Link
            href={`/messages?start=${encodeURIComponent(username)}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--accent-cyan-strong)", background: "color-mix(in srgb, var(--accent-cyan) 14%, transparent)" }}
          >
            <MessageCircle className="h-4 w-4" />
            Message
          </Link>
        </div>
      )}
    </div>
  )
}

/** Profile stats: record, rankings, achievements (PROMPT 308). */
function ProfileStatsSection() {
  const [stats, setStats] = useState<{
    record: { wins: number; losses: number; ties: number; byLeague: Array<{ leagueName: string; wins: number; losses: number; ties: number; rank?: number }> }
    rankings: Array<{ leagueName: string; season: string; grade: string; rank: number }>
    achievements: Array<{ id: string; name: string; description: string; icon: string; earned: boolean; earnedAt?: string }>
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/profile/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.record != null) setStats(data)
        else setStats(null)
      })
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
          <BarChart3 className="h-4 w-4" />
          Your stats
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      </div>
    )
  }

  if (!stats) return null

  const { record, rankings, achievements } = stats
  const totalGames = record.wins + record.losses + record.ties
  const earnedCount = achievements.filter((a) => a.earned).length

  return (
    <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
        <BarChart3 className="h-4 w-4" />
        Your stats
      </h2>

      <div className="grid gap-6 sm:grid-cols-3">
        {/* Record */}
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>
            <Trophy className="h-3.5 w-3.5" />
            Record
          </div>
          {totalGames > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
                {record.wins}-{record.losses}
                {record.ties > 0 ? `-${record.ties}` : ""}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                across {record.byLeague.length} league{record.byLeague.length !== 1 ? "s" : ""}
              </p>
              {record.byLeague.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
                  {record.byLeague.slice(0, 3).map((l) => (
                    <li key={l.leagueName}>
                      {l.leagueName}: {l.wins}-{l.losses}
                      {l.ties > 0 ? `-${l.ties}` : ""}
                      {l.rank != null ? ` · #${l.rank}` : ""}
                    </li>
                  ))}
                  {record.byLeague.length > 3 && (
                    <li>+{record.byLeague.length - 3} more</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Link leagues to see your W-L record.
            </p>
          )}
        </div>

        {/* Rankings (draft grades) */}
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>
            <BarChart3 className="h-3.5 w-3.5" />
            Rankings
          </div>
          {rankings.length > 0 ? (
            <>
              <p className="mt-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                Draft grades
              </p>
              <ul className="mt-2 space-y-1.5 text-xs" style={{ color: "var(--muted)" }}>
                {rankings.slice(0, 4).map((r, i) => (
                  <li key={`${r.leagueName}-${r.season}-${i}`}>
                    {r.leagueName} ({r.season}): <strong style={{ color: "var(--text)" }}>{r.grade}</strong>
                    {r.rank > 0 ? ` · #${r.rank}` : ""}
                  </li>
                ))}
                {rankings.length > 4 && <li>+{rankings.length - 4} more</li>}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Complete a draft to see grades here.
            </p>
          )}
        </div>

        {/* Achievements */}
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>
            <Award className="h-3.5 w-3.5" />
            Achievements
          </div>
          <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>
            {earnedCount} / {achievements.length}
          </p>
          <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
            {achievements.slice(0, 4).map((a) => (
              <li key={a.id} className={`flex items-center gap-2 ${a.earned ? '' : 'opacity-40'}`}>
                <span>{a.icon}</span>
                <span className="flex-1" style={{ color: a.earned ? "var(--text)" : "var(--muted)" }}>
                  {a.name}
                </span>
                {a.earned && <span className="shrink-0 text-[10px] font-bold text-emerald-400">✓</span>}
              </li>
            ))}
            {achievements.length > 4 && <li>+{achievements.length - 4} more</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
