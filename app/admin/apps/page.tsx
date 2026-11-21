import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { getAppPlatformReport, readPostHogQueryConfig } from "@/lib/admin-dashboard/AppPlatformStatsService"
import { normalizeWindow, type AppPlatformReport } from "@/lib/admin-dashboard/appPlatformStats"
import { AppPlatformDashboard, AppPlatformSetup } from "@/components/admin/AppPlatformDashboard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

/**
 * Apps (2026-11-20): who uses AllFantasy in the iOS app, the Android app and the browser,
 * from PostHog's app_platform label. Downloads stay in the stores' own consoles (linked).
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

  const config = readPostHogQueryConfig()
  if (!config) return <AppPlatformSetup />

  const days = normalizeWindow(searchParams?.days)
  let report: AppPlatformReport
  try {
    report = await getAppPlatformReport({ days, config })
  } catch (err) {
    report = {
      days, generatedAt: new Date().toISOString(), totalActive: null, platforms: [], daily: null,
      errors: [err instanceof Error ? err.message : "Could not build the report"],
    }
  }
  return <AppPlatformDashboard report={report} />
}
