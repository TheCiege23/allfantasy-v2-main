import type { LegacyProviderId } from "./types"
import type { LegacyImportStatusResponse } from "./types"
import type { LegacyProviderStatus } from "./types"

const LEGACY_PROVIDER_NAMES: Record<LegacyProviderId, string> = {
  sleeper: "Sleeper",
  yahoo: "Yahoo",
  espn: "ESPN",
  mfl: "MFL",
  fleaflicker: "Fleaflicker",
  fantrax: "Fantrax",
}

export function getLegacyProviderName(providerId: LegacyProviderId): string {
  return LEGACY_PROVIDER_NAMES[providerId] ?? providerId
}

export const LEGACY_PROVIDER_IDS: LegacyProviderId[] = [
  "sleeper",
  "yahoo",
  "espn",
  "mfl",
  "fleaflicker",
  "fantrax",
]

/**
 * Returns human-readable import status for display.
 */
export function getImportStatusLabel(status: string | null): string {
  if (!status) return "—"
  switch (status) {
    case "completed":
      return "Completed"
    case "running":
      return "Importing…"
    case "queued":
      return "Queued"
    case "failed":
    case "error":
      return "Failed"
    case "not_started":
    case "none":
      return "Not started"
    default:
      return status
  }
}

/**
 * i18n key for `getImportStatusLabel`, or null when that function would echo the raw status
 * (or "—"). Display only — the status values themselves are untouched.
 */
export function getImportStatusLabelKey(status: string | null): string | null {
  switch (status) {
    case "completed":
      return "settings.legacy.importStatus.completed"
    case "running":
      return "settings.legacy.importStatus.running"
    case "queued":
      return "settings.legacy.importStatus.queued"
    case "failed":
    case "error":
      return "settings.legacy.importStatus.failed"
    case "not_started":
    case "none":
      return "settings.legacy.importStatus.notStarted"
    default:
      return null
  }
}

/**
 * Resolves provider status from API response.
 */
export function getProviderStatus(
  data: LegacyImportStatusResponse,
  providerId: LegacyProviderId
) {
  return data.providers[providerId] ?? {
    linked: false,
    importStatus: null,
    available: false,
  }
}

export function isImportStatusActive(status: string | null): boolean {
  return status === "running" || status === "queued"
}

export function shouldShowRetryImport(status: LegacyProviderStatus | null | undefined): boolean {
  const value = status?.importStatus ?? null
  return value === "failed" || value === "error"
}

export function getLegacyProviderHelpHref(providerId: LegacyProviderId): string {
  if (providerId === "sleeper") return "/import"
  return "/import"
}

/**
 * i18n keys for the labels `getLegacyProviderPrimaryAction` returns, keyed by that English label.
 * A lookup beside the function rather than a new field on its result, so the action object (and
 * the `label.includes("Retry")` styling check that reads it) is unchanged. Display only.
 */
const LEGACY_PRIMARY_ACTION_LABEL_KEYS: Record<string, string> = {
  "Connect first": "settings.legacy.action.connectFirst",
  "Retry import": "settings.legacy.action.retryImport",
  "Re-import / refresh": "settings.legacy.action.reimport",
  "Start import": "settings.legacy.action.startImport",
  "Open import": "settings.legacy.action.openImport",
}

export function getLegacyPrimaryActionLabelKey(label: string): string | null {
  return LEGACY_PRIMARY_ACTION_LABEL_KEYS[label] ?? null
}

/** The one page that links a Sleeper account to this profile. */
export const SLEEPER_CONNECT_HREF = "/settings/connect/sleeper"

export function getLegacyProviderPrimaryAction(params: {
  providerId: LegacyProviderId
  status: LegacyProviderStatus | null
}): { label: string; href: string } | null {
  const { providerId, status } = params
  if (!status) return null
  if (!status.available) return null

  /*
   * ⚠ "Connect first" went to /dashboard, which redirects to /core — where there is no linker. The
   * Sleeper linker is /settings/connect/sleeper (no inbound link anywhere before 2026-10-02); every
   * other platform connects from Settings › Connected Accounts.
   */
  if (providerId === "sleeper") {
    if (!status.linked) {
      return { label: "Connect first", href: SLEEPER_CONNECT_HREF }
    }
    if (shouldShowRetryImport(status)) {
      return { label: "Retry import", href: "/af-legacy?retry=1&provider=sleeper" }
    }
    if (status.importStatus === "completed" || isImportStatusActive(status.importStatus)) {
      return { label: "Re-import / refresh", href: "/af-legacy?refresh=1&provider=sleeper" }
    }
    return { label: "Start import", href: "/af-legacy?provider=sleeper" }
  }

  if (!status.linked) {
    return { label: "Connect first", href: "/settings?tab=connected" }
  }
  if (shouldShowRetryImport(status)) {
    return { label: "Retry import", href: "/af-legacy?retry=1&provider=" + providerId }
  }
  return { label: "Open import", href: "/af-legacy?provider=" + providerId }
}
