"use client"

import type { ReactNode } from "react"
import type { Session } from "next-auth"
import { LanguageProviderClient } from "@/components/i18n/LanguageProviderClient"
import SessionAppProvider from "@/components/providers/SessionAppProvider"
import { ThemeProvider } from "@/components/theme/ThemeProvider"
import { PHProvider, PostHogUserIdentifier } from "@/components/providers/PostHogProvider"
import { GeoRefusalWatcher } from "@/components/geo/GeoRefusalWatcher"
import { AdOptOutSync } from "@/components/privacy/AdOptOutSync"
import { AppOpenPing } from "@/components/analytics/AppOpenPing"

export function AppProviders({
  children,
  session,
}: {
  children: ReactNode
  session?: Session | null
}) {
  return (
    <PHProvider>
      <LanguageProviderClient>
        <SessionAppProvider session={session}>
          {/* PostHogUserIdentifier must be inside SessionAppProvider so useSession() works */}
          <PostHogUserIdentifier />
          <GeoRefusalWatcher />
          {/* Carries a "Do Not Sell or Share" choice to every browser the person signs in on. */}
          <AdOptOutSync />
          {/* One "app opened" row a day per device, for the people counts on /admin/apps. */}
          <AppOpenPing />
          <ThemeProvider>{children}</ThemeProvider>
        </SessionAppProvider>
      </LanguageProviderClient>
    </PHProvider>
  )
}
