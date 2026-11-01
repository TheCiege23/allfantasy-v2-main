'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { pickEnEs } from '@/lib/i18n/bilingual'
import type { MyTeamAutomationsView } from '@/lib/lineup-automation/myTeamAutomationsService'

/**
 * "What AllFantasy may do for your team" on the manager's lineup screen (lib/lineup-automation/
 * myTeamAutomations.ts): what may act on this team in this league, and how to take control back.
 * Collapsed by default, open while AllFantasy is running the team. Hidden when nothing applies.
 */
export function MyTeamAutomations({ leagueId }: { leagueId: string }) {
  const { language, t } = useOptionalLanguage()
  const [view, setView] = useState<MyTeamAutomationsView | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/league/my-automations?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: MyTeamAutomationsView | null) => live && setView(body))
      .catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [leagueId])

  if (!view || !view.available || view.items.length === 0) return null
  const managedNow = view.items.some((i) => i.key === 'managed')
  return (
    <details className="nls-card" open={managedNow} data-testid="my-team-automations">
      <summary className="nls-label">{t('league.myAutomations.title')}</summary>
      <ul>
        {view.items.map((i) => (
          <li key={i.key} data-testid={`my-automation-${i.key}`}>
            {pickEnEs(i, language)}
          </li>
        ))}
      </ul>
      <p className="nls-muted">{pickEnEs(view.takeBack, language)}</p>
    </details>
  )
}
