/**
 * The league page's tournament banner for a league that belongs to a tournament SHELL.
 *
 * 🛑 THE BANNER ONLY KNEW THE OLDER TOURNAMENT TABLES. `/api/leagues/[leagueId]/tournament-context`
 * read `legacyTournamentLeague` and nothing else, so a league in the newer shell system
 * (`tournament_shell_leagues`) answered `{ tournament: null }` and its page showed no banner. Measured
 * read-only on production 2026-11-21: "KingBuffalo Tournament 2026" has 27 shell leagues, 26 linked to
 * a league page, and none of them in the older table.
 *
 * A shell's hub lives at `/tournament-hub/<id>`, not the older `/tournament/<id>`, so the context
 * carries its own links: the hero must not send a manager to a page that 404s. There is no ops page
 * for a shell at the older `/control` path, so that link is null.
 *
 * Pure. The older tables keep answering first; this is only read when they have nothing.
 */
export type ShellLeagueRow = {
  tournament: { id: string; name: string }
  conference: { name: string | null; theme: string | null; bannerUrl: string | null; colorHex: string | null } | null
  round: { roundNumber: number; roundLabel: string | null; roundType: string | null } | null
}

export type ShellHeroContext = {
  tournamentId: string
  tournamentName: string
  conferenceName: string
  conferenceTheme: string
  roundIndex: number
  phase: string
  hubHref: string
  controlHref: null
  theme: { bannerUrl: string | null; themePack: string; accentColor: string | null; glowAccent: string | null; badgeStyle: string | null } | null
}

export function shellTournamentHeroContext(row: ShellLeagueRow | null | undefined): ShellHeroContext | null {
  if (!row?.tournament?.id || !row.tournament.name?.trim()) return null
  const conference = row.conference
  return {
    tournamentId: row.tournament.id,
    tournamentName: row.tournament.name.trim(),
    conferenceName: conference?.name?.trim() ?? '',
    conferenceTheme: conference?.theme?.trim() ?? '',
    roundIndex: row.round?.roundNumber ?? 1,
    phase: row.round?.roundLabel?.trim() || row.round?.roundType?.trim() || 'Tournament',
    hubHref: `/tournament-hub/${encodeURIComponent(row.tournament.id)}`,
    controlHref: null,
    theme: conference?.bannerUrl || conference?.colorHex
      ? { bannerUrl: conference.bannerUrl ?? null, themePack: 'default', accentColor: conference.colorHex ?? null, glowAccent: null, badgeStyle: null }
      : null,
  }
}
