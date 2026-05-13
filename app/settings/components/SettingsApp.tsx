"use client"

/**
 * Settings App — Tabbed settings interface with 10 tabs (profile, preferences, security, etc).
 *
 * CANONICAL ROUTE: /settings
 *
 * Deep linking: Tab state preserved via URL query params (?tab=profile, ?tab=connected, etc).
 * Router uses router.replace() to update URL without adding history entry on tab change.
 *
 * Tab routing:
 * - useSearchParams() reads tab param from URL
 * - setActiveTab() updates state
 * - handleTabSelect() updates URL via router.replace()
 * - useEffect() syncs URL param changes back to state
 */
import { useState, useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { signOut } from "next-auth/react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { ReferralSection } from "@/components/settings/ReferralSection"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { ErrorStateRenderer, LoadingStateRenderer } from "@/components/ui-states"
import { resolveRecoveryActions } from "@/lib/ui-state"
import { SettingsChrome, isSettingsTabId, type SettingsTabId } from "./SettingsChrome"
import {
  ProfileSettingsSection,
  PreferencesSettingsSection,
  SecuritySettingsSection,
  NotificationsSettingsSection,
  ConnectedAccountsSettingsSection,
  LegacyImportSettingsSection,
  LegalSettingsSection,
  AccountSettingsSection,
  BillingSettingsSection,
} from "./sections"
import { AISettingsSection } from "./sections/AISettingsSection"

export type SettingsAppProps = {
  uploadLeagueId: string | null
  accountCreatedAt: string | null
  planLabel: string | null
}

export default function SettingsApp({
  uploadLeagueId,
  accountCreatedAt,
  planLabel,
}: SettingsAppProps) {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const tabFromQuery = searchParams?.get("tab")
  const initialTab = isSettingsTabId(tabFromQuery) ? tabFromQuery : "profile"
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab)
  const { profile, loading, saving, error, updateProfile, fetchProfile } = useSettingsProfile()

  useEffect(() => {
    if (!isSettingsTabId(tabFromQuery)) return
    if (tabFromQuery !== activeTab) {
      setActiveTab(tabFromQuery)
    }
  }, [tabFromQuery, activeTab])

  const handleTabSelect = (tabId: SettingsTabId) => {
    setActiveTab(tabId)
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.set("tab", tabId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  if (loading && !profile) {
    return (
      <div className="min-h-[100dvh] bg-[#0d1117] px-4 py-8">
        <LoadingStateRenderer label={t("settings.loading")} testId="settings-loading-state" />
      </div>
    )
  }

  if (!loading && !profile) {
    return (
      <div className="min-h-[100dvh] bg-[#0d1117] px-4 py-8">
        <ErrorStateRenderer
          title={t("settings.errorTitle")}
          message={error ?? t("settings.errorMessage")}
          onRetry={() => void fetchProfile()}
          actions={[
            ...resolveRecoveryActions("settings").map((action) => ({
              id: action.id,
              label: action.label,
              href: action.href,
            })),
            { id: "sign-out", label: "Sign out", href: "/logout" },
          ]}
          testId="settings-error-state"
        />
      </div>
    )
  }

  return (
    <SettingsChrome activeTab={activeTab} onTabChange={handleTabSelect}>
      {error && (
        <div className="mb-4">
          <ErrorStateRenderer
            compact
            title={t("settings.inlineErrorTitle")}
            message={error}
            onRetry={() => void fetchProfile()}
            testId="settings-inline-error-state"
          />
        </div>
      )}
      {activeTab === "profile" && (
        <ProfileSettingsSection
          profile={profile}
          saving={saving}
          onSave={updateProfile}
          onRefetch={fetchProfile}
          uploadLeagueId={uploadLeagueId}
        />
      )}
      {activeTab === "preferences" && (
        <PreferencesSettingsSection profile={profile} saving={saving} onSave={updateProfile} />
      )}
      {activeTab === "security" && <SecuritySettingsSection profile={profile} onRefetch={fetchProfile} />}
      {activeTab === "notifications" && (
        <NotificationsSettingsSection profile={profile} onRefetch={fetchProfile} />
      )}
      {activeTab === "connected" && (
        <ConnectedAccountsSettingsSection profile={profile} onRefetchProfile={fetchProfile} />
      )}
      {activeTab === "billing" && <BillingSettingsSection />}
      {activeTab === "referral" && <ReferralSection />}
      {activeTab === "legacy" && <LegacyImportSettingsSection />}
      {activeTab === "legal" && <LegalSettingsSection profile={profile} />}
      {activeTab === "ai" && <AISettingsSection />}
      {activeTab === "account" && (
        <AccountSettingsSection accountCreatedAt={accountCreatedAt} planLabel={planLabel} />
      )}
    </SettingsChrome>
  )
}
