'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  TournamentCommissionerDashboard,
  type TournamentCommissionerTabId,
} from '@/components/tournament/TournamentCommissionerDashboard'

export function TournamentCommissionerPageShell({
  tournamentId,
  initialTab,
}: {
  tournamentId: string
  initialTab?: TournamentCommissionerTabId
}) {
  const { t } = useLanguage()
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/tournament" className="inline-flex items-center gap-2 text-white/60 hover:text-white">
          <ChevronLeft className="h-4 w-4" /> {t('tournament.appCommissioner.backTournaments')}
        </Link>
      </div>
      <Suspense
        fallback={
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center text-white/55">
            {t('tournament.appCommissioner.loadingDashboard')}
          </div>
        }
      >
        <TournamentCommissionerDashboard tournamentId={tournamentId} initialTab={initialTab} />
      </Suspense>
    </main>
  )
}
