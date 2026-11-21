import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { getAppPlatformReport, readPostHogQueryConfig } from "@/lib/admin-dashboard/AppPlatformStatsService"
import { normalizeWindow, type AppPlatformReport } from "@/lib/admin-dashboard/appPlatformStats"
import { appleCard, googleCard } from "@/lib/admin-dashboard/storeDownloads"
import { getAppStoreDownloads, type AppStoreDownloadsResult } from "@/lib/app-store/appStoreDownloads"
import { getPlayInstallStats, type PlayInstallStatsResult } from "@/lib/google-play/playInstallStats"
import { AppPlatformDashboard } from "@/components/admin/AppPlatformDashboard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

/** A slow store must not hold the page. A first App Store load fetches up to 30 daily reports. */
const STORE_BUDGET_MS = 25_000

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), STORE_BUDGET_MS))])
}

/**
 * Apps (2026-11-20): who uses AllFantasy in the iOS app, the Android app and the browser
 * (PostHog's app_platform label), and how many download it (each store's own reports).
 * Every source is optional and independent: a missing key shows that source's setup steps.
 */
export default async function AdminAppsPage(props: { searchParams?: Promise<{ days?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/apps")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const days = normalizeWindow(searchParams?.days)
  const config = readPostHogQueryConfig()
  const timedOut = { status: "error" as const, reason: "The store took too long to answer — reload in a minute" }

  const [report, apple, google] = await Promise.all([
    config
      ? getAppPlatformReport({ days, config }).catch((err): AppPlatformReport => ({
          days, generatedAt: new Date().toISOString(), totalActive: null, platforms: [], daily: null,
          errors: [err instanceof Error ? err.message : "Could not build the report"],
        }))
      : Promise.resolve(null),
    withBudget<AppStoreDownloadsResult>(getAppStoreDownloads({ days }), timedOut),
    withBudget<PlayInstallStatsResult>(getPlayInstallStats(), timedOut),
  ])

  return <AppPlatformDashboard days={days} report={report} stores={[appleCard(apple), googleCard(google, days)]} />
}
