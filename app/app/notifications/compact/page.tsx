'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { ChimmyUnifiedAlertFeed } from '@/components/chimmy-surfaces'

export default function CompactNotificationCenterPage() {
  const searchParams = useSearchParams()
  const leagueId = searchParams?.get('leagueId') ?? undefined

  return (
    <main className="mx-auto w-full max-w-xl px-3 py-4 sm:px-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <Link
          href="/app/notifications"
          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] font-medium text-white/70 hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Notifications
        </Link>
        <div className="inline-flex items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
          <Sparkles className="h-3 w-3" />
          Compact AI Center
        </div>
      </header>

      <section className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
        <div className="mb-2">
          <h1 className="text-sm font-semibold text-white">
            Chimmy Alerts
          </h1>
          <p className="text-xs text-white/60">
            Prioritized, grouped, and actionable. Built for fast scanning.
          </p>
        </div>

        <ChimmyUnifiedAlertFeed
          leagueId={leagueId}
          surface="notification_center"
          presentation="feed"
          className="space-y-2"
        />
      </section>
    </main>
  )
}
