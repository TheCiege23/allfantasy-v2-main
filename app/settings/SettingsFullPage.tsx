"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { ConnectedAccountsSettingsSection } from "@/app/settings/components/sections/ConnectedAccountsSettingsSection"
import { AutoCoachPreferencesPanel } from "@/components/settings/AutoCoachPreferencesPanel"
import { useEntitlement } from "@/hooks/useEntitlement"
import { useSubscriptionGateOptional } from "@/hooks/useSubscriptionGate"
import { SubscriptionGateModal } from "@/components/subscription/SubscriptionGateModal"
import { getDisplayPlanName } from "@/lib/subscription/feature-access"
import type { SubscriptionPlanId } from "@/lib/subscription/types"
import type { AutoCoachUserPreferences } from "@/lib/autocoach/autoCoachPreferences"

const CARD =
  "rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 mb-4"

const LABEL = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40"

const ACCENT_SWATCHES = [
  { id: "cyan", hex: "#06b6d4" },
  { id: "purple", hex: "#8b5cf6" },
  { id: "green", hex: "#10b981" },
  { id: "orange", hex: "#f59e0b" },
  { id: "pink", hex: "#ec4899" },
  { id: "red", hex: "#ef4444" },
] as const

const MAX_AVATAR_BYTES = 2 * 1024 * 1024

type DashboardToggles = {
  waiverWireCloses: boolean
  tradeActivity: boolean
  leagueChatMessages: boolean
  draftReminders: boolean
  injuryAlerts: boolean
}

const DEFAULT_TOGGLES: DashboardToggles = {
  waiverWireCloses: true,
  tradeActivity: true,
  leagueChatMessages: true,
  draftReminders: true,
  injuryAlerts: true,
}

function parseDashboardToggles(
  raw: Record<string, unknown> | null | undefined
): DashboardToggles {
  const dt = (raw?.dashboardToggles as Partial<DashboardToggles> | undefined) ?? {}
  return {
    waiverWireCloses: dt.waiverWireCloses ?? DEFAULT_TOGGLES.waiverWireCloses,
    tradeActivity: dt.tradeActivity ?? DEFAULT_TOGGLES.tradeActivity,
    leagueChatMessages: dt.leagueChatMessages ?? DEFAULT_TOGGLES.leagueChatMessages,
    draftReminders: dt.draftReminders ?? DEFAULT_TOGGLES.draftReminders,
    injuryAlerts: dt.injuryAlerts ?? DEFAULT_TOGGLES.injuryAlerts,
  }
}

function profileInitials(name: string): string {
  const t = name.trim()
  if (!t) return "?"
  const at = t.indexOf("@")
  const base = at > 0 ? t.slice(0, at) : t
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase() || "?"
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-white/85">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          checked ? "bg-cyan-500" : "bg-white/10"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  )
}

function readFantasyPrefs(
  np: Record<string, unknown> | null | undefined
): {
  primarySport: string
  defaultScoring: string
  favoriteTeam: string
} {
  const f = (np?.fantasyPreferences as Record<string, unknown> | undefined) ?? {}
  return {
    primarySport: typeof f.primarySport === "string" ? f.primarySport : "NFL",
    defaultScoring: typeof f.defaultScoring === "string" ? f.defaultScoring : "PPR",
    favoriteTeam: typeof f.favoriteTeam === "string" ? f.favoriteTeam : "",
  }
}

function readAccent(np: Record<string, unknown> | null | undefined): string {
  const a = np?.accentColor
  return typeof a === "string" && a.startsWith("#") ? a : "#06b6d4"
}

