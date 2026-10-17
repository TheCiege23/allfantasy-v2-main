"use client"

import Link from "next/link"
import Image from "next/image"
import { useState, useEffect } from "react"
import { useOptionalSession } from "@/components/auth/useOptionalSession"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import NotificationBell from "@/components/shared/NotificationBell"
import SettingsModal from "@/components/navigation/SettingsModal"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { loginUrlWithIntent, signupUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import { Settings as SettingsIcon, Shield } from "lucide-react"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"

export default function HomeTopNav() {
  const { data: session, status } = useOptionalSession()
  const { t } = useOptionalLanguage()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const { profile } = useSettingsProfile()

  const isAuthenticated = status === "authenticated"
  const user = session?.user as { username?: string; name?: string; email?: string | null } | undefined
  const username =
    user?.username ||
    user?.name ||
    t("common.guest")

  useEffect(() => {
    if (!isAuthenticated) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    fetch("/api/user/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.isAdmin) setIsAdmin(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isAuthenticated])

  return (
    <>
      <header
        className="w-full border-b px-3 sm:px-4"
        style={{ borderColor: "color-mix(in srgb, var(--border) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 py-2 sm:py-3">
          {/* Logo */}
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="flex items-center gap-2 min-w-0" aria-label="AllFantasy home">
              <Image
                src="/af-crest.svg"
                alt="AllFantasy Crest"
                width={32}
                height={32}
                className="mode-logo-safe h-8 w-8 rounded-lg object-contain"
              />
              <span
                className="mode-wordmark-safe hidden text-sm font-semibold tracking-tight sm:inline-block"
                style={{ color: "var(--text)" }}
              >
                AllFantasy
              </span>
            </Link>
          </div>

          {/* Right: Sign In / Sign Up or user + Admin + toggles */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {isAuthenticated ? (
              <>
                <Link
                  href="/profile"
                  className="flex items-center gap-2 min-w-0 max-w-[140px]"
                  title={t("common.profile")}
                >
                  <IdentityImageRenderer
                    avatarUrl={profile?.profileImageUrl}
                    avatarPreset={profile?.avatarPreset}
                    displayName={profile?.displayName}
                    username={username}
                    size="sm"
                  />
                  <span className="hidden sm:inline truncate text-xs font-medium" style={{ color: "var(--muted)" }}>
                    {username}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                  style={{
                    borderColor: "var(--border)",
                    background: "color-mix(in srgb, var(--panel2) 84%, transparent)",
                    color: "var(--muted2)",
                  }}
                  aria-label={t("common.openSettings")}
                >
                  <SettingsIcon className="h-4 w-4" />
                </button>
                <NotificationBell />
              </>
            ) : (
              <>
                <Link
                  href={loginUrlWithIntent("/dashboard")}
                  className="inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium sm:text-sm"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text)",
                    background: "color-mix(in srgb, var(--panel2) 84%, transparent)",
                  }}
                >
                  {t("common.signIn")}
                </Link>
                <Link
                  href={signupUrlWithIntent("/dashboard")}
                  className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold sm:text-sm"
                  style={{
                    background: "var(--accent-cyan)",
                    color: "var(--on-accent-bg)",
                  }}
                >
                  {t("common.signUp")}
                </Link>
              </>
            )}

            <div className="hidden sm:inline-flex">
              <LanguageToggle />
            </div>

            {isAdmin && (
              <Link
                href="/admin"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-amber) 45%, var(--border))",
                  background: "color-mix(in srgb, var(--accent-amber) 14%, transparent)",
                  color: "var(--accent-amber-strong)",
                }}
                aria-label={t("common.admin")}
                title={t("common.admin")}
              >
                <Shield className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Mobile: language row */}
        <div className="flex items-center gap-2 pb-2 sm:hidden">
          <LanguageToggle />
        </div>
      </header>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} username={username} />
    </>
  )
}
