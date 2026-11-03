'use client'

import Link from 'next/link'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import UserOsCard from '@/components/decision-os/UserOsCard'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { messagesFor } from '@/lib/i18n/messages'
import { coreWidgetsMessages } from '@/lib/core-app/messages/coreWidgets'

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
  const m = messagesFor(coreWidgetsMessages, language)
  return (
    <section className="af-core" aria-label={m.userOsAria} style={{ marginBottom: 16 }}>
      {/* 2026-11-01 home redesign: a section heading and a real button, matching the cards around it. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <h2 className="af-display" style={{ margin: 0, fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          {m.userOsYourTeam}
          {leagueName ? ` · ${leagueName}` : ''}
        </h2>
        {/* Explains the card's tier chip (Elite … Inactive). UserOsCard is shared with other surfaces, so the tip lives here. */}
        <TopicTip topic="participationTier" />
        <Link
          href={`/league/${leagueId}?view=decide`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            marginLeft: 'auto',
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid var(--accent-line)',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            fontSize: 13,
            fontWeight: 800,
            textDecoration: 'none',
          }}
        >
          {m.userOsOpenDecide}
        </Link>
      </div>
      <UserOsCard snapshot={snapshot} variant="dashboard" language={language} />
    </section>
  )
}

export default DashUserOsView
