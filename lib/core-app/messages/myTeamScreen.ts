import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * My Team (components/core-app/screens/MyTeam.tsx): the roster screen, its offseason view and the
 * cards inside it — unidentified-player note, venue marks, roster-value subtitle, recent moves,
 * positional strength, win forecast, matchup edge, roster key, dynasty outlook, free-agent fill,
 * lineup check, bench check, taxi years, projection compare toggle, the lineup-decision card and
 * the coverage footnotes.
 * Every string is the one the component wrote before the move, byte for byte, in both languages —
 * a relocation, not a rewrite.
 *
 * The bench-check sentences carry `{bench}`, `{benchPts}`, `{starter}` and `{starterPts}` tokens:
 * the component puts the bench name in a <strong> and both projections in `af-num` spans, and the
 * two languages order those pieces differently.
 */

/** "2nd" — "1st", "11th", "22nd"; the screen's own ordinal, repeated so the catalog imports nothing. */
function ordinalEn(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** «2.º» — it sits inside Spanish sentences too ("terminó 2.º de 12"). */
const ordinalEs = (n: number): string => `${n}.º`

/** The lineup-check tags; Q stays Q in Spanish, as in the abbreviation key. */
type CheckKind = 'out' | 'bye' | 'empty' | 'swap' | 'questionable'
const CHECK_TAG: Record<CheckKind, string> = { out: 'OUT', bye: 'BYE', empty: 'EMPTY', swap: 'SWAP', questionable: 'Q' }
const CHECK_TAG_ES: Record<CheckKind, string> = { out: 'FUERA', bye: 'DESCANSO', empty: 'VACÍO', swap: 'CAMBIO', questionable: 'Q' }

/**
 * The status in Spanish, by its abbreviation — the same words as `RosterKey`. `full` is the
 * provider's own text ("Questionable"), so without this a screen reader said English in Spanish.
 * An unfamiliar designation keeps the provider's text, as `abbreviate` does.
 */
const STATUS_ES: Record<string, string> = {
  H: 'sano', Q: 'dudoso', D: 'poco probable', O: 'fuera', IR: 'reserva de lesionados', DNP: 'no entrenó',
  P: 'probable', SUS: 'suspendido', PUP: 'no apto físicamente', INA: 'inactivo',
}

const CONFIDENCE_ES: Record<string, string> = { HIGH: 'alta', MEDIUM: 'media', LOW: 'baja', INSUFFICIENT: 'insuficiente' }

export const myTeamScreenMessages = defineMessages({
  en: {
    ordinal: ordinalEn,
    /** "3 of 12" — the word between a rank and its field. */
    of: 'of',
    /** The lock time's locale, once the reader's zone is known; empty is "none" — the browser's own. */
    lockTimeLocale: '',
    /** StatusChip's spoken/hover text: the provider's own designation. */
    statusFull: (_short: string, provider: string): string => provider,

    // UnidentifiedNote
    unidentifiedNote: (count: number) =>
      `${count} more ${count === 1 ? 'player' : 'players'} on this list could not be matched to anyone we hold, so ${count === 1 ? 'is' : 'are'} not shown. ${count === 1 ? 'He is' : 'They are'} still on your roster.`,

    // GameContext
    noGameThisWeek: 'no game found for this week',

    // VenueMark
    windMph: (mph: number) => `${Math.round(mph)} mph wind`,
    precipPct: (pct: number) => `${Math.round(pct)}% precip`,

    // gradeSubtitle
    rightOnMedian: 'right on the league median',
    /** `amount` is already formatted in the reader's locale. */
    vsMedian: (amount: string, above: boolean) => `${amount} ${above ? 'above' : 'below'} the median`,
    vsMedianAmount: (amount: number): string => amount.toLocaleString(getAppIntlLocale()),
    bestPosition: (position: string, rank: number) => `${position} is your best (${ordinalEn(rank)})`,
    thinnestPosition: (position: string, rank: number) => `${position} your thinnest (${ordinalEn(rank)})`,
    pricedOf: (priced: number, total: number) => `priced ${priced} of your ${total}`,
    valuedUnderScoring: 'valued under your scoring',
    marketPricesUnadjusted: 'market prices, not adjusted for your scoring',

    // TeamActivityCard
    recentMoves: 'Your recent moves',
    noMovesByYou: 'No moves by you in the activity we hold.',
    activityThrough: (date: string) => ` League activity on file through ${date}.`,
    tradedWith: 'with',

    // PositionStrengthCard
    positionalStrength: 'Positional strength',
    vsMedianLabel: 'vs median',
    posStrNoteLeagueScored: 'Roster value priced under your league’s scoring, against the other teams in this league.',
    posStrNoteMarket: 'Roster value at 12-team PPR market prices, against the other teams in this league.',

    // WinForecast
    noWinProbability: 'No win probability',
    toWin: 'to win',
    projectedMargin: 'projected margin',
    confidence: 'confidence',
    confidenceLevel: (confidence: string): string => confidence.toLowerCase(),

    // MatchupSideView
    projectedFromOf: (from: number, count: number) => `from ${from} of ${count}`,

    // edge
    edgeBestBall: (by: string, ahead: boolean) =>
      `Listed starters project ${by} ${ahead ? 'ahead' : 'behind'}; eligible Best Ball bench replacements are not included.`,
    edgeCoinFlip: 'Projected within three points — this is a coin flip.',
    edgeAhead: (by: string) => `You are projected ahead by ${by}.`,
    edgeBehind: (by: string) => `You are projected behind by ${by}.`,

    // PlayerCell
    byeTag: 'BYE',

    // ProjHeader / RosterKey — the two market columns' headings
    marketOwn: 'OWN',
    marketStart: 'START',

    // RosterKey
    keyHealthy: 'healthy',
    keyQuestionable: 'questionable',
    keyDoubtful: 'doubtful',
    keyOut: 'out',
    keyInjuredReserve: 'injured reserve',
    keyDidNotPractice: 'did not practice',
    keyNoDesignation: 'no designation reported, which is not the same as confirmed healthy',
    keyRoofed: 'roofed stadium: weather is not a factor',
    keyForecast: 'forecast at kickoff',
    abbreviationsSummary: 'What the abbreviations mean',
    keyMarketColumns: 'how many AllFantasy leagues roster him, and of those how many start him this week (wide screens)',

    // DynastyCard
    dynastyOutlook: 'Dynasty outlook',
    draftCapital: 'Draft capital',
    noPicks: 'You hold no picks in the upcoming drafts.',
    pickVia: 'via',
    tradedPicksOnly: 'Only picks that changed hands are listed — this league’s draft size is not on file.',
    lineupAge: 'Lineup age',
    startersMedianAge: 'Starters’ median age',
    withAgeOnFile: 'with an age on file',
    youngCore: 'players 24 or younger',
    noAgingStarters: 'No starter is past the age his position usually declines.',
    agingDecline: (position: string, threshold: number) => `${position}s usually decline from ${threshold}`,

    // FreeAgentFill
    faTitle: 'Free agents who would start',
    faChecking: 'Checking free agents…',
    faNone: 'No free agent improves your lineup this week.',
    faReplaces: (name: string) => `replaces ${name}`,
    faSeeAll: 'See every add, bids and priority',

    // checkLine
    checkReview: (name: string, pts: string) => ` — review ${name} (${pts})`,
    checkFindReplacement: ' — find a replacement',
    checkRuledOut: (name: string | null) => `${name} is ruled out`,
    checkOnBye: (name: string | null) => `${name} is on bye`,
    checkEmpty: (slot: string) => `${slot} is empty`,
    checkCompare: (replacement: string, name: string | null, gain: string) => `Compare ${replacement} with ${name} (+${gain})`,
    checkQuestionable: (name: string | null) => `${name} is questionable — have a backup ready`,
    checkTag: (kind: CheckKind): string => CHECK_TAG[kind],

    // LineupCheckCard
    lockedNote: (locked: number) =>
      ` ${locked} ${locked === 1 ? 'starter has' : 'starters have'} reached kickoff; confirm individual locks on your platform.`,
    lineupCheck: 'Lineup check',
    unresolvedSlots: (n: number) => `${n} filled slot(s) could not be checked because the player identity is unresolved.`,
    lineupCheckFootnote: 'These are candidates for review. Confirm eligibility, locks, and AutoSubs on your platform before changing the lineup.',
    lineupCheckClear: 'No issues were identified among the starters we could check. Confirm current news and rules on your platform.',
    fixInPlatform: (platform: string) => `Fix in ${platform}`,

    // BenchCheckStrip
    benchCheck: 'Bench check',
    benchCheckSwap: '{bench} (bench) projects {benchPts} against {starter}’s {starterPts} — the stronger play this week.',
    benchCheckHold: (margin: number) =>
      `{bench} (bench) projects {benchPts} against {starter}’s {starterPts} — inside the ${margin}-point margin these projections can actually tell apart, so your starter is fine as-is.`,
    benchAskPrefill: (bench: string, starter: string) =>
      `Should I start ${bench} instead of ${starter} in this league? Compare league-scored projections, injuries, positional eligibility and kickoff locks.`,
    benchAskChimmy: 'Ask Chimmy about this swap',
    benchCaveat: 'Projection comparison · confirm injury updates, kickoff locks and AutoSubs on your platform.',

    // TaxiYears
    taxiUnknownTitle: "This needs the league's taxi-year limit and its season-end roster history. One of them is missing, so we are not going to guess.",
    taxiUnknown: 'years left unknown',
    taxiNone: 'no taxi years left',
    taxiYearsLeft: (n: number, allowed: number) => `${n} ${n === 1 ? 'year' : 'years'} left of ${allowed}`,

    // OffseasonView
    finishedRank: (rank: number, teamCount: number) => ` · finished ${ordinalEn(rank)} of ${teamCount}`,
    openDraftHq: 'Open Draft HQ',
    planRookieDraft: 'Plan your rookie draft',
    tradeCenter: 'Trade center',
    rosterValue: 'roster value',
    nextSteps: 'Next steps',

    // ProjectionTiles
    hideComparison: 'Hide comparison',
    compareProjections: 'Compare projections',

    // MyTeam header
    teams: 'teams',

    // MyTeam lock banner
    distantLock: (daysAway: number, week: number | null) =>
      `The next game we hold for your starters is ${daysAway} days away${week != null ? ` (week ${week})` : ''}. That is further out than a lineup lock should be, so this week's schedule probably has not been ingested yet rather than your lineup being safe for ${daysAway} days.`,

    // MyTeam lineup decision
    decisionReviewLock: (name: string | undefined) => `Review ${name}'s lock`,
    decisionFillSlot: (slot: string) => `Fill your ${slot} slot`,
    decisionReplace: (name: string) => `Replace ${name}`,
    decisionCoverBye: (name: string) => `Cover ${name}'s bye`,
    decisionReviewSwap: (starter: string, bench: string) => `Review ${starter} vs ${bench}`,
    decisionKickoffReached: 'The starter or bench option has already reached kickoff. Confirm locks and AutoSubs on your platform; this notice does not establish that a lineup change is allowed.',
    decisionOutOrBye: (name: string, onBye: boolean) =>
      `${name} is ${onBye ? 'on a bye' : 'ruled out'}. Review replacement eligibility, individual locks, and AutoSubs on your platform.`,
    decisionBenchProjectsMore: (bench: string, delta: number) =>
      `${bench} projects ${delta.toFixed(1)} more points under this league's scoring. Confirm injury status and eligibility first.`,
    decisionScoringDisfavors: "This league's scoring does not favor the bench option. These projections do not support a swap.",
    decisionUnconfirmed: 'The bench check suggests a review, but the player identity or league-scored values could not be confirmed. Refresh before considering a swap.',
    decisionCoverage: (week: number, afProjected: number, starters: number) =>
      `Week ${week} · ${afProjected} of ${starters} starters priced for this league`,

    // MyTeam basis card
    basisCoverage: (afProjected: number, projected: number) =>
      `Your league’s total is built from ${afProjected} of ${projected} priced starters, so it reads low next to the standard one.`,

    // MyTeam starters note
    startersNoteNative: 'Native AllFantasy lineup. Save eligible changes in Roster decisions; server rules and locks apply.',
    startersNoteBestBall: (platform: string) => `Best Ball roster from ${platform}. Scoring selects your eligible starters automatically.`,
    startersNoteImported: (platform: string) => `Lineup from ${platform}. To change it, open ${platform} — AllFantasy only reads.`,

    // MyTeam coverage footnote
    allStartersProjected: (projected: number, season: string, week: number) =>
      `All ${projected} starters projected · ${season} week ${week}`,
    standardBuiltFrom: (projected: number, unprojected: number) =>
      `Standard total built from ${projected} of ${
        projected + unprojected
      } starters — ${unprojected} ${
        unprojected === 1 ? 'has' : 'have'
      } no projection on file, so it reads low.`,
  },
  es: {
    ordinal: ordinalEs,
    of: 'de',
    lockTimeLocale: 'es',
    statusFull: (short, provider) => STATUS_ES[short] ?? provider,

    unidentifiedNote: (count) =>
      `${count} ${count === 1 ? 'jugador más' : 'jugadores más'} en esta lista no ${count === 1 ? 'coincide' : 'coinciden'} con nadie en nuestros datos, así que no se muestra${count === 1 ? '' : 'n'}. Siguen en tu plantilla.`,

    noGameThisWeek: 'no se encontró partido esta semana',

    windMph: (mph) => `viento de ${Math.round(mph)} mph`,
    precipPct: (pct) => `${Math.round(pct)}% de lluvia`,

    rightOnMedian: 'justo en la mediana de la liga',
    vsMedian: (amount, above) => `${amount} ${above ? 'por encima' : 'por debajo'} de la mediana`,
    vsMedianAmount: (amount) => amount.toLocaleString('es'),
    bestPosition: (position, rank) => `${position} es tu mejor posición (${ordinalEs(rank)})`,
    thinnestPosition: (position, rank) => `${position} la más débil (${ordinalEs(rank)})`,
    pricedOf: (priced, total) => `valorados ${priced} de tus ${total}`,
    valuedUnderScoring: 'valorado con tu puntuación',
    marketPricesUnadjusted: 'precios de mercado, sin ajustar a tu puntuación',

    recentMoves: 'Tus movimientos recientes',
    noMovesByYou: 'No hay movimientos tuyos en la actividad registrada.',
    activityThrough: (date) => ` Actividad de la liga registrada hasta el ${date}.`,
    tradedWith: 'con',

    positionalStrength: 'Fuerza por posición',
    vsMedianLabel: 'vs mediana',
    posStrNoteLeagueScored: 'Valor de plantilla con la puntuación de tu liga, contra los demás equipos de esta liga.',
    posStrNoteMarket: 'Valor de plantilla con precios de mercado PPR de 12 equipos, contra los demás equipos de esta liga.',

    noWinProbability: 'Sin probabilidad de victoria',
    toWin: 'probabilidad de ganar',
    projectedMargin: 'margen proyectado',
    confidence: 'confianza',
    confidenceLevel: (confidence) => CONFIDENCE_ES[confidence] ?? confidence,

    projectedFromOf: (from, count) => `con ${from} de ${count}`,

    edgeBestBall: (by, ahead) =>
      `Los titulares mostrados proyectan ${by} ${ahead ? 'a favor' : 'en contra'}; no incluye los reemplazos elegibles del banquillo de Best Ball.`,
    edgeCoinFlip: 'Proyección a menos de tres puntos: es una moneda al aire.',
    edgeAhead: (by) => `Tienes una ventaja proyectada de ${by}.`,
    edgeBehind: (by) => `Tienes una desventaja proyectada de ${by}.`,

    byeTag: 'DESCANSO',

    marketOwn: 'PROP.',
    marketStart: 'TIT.',

    keyHealthy: 'sano',
    keyQuestionable: 'dudoso',
    keyDoubtful: 'poco probable',
    keyOut: 'fuera',
    keyInjuredReserve: 'reserva de lesionados',
    keyDidNotPractice: 'no entrenó',
    keyNoDesignation: 'sin designación reportada, que no es lo mismo que confirmado sano',
    keyRoofed: 'estadio techado: el clima no cuenta',
    keyForecast: 'pronóstico al inicio del partido',
    abbreviationsSummary: 'Qué significan las abreviaturas',
    keyMarketColumns: 'propiedad y titular: cuántas ligas de AllFantasy lo tienen, y de esas cuántas lo alinean esta semana (en pantallas anchas)',

    dynastyOutlook: 'Panorama dinastía',
    draftCapital: 'Selecciones de draft',
    noPicks: 'No tienes selecciones en los próximos drafts.',
    pickVia: 'vía',
    tradedPicksOnly: 'Solo se listan las selecciones que cambiaron de manos: el tamaño del draft de esta liga no está registrado.',
    lineupAge: 'Edad de la alineación',
    startersMedianAge: 'Edad mediana de titulares',
    withAgeOnFile: 'con edad registrada',
    youngCore: 'jugadores de 24 años o menos',
    noAgingStarters: 'Ningún titular ha pasado la edad en que su posición suele declinar.',
    agingDecline: (position, threshold) => `los ${position} suelen declinar desde los ${threshold}`,

    faTitle: 'Agentes libres que entrarían',
    faChecking: 'Revisando agentes libres…',
    faNone: 'Ningún agente libre mejora tu alineación esta semana.',
    faReplaces: (name) => `reemplaza a ${name}`,
    faSeeAll: 'Ver todas las altas, ofertas y prioridad',

    checkReview: (name, pts) => ` — revisa a ${name} (${pts})`,
    checkFindReplacement: ' — busca un reemplazo',
    checkRuledOut: (name) => `${name} está descartado`,
    checkOnBye: (name) => `${name} descansa esta semana`,
    checkEmpty: (slot) => `El puesto ${slot} está vacío`,
    checkCompare: (replacement, name, gain) => `Compara a ${replacement} con ${name} (+${gain})`,
    checkQuestionable: (name) => `${name} es duda — ten un suplente listo`,
    checkTag: (kind) => CHECK_TAG_ES[kind],

    lockedNote: (locked) =>
      ` ${locked} ${locked === 1 ? 'titular ya llegó al inicio del partido' : 'titulares ya llegaron al inicio del partido'}.`,
    lineupCheck: 'Revisión de alineación',
    unresolvedSlots: (n) => `${n} puesto(s) ocupado(s) no pudieron revisarse porque no identificamos al jugador.`,
    lineupCheckFootnote: 'Estas son opciones para revisar. Confirma elegibilidad, cierres y AutoSubs en tu plataforma antes de cambiar la alineación.',
    lineupCheckClear: 'No se identificaron problemas entre los titulares que pudimos revisar. Confirma las noticias y las reglas en tu plataforma.',
    fixInPlatform: (platform) => `Corregir en ${platform}`,

    benchCheck: 'Revisión del banquillo',
    benchCheckSwap: '{bench} (suplente) proyecta {benchPts} frente a los {starterPts} de {starter}: la mejor opción esta semana.',
    benchCheckHold: (margin) =>
      `{bench} (suplente) proyecta {benchPts} frente a los {starterPts} de {starter}: dentro del margen de ${margin} puntos que estas proyecciones pueden distinguir, así que tu titular está bien así.`,
    benchAskPrefill: (bench, starter) =>
      `¿Debería poner de titular a ${bench} en lugar de ${starter} en esta liga? Compara las proyecciones con la puntuación de la liga, lesiones, elegibilidad de posición y cierres por inicio de partido.`,
    benchAskChimmy: 'Preguntar a Chimmy por este cambio',
    benchCaveat: 'Comparación de proyecciones · confirma lesiones, cierres por inicio y cambios automáticos en tu plataforma.',

    taxiUnknownTitle: 'Hace falta el límite de años de taxi de la liga y su historial de plantillas a fin de temporada. Falta uno de los dos, así que no vamos a adivinar.',
    taxiUnknown: 'años restantes desconocidos',
    taxiNone: 'sin años de taxi',
    taxiYearsLeft: (n, allowed) => `${n === 1 ? 'queda 1 año' : `quedan ${n} años`} de ${allowed}`,

    finishedRank: (rank, teamCount) => ` · terminó ${ordinalEs(rank)} de ${teamCount}`,
    openDraftHq: 'Abrir Draft HQ',
    planRookieDraft: 'Planear el draft de novatos',
    tradeCenter: 'Centro de intercambios',
    rosterValue: 'valor de plantilla',
    nextSteps: 'Siguientes pasos',

    hideComparison: 'Ocultar comparación',
    compareProjections: 'Comparar proyecciones',

    teams: 'equipos',

    distantLock: (daysAway, week) =>
      `El próximo partido registrado de tus titulares es en ${daysAway} días${week != null ? ` (semana ${week})` : ''}. Es demasiado pronto para una hora de cierre; probablemente aún falta el calendario de esta semana.`,

    decisionReviewLock: (name) => `Revisa el cierre de ${name}`,
    decisionFillSlot: (slot) => `Cubre tu posición ${slot}`,
    decisionReplace: (name) => `Reemplaza a ${name}`,
    decisionCoverBye: (name) => `Cubre la semana de descanso de ${name}`,
    decisionReviewSwap: (starter, bench) => `Revisa ${starter} frente a ${bench}`,
    decisionKickoffReached: 'El partido del titular o de la opción de banca ya comenzó. Confirma los cierres y AutoSubs en tu plataforma; este aviso no garantiza que puedas cambiar la alineación.',
    decisionOutOrBye: (name, onBye) =>
      `${name} está ${onBye ? 'en semana de descanso' : 'descartado'}. Revisa la elegibilidad del reemplazo, los cierres individuales y los cambios automáticos en tu plataforma.`,
    decisionBenchProjectsMore: (bench, delta) =>
      `${bench} proyecta ${delta.toFixed(1)} puntos más con la puntuación de esta liga. Confirma primero su estado de lesión y su elegibilidad.`,
    decisionScoringDisfavors: 'La puntuación de esta liga no favorece la opción de banca. No se recomienda un cambio con estas proyecciones.',
    decisionUnconfirmed: 'La comparación sugiere una revisión, pero no se pudo confirmar la identidad o las proyecciones de esta liga. Actualiza antes de considerar un cambio.',
    decisionCoverage: (week, afProjected, starters) =>
      `Semana ${week} · ${afProjected} de ${starters} titulares valorados para esta liga`,

    basisCoverage: (afProjected, projected) =>
      `El total de tu liga incluye ${afProjected} de ${projected} titulares con proyección, así que puede parecer bajo frente al estándar.`,

    startersNoteNative: 'Liga nativa AllFantasy. Guarda cambios válidos en Decisiones de plantilla; se aplican las reglas y cierres del servidor.',
    startersNoteBestBall: (platform) => `Plantilla Best Ball de ${platform}. Los titulares elegibles se seleccionan automáticamente.`,
    startersNoteImported: (platform) => `Alineación de ${platform}. Para cambiarla, abre ${platform}; AllFantasy solo la consulta.`,

    allStartersProjected: (projected, season, week) =>
      `Los ${projected} titulares tienen proyección · ${season}, semana ${week}`,
    standardBuiltFrom: (projected, unprojected) =>
      `Total estándar calculado con ${projected} de ${projected + unprojected} titulares; ${unprojected} sin proyección, así que puede parecer bajo.`,
  },
})
