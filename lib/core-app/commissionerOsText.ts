/**
 * Spanish for the Commissioner OS card (2026-10-05).
 *
 * The card on `/core/commissioner` shows the top commissioner recommendation and the copy-ready
 * cards. Their titles and summaries are written in English by the server, from four places:
 *
 * - the commissioner generators in `lib/shared-services/league-hub/generators/commissioner/`;
 * - the league health engine (`lib/league-health/league-health-engine.ts`) — alerts,
 *   interventions and problems, passed through Mission Control or quoted inside a summary;
 * - the league attention signals (`lib/decision-os/attentionSignals.ts`);
 * - the drama engine's storyline headlines (`lib/drama-engine/DramaEventDetector.ts`), which carry
 *   team names.
 *
 * Measured 2026-10-05 against the 40 leagues the owner can open as commissioner: 587
 * recommendations, 14 types, every one English. Translated at render, in the client, where the
 * language is known. Fixed sentences go through an exact map; templates go through patterns that
 * keep the names and numbers they carry. Unknown text passes through unchanged.
 *
 * `__tests__/core-app/commissioner-os-text.test.tsx` scans those four sources so a new sentence
 * without Spanish fails. PURE and client-safe: no imports.
 */

const EXACT: Record<string, string> = {
  // league-health-engine: urgent alerts
  'CRITICAL: Multiple abandoned teams. Find replacements immediately.':
    'CRÍTICO: varios equipos abandonados. Busca reemplazos de inmediato.',
  'URGENT: Unresolved disputes accumulating. Commissioner action required.':
    'URGENTE: se acumulan disputas sin resolver. Se requiere la acción del comisionado.',
  'ALERT: 30%+ of managers inactive. League may be dying.':
    'ALERTA: más del 30 % de los mánagers están inactivos. La liga podría estar muriendo.',
  // league-health-engine: interventions
  'Find replacement managers for abandoned teams': 'Busca mánagers de reemplazo para los equipos abandonados',
  'Resolve all pending disputes this week': 'Resuelve todas las disputas pendientes esta semana',
  'Post weekly recaps, power rankings, or trash talk threads to boost engagement':
    'Publica resúmenes semanales, rankings de poder o hilos de pique para aumentar la participación',
  'Consider extending trade deadline or brokering deals to stimulate trade activity':
    'Considera ampliar la fecha límite de intercambios o mediar acuerdos para estimular los intercambios',
  // league-health-engine: problems and early warnings
  'Low engagement — league activity is below healthy levels':
    'Participación baja: la actividad de la liga está por debajo de lo saludable',
  'Poor lineup submission rate — managers are checked out':
    'Pocas alineaciones enviadas: los mánagers se han desconectado',
  'Lineup submission dipping — some managers may be losing interest':
    'Bajan las alineaciones enviadas: algunos mánagers podrían estar perdiendo el interés',
  'Very low chat activity — community engagement is weak':
    'Muy poca actividad en el chat: la comunidad participa poco',

  // engagementRecommendations: summaries of Mission Control actions
  'Flagged as urgent from this league’s health check.': 'Marcado como urgente en la revisión de salud de esta liga.',
  'Suggested from this league’s health check.': 'Sugerido por la revisión de salud de esta liga.',
  // integrityRecommendations
  'Review recommended': 'Revisión recomendada',
  // leagueHealthRecommendations + LeagueHealthService
  'League health could not be assessed': 'No se pudo evaluar la salud de la liga',
  'League health data is unavailable for this league.': 'No hay datos de salud disponibles para esta liga.',
  'League health could not be resolved for this league.': 'No se pudo determinar la salud de esta liga.',
  // rivalryRecommendations
  'No notable timeline moments recorded yet for this rivalry.':
    'Aún no hay momentos destacados registrados para esta rivalidad.',

  // attentionSignals
  'Draft is today': 'El draft es hoy',
  'Draft is tomorrow': 'El draft es mañana',
  'Confirm draft settings, roster rules, and pick order before draft day.':
    'Confirma la configuración del draft, las reglas de plantilla y el orden de selección antes del día del draft.',
  'Financial status not confirmed': 'Estado financiero sin confirmar',
  'Confirm this league is free or paid from the League Context card.':
    'Confirma si esta liga es gratuita o de pago desde la tarjeta de contexto de la liga.',
  'League health needs attention': 'La salud de la liga necesita atención',
  'Review League Health and consider a commissioner intervention.':
    'Revisa la salud de la liga y considera una intervención del comisionado.',
  'League health is excellent': 'La salud de la liga es excelente',
  'Requires immediate review': 'Requiere revisión inmediata',
  'Recommended review': 'Revisión recomendada',

  // DramaEventDetector: fixed summaries and headlines
  'Winner flipped from the prior meeting, signaling a revenge payoff.':
    'El ganador cambió respecto al enfrentamiento anterior: revancha cumplida.',
  'Momentum continues to build as playoff pressure rises.':
    'El impulso sigue creciendo mientras sube la presión de los playoffs.',
  'Pressure mounts as every week worsens the playoff path.':
    'La presión aumenta: cada semana complica más el camino a los playoffs.',
  'Playoff bubble tightening across the league': 'La pelea por los playoffs se aprieta en toda la liga',
  'Playoff odds are swinging quickly around the cut line.':
    'Las probabilidades de playoffs cambian rápido alrededor del corte.',
  "Last season's champion still projects as a contender.":
    'El campeón de la temporada pasada sigue proyectándose como candidato.',
  'A new long-term power center is emerging.': 'Está surgiendo un nuevo centro de poder a largo plazo.',
}

