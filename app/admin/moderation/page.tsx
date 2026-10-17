import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { listReportsForReview } from "@/lib/moderation/AdminReportReview"
import { ModerationQueue } from "./ModerationQueue"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Reported chat messages, newest first. Members report from any chat's message
 * sheet (league chat, DMs, huddles); this is where somebody acts on it — App
 * Store guideline 1.2 expects objectionable content to be removed promptly.
 */
export default async function ModerationPage(props: { searchParams?: Promise<{ view?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/moderation")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const showAll = searchParams?.view === "all"
  const reports = await listReportsForReview({ status: showAll ? "all" : "pending" })
  const pendingCount = showAll ? reports.filter((r) => r.status === "pending").length : reports.length

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">
              ← Admin
            </Link>
            <h1 className="mt-1 text-2xl font-black">Reported messages</h1>
            <p className="text-sm text-white/60">
              {pendingCount === 0 ? "No reports waiting." : `${pendingCount} waiting for review.`} Aim to act within 24 hours.
            </p>
          </div>
          <Link href={showAll ? "/admin/moderation" : "/admin/moderation?view=all"} className="text-sm text-cyan-300">
            {showAll ? "Show pending only" : "Show all, including closed"}
          </Link>
        </div>
        <ModerationQueue reports={reports} />
      </div>
    </main>
  )
}
