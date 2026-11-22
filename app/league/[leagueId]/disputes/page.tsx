'use client'

/**
 * app/league/[leagueId]/disputes/page.tsx — the dispute desk for every member of the league.
 * Commissioners rule from the same component on the Commissioner Hub; the API decides who may do what.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DisputeDesk } from '@/components/disputes/DisputeDesk'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function LeagueDisputesPage() {
  const params = useParams<{ leagueId: string }>()
  const { t } = useOptionalLanguage()
  const leagueId = params?.leagueId ?? ''
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href={`/league/${encodeURIComponent(leagueId)}`} className="text-sm text-white/60 underline">
        {t('league.common.backToLeague')}
      </Link>
      <div className="mt-4">{leagueId && <DisputeDesk leagueId={leagueId} />}</div>
    </main>
  )
}
