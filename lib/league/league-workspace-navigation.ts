import { resolveWriteAuthority, sourcePlatformLabel } from '@/lib/league/write-authority'

/** Stable entry points: onboarding flags must never be needed to reopen a league. */
export function leagueWorkspaceHref(leagueId: string): string {
  return '/league/' + encodeURIComponent(leagueId)
}

export function leagueDashboardHref(leagueId: string): string {
  return '/core?league=' + encodeURIComponent(leagueId)
}

/** Explicitly bypass the optional last-league landing when returning to all leagues. */
export const ALL_LEAGUES_DASHBOARD_HREF = '/core?view=all'

export function leagueWorkspaceMode(platform: string | null | undefined, language = 'en') {
  const authority = resolveWriteAuthority(platform)
  const source = sourcePlatformLabel(platform) ?? (language === 'es' ? 'tu plataforma' : 'your host platform')
  const es = language === 'es'
  if (authority === 'SHADOW') return {
    authority,
    badge: es ? 'Importada · Gestionada en ' + source : 'Imported · Hosted on ' + source,
    description: es
      ? 'Los cambios de alineación, intercambios y reclamos aquí se guardan solo en AllFantasy. Completa los movimientos oficiales en ' + source + '.'
      : 'Lineup, trade and waiver changes here stay in AllFantasy. Complete official moves in ' + source + '.',
  }
  if (authority === 'CONNECTED') return {
    authority,
    badge: es ? 'Conectada a ' + source : 'Connected to ' + source,
    description: es ? 'Los movimientos compatibles se guardan en ' + source + '.' : 'Supported moves are saved to ' + source + '.',
  }
  return {
    authority,
    badge: es ? 'Gestionada en AllFantasy · Beta' : 'Hosted on AllFantasy · Beta',
    description: es ? 'Los movimientos de esta liga se guardan en AllFantasy.' : 'League moves are saved in AllFantasy.',
  }
}
