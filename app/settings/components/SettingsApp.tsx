"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
  LegacyRankSettingsSection,
  CommandCenterSettingsSection,
  LegalSettingsSection,
  AccountSettingsSection,
  BillingSettingsSection,
} from "./sections"

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
  /*
   * No `?tab` is the Settings hub (2026-09-13 handoff) — a card grid that opens
   * the tabs — where it used to default to Profile. Every link that names a tab
   * still lands on that tab.
   */
  const [activeTab, setActiveTab] = useState<SettingsTabId | null>(
    isSettingsTabId(tabFromQuery) ? tabFromQuery : null,
  )
  const { profile, loading, saving, error, updateProfile, fetchProfile } = useSettingsProfile()

  /*
   * Follows the URL only when the URL changes. Keyed on `activeTab` too, a local
   * selection was reverted for a render by the stale query it had not yet
   * replaced — and with the hub, a stale "no tab" would bounce a card straight
   * back to the grid.
   */
  useEffect(() => {
    setActiveTab(isSettingsTabId(tabFromQuery) ? tabFromQuery : null)
  }, [tabFromQuery])

  const handleTabSelect = (tabId: SettingsTabId) => {
    const fromHub = activeTab == null
    setActiveTab(tabId)
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.set("tab", tabId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    // A card sits anywhere down the grid; the tab it opens starts at its top.
    if (fromHub && typeof window !== "undefined") window.scrollTo({ top: 0 })
  }

  const handleShowHub = () => {
    setActiveTab(null)
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.delete("tab")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  if (loading && !profile) {
    return (
      <div className="min-h-[100dvh] bg-[#161826] px-4 py-8">
        <LoadingStateRenderer label={t("settings.loading")} testId="settings-loading-state" />
      </div>
    )
  }

  if (!loading && !profile) {
    return (
      <div className="min-h-[100dvh] bg-[#161826] px-4 py-8">
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
    <SettingsChrome
      activeTab={activeTab}
      onTabChange={handleTabSelect}
      onShowHub={handleShowHub}
      profile={profile}
      planLabel={planLabel}
    >
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
      {activeTab === "rank" && <LegacyRankSettingsSection />}
      {activeTab === "command" && <CommandCenterSettingsSection />}
      {activeTab === "legal" && <LegalSettingsSection profile={profile} />}
      {activeTab === "account" && (
        <AccountSettingsSection accountCreatedAt={accountCreatedAt} planLabel={planLabel} />
      )}
    </SettingsChrome>
  )
}
