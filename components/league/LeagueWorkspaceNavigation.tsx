'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { leagueEntryHref } from '@/lib/league/leagueEntryHref'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ALL_LEAGUES_DASHBOARD_HREF, leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'
import { platformOnlyAuthority } from '@/lib/league/write-authority'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'

export function LeagueWorkspaceNavigation({ leagueId, platform, sourceLeagueId, leagueName, season, variant = 'panel', trailing }: {
  leagueId: string
  platform: string | null | undefined
  sourceLeagueId?: string | null
  leagueName: string
  season?: number | null
  /**
   * `strip` is the league page's one-line version: the back links and where the league is hosted on
   * the left; `trailing` (the imported-league actions) and the host-platform button on the right; the
   * read-only note under them. It replaced three stacked bars. `panel` is the original block.
   */
  variant?: 'panel' | 'strip'
  trailing?: ReactNode
}) {
  const { language, t } = useOptionalLanguage()
  const mode = leagueWorkspaceMode(platformOnlyAuthority(platform), language)
  const source = mode.authority === 'NATIVE' ? null : resolveSourceLink({ platform, sourceLeagueId, leagueName, season })

  if (variant === 'strip') {
    return (
      <section className="af-lsk-sync" aria-label={t('league.workspaceNav.aria')} data-testid="league-sync-strip">
        <nav className="af-lsk-sync-links" aria-label={t('league.workspaceNav.dashboardAria')}>
          <Link href={ALL_LEAGUES_DASHBOARD_HREF}>{t('league.workspaceNav.backToDashboard')}</Link>
          <Link href={leagueEntryHref({ id: leagueId, platform })}>{mode.authority === 'NATIVE' ? t('league.workspaceNav.leagueHome') : t('league.workspaceNav.leagueDashboard')}</Link>
          <span className="af-lsk-sync-badge" data-authority={mode.authority}>{mode.badge}</span>
        </nav>
        <div className="af-lsk-sync-links">
          {trailing}
          {source ? <a className="af-lsk-sync-primary" href={source.href} target="_blank" rel="noopener noreferrer">{source.label} ↗</a> : null}
        </div>
        <p className="af-lsk-sync-note">{mode.description}</p>
      </section>
    )
  }

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
