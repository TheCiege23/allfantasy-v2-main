'use client'

/**
 * app/league/[leagueId]/guillotine-tiebreak/page.tsx — the commissioner picks who goes in a tied Guilly chop
 * (lib/guillotine/commissionerTiebreak.ts), and undoes the latest chop (lib/guillotine/chopUndo.ts). The urgent alerts link
 * here; the API refuses anyone but the commissioner.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChopUndoCard } from '@/components/guillotine/ChopUndoCard'
import { CommissionerTiebreakDesk } from '@/components/guillotine/CommissionerTiebreakDesk'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function GuillotineTiebreakPage() {
  const params = useParams<{ leagueId: string }>()
  const { t } = useOptionalLanguage()
  const leagueId = params?.leagueId ?? ''
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href={`/league/${encodeURIComponent(leagueId)}`} className="text-sm text-white/60 underline">
        {t('league.common.backToLeague')}
      </Link>
      {leagueId && (
        <div className="mt-4 space-y-6">
          <CommissionerTiebreakDesk leagueId={leagueId} />
          <ChopUndoCard leagueId={leagueId} />
        </div>
      )}
    </main>
  )
}
