'use client'

import Link from 'next/link'
import { leagueEntryHref } from '@/lib/league/leagueEntryHref'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ALL_LEAGUES_DASHBOARD_HREF, leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'

export function LeagueWorkspaceNavigation({ leagueId, platform, sourceLeagueId, leagueName, season }: {
  leagueId: string
  platform: string | null | undefined
  sourceLeagueId?: string | null
  leagueName: string
  season?: number | null
}) {
  const { language, t } = useOptionalLanguage()
  const mode = leagueWorkspaceMode(platform, language)
  const source = mode.authority === 'NATIVE' ? null : resolveSourceLink({ platform, sourceLeagueId, leagueName, season })
  return (
    <section className="af-core af-workspace-navigation" aria-label={t('league.workspaceNav.aria')}>
      <nav className="af-workspace-navigation-links" aria-label={t('league.workspaceNav.dashboardAria')}>
        <Link href={ALL_LEAGUES_DASHBOARD_HREF}>{t('league.workspaceNav.backToDashboard')}</Link>
        <Link href={leagueEntryHref({ id: leagueId, platform })}>{mode.authority === 'NATIVE' ? t('league.workspaceNav.leagueHome') : t('league.workspaceNav.leagueDashboard')}</Link>
        {source ? <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a> : null}
      </nav>
      <div className="af-workspace-navigation-mode" data-authority={mode.authority}>
        <span>{mode.badge}</span>
        <p>{mode.description}</p>
      </div>
    </section>
  )
}
