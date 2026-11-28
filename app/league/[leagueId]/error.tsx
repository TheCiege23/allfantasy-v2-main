"use client"

import { useEffect } from "react"
import { reportBoundaryError } from "@/lib/observability/reportBoundaryError"
import DashboardUnavailableState from "@/components/dashboard/DashboardUnavailableState"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

/**
 * League route error boundary — keep messaging generic. Do not pattern-match Prisma/config
 * errors here: many runtime failures (e.g. hydration) surface with messages that mention
 * DATABASE_URL and mislead users into thinking Vercel env is wrong.
 */
export default function LeagueRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useOptionalLanguage()
  // This boundary used to drop the error on the floor: nothing recorded a league page crashing.
  useEffect(() => reportBoundaryError(error, "league-route"), [error])

  return (
    <DashboardUnavailableState
      title={t("league.error.title")}
      message={t("league.error.message")}
      onRetry={reset}
    />
  )
}
