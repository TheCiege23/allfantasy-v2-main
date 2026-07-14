"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useSettingsProfile } from "@/hooks/useSettingsProfile"
import { ErrorStateRenderer, LoadingStateRenderer } from "@/components/ui-states"
import { SecuritySettingsSection } from "../components/sections/SecuritySettingsSection"
import type { SettingsProfile } from "../components/sections/settings-types"

export default function SecuritySettingsPage() {
  const { t } = useLanguage()
  const { profile, loading, error, fetchProfile } = useSettingsProfile()

  if (loading && !profile) {
    return (
      <div className="min-h-screen bg-app px-4 py-10 text-primary">
        <LoadingStateRenderer label={t("settings.securityPage.loading")} testId="settings-security-loading" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-app px-4 py-10 text-primary">
        <ErrorStateRenderer
          title={t("settings.securityPage.errorTitle")}
          message={error ?? t("settings.securityPage.tryAgain")}
          onRetry={() => void fetchProfile()}
          testId="settings-security-error"
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-app px-4 py-8 text-primary">
      <div className="mx-auto max-w-xl">
        <Link
          href="/settings"
          className="mb-6 inline-flex items-center gap-2 text-sm text-cyan-400/90 hover:text-cyan-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.securityPage.back")}
        </Link>
        <h1 className="mb-6 text-xl font-bold">{t("settings.securityPage.h1")}</h1>
        <SecuritySettingsSection profile={profile as SettingsProfile} onRefetch={fetchProfile} />
      </div>
    </div>
  )
}