const HEALTH_BAND_ES: Record<string, string> = {
  healthy: 'saludable',
  stable: 'estable',
  declining: 'en descenso',
  'at risk': 'en riesgo',
  'insufficient evidence': 'evidencia insuficiente',
}

const RIVALRY_TIER_ES: Record<string, string> = {
  Emerging: 'emergente',
  Heated: 'caliente',
  'Blood Feud': 'enemistad a muerte',
  'League Classic': 'clásico de la liga',
}

const RIVALRY_EVENT_ES: Record<string, string> = {
  championship_clash: 'choque por el campeonato',
  close_game: 'partido ajustado',
  drama: 'drama',
  elimination: 'eliminación',
  h2h_matchup: 'duelo directo',
  playoff_matchup: 'duelo de playoffs',
  streak: 'racha',
  trade: 'intercambio',
  upset_win: 'victoria sorpresa',
}

const plural = (n: string, one: string, many: string) => (n === '1' ? `1 ${one}` : `${n} ${many}`)

type Rule = [RegExp, (...groups: string[]) => string]

/** Templates, each anchored to the whole string. Captured names and numbers are kept as they are. */
const RULES: Rule[] = [
  // league-health-engine problems and warnings (also quoted inside an integrity summary)
  [/^(\d+) inactive managers — engagement at risk$/, (n) => `${n} mánagers inactivos: la participación está en riesgo`],
  [/^(\d+) abandoned teams — immediate action needed$/, (n) => `${n} equipos abandonados: hace falta actuar de inmediato`],
  [/^(\d+) unresolved disputes eroding trust$/, (n) => `${n} disputas sin resolver están minando la confianza`],
  [/^Zero trades through week (\d+) — trade market may be stagnant$/, (w) => `Ningún intercambio hasta la semana ${w}: el mercado podría estar estancado`],

  // integrityRecommendations — the quoted issue is translated too
  [/^Possible integrity concern: (.+)$/s, (issue) => `Posible problema de integridad: ${commissionerOsText(issue, 'es')}`],

  // leagueHealthRecommendations
  [/^League health: (healthy|stable|declining|at risk|insufficient evidence)$/, (band) => `Salud de la liga: ${HEALTH_BAND_ES[band]}`],
  [
    /^Overall score (\d+)\/100 \((healthy|stable|declining|at risk|insufficient evidence)\)\. (\d+) issue\(s\) flagged\.$/,
    (score, band, k) => `Puntuación general ${score}/100 (${HEALTH_BAND_ES[band]}). ${plural(k, 'problema detectado', 'problemas detectados')}.`,
  ],

  // tradeGradeRecommendations
  [/^(\d+) trade\(s\) this period$/, (n) => `${plural(n, 'intercambio', 'intercambios')} en este periodo`],
  [
    /^Your league recorded (\d+) real trade\(s\) this period\. Review deterministic fairness\/impact grades for any of them in the Trade Analyzer\.$/,
    (n) => `Tu liga registró ${plural(n, 'intercambio real', 'intercambios reales')} en este periodo. Revisa en el Analizador de intercambios las calificaciones de equidad e impacto de cualquiera de ellos.`,
  ],

  // draftGradeRecommendations
  [/^Draft grades ready for (\d+) team\(s\)$/, (n) => `Calificaciones del draft listas para ${plural(n, 'equipo', 'equipos')}`],
  [
    /^Best grade: (.+?) \(roster (.+?)\)\. Lowest grade: (.+?) \(roster (.+?)\)\. Format-naive scoring — does not yet account for keeper\/dynasty rules\.$/,
    (best, bestRoster, worst, worstRoster) =>
      `Mejor calificación: ${best} (plantilla ${bestRoster}). Peor calificación: ${worst} (plantilla ${worstRoster}). Puntuación que no distingue formatos: aún no tiene en cuenta las reglas de keeper ni dinastía.`,
  ],

  // rankingsRecommendations
  [/^Week (\d+) power rankings ready$/, (w) => `Rankings de poder de la semana ${w} listos`],
  [/^Deterministic power rankings for week (\d+) — (.*)$/s, (w, rest) => `Rankings de poder deterministas de la semana ${w}: ${rest}`],

  // rivalryRecommendations
  [
    /^Rivalry: (Emerging|Heated|Blood Feud|League Classic) tier \(score (\d+)\)$/,
    (tier, score) => `Rivalidad: nivel ${RIVALRY_TIER_ES[tier]} (puntuación ${score})`,
  ],
  [
    /^Most recent notable moment: ([a-z0-9_]+)(?: \((\d+)\))?\.$/,
    (event, season) => `Momento destacado más reciente: ${RIVALRY_EVENT_ES[event] ?? event.replace(/_/g, ' ')}${season ? ` (${season})` : ''}.`,
  ],

  // attentionSignals
  [/^Draft in (\d+) days$/, (n) => `El draft es en ${n} días`],

  // DramaEventDetector headlines and summaries — the names are the users' own and stay as they are,
  // except the stand-in for a team with none ("Team 9"), which is ours and reads «Equipo 9» (`teamEs`).
  [/^(.+?) vs (.+): (Emerging|Heated|Blood Feud|League Classic) rivalry$/s, (a, b, tier) => `${teamEs(a)} vs ${teamEs(b)}: rivalidad ${RIVALRY_TIER_ES[tier]}`],
  [/^Head-to-head tension \(score (\d+)\/100\)\.$/, (score) => `Tensión en el cara a cara (puntuación ${score}/100).`],
  [/^Major upset in week (\d+): (.+)$/s, (w, teams) => `Gran sorpresa en la semana ${w}: ${teamsEs(teams)}`],
  [/^Revenge game completed: (.+)$/s, (teams) => `Revancha consumada: ${teamsEs(teams)}`],
  [/^(.+) is on a (\d+)-game heater$/s, (team, n) => `${teamEs(team)} lleva una racha de ${n} victorias`],
  [/^Collapse warning: (.+) has dropped (\d+) straight$/s, (team, n) => `Alerta de derrumbe: ${teamEs(team)} ha perdido ${n} seguidos`],
  [/^Title defense alive for (.+)$/s, (team) => `${teamEs(team)} sigue vivo en la defensa del título`],
  [/^Trade fallout after week (\d+) blockbuster$/, (w) => `Repercusiones del gran intercambio de la semana ${w}`],
  [
    /^High-volatility trade \((\d+) moved assets, value swing (-?[\d.]+)\)\.$/,
    (n, swing) => `Intercambio de alta volatilidad (${plural(n, 'activo movido', 'activos movidos')}, variación de valor ${swing}).`,
  ],
  [/^Dynasty shift alert: (.+) is surging$/s, (team) => `Alerta de cambio dinástico: ${teamEs(team)} va en ascenso`],
  [/^(.+) no longer looks untouchable as power shifts\.$/s, (team) => `${teamEs(team)} ya no parece intocable mientras cambia el poder.`],
]

/**
 * A team with no name is printed by its roster slot, "Team 9" (`teamDisplayName`, and the drama
 * engine's `rivalSideNamer`). Those two words are ours, not the user's, so they are translated; any
 * other name — including a real team called "Team Awesome" — is the user's and passes through.
 */
function teamEs(name: string): string {
  return name.replace(/^Team (\d{1,3})$/, 'Equipo $1')
}

/** Both sides of an "A vs B" pair. */
function teamsEs(teams: string): string {
  return teams.split(' vs ').map(teamEs).join(' vs ')
}

/** A Commissioner OS sentence in the reader's language; unknown text passes through unchanged. */
export function commissionerOsText(text: string | null | undefined, language: string): string {
  if (!text) return ''
  if (language !== 'es') return text
  const exact = EXACT[text]
  if (exact) return exact
  for (const [pattern, render] of RULES) {
    const m = pattern.exec(text)
    if (m) return render(...m.slice(1))
  }
  return text
}
