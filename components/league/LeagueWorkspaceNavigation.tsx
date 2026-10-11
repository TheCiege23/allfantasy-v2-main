'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ALL_LEAGUES_DASHBOARD_HREF, leagueDashboardHref, leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'

export function LeagueWorkspaceNavigation({ leagueId, platform, sourceLeagueId, leagueName, season }: {
  leagueId: string
  platform: string | null | undefined
  sourceLeagueId?: string | null
  leagueName: string
  season?: number | null
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const mode = leagueWorkspaceMode(platform, language)
  const source = mode.authority === 'NATIVE' ? null : resolveSourceLink({ platform, sourceLeagueId, leagueName, season })
  return (
    <section className="af-core af-workspace-navigation" aria-label={es ? 'Navegación de la liga' : 'League workspace navigation'}>
      <nav className="af-workspace-navigation-links" aria-label={es ? 'Volver a los paneles' : 'Dashboard navigation'}>
        <Link href={ALL_LEAGUES_DASHBOARD_HREF}>{es ? '← Volver al panel' : '← Back to Dashboard'}</Link>
        <Link href={leagueDashboardHref(leagueId)}>{es ? 'Panel de la liga' : 'League Dashboard'}</Link>
        {source ? <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a> : null}
      </nav>
      <div className="af-workspace-navigation-mode" data-authority={mode.authority}>
        <span>{mode.badge}</span>
        <p>{mode.description}</p>
      </div>
    </section>
  )
}
