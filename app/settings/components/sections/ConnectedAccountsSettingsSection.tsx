"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { signIn } from "next-auth/react"
import { DiscordIcon } from "@/app/components/icons/DiscordIcon"
import { discordAvatarUrl } from "@/lib/discord/avatar"
import {
  getConnectedAccounts,
  disconnectConnectedAccount,
  getProviderConnectAction,
  canDisconnectProvider,
  type SignInProviderId,
  type ProviderStatus,
} from "@/lib/connected-accounts"
import { ConnectedIdentityRenderer } from "@/components/connected-accounts/ConnectedIdentityRenderer"
import { EspnCookieConnection } from "@/components/settings/EspnCookieConnection"
import type { SettingsProfile } from "./settings-types"

const IMPORT_PLATFORM_IDS = ["yahoo", "espn", "mfl", "fleaflicker", "fantrax"] as const

function signInProviderLabel(id: SignInProviderId, t: (key: string) => string): string {
  return t(`settings.connected.signInProvider.${id}`)
}

function localizedProviderFallback(providerId: SignInProviderId, t: (key: string) => string): string {
  const key = `settings.connected.fallback.${providerId}`
  const msg = t(key)
  return msg !== key ? msg : t("settings.connected.fallbackGeneric")
}

export function ConnectedAccountsSettingsSection({
  profile,
  onRefetchProfile,
}: {
  profile: SettingsProfile
  onRefetchProfile: () => void
}) {
  const { t, tInterpolate } = useLanguage()
  const searchParams = useSearchParams()
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyProviderId, setBusyProviderId] = useState<SignInProviderId | null>(null)
  const [linkingProvider, setLinkingProvider] = useState<"discord" | "spotify" | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusTone, setStatusTone] = useState<"info" | "error" | "success" | null>(null)

  const linkedProvidersCount = providers.filter((provider) => provider.linked).length
  const hasPassword = !!profile?.hasPassword

  const loadProviders = async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      if (asRefresh) onRefetchProfile()
      const data = await getConnectedAccounts()
      setProviders(data.providers)
    } catch {
      setStatusTone("error")
      setStatusMessage(t("settings.connected.loadError"))
    } finally {
      if (asRefresh) setRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    loadProviders()
  }, [])

  useEffect(() => {
    const discordStatus = searchParams?.get("discord")
    const spotifyStatus = searchParams?.get("spotify")
    if (discordStatus === "connected") {
      setStatusTone("success")
      setStatusMessage("Discord connected. Your pool and league sharing tools can now use this account.")
    } else if (discordStatus === "error") {
      setStatusTone("error")
      setStatusMessage("Discord could not be connected. Check the Discord app redirect URL and try again.")
    } else if (spotifyStatus === "connected") {
      setStatusTone("success")
      setStatusMessage("Spotify connected. Music controls are now available where supported.")
    } else if (spotifyStatus === "error") {
      setStatusTone("error")
      setStatusMessage("Spotify could not be connected. Check the Spotify app redirect URL and try again.")
    }
  }, [searchParams])

  useEffect(() => {
    const onFocus = () => {
      void loadProviders(true)
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus)
      return () => window.removeEventListener("focus", onFocus)
    }
  }, [])

  const handleConnect = (providerId: SignInProviderId, configured: boolean) => {
    const action = getProviderConnectAction(providerId, configured)
    if (action === "fallback") {
      setStatusTone("info")
      setStatusMessage(localizedProviderFallback(providerId, t))
      return
    }
    setStatusMessage(null)
    setStatusTone(null)
    setBusyProviderId(providerId)
    // signIn() for OAuth providers does a full-page redirect — the .finally() fires
    // only if the redirect does NOT happen (e.g. the provider is missing on the server).
    void signIn(providerId, { callbackUrl: "/settings?tab=connected" })
      .then((result) => {
        // result is only defined when redirect:false is passed; for OAuth providers NextAuth
        // does a hard redirect so we never reach this branch on success.
        if (result?.error) {
          setStatusTone("error")
          setStatusMessage(
            t("settings.connected.connectError") ||
              `Could not connect ${providerId}. Please try again.`
          )
        }
      })
      .catch(() => {
        setStatusTone("error")
        setStatusMessage(`Could not connect ${providerId}. Please try again.`)
      })
      .finally(() => {
        setBusyProviderId(null)
      })
  }

  const handleDisconnectSleeper = async () => {
    if (typeof window !== "undefined" && !window.confirm(t("settings.connected.confirmDisconnectSleeper"))) return
    const res = await fetch("/api/user/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disconnectSleeper: true }),
    })
    if (res.ok) {
      onRefetchProfile()
      await loadProviders(true)
    }
  }

  const handleDisconnectDiscord = async () => {
    const res = await fetch("/api/auth/discord/disconnect", { method: "POST" })
    if (res.ok) {
      onRefetchProfile()
      await loadProviders(true)
      setStatusTone("success")
      setStatusMessage("Discord disconnected.")
    } else {
      setStatusTone("error")
      setStatusMessage("Discord could not be disconnected. Please try again.")
    }
  }

  const handleLinkIdentity = async (provider: "discord" | "spotify") => {
    setStatusMessage(null)
    setStatusTone(null)
    setLinkingProvider(provider)

    try {
      // Redirect to the custom OAuth flow routes
      const authRoute = provider === "discord" ? "/api/auth/discord" : "/api/auth/spotify"
      window.location.href = authRoute
    } catch (error) {
      setStatusTone("error")
      setStatusMessage(error instanceof Error ? error.message : `Failed to connect ${provider}.`)
      setLinkingProvider(null)
    }
  }

  const handleDisconnect = async (provider: ProviderStatus) => {
    if (!canDisconnectProvider(provider, linkedProvidersCount, hasPassword)) {
      setStatusTone("error")
      setStatusMessage(
        tInterpolate("settings.connected.disconnectBlocked", {
          provider: signInProviderLabel(provider.id, t),
        }),
      )
      return
    }
    if (typeof window !== "undefined") {
      const shouldDisconnect = window.confirm(
        tInterpolate("settings.connected.confirmDisconnectProvider", {
          provider: provider.name,
        }),
      )
      if (!shouldDisconnect) return
    }
    setBusyProviderId(provider.id)
    setStatusMessage(null)
    setStatusTone(null)
    const result = await disconnectConnectedAccount(provider.id)
    setBusyProviderId(null)
    if (!result.ok) {
      setStatusTone("error")
      if (result.error === "LOCKOUT_RISK") {
        setStatusMessage(t("settings.connected.errorLockout"))
      } else {
        setStatusMessage(t("settings.connected.errorDisconnect"))
      }
      return
    }
    if (result.providers && result.providers.length > 0) {
      setProviders(result.providers)
    } else {
      await loadProviders(true)
    }
    setStatusTone("success")
    setStatusMessage(
      tInterpolate("settings.connected.disconnectSuccess", { provider: provider.name }),
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.connected.title")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{t("settings.connected.subtitle")}</p>
      </div>
      {statusMessage && (
        <div
          className="rounded-xl border px-3 py-2 text-sm"
          style={{
            borderColor: statusTone === "error" ? "var(--accent-red)" : "var(--accent-cyan)",
            background:
              statusTone === "error"
                ? "color-mix(in srgb, var(--accent-red) 10%, transparent)"
                : statusTone === "success"
                  ? "color-mix(in srgb, #10b981 16%, transparent)"
                  : "color-mix(in srgb, var(--accent-cyan) 12%, transparent)",
            color: "var(--text)",
          }}
        >
          {statusMessage}
        </div>
      )}
      <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium" style={{ color: "var(--muted2)" }}>{t("settings.connected.signInProviders")}</p>
          <button
            type="button"
            onClick={() => void loadProviders(true)}
            disabled={refreshing}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {refreshing ? t("settings.connected.refreshing") : t("settings.connected.refreshStatus")}
          </button>
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.connected.loading")}</p>
        ) : (
          <ul className="space-y-3">
            {providers.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-center justify-between gap-2">
                <ConnectedIdentityRenderer provider={provider} size="md" />
                {!provider.linked ? (
                  <button
                    type="button"
                    onClick={() => handleConnect(provider.id, provider.configured)}
                    disabled={busyProviderId === provider.id}
                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {busyProviderId === provider.id ? t("settings.connected.connecting") : t("settings.connected.connect")}
                  </button>
                ) : canDisconnectProvider(provider, linkedProvidersCount, hasPassword) ? (
                  <button
                    type="button"
                    onClick={() => void handleDisconnect(provider)}
                    disabled={busyProviderId === provider.id}
                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
                  >
                    {busyProviderId === provider.id
                      ? t("settings.connected.disconnecting")
                      : t("settings.connected.disconnect")}
                  </button>
                ) : (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.connected.protected")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.connected.lockoutHint")}</p>
      </div>

      <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--muted2)" }}>{t("settings.connected.discord")}</p>
        {!profile?.discordUserId ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.connected.discordBlurb")}</p>
            <button
              type="button"
              onClick={() => void handleLinkIdentity("discord")}
              disabled={linkingProvider === "discord"}
              data-testid="settings-connect-discord"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "#5865F2", background: "color-mix(in srgb, #5865F2 18%, transparent)", color: "var(--text)" }}
            >
              <DiscordIcon size={16} className="text-[#5865F2]" />
              {linkingProvider === "discord" ? t("settings.connected.connecting") : t("settings.connected.connectDiscord")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={discordAvatarUrl(profile.discordUserId, profile.discordAvatar)}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {profile.discordUsername ?? t("settings.connected.discordFallbackName")}
                </p>
                <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
                  {profile.discordEmail ?? t("settings.connected.connectedLabel")}
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="settings-disconnect-discord"
              onClick={() => void handleDisconnectDiscord()}
              className="rounded-lg border px-3 py-2 text-xs font-medium"
              style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
            >
              {t("settings.connected.disconnect")}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--muted2)" }}>Spotify</p>
        {!(profile as any)?.spotifyConnectedAt ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>Connect Spotify to play music while managing your leagues.</p>
            <button
              type="button"
              onClick={() => void handleLinkIdentity("spotify")}
              disabled={linkingProvider === "spotify"}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "#1DB954", background: "color-mix(in srgb, #1DB954 18%, transparent)", color: "var(--text)" }}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              {linkingProvider === "spotify" ? t("settings.connected.connecting") : "Connect Spotify"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "#1DB95433" }}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                  {(profile as any)?.spotifyDisplayName ?? "Spotify Connected"}
                </p>
                <p className="truncate text-xs" style={{ color: "var(--muted)" }}>Connected</p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const res = await fetch("/api/auth/spotify/disconnect", { method: "POST" })
                if (res.ok) {
                  onRefetchProfile()
                  await loadProviders(true)
                  setStatusTone("success")
                  setStatusMessage("Spotify disconnected.")
                } else {
                  setStatusTone("error")
                  setStatusMessage("Spotify could not be disconnected. Please try again.")
                }
              }}
              className="rounded-lg border px-3 py-2 text-xs font-medium"
              style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--muted2)" }}>{t("settings.connected.fantasyPlatformsTitle")}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {t("settings.connected.fantasyPlatformsBody")}
        </p>
        <ul className="space-y-3">
          <li className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div>
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.connected.sleeper")}</span>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {profile?.sleeperUsername
                  ? tInterpolate("settings.connected.linkedAs", { username: profile.sleeperUsername })
                  : t("settings.connected.notLinked")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profile?.sleeperUsername ? (
                <>
                  <span className="text-xs text-emerald-500">{t("settings.connected.linkedBadge")}</span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnectSleeper()}
                    className="rounded-lg border px-3 py-2 text-xs font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {t("settings.connected.disconnect")}
                  </button>
                </>
              ) : (
                <Link
                  href="/settings/connect/sleeper"
                  className="rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {t("settings.connected.connectSleeper")}
                </Link>
              )}
            </div>
          </li>
          {IMPORT_PLATFORM_IDS.map((id) => (
            <li key={id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{t(`settings.connected.platform.${id}`)}</span>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{t(`settings.connected.hint.${id}`)}</p>
                </div>
                <Link
                  href="/import"
                  className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {t("settings.connected.openImport")}
                </Link>
              </div>
              {id === "espn" && <EspnCookieConnection />}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/legacy-import"
            className="rounded-lg border px-3 py-2 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.connected.legacyImportLink")}
          </Link>
          <Link
            href="/import"
            className="rounded-lg border px-3 py-2 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.connected.importHub")}
          </Link>
        </div>
      </div>
    </div>
  )
}
