"use client"

import type { ReactNode } from "react"
import type { Session } from "next-auth"
import { LanguageProviderClient } from "@/components/i18n/LanguageProviderClient"
import SessionAppProvider from "@/components/providers/SessionAppProvider"
import { ThemeProvider } from "@/components/theme/ThemeProvider"
import { PHProvider, PostHogUserIdentifier } from "@/components/providers/PostHogProvider"

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
          <ThemeProvider>{children}</ThemeProvider>
        </SessionAppProvider>
      </LanguageProviderClient>
    </PHProvider>
  )
}
