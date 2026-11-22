'use client'

/**
 * app/league/[leagueId]/log/page.tsx — the league log: every commissioner action, read by the
 * league unless the commissioner keeps it private. The API decides who sees what.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { LeagueLog } from '@/components/league-log/LeagueLog'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function LeagueLogPage() {
  const params = useParams<{ leagueId: string }>()
  const { t } = useOptionalLanguage()
  const leagueId = params?.leagueId ?? ''
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/league/${encodeURIComponent(leagueId)}`} className="text-sm text-white/60 underline">
        {t('league.common.backToLeague')}
      </Link>
      <div className="mt-4">{leagueId && <LeagueLog leagueId={leagueId} />}</div>
    </main>
  )
}