export default function SettingsFullPage() {
  const { data: session } = useSession()
  const { profile, loading, saving, error, fetchProfile, updateProfile } = useSettingsProfile()

  const [displayName, setDisplayName] = useState("")
  const [username, setUsername] = useState("")
  const [bio, setBio] = useState("")
  const [profileSaveMsg, setProfileSaveMsg] = useState<string | null>(null)

  const [toggles, setToggles] = useState<DashboardToggles>(DEFAULT_TOGGLES)
  const [toggleSavingKey, setToggleSavingKey] = useState<string | null>(null)

  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark")
  const [accent, setAccent] = useState("#06b6d4")
  const [appearanceSaving, setAppearanceSaving] = useState(false)

  const [primarySport, setPrimarySport] = useState("NFL")
  const [defaultScoring, setDefaultScoring] = useState("PPR")
  const [favoriteTeam, setFavoriteTeam] = useState("")
  const [fantasySaving, setFantasySaving] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [autoCoachGlobal, setAutoCoachGlobal] = useState(true)
  const [autoCoachSaving, setAutoCoachSaving] = useState(false)
  const [autoCoachGateOpen, setAutoCoachGateOpen] = useState(false)
  const defaultAcPrefs: AutoCoachUserPreferences = useMemo(
    () => ({
      learnTendencies: false,
      aggressiveness: "balanced",
      questionableAutomation: "never",
      notifyAutoSwapInApp: true,
      notifyAutoSwapEmail: false,
      confidenceThreshold: 65,
      positionOverrides: {},
      excludedPlayerIds: [],
    }),
    [],
  )
  const [acPrefs, setAcPrefs] = useState<AutoCoachUserPreferences>(defaultAcPrefs)
  const [acPrefsSaving, setAcPrefsSaving] = useState(false)
  const [swapLogsOpen, setSwapLogsOpen] = useState(false)
  const [swapLogsLoading, setSwapLogsLoading] = useState(false)
  const [swapLogs, setSwapLogs] = useState<
    Array<{
      id: string
      swapMadeAt: string
      leagueId: string
      playerOutName: string
      playerInName: string
      playerOutStatus: string
      decisionNotes: string | null
    }>
  >([])
  const proAutoCoachEnt = useEntitlement("pro_autocoach")
  const gateOptional = useSubscriptionGateOptional()
  const hasProAutoCoach = proAutoCoachEnt.hasAccess("pro_autocoach")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const np = useMemo(
    () => (profile?.notificationPreferences as Record<string, unknown> | null) ?? null,
    [profile?.notificationPreferences]
  )

  const discordParamToastDone = useRef(false)
  useEffect(() => {
    if (typeof window === "undefined" || discordParamToastDone.current) return
    const p = new URLSearchParams(window.location.search)
    const d = p.get("discord")
    if (!d) return
    discordParamToastDone.current = true
    if (d === "connected") {
      toast.success("Discord connected")
      void fetchProfile()
    }
    if (d === "error") toast.error("Discord connection failed")
    if (d === "bot-linked") {
      toast.success("Discord server linked for bot setup")
      void fetchProfile()
    }
    if (d === "bot-not-ready") toast.message("Discord bot is not configured on this environment yet.")
    const clean = new URL(window.location.href)
    clean.searchParams.delete("discord")
    const next = clean.pathname + (clean.search ? clean.search : "") + clean.hash
    window.history.replaceState({}, "", next)
  }, [fetchProfile])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/user/autocoach", { cache: "no-store" })
      if (!res.ok || cancelled) return
      const j = (await res.json()) as {
        globalEnabled?: boolean
        preferences?: Partial<AutoCoachUserPreferences>
      }
      if (typeof j.globalEnabled === "boolean") setAutoCoachGlobal(j.globalEnabled)
      if (j.preferences && typeof j.preferences === "object") {
        setAcPrefs((prev) => ({ ...defaultAcPrefs, ...prev, ...j.preferences }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session?.user?.id, defaultAcPrefs])

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.displayName ?? session?.user?.name ?? "")
    setUsername(profile.username ?? "")
    setBio(profile.bio ?? "")
    setToggles(parseDashboardToggles(np))
    const th = profile.themePreference
    if (th === "light" || th === "dark" || th === "system") setTheme(th)
    else if (th === "legacy") setTheme("dark")
    else setTheme("dark")
    setAccent(readAccent(np))
    const fp = readFantasyPrefs(np)
    setPrimarySport(fp.primarySport)
    setDefaultScoring(fp.defaultScoring)
    setFavoriteTeam(fp.favoriteTeam)
  }, [profile, session?.user?.name, np])

  const email = profile?.email ?? session?.user?.email ?? ""
  const avatarUrl = profile?.profileImageUrl ?? session?.user?.image ?? null

  const persistAutoCoachGlobal = useCallback(async (next: boolean) => {
    setAutoCoachSaving(true)
    try {
      const res = await fetch("/api/user/autocoach/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (res.ok) {
        const j = (await res.json()) as { globalEnabled?: boolean }
        if (typeof j.globalEnabled === "boolean") setAutoCoachGlobal(j.globalEnabled)
      }
    } finally {
      setAutoCoachSaving(false)
    }
  }, [])

  const patchAcPrefs = useCallback(
    async (patch: Partial<AutoCoachUserPreferences>) => {
      if (!hasProAutoCoach) {
        if (gateOptional) gateOptional.gate("pro_autocoach")
        else setAutoCoachGateOpen(true)
        return
      }
      setAcPrefsSaving(true)
      setAcPrefs((prev) => ({ ...prev, ...patch }))
      try {
        const res = await fetch("/api/user/autocoach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: patch }),
        })
        if (!res.ok) {
          toast.error("Could not save lineup protection preferences")
          const r = await fetch("/api/user/autocoach", { cache: "no-store" })
          if (r.ok) {
            const jj = (await r.json()) as { preferences?: Partial<AutoCoachUserPreferences> }
            if (jj.preferences) setAcPrefs((p) => ({ ...defaultAcPrefs, ...p, ...jj.preferences }))
          }
        }
      } finally {
        setAcPrefsSaving(false)
      }
    },
    [defaultAcPrefs, gateOptional, hasProAutoCoach],
  )

  const loadSwapLogs = useCallback(async () => {
    setSwapLogsLoading(true)
    try {
      const res = await fetch("/api/user/autocoach/swap-logs", { cache: "no-store" })
      if (!res.ok) return
      const j = (await res.json()) as {
        swaps?: Array<{
          id: string
          swapMadeAt: string
          leagueId: string
          playerOutName: string
          playerInName: string
          playerOutStatus: string
          decisionNotes: string | null
        }>
      }
      setSwapLogs(j.swaps ?? [])
    } finally {
      setSwapLogsLoading(false)
    }
  }, [])

  const persistToggle = useCallback(
    async (key: keyof DashboardToggles, next: boolean) => {
      setToggleSavingKey(key)
      setToggles((prev) => ({ ...prev, [key]: next }))
      try {
        const res = await fetch("/api/user/notifications", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dashboardToggles: { [key]: next },
          }),
        })
        if (!res.ok) {
          await fetchProfile()
          return
        }
        await fetchProfile()
      } catch {
        await fetchProfile()
      } finally {
        setToggleSavingKey(null)
      }
    },
    [fetchProfile]
  )

  const handleAvatarPick = () => fileInputRef.current?.click()

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setProfileSaveMsg("Please choose an image file.")
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setProfileSaveMsg("Image must be 2MB or smaller.")
      return
    }
    setAvatarUploading(true)
    setProfileSaveMsg(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/user/avatar", { method: "POST", body: fd })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) {
        setProfileSaveMsg(data.error ?? "Upload failed")
        return
      }
      if (data.url) {
        await updateProfile({ avatarUrl: data.url, avatarPreset: null })
      }
      await fetchProfile()
      setProfileSaveMsg("Avatar updated.")
    } catch {
      setProfileSaveMsg("Upload failed.")
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileSaveMsg(null)
    const u = username.trim()
    if (u && !/^[A-Za-z0-9_]{3,30}$/.test(u)) {
      setProfileSaveMsg("Username must be 3-30 characters with letters, numbers, or underscores.")
      return
    }
    const ok = await updateProfile({
      displayName: displayName.trim() || null,
      username: u || null,
      bio: bio.trim() || null,
    })
    setProfileSaveMsg(ok ? "Profile saved." : null)
  }

  const applyTheme = async (t: "dark" | "light" | "system") => {
    setTheme(t)
    setAppearanceSaving(true)
    try {
      await updateProfile({ themePreference: t })
      await fetchProfile()
    } finally {
      setAppearanceSaving(false)
    }
  }

  const applyAccent = async (hex: string) => {
    setAccent(hex)
    setAppearanceSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: hex }),
      })
      if (res.ok) await fetchProfile()
    } finally {
      setAppearanceSaving(false)
    }
  }

  const handleSaveFantasy = async (e: React.FormEvent) => {
    e.preventDefault()
    setFantasySaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fantasyPreferences: {
            primarySport,
            defaultScoring,
            favoriteTeam: favoriteTeam.trim(),
          },
        }),
      })
      if (res.ok) await fetchProfile()
    } finally {
      setFantasySaving(false)
    }
  }

  const handleExport = async () => {
    const res = await fetch("/api/user/export", { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `allfantasy-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return
    setDeleteBusy(true)
    try {
      const res = await fetch("/api/user/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      })
      if (res.ok) {
        setDeleteOpen(false)
        setDeleteConfirm("")
        // Account PII is erased + auth revoked — sign the user out and leave.
        window.location.href = "/api/auth/signout?callbackUrl=/"
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="mx-auto max-w-xl px-4 py-6 pb-24">
        <div className="mb-6 flex flex-col gap-4 border-b border-white/[0.06] pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="mb-3 inline-flex items-center gap-2 text-sm text-cyan-400/90 hover:text-cyan-300"
            >
              <ArrowLeft className="h-4 w-4" />
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold text-white">Settings</h1>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="shrink-0 self-start rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
          >
            Log out
          </button>
        </div>

        {loading && !profile ? (
          <p className="text-sm text-white/55">Loading settings…</p>
        ) : !profile ? (
          <div className="space-y-4">
            <div
              className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100/95"
              role="alert"
            >
              {error ??
                "Could not load your settings. You can sign out and try again later."}
            </div>
            <button
              type="button"
              onClick={() => void fetchProfile()}
              className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {error ? (
              <p className="mb-4 text-sm text-amber-300/90">{error}</p>
            ) : null}

            {/* 1. Profile */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Profile
          </h2>
          <div className="mb-5 flex items-center gap-4">
            <button
              type="button"
              onClick={handleAvatarPick}
              disabled={avatarUploading}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/15 bg-gradient-to-br from-cyan-600/40 to-blue-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              aria-label="Upload avatar"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white">
                  {profileInitials(displayName || session?.user?.name || "U")}
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFile}
            />
            <p className="text-xs text-white/45">
              {avatarUploading ? "Uploading…" : "Click to upload a new photo (max 2MB)."}
            </p>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className={LABEL} htmlFor="displayName">
                Display name
              </label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-500/40"
                autoComplete="name"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="username">
                Username
              </label>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-500/40"
                autoComplete="username"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                value={email}
                disabled
                readOnly
                className="w-full cursor-not-allowed rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white/50"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="bio">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                maxLength={160}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-500/40"
                placeholder="Short bio…"
              />
              <p className="mt-1 text-right text-[10px] text-white/35">{bio.length}/160</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
            {profileSaveMsg ? (
              <p className="text-sm text-emerald-400/90">{profileSaveMsg}</p>
            ) : null}
          </form>
        </section>

        {/* 2. Connected accounts — sign-in, Discord, fantasy/import platforms */}
        <section className={CARD}>
          <ConnectedAccountsSettingsSection
            profile={profile}
            onRefetchProfile={() => {
              void fetchProfile()
            }}
          />
        </section>

        {/* 3. Notifications */}
        <section className={CARD}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
            Notifications
          </h2>
          <p className="mb-3 text-xs text-white/40">Changes save automatically.</p>
          <div className="divide-y divide-white/[0.06]">
            <ToggleRow
              label="Waiver wire closes"
              checked={toggles.waiverWireCloses}
              disabled={toggleSavingKey === "waiverWireCloses"}
              onChange={(v) => void persistToggle("waiverWireCloses", v)}
            />
            <ToggleRow
              label="Trade activity"
              checked={toggles.tradeActivity}
              disabled={toggleSavingKey === "tradeActivity"}
              onChange={(v) => void persistToggle("tradeActivity", v)}
            />
            <ToggleRow
              label="League chat messages"
              checked={toggles.leagueChatMessages}
              disabled={toggleSavingKey === "leagueChatMessages"}
              onChange={(v) => void persistToggle("leagueChatMessages", v)}
            />
            <ToggleRow
              label="Draft reminders"
              checked={toggles.draftReminders}
              disabled={toggleSavingKey === "draftReminders"}
              onChange={(v) => void persistToggle("draftReminders", v)}
            />
            <ToggleRow
              label="Injury alerts"
              checked={toggles.injuryAlerts}
              disabled={toggleSavingKey === "injuryAlerts"}
              onChange={(v) => void persistToggle("injuryAlerts", v)}
            />
          </div>
        </section>

        <section className={CARD}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/50">
            AI Auto Start/Sit Protection
          </h2>
          <p className="mb-3 text-xs text-white/40">
            Master switch: pause all leagues. When on, enable per league on each team tab. Uses live status and
            Start/Sit projections; swaps only before each player&apos;s game — not Best Ball, not in-game fixes.
          </p>
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm text-white/85">Protection active (all leagues)</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoCoachGlobal}
              disabled={autoCoachSaving}
              onClick={() => {
                if (!hasProAutoCoach) {
                  if (gateOptional) gateOptional.gate("pro_autocoach")
                  else setAutoCoachGateOpen(true)
                  return
                }
                void persistAutoCoachGlobal(!autoCoachGlobal)
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                autoCoachGlobal && hasProAutoCoach ? "bg-cyan-500" : "bg-white/10"
              } ${!hasProAutoCoach ? "cursor-pointer opacity-50" : ""}`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  autoCoachGlobal && hasProAutoCoach ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {!hasProAutoCoach ? (
            <p className="mt-2 text-[11px] text-white/35">
              Requires AF Pro — tap the toggle to see upgrade options.
            </p>
          ) : null}

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            {hasProAutoCoach && autoCoachGlobal ? (
              <AutoCoachPreferencesPanel />
            ) : (
              <p className="text-[11px] text-white/40">
                Enable AutoCoach globally above to manage preferences.
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              onClick={() => {
                const next = !swapLogsOpen
                setSwapLogsOpen(next)
                if (next && swapLogs.length === 0) void loadSwapLogs()
              }}
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300"
            >
              {swapLogsOpen ? "Hide" : "View"} recent auto-swaps
            </button>
            {swapLogsOpen ? (
              <div className="mt-2 space-y-2">
                {swapLogsLoading ? (
                  <p className="text-[11px] text-white/40">Loading…</p>
                ) : swapLogs.length === 0 ? (
                  <p className="text-[11px] text-white/40">No swaps logged yet.</p>
                ) : (
                  <ul className="max-h-56 space-y-2 overflow-y-auto text-[11px] text-white/70">
                    {swapLogs.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5"
                      >
                        <p className="font-medium text-white/85">
                          {s.playerOutName} ({s.playerOutStatus}) → {s.playerInName}
                        </p>
                        <p className="text-white/45">{new Date(s.swapMadeAt).toLocaleString()}</p>
                        {s.decisionNotes ? (
                          <p className="mt-0.5 text-white/35">{s.decisionNotes}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </section>

        {autoCoachGateOpen && !gateOptional ? (
          <SubscriptionGateModal isOpen onClose={() => setAutoCoachGateOpen(false)} featureId="pro_autocoach" />
        ) : null}

        {/* 4. Subscription & Billing */}
        <section className={CARD} data-testid="settings-subscription-section">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Subscription &amp; Billing
          </h2>
          {proAutoCoachEnt.loading ? (
            <div className="mb-3 h-10 animate-pulse rounded-lg bg-white/[0.05]" data-testid="settings-subscription-loading" />
          ) : proAutoCoachEnt.error ? (
            <p className="mb-3 text-sm text-red-400" data-testid="settings-subscription-error">
              Unable to verify subscription status.
            </p>
          ) : (
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white/85">
                {proAutoCoachEnt.isActiveOrGrace
                  ? proAutoCoachEnt.entitlement?.plans?.length
                    ? `Active: ${proAutoCoachEnt.entitlement.plans.map((p) => getDisplayPlanName(p as SubscriptionPlanId) ?? p).join(", ")}`
                    : "Active subscription"
                  : proAutoCoachEnt.entitlement?.status === "past_due"
                  ? "Past due — update billing"
                  : proAutoCoachEnt.entitlement?.status === "expired"
                  ? "Subscription expired"
                  : "Free plan"}
              </p>
              <p className="mt-0.5 text-[11px] text-white/40">
                {proAutoCoachEnt.isActiveOrGrace
                  ? "Full AI features unlocked."
                  : "Upgrade to unlock Chimmy AI, bracket analysis, and commissioner tools."}
              </p>
              {proAutoCoachEnt.isAdminBypassAccount && (
                <p className="mt-1 text-[11px] italic text-white/40" data-testid="settings-subscription-bypass-notice">
                  Admin bypass — not a real Stripe subscription.
                </p>
              )}
            </div>
          </div>
          )}
          <div className="flex flex-col gap-2">
            <Link
              href="/pricing"
              data-testid="settings-view-plans-link"
              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-center text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20"
            >
              {proAutoCoachEnt.isActiveOrGrace ? "View or change plans" : "Upgrade to AF Pro"}
            </Link>
            {proAutoCoachEnt.isActiveOrGrace ? (
              <a
                href="/api/subscription/billing-portal"
                data-testid="settings-billing-portal-link"
                className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-center text-sm font-medium text-white/70 hover:bg-white/[0.07]"
              >
                Manage billing &amp; invoices
              </a>
            ) : null}
          </div>
        </section>

        {/* 5. Appearance */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Appearance
          </h2>
          <p className={LABEL}>Theme</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {(["dark", "light", "system"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={appearanceSaving}
                onClick={() => void applyTheme(t)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  theme === t
                    ? "border-cyan-500/30 bg-cyan-500/20 text-cyan-400"
                    : "border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className={LABEL}>Accent color</p>
          <div className="flex flex-wrap gap-3">
            {ACCENT_SWATCHES.map((s) => {
              const selected = accent.toLowerCase() === s.hex.toLowerCase()
              return (
                <button
                  key={s.id}
                  type="button"
                  title={s.id}
                  onClick={() => void applyAccent(s.hex)}
                  disabled={appearanceSaving}
                  className={`h-5 w-5 rounded-full border border-white/10 transition ${
                    selected ? "ring-2 ring-white ring-offset-1 ring-offset-[#07071a]" : ""
                  }`}
                  style={{ backgroundColor: s.hex }}
                />
              )
            })}
          </div>
        </section>

        {/* 5. Fantasy preferences */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Fantasy preferences
          </h2>
          <form onSubmit={(e) => void handleSaveFantasy(e)} className="space-y-4">
            <div>
              <p className={LABEL}>Primary sport</p>
              <div className="flex flex-wrap gap-2">
                {["NFL", "NBA", "MLB", "NHL", "All"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPrimarySport(s)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      primarySport === s
                        ? "border-cyan-500/30 bg-cyan-500/20 text-cyan-400"
                        : "border-white/[0.08] bg-white/[0.04] text-white/70"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={LABEL}>Default scoring</p>
              <div className="flex flex-wrap gap-2">
                {["PPR", "Half PPR", "Standard"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDefaultScoring(s)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      defaultScoring === s
                        ? "border-cyan-500/30 bg-cyan-500/20 text-cyan-400"
                        : "border-white/[0.08] bg-white/[0.04] text-white/70"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="favoriteTeam">
                Favorite team
              </label>
              <input
                id="favoriteTeam"
                value={favoriteTeam}
                onChange={(e) => setFavoriteTeam(e.target.value)}
                placeholder="e.g. Kansas City Chiefs"
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={fantasySaving}
              className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {fantasySaving ? "Saving…" : "Save fantasy preferences"}
            </button>
          </form>
        </section>

        {/* 7. Account */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Account
          </h2>
          <div className="flex flex-col gap-2">
            <Link
              href="/settings/security"
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-center text-sm font-medium text-white hover:bg-white/[0.07]"
            >
              Change password
            </Link>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-medium text-white hover:bg-white/[0.07]"
            >
              Export my data
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteOpen(true)
                setDeleteConfirm("")
              }}
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-300 hover:bg-rose-500/20"
            >
              Delete account
            </button>
          </div>
        </section>
          </>
        )}
      </div>

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0c1020] p-5 shadow-xl"
          >
            <h3 className="text-lg font-semibold text-white">Delete account</h3>
            <p className="mt-2 text-sm text-white/55">
              This cannot be undone. Type <span className="font-mono text-white/90">DELETE</span> to
              confirm.
            </p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white"
              placeholder="DELETE"
              autoComplete="off"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirm !== "DELETE" || deleteBusy}
                onClick={() => void handleDeleteAccount()}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {deleteBusy ? "…" : "Delete my account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
