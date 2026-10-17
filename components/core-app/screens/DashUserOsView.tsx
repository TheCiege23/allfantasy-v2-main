'use client'

import Link from 'next/link'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import UserOsCard from '@/components/decision-os/UserOsCard'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * The words of DashUserOs, in the reader's language (2026-10-04). DashUserOs keeps the render-nothing
 * gate on the server; this says the header, and hands the language to UserOsCard, which every other
 * surface still renders in English. The snapshot already crossed the boundary — UserOsCard was a client
 * component before this split.
 */
export function DashUserOsView({
  snapshot,
  leagueId,
  leagueName,
}: {
  snapshot: UserOsSnapshot
  leagueId: string
  leagueName: string | null
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <section className="af-core" aria-label={es ? 'Inteligencia de tu equipo' : 'Your team intelligence'} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <h2 className="af-display" style={{ margin: 0, fontSize: 15, letterSpacing: '-0.02em' }}>
          {es ? coreUiCopy('Your team', 'es') : 'Your team'}
          {leagueName ? ` · ${leagueName}` : ''}
        </h2>
        {/* Explains the card's tier chip (Elite … Inactive). UserOsCard is shared with other surfaces, so the tip lives here. */}
        <TopicTip topic="participationTier" />
        <Link href={`/league/${leagueId}?view=decide`} style={{ fontSize: 12, color: 'var(--muted)' }}>
          {es ? 'Abrir Decidir' : 'Open Decide'}
        </Link>
      </div>
      <UserOsCard snapshot={snapshot} variant="dashboard" language={language} />
    </section>
  )
}

export default DashUserOsView
