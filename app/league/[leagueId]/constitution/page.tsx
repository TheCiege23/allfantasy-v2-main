'use client'

/**
 * app/league/[leagueId]/constitution/page.tsx — the league constitution: read by every member,
 * built, edited and amended by the commissioner. The API decides who may do what.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ConstitutionBuilder } from '@/components/constitution/ConstitutionBuilder'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function LeagueConstitutionPage() {
  const params = useParams<{ leagueId: string }>()
  const { language } = useOptionalLanguage()
  const leagueId = params?.leagueId ?? ''
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/league/${encodeURIComponent(leagueId)}`} className="text-sm text-white/60 underline">
        {language === 'es' ? '← Volver a la liga' : '← Back to league'}
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{language === 'es' ? 'Constitución de la liga' : 'League constitution'}</h1>
      <div className="mt-4">{leagueId && <ConstitutionBuilder leagueId={leagueId} />}</div>
    </main>
  )
}
