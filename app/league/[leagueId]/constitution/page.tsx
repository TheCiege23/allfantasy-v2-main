'use client'

/**
 * app/league/[leagueId]/constitution/page.tsx — the league constitution: read by every member,
 * built, edited and amended by the commissioner. The API decides who may do what.
 */

import Link from 'next/link'
import { buildAIChatHref } from '@/lib/chimmy-chat/AIContextRouter'
import { useParams } from 'next/navigation'
import { ConstitutionBuilder } from '@/components/constitution/ConstitutionBuilder'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function LeagueConstitutionPage() {
  const params = useParams<{ leagueId: string }>()
  const { t } = useOptionalLanguage()
  const leagueId = params?.leagueId ?? ''
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/league/${encodeURIComponent(leagueId)}`} className="text-sm text-white/60 underline">
        {t('league.common.backToLeague')}
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{t('league.constitution.title')}</h1>
      {leagueId && (
        <Link
          className="mt-3 inline-block rounded-lg border border-white/20 px-3 py-2 text-sm"
          href={buildAIChatHref({ leagueId, prompt: 'Explain my league rules. Compare the published constitution with our league settings and call out any differences.' })}
        >
          Ask Chimmy about league rules
        </Link>
      )}
      <div className="mt-4">{leagueId && <ConstitutionBuilder leagueId={leagueId} />}</div>
    </main>
  )
}
