'use client'

/**
 * app/league/[leagueId]/guillotine-tiebreak/page.tsx — the commissioner picks who goes in a tied Guilly chop
 * (lib/guillotine/commissionerTiebreak.ts). The urgent alert links here; the API refuses anyone but the commissioner.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
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
      <div className="mt-4">{leagueId && <CommissionerTiebreakDesk leagueId={leagueId} />}</div>
    </main>
  )
}
