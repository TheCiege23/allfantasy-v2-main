import { defineMessages } from '@/lib/i18n/messages'

/**
 * Small /core parts: the commissioner badge, the clip rails, the card freshness summary, the league chat
 * bar, local times, the share button, topic tips, and the projection notes on the draft edge, scoreboard
 * and lineup views. Every string is the one each component wrote before the move, byte for byte, in both
 * languages — a relocation, not a rewrite.
 */
export const corePartsMessages = defineMessages({
  en: {
    commissionerBadge: "You're the commissioner",
    clipsAroundLeagues: 'Around your leagues',
    clipsMyTeam: 'My Team clips',
    clipsRecent: 'Recent clips',
    updatesDelayed: 'Updates delayed',
    openLeagueChat: (leagueName: string | null) => `Open ${leagueName ?? 'league'} chat`,
    timeUnavailable: 'Time unavailable',
    share: 'Share',
    topicMeans: (title: string) => `What “${title}” means`,
    draftEdgeBasis: (seasonsRange: string | null, unattributedSeasons: string | null) =>
      `Counted from this league's Sleeper drafts${seasonsRange != null ? ` (${seasonsRange})` : ''}, matched to the manager who owned each team that season.${unattributedSeasons != null ? ` Picks from ${unattributedSeasons} aren't matched to a manager yet, so those drafts are left out.` : ''} It shows what they did, not what they'll take.`,
    scoreboardUnpriced: (reason: string) => `Nothing scored yet — no projections, because ${reason}`,
    lineupProjectionTitle: (provider: string, partial: boolean) =>
      'This week’s lineup projections: each side’s players summed over the lineup as set, under this league’s scoring. ' +
      `AF is AllFantasy’s own projection engine; ${provider} is ${provider}’s own projection. ` +
      'Not the same measure as the team-average projection and win probability above.' +
      (partial ? ' Some starters have no projection, so a total is partial.' : ''),
    weekLineupsNote: (week: number | string, provider: string, caveat: string) =>
      `Each team’s lineup as currently set, projected for week ${week} under this league’s scoring. AF is AllFantasy’s own projection engine; ${provider} is ${provider}’s own projection. A forecast of the coming week — ${caveat}`,
  },
  es: {
    commissionerBadge: 'Eres comisionado',
    clipsAroundLeagues: 'Clips de tus ligas',
    clipsMyTeam: 'Clips de mi equipo',
    clipsRecent: 'Clips recientes',
    updatesDelayed: 'Actualizaciones retrasadas',
    openLeagueChat: (leagueName: string | null) => `Abrir chat de ${leagueName ?? 'la liga'}`,
    timeUnavailable: 'Hora no disponible',
    share: 'Compartir',
    topicMeans: (title: string) => `Qué significa «${title}»`,
    draftEdgeBasis: (seasonsRange: string | null, unattributedSeasons: string | null) =>
      `Datos de los drafts de Sleeper de esta liga${seasonsRange != null ? ` (${seasonsRange})` : ''}, asignados al mánager de cada equipo en esa temporada.${unattributedSeasons != null ? ` Las selecciones de ${unattributedSeasons} aún no se pueden asignar y quedan fuera.` : ''} Muestra lo que hicieron, no lo que elegirán.`,
    scoreboardUnpriced: (reason: string) => `Aún no hay puntos ni proyecciones porque ${reason}`,
    lineupProjectionTitle: (provider: string, partial: boolean) =>
      `Proyecciones de las alineaciones de esta semana: suman a los jugadores titulares con la puntuación de esta liga. AF es la proyección de AllFantasy; ${provider} es la de ${provider}. Es una medida distinta de la probabilidad de ganar mostrada arriba.${partial ? ' Faltan proyecciones de algunos titulares, así que el total es parcial.' : ''}`,
    weekLineupsNote: (week: number | string, provider: string, caveat: string) =>
      `La alineación actual de cada equipo, proyectada para la semana ${week} con las reglas de esta liga. AF es la proyección de AllFantasy; ${provider} es la de ${provider}. Es un pronóstico: ${caveat}`,
  },
})
