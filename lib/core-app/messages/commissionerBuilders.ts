import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner Hub builders (lib/core-app/commissioner/charts.ts, history.ts, formatCards.ts,
 * reports.ts, healthScore.ts) — chart titles and takeaways, history labels and notes, format-card
 * copy, and the reasons a report or the health score is withheld.
 * Every string is the one the builder wrote before the move, byte for byte, in both languages — this
 * is a relocation, not a rewrite. Keys are prefixed by the module that reads them. Number formatting
 * (`toFixed`, `toLocaleString('en-US')`) stays inside the message, exactly where the builder had it.
 */
export const commissionerBuildersMessages = defineMessages({
  en: {
    // charts.ts — activity.
    chartActivityTitle: 'League activity',
    chartActivitySubtitle: (weeks: number): string => `Trades, waiver claims and roster moves per week · last ${weeks} weeks`,
    chartActivityNone: 'No moves imported in the last eight weeks.',
    chartActivityTakeaway: (last: number, avg: number): string =>
      `${last} ${last === 1 ? 'move' : 'moves'} this week, against ${avg.toFixed(1)} a week before that.`,

    // charts.ts — trades.
    chartTradesTitle: 'Trades',
    chartTradesSubtitle: (weeks: number): string => `Completed trades per week · last ${weeks} weeks`,
    chartTradesNone: 'No trades in eight weeks.',
    chartTradesTakeaway: (total: number): string => `${total} ${total === 1 ? 'trade' : 'trades'} in eight weeks.`,

    // charts.ts — waiver participation.
    chartWaiversTitle: 'Waiver participation',
    chartWaiversSubtitle: 'Waiver claims by manager · this season',
    chartWaiversTakeaway: (participating: number, managers: number, claims: number): string =>
      `${participating} of ${managers} managers have made a claim${claims > 0 ? ` · ${claims} claims in all` : ''}.`,

    // charts.ts — competitive balance.
    chartBalanceTitle: 'Competitive balance',
    chartBalanceSubtitle: 'Points for by team, with record',
    chartBalanceTakeaway: (spread: number, winsSd: number, games: number): string =>
      `${Math.round(spread).toLocaleString('en-US')} points separate the top and bottom scorers; win totals vary by ±${winsSd.toFixed(1)} over ${games} ${games === 1 ? 'game' : 'games'}.`,

    // charts.ts — scoring.
    chartScoringWeekLabel: (week: number): string => `Wk ${week}`,
    chartScoringBarDisplay: (avg: number, high: number): string => `${avg.toFixed(1)} avg · ${high.toFixed(1)} high`,
    chartScoringTitle: 'Scoring',
    chartScoringSubtitleCertified: 'Average team score per completed week',
    chartScoringSubtitleRecorded: 'Recorded weekly scores · may include a week in progress',
    chartScoringTakeaway: (week: number, high: number, low: number): string =>
      `Week ${week}: high ${high.toFixed(1)}, low ${low.toFixed(1)}.`,

    // charts.ts — manager engagement.
    chartEngagementActive: 'Active',
    chartEngagementSlowing: 'Slowing down',
    chartEngagementInactive: 'Inactive',
    chartEngagementUnknown: 'Can’t tell',
    chartEngagementTitle: 'Manager engagement',
    chartEngagementSubtitle: 'Active vs. inactive managers · 14-day window',
    chartEngagementTakeaway: (active: number, managers: number): string => `${active} of ${managers} managers are active.`,

    // history.ts — trade labels.
    historyUnattributedTrade: 'Unattributed trade',
    historyMoreAssets: (more: number): string => ` +${more} more`,
    historyTradeDetailsUnavailable: 'Trade (details unavailable)',

    // history.ts — draft rows.
    historySourceRedraft: 'AllFantasy redraft',
    historyUnassigned: 'Unassigned',
    historyNotSelected: 'Not selected',
    historySourceLiveDraft: 'Live draft session',

    // history.ts — notes.
    historyTradeUnread: 'Trade history could not be read.',
    historyTradeNoteNative: 'Native trade records on file. This list is limited to the ten newest.',
    historyTradeNoteImported: 'Imported trades recorded in the league warehouse. Provider history may be incomplete.',
    historyDraftUnread: 'Some draft records or corrections could not be read.',
    historyDraftNote:
      'Only connected live draft sessions and native redraft drafts on file are shown. A session year is inferred from its date; missing provider seasons are not reconstructed.',

    // formatCards.ts — shared actions.
    formatOpenCommand: 'Open command',
    formatOpenStandings: 'Open standings',
    formatOpenPicks: 'Open picks',

    // formatCards.ts — one card each.
    formatKeeperTitle: 'Keeper decisions',
    formatKeeperDetail: 'Review retained players, costs and the next draft.',
    formatKeeperAction: 'Open keepers',
    formatGuillotineTitle: 'Elimination week',
    formatGuillotineDetail: 'Review cuts, released rosters and waiver timing.',
    formatGuillotineAction: 'Open guillotine',
    formatSurvivorTitle: 'Survivor command',
    formatSurvivorDetail: 'Review tribes, challenges, tribal votes and phase state.',
    formatBigBrotherTitle: 'Big Brother command',
    formatBigBrotherDetail: 'Review HOH, veto, eviction and jury state.',
    formatZombieTitle: 'Zombie control',
    formatZombieDetail: 'Review conversions and survival status.',
    formatZombieAction: 'Open zombie',
    formatEflTitle: 'Promotion and relegation',
    formatEflDetail: 'Review tier movement, frozen standings inputs and rookie order.',
    formatDevyTitle: 'Devy assets',
    formatDevyDetail: 'Review college rights, taxi decisions and rookie picks.',
    formatC2cTitle: 'Campus to Canton',
    formatC2cDetail: 'Review college and pro assets, transitions and picks.',
    formatTournamentTitle: 'Tournament advancement',
    formatTournamentDetail: 'Review brackets and progression rules.',
    formatFourHorsemenTitle: 'Four Horsemen rules',
    formatFourHorsemenDetail: 'Review the configured rules before making a commissioner ruling.',
    formatFourHorsemenAction: 'Open settings',

    // formatCards.ts — the dynasty card (2026-10-31). Every value is read from the league's saved settings.
    formatDynastyTitle: 'Dynasty settings',
    formatDynastyDetail: 'The rules that carry this league from one season to the next.',
    formatDynastyEmpty: 'No dynasty settings are saved for this league yet. Review them before the rookie draft.',
    formatDynastyAction: 'Open dynasty settings',
    formatDynastyRosterLabel: 'Roster',
    formatDynastyRosterValue: (n: number): string => `${n} ${n === 1 ? 'spot' : 'spots'}`,
    formatDynastyTaxiLabel: 'Taxi squad',
    formatDynastyDevyLabel: 'Devy slots',
    formatDynastySlotsValue: (n: number): string => `${n} ${n === 1 ? 'slot' : 'slots'}`,
    formatDynastyRookieLabel: 'Rookie draft',
    formatDynastyRookieValue: (rounds: number, type: 'linear' | 'snake' | null): string =>
      `${rounds} ${rounds === 1 ? 'round' : 'rounds'}${type === 'linear' ? ' · linear' : type === 'snake' ? ' · snake' : ''}`,
    formatDynastyPickYearsLabel: 'Pick trading',
    formatDynastyPickYearsValue: (years: number): string => `${years} ${years === 1 ? 'season' : 'seasons'} out`,
    formatDynastyRolloverLabel: 'Rollover',
    formatDynastyRolloverDue: (season: number): string => `Due · the ${season} season is over`,
    formatDynastyRolloverStarted: (season: number): string => `Done · ${season} is under way`,
    formatDynastyRolloverInSeason: (season: number): string => `Not yet · ${season} is in progress`,
    formatDynastyLinkRoster: 'Roster settings',
    formatDynastyLinkDraft: 'Draft settings',
    formatDynastyLinkTrades: 'Trade settings',
    formatDynastyLinkRollover: 'Open the rollover',
    formatDynastyPicksAria: (rounds: number): string => `${rounds} rookie draft ${rounds === 1 ? 'round' : 'rounds'}`,

    // reports.ts.
    reportsActivityUnread: 'League activity couldn’t be read just now.',

    // healthScore.ts.
    healthScoreStale: (staleDays: number): string =>
      `Not scored: AllFantasy last read this league ${staleDays} days ago, and a score built on that data would call every quiet manager inactive. Re-sync it to score the league.`,
    healthScoreNeverSynced: 'This league has never synced, so there is nothing to score yet.',
    healthScoreNotEnoughData: 'There isn’t enough roster and activity data to score this league yet.',
  },
  es: {
    chartActivityTitle: 'Actividad de la liga',
    chartActivitySubtitle: (weeks) => `Intercambios, reclamos y cambios de plantilla por semana · últimas ${weeks} semanas`,
    chartActivityNone: 'No se importó ningún movimiento en las últimas ocho semanas.',
    chartActivityTakeaway: (last, avg) =>
      `${last} ${last === 1 ? 'movimiento' : 'movimientos'} esta semana, frente a ${avg.toFixed(1)} por semana antes.`,

    chartTradesTitle: 'Intercambios',
    chartTradesSubtitle: (weeks) => `Intercambios cerrados por semana · últimas ${weeks} semanas`,
    chartTradesNone: 'Ningún intercambio en ocho semanas.',
    chartTradesTakeaway: (total) => `${total} ${total === 1 ? 'intercambio' : 'intercambios'} en ocho semanas.`,

    chartWaiversTitle: 'Participación en agentes libres',
    chartWaiversSubtitle: 'Reclamos por mánager · esta temporada',
    chartWaiversTakeaway: (participating, managers, claims) =>
      `${participating} de ${managers} mánagers han hecho un reclamo${claims > 0 ? ` · ${claims} reclamos en total` : ''}.`,

    chartBalanceTitle: 'Equilibrio competitivo',
    chartBalanceSubtitle: 'Puntos a favor por equipo, con su récord',
    chartBalanceTakeaway: (spread, winsSd, games) =>
      `${Math.round(spread).toLocaleString('en-US')} puntos separan al que más anota del que menos; las victorias varían ±${winsSd.toFixed(1)} en ${games} ${games === 1 ? 'partido' : 'partidos'}.`,

    chartScoringWeekLabel: (week) => `Sem ${week}`,
    chartScoringBarDisplay: (avg, high) => `${avg.toFixed(1)} media · ${high.toFixed(1)} máx.`,
    chartScoringTitle: 'Puntuación',
    chartScoringSubtitleCertified: 'Puntuación media por equipo en cada semana completada',
    chartScoringSubtitleRecorded: 'Puntuaciones semanales registradas · puede incluir una semana en curso',
    chartScoringTakeaway: (week, high, low) => `Semana ${week}: máximo ${high.toFixed(1)}, mínimo ${low.toFixed(1)}.`,

    chartEngagementActive: 'Activos',
    chartEngagementSlowing: 'Bajando el ritmo',
    chartEngagementInactive: 'Inactivos',
    chartEngagementUnknown: 'No se sabe',
    chartEngagementTitle: 'Participación de los mánagers',
    chartEngagementSubtitle: 'Mánagers activos e inactivos · últimos 14 días',
    chartEngagementTakeaway: (active, managers) => `${active} de ${managers} mánagers están activos.`,

    historyUnattributedTrade: 'Intercambio sin atribuir',
    historyMoreAssets: (more) => ` y ${more} más`,
    historyTradeDetailsUnavailable: 'Intercambio (detalles no disponibles)',

    historySourceRedraft: 'Redraft de AllFantasy',
    historyUnassigned: 'Sin asignar',
    historyNotSelected: 'Sin seleccionar',
    historySourceLiveDraft: 'Sesión de draft en vivo',

    historyTradeUnread: 'No se pudo leer el historial de intercambios.',
    historyTradeNoteNative: 'Intercambios registrados en AllFantasy. La lista se limita a los diez más recientes.',
    historyTradeNoteImported:
      'Intercambios importados registrados en el almacén de la liga. El historial del proveedor puede estar incompleto.',
    historyDraftUnread: 'No se pudieron leer algunos registros o correcciones del draft.',
    historyDraftNote:
      'Solo se muestran las sesiones de draft en vivo conectadas y los drafts de redraft de AllFantasy registrados. El año de una sesión se deduce de su fecha; las temporadas que faltan del proveedor no se reconstruyen.',

    formatOpenCommand: 'Abrir el mando',
    formatOpenStandings: 'Abrir la clasificación',
    formatOpenPicks: 'Abrir selecciones',

    formatKeeperTitle: 'Decisiones de keepers',
    formatKeeperDetail: 'Revisa los jugadores retenidos, sus costes y el próximo draft.',
    formatKeeperAction: 'Abrir keepers',
    formatGuillotineTitle: 'Semana de eliminación',
    formatGuillotineDetail: 'Revisa los cortes, las plantillas liberadas y los plazos de reclamos.',
    formatGuillotineAction: 'Abrir guillotina',
    formatSurvivorTitle: 'Mando de Survivor',
    formatSurvivorDetail: 'Revisa las tribus, los desafíos, las votaciones tribales y el estado de cada fase.',
    formatBigBrotherTitle: 'Mando de Big Brother',
    formatBigBrotherDetail: 'Revisa el HOH, el veto, la expulsión y el estado del jurado.',
    formatZombieTitle: 'Control de zombis',
    formatZombieDetail: 'Revisa las conversiones y el estado de supervivencia.',
    formatZombieAction: 'Abrir zombis',
    formatEflTitle: 'Ascensos y descensos',
    formatEflDetail: 'Revisa los cambios de división, los datos de clasificación congelados y el orden de novatos.',
    formatDevyTitle: 'Activos devy',
    formatDevyDetail: 'Revisa los derechos universitarios, las decisiones de taxi y las selecciones de novatos.',
    formatC2cTitle: 'Campus to Canton',
    formatC2cDetail: 'Revisa los activos universitarios y profesionales, las transiciones y las selecciones.',
    formatTournamentTitle: 'Avance del torneo',
    formatTournamentDetail: 'Revisa los cuadros y las reglas de avance.',
    formatFourHorsemenTitle: 'Reglas de Four Horsemen',
    formatFourHorsemenDetail: 'Revisa las reglas configuradas antes de tomar una decisión como comisionado.',
    formatFourHorsemenAction: 'Abrir la configuración',

    formatDynastyTitle: 'Configuración dynasty',
    formatDynastyDetail: 'Las reglas que llevan esta liga de una temporada a la siguiente.',
    formatDynastyEmpty: 'Esta liga aún no tiene configuración dynasty guardada. Revísala antes del draft de novatos.',
    formatDynastyAction: 'Abrir la configuración dynasty',
    formatDynastyRosterLabel: 'Plantilla',
    formatDynastyRosterValue: (n) => `${n} ${n === 1 ? 'puesto' : 'puestos'}`,
    formatDynastyTaxiLabel: 'Escuadra taxi',
    formatDynastyDevyLabel: 'Puestos devy',
    formatDynastySlotsValue: (n) => `${n} ${n === 1 ? 'puesto' : 'puestos'}`,
    formatDynastyRookieLabel: 'Draft de novatos',
    formatDynastyRookieValue: (rounds, type) =>
      `${rounds} ${rounds === 1 ? 'ronda' : 'rondas'}${type === 'linear' ? ' · lineal' : type === 'snake' ? ' · serpiente' : ''}`,
    formatDynastyPickYearsLabel: 'Intercambio de selecciones',
    formatDynastyPickYearsValue: (years) => `${years} ${years === 1 ? 'temporada' : 'temporadas'} a futuro`,
    formatDynastyRolloverLabel: 'Cambio de temporada',
    formatDynastyRolloverDue: (season) => `Pendiente · la temporada ${season} terminó`,
    formatDynastyRolloverStarted: (season) => `Hecho · ${season} ya está en marcha`,
    formatDynastyRolloverInSeason: (season) => `Aún no · ${season} está en curso`,
    formatDynastyLinkRoster: 'Configuración de plantilla',
    formatDynastyLinkDraft: 'Configuración del draft',
    formatDynastyLinkTrades: 'Configuración de intercambios',
    formatDynastyLinkRollover: 'Abrir el cambio de temporada',
    formatDynastyPicksAria: (rounds) => `${rounds} ${rounds === 1 ? 'ronda' : 'rondas'} del draft de novatos`,

    reportsActivityUnread: 'No se pudo leer la actividad de la liga en este momento.',

    healthScoreStale: (staleDays) =>
      `Sin puntuar: AllFantasy leyó esta liga por última vez hace ${staleDays} días, y una puntuación con esos datos daría por inactivo a cualquier mánager tranquilo. Vuelve a sincronizarla para puntuarla.`,
    healthScoreNeverSynced: 'Esta liga nunca se ha sincronizado, así que aún no hay nada que puntuar.',
    healthScoreNotEnoughData: 'Aún no hay suficientes datos de plantillas y actividad para puntuar esta liga.',
  },
})
