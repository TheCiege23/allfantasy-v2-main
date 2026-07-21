"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import {
  refreshLegacyImportStatus,
  LEGACY_PROVIDER_IDS,
  getLegacyProviderName,
  getImportStatusLabel,
  getProviderStatus,
  getLegacyProviderPrimaryAction,
  getLegacyProviderHelpHref,
  isImportStatusActive,
  type LegacyImportStatusResponse,
} from "@/lib/legacy-import-settings"
import { EmptyStateRenderer } from "@/components/ui-states"
import { resolveNoResultsState } from "@/lib/ui-state"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import { ImportedLeaguesPanel } from "./ImportedLeaguesPanel"

export function LegacyImportSettingsSection() {
  const { t, tInterpolate } = useLanguage()
  const [legacyStatus, setLegacyStatus] = useState<LegacyImportStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const loadLegacyStatus = async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await refreshLegacyImportStatus()
      setLegacyStatus(data)
      setLastUpdatedAt(new Date())
    } catch {
      setError(t("settings.legacy.loadError"))
    } finally {
      if (asRefresh) setRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    void loadLegacyStatus()
  }, [])

  useEffect(() => {
    const onFocus = () => {
      void loadLegacyStatus(true)
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus)
      return () => window.removeEventListener("focus", onFocus)
    }
  }, [])

  const hasActiveImport = LEGACY_PROVIDER_IDS.some((providerId) => {
    const status = legacyStatus ? getProviderStatus(legacyStatus, providerId) : null
    return isImportStatusActive(status?.importStatus ?? null)
  })
  const hasLinkedProvider = LEGACY_PROVIDER_IDS.some((providerId) => {
    const status = legacyStatus ? getProviderStatus(legacyStatus, providerId) : null
    return Boolean(status?.linked)
  })
  const hasCompletedImport = LEGACY_PROVIDER_IDS.some((providerId) => {
    const status = legacyStatus ? getProviderStatus(legacyStatus, providerId) : null
    return status?.importStatus === "completed"
  })

  useEffect(() => {
    if (!hasActiveImport) return
    const timer = window.setInterval(() => {
      void loadLegacyStatus(true)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [hasActiveImport])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.legacy.title")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {tInterpolate("settings.legacy.subtitle", { sports: SUPPORTED_SPORTS.join(", ") })}
        </p>
      </div>

      <ImportedLeaguesPanel />

      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>Import sources</p>
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted)" }}>
        <p className="font-medium" style={{ color: "var(--text)" }}>{t("settings.legacy.rankingsLevel")}</p>
        <p className="mt-1">{t("settings.legacy.rankingsBody")}</p>
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--accent-red-strong)" }}>
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.legacy.loadingStatus")}</p>
      ) : (
        <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium" style={{ color: "var(--muted2)" }}>{t("settings.legacy.importProviders")}</p>
            <button
              type="button"
              onClick={() => void loadLegacyStatus(true)}
              disabled={refreshing}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              {refreshing ? t("settings.legacy.refreshing") : t("settings.legacy.refreshStatus")}
            </button>
          </div>
          {lastUpdatedAt && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {tInterpolate("settings.legacy.lastUpdated", {
                time: formatInTimezone(lastUpdatedAt, undefined, undefined, "en"),
              })}
            </p>
          )}
          <ul className="space-y-4">
            {LEGACY_PROVIDER_IDS.map((providerId) => {
              const status = legacyStatus ? getProviderStatus(legacyStatus, providerId) : null
              const isSleeper = providerId === "sleeper"
              const name = getLegacyProviderName(providerId)
              const linked = status?.linked ?? false
              const importStatusLabel = status?.importStatus ? getImportStatusLabel(status.importStatus) : "—"
              const available = status?.available ?? false
              const primaryAction = getLegacyProviderPrimaryAction({ providerId, status })
              const helpHref = getLegacyProviderHelpHref(providerId)
              const showReconnect = isSleeper && linked

              return (
                <li key={providerId} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{name}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {available
                        ? linked
                          ? tInterpolate("settings.legacy.linkedImport", { status: importStatusLabel })
                          : t("settings.legacy.notConnected")
                        : t("settings.legacy.comingSoon")}
                    </p>
                    {status?.error && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--accent-red-strong)" }}>{status.error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {primaryAction ? (
                      <Link
                        href={primaryAction.href}
                        className="rounded-lg border px-3 py-2 text-sm font-medium"
                        style={{ borderColor: primaryAction.label.includes("Retry") ? "var(--accent-red)" : "var(--accent-cyan)", color: "var(--text)" }}
                      >
                        {primaryAction.label}
                      </Link>
                    ) : (
                      !available && (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {t("settings.legacy.comingSoon")}
                        </span>
                      )
                    )}
                    {showReconnect && (
                      <Link
                        href="/dashboard"
                        className="rounded-lg border px-3 py-2 text-sm font-medium"
                        style={{ borderColor: "var(--border)", color: "var(--text)" }}
                      >
                        {t("settings.legacy.reconnect")}
                      </Link>
                    )}
                    <Link
                      href={helpHref}
                      className="rounded-lg border px-3 py-2 text-sm font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      {t("settings.legacy.help")}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
          {hasActiveImport && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.legacy.activeImportNote")}</p>
          )}
          {!hasActiveImport && !hasLinkedProvider && !hasCompletedImport ? (
            <EmptyStateRenderer
              compact
              title={resolveNoResultsState({ context: "legacy_import" }).title}
              description={resolveNoResultsState({ context: "legacy_import" }).description}
              actions={resolveNoResultsState({ context: "legacy_import" }).actions.map((action) => ({
                id: action.id,
                label: action.label,
                href: action.href,
              }))}
              testId="legacy-import-empty-state"
            />
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/af-legacy"
          className="rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          {t("settings.legacy.openApp")}
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          {t("settings.legacy.dashboardLinkSleeper")}
        </Link>
        <Link
          href="/import"
          className="rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          {t("settings.legacy.importInstructions")}
        </Link>
      </div>
    </div>
  )
}
