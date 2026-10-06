/**
 * lib/i18n/decision-os/recommendations.ts — Spanish for the Recommended Moves a screen renders.
 *
 * buildDecisionRecommendationsViewModel (lib/decision-os/recommendations.ts) assembles its view model
 * from the phase 6 engine (lib/decision-os/phase6/recommendations/recommendations.ts) and the category
 * templates in lib/decision-os/presentation/recommendations.ts — all English, and all also used off the
 * screen. So nothing upstream changes: the screens localize the finished view model here.
 *
 * English and other languages return the model untouched. Unknown text stays English, never a raw
 * key; `__tests__/recommendations-i18n.test.tsx` reads the engine's own literals and fails on any
 * sentence without Spanish.
 *
 * ⚠ TWO FIELDS ARE DELIBERATELY LEFT ENGLISH, because code branches on them:
 *   - `confidenceLabel` — DecisionOsConfidenceBadge picks its tone and icon from it;
 *   - each item's `priority` — DecisionRecommendationsCard's priorityClass and DecideHome's recSev
 *     both compare it to 'critical' / 'high'. Screens translate it only where they print it, with
 *     `translateRecText`.
 * ⚠ The engine withholds an identity classification on purpose (IDENTITY_WITHHELD_EVIDENCE); its
 *   Spanish says exactly as little.
 */

import type { DecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'

const REC_ES: Readonly<Record<string, string>> = {
  // ── View model ──
  'Recommended Moves': 'Movimientos recomendados',
  'Personal action queue': 'Tu lista de acciones',
  'Recommendations': 'Recomendaciones',
  'None ready yet': 'Ninguna lista todavía',
  'Ready actions': 'Acciones listas',
  'Critical items': 'Elementos críticos',
  'Evidence points': 'Puntos de evidencia',
  'No grounded recommendations yet': 'Aún no hay recomendaciones fundamentadas',
  'Recommendations appear here after enough league and manager activity is available.':
    'Las recomendaciones aparecen aquí cuando hay suficiente actividad de la liga y de los mánagers.',
  'Behavior signals': 'Señales de comportamiento',
  'League activity': 'Actividad de la liga',
  'Actionable opportunity': 'Oportunidad accionable',
  'Review this opportunity': 'Revisa esta oportunidad',

  // ── Tokens (priority, difficulty, confidence, completion), as titleCaseToken prints them ──
  'Critical': 'Crítica',
  'High': 'Alta',
  'Medium': 'Media',
  'Low': 'Baja',
  'Easy': 'Fácil',
  'Moderate': 'Moderada',
  'Hard': 'Difícil',
  'Pending': 'Pendiente',
  'In Progress': 'En curso',
  'Completed': 'Completada',
  'Dismissed': 'Descartada',
  'Unknown': 'Desconocido',

  // ── Category titles (presentation templates) ──
  'Boost Engagement': 'Impulsar la participación',
  'Lineup Discipline': 'Disciplina con la alineación',
  'Trade Strategy': 'Estrategia de trades',
  'Waiver Wire Opportunity': 'Oportunidad entre agentes libres',
  'Increase League Participation': 'Aumentar la participación en la liga',
  'Draft Preparation': 'Preparación del draft',
  'Retention Intervention': 'Intervención de retención',
  'Activate Trade Market': 'Activar el mercado de trades',
  'Activate Waiver Wire': 'Activar los reclamos',
  'Host a League Event': 'Organizar un evento de liga',
  'Post a Weekly Recap': 'Publicar un resumen semanal',
  'Amplify Rivalries': 'Avivar las rivalidades',
  'Platform Benchmark Alert': 'Alerta de referencia de la plataforma',
  'Product Opportunity': 'Oportunidad de producto',
  'Cohort Improvement': 'Mejora de cohorte',
  'Feature Adoption Gap': 'Brecha de adopción de funciones',

  // ── Expected impact ──
  'Improved lineup setting, waiver participation, and seasonal roster performance':
    'Mejores alineaciones, más participación en reclamos y mejor rendimiento de la plantilla en la temporada',
  'Fewer last-minute changes, reduced bench regret, more consistent start/sit decisions':
    'Menos cambios de último minuto, menos arrepentimiento con la banca y decisiones de titular/banca más constantes',
  'Higher trade acceptance rate, more balanced proposals, improved roster construction via trades':
    'Más trades aceptados, propuestas más equilibradas y una plantilla mejor armada a través de trades',
  'Improved roster depth and flexibility through targeted waiver wire use':
    'Más profundidad y flexibilidad en la plantilla con un uso dirigido de los agentes libres',
  'Improved league culture, higher commish satisfaction, better seasonal experience':
    'Mejor ambiente en la liga, comisionado más satisfecho y mejor experiencia de temporada',
  'Better draft positioning, stronger initial roster quality, reduced in-season adjustment burden':
    'Mejor posición en el draft, una plantilla inicial más fuerte y menos ajustes durante la temporada',
  'Reduced manager dropout risk, improved season completion rate':
    'Menos riesgo de que los mánagers abandonen y más temporadas terminadas',
  'Increased trade proposals, more engaged roster management, improved competitive balance':
    'Más propuestas de trade, una gestión de plantillas más activa y mejor equilibrio competitivo',
  'More active roster management, healthier competitive balance across the league':
    'Gestión de plantillas más activa y un equilibrio competitivo más sano en toda la liga',
  'Increased league activity, more inter-manager interaction, improved season experience':
    'Más actividad en la liga, más interacción entre mánagers y mejor experiencia de temporada',
  'Improved information flow, managers stay informed without active browsing':
    'Mejor flujo de información: los mánagers se mantienen al día sin tener que buscar',
  'Re-energized league activity, reversal of engagement decline, stronger finish to season':
    'Liga con nueva energía, freno a la caída de la participación y un mejor cierre de temporada',
  'Platform-wide retention improvement, reduced seasonal dropout rate':
    'Mejor retención en toda la plataforma y menos abandonos por temporada',
  'Increased platform engagement, improved product-market fit for low-engagement segments':
    'Más participación en la plataforma y mejor encaje del producto en los segmentos con poca participación',
  'Improved platform-wide health score, reduced stale league accumulation':
    'Mejor puntuación de salud de la plataforma y menos ligas inactivas acumuladas',
  'Improved feature discovery, better platform utilization in low-engagement segments':
    'Más descubrimiento de funciones y mejor uso de la plataforma en los segmentos con poca participación',

  // ── Suggested actions ──
  'Enable weekly lineup reminder notifications': 'Activa los avisos semanales para la alineación',
  'Check lineup 48 hours before game day': 'Revisa la alineación 48 horas antes del día de partido',
  'Review waiver wire every Tuesday morning': 'Revisa los agentes libres cada martes por la mañana',
  'Lock lineup decisions 24 hours before kickoff': 'Cierra las decisiones de alineación 24 horas antes del inicio',
  'Build a pre-week start/sit shortlist on Tuesdays': 'Arma los martes una lista corta de titulares y banca para la semana',
  'Commit to bench decisions by Thursday night': 'Define la banca a más tardar el jueves por la noche',
  'Research fair market value before proposing': 'Investiga el valor justo de mercado antes de proponer',
  'Add a value sweetener (pick or depth piece) to stalled offers': 'Añade un extra (una ronda o un jugador de profundidad) a las ofertas estancadas',
  'Check trade value charts for current buy-low/sell-high opportunities': 'Consulta las tablas de valor para ver oportunidades de comprar barato y vender caro',
  'Review available players and your league’s pickup rules': 'Revisa los jugadores disponibles y las reglas de altas de tu liga',
  'Set pickup targets before your league’s next deadline': 'Fija tus objetivos de altas antes del próximo plazo de tu liga',
  'Monitor injury reports for pickup opportunities': 'Sigue los reportes de lesiones para encontrar altas',
  'Respond to commissioner polls and surveys': 'Responde a las encuestas del comisionado',
  'Comment on matchup results or trade blocks': 'Comenta los resultados de los enfrentamientos o los jugadores en el mercado',
  'Set up push notifications for lineup lock reminders': 'Activa las notificaciones de cierre de alineación',
  'Study ADP and positional value tiers before the draft': 'Estudia el ADP y los niveles de valor por posición antes del draft',
  'Prepare a ranked position board for each round': 'Prepara un tablero por posiciones con tu orden para cada ronda',
  'Identify 3-4 handcuff running backs to target in late rounds': 'Identifica 3-4 corredores suplentes (handcuffs) para las últimas rondas',
  'Personally message inactive managers to check availability': 'Escribe en persona a los mánagers inactivos para ver si siguen',
  'Create a mid-season activity challenge with prize stakes': 'Crea un reto de actividad a mitad de temporada con premio',
  'Discuss adding a last-place punishment for next season': 'Propón un castigo para el último lugar la próxima temporada',
  'Post a trade block/offers thread in league chat': 'Abre un hilo de mercado y ofertas en el chat de la liga',
  'Run a power rankings poll to surface trade motivation': 'Haz una encuesta de power rankings para despertar ganas de hacer trades',
  'Create a trade deadline event with announcement': 'Crea un evento con anuncio para la fecha límite de trades',
  'Feature waiver wire pickups in your weekly recap': 'Destaca las altas de agentes libres en tu resumen semanal',
  'Post top 5 waiver wire targets every Tuesday': 'Publica cada martes los 5 mejores objetivos entre agentes libres',
  'Highlight streaming options at thin positions': 'Destaca opciones de streaming en las posiciones con poca profundidad',
  'Run a power rankings poll mid-week': 'Haz una encuesta de power rankings a mitad de semana',
  'Post a weekly matchup preview or trash talk prompt': 'Publica una previa semanal de los enfrentamientos o un tema para picarse',
  'Create a rivalry week with bonus stakes': 'Crea una semana de rivalidades con premios extra',
  'Post weekly standings after Monday night games': 'Publica la clasificación semanal tras los partidos del lunes por la noche',
  'Highlight top performers and surprise outcomes': 'Destaca a los mejores y los resultados sorpresa',
  'Launch a rivalry week with double-points stakes': 'Lanza una semana de rivalidades con puntos dobles en juego',
  'Post a playoff bubble standings graphic': 'Publica un gráfico con los equipos al borde de los playoffs',
  'Announce mid-season award (most points, best record, etc.)': 'Anuncia premios de mitad de temporada (más puntos, mejor récord, etc.)',
  'Analyze churn patterns by league archetype to identify highest-risk cohorts': 'Analiza los abandonos por arquetipo de liga para encontrar las cohortes de más riesgo',
  'Alert commissioners in high-churn leagues with retention recommendations': 'Avisa a los comisionados de ligas con muchos abandonos con recomendaciones de retención',
  'Review onboarding and re-engagement notification timing': 'Revisa el momento de las notificaciones de bienvenida y de reactivación',
  'Audit onboarding flow for new commissioner friction points': 'Audita la bienvenida para encontrar fricciones de los nuevos comisionados',
  'Identify which features top-quartile leagues use that bottom-quartile leagues do not': 'Identifica qué funciones usan las ligas del cuartil superior y no las del inferior',
  'A/B test proactive commissioner nudges in low-engagement leagues': 'Haz pruebas A/B de avisos proactivos a comisionados en ligas con poca participación',
  'Segment inactive leagues by age and inactivity duration': 'Segmenta las ligas inactivas por antigüedad y tiempo sin actividad',
  'Send automated re-engagement prompts to commissioners of stale leagues': 'Envía avisos automáticos de reactivación a los comisionados de ligas inactivas',
  'Set a league archival policy after N weeks of inactivity': 'Define una política para archivar ligas tras N semanas sin actividad',
  'Identify which platform features are underused in inactive_or_stale and low_engagement leagues': 'Identifica qué funciones se usan poco en las ligas inactive_or_stale y low_engagement',
  'Test commissioner-targeted feature education for high-value features in low-adoption leagues': 'Prueba formación para comisionados sobre funciones de alto valor en ligas con poca adopción',

  // ── Evidence (fixed sentences) ──
  'Supported by an internal engagement assessment, which is not disclosed here':
    'Respaldado por una evaluación interna de participación, que no se muestra aquí',
  'Engagement level suggests managers benefit from commissioner-pushed summaries':
    'El nivel de participación indica que a los mánagers les vienen bien los resúmenes que envía el comisionado',
}

/** Engine sentences that carry a count, a percentage or a token. English shape → Spanish builder. */
const PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Inactivity gap detected \((\w+) confidence, (\d+)x\)$/, (m) => `Pausa de inactividad detectada (confianza ${word(m[1]!)}, ${m[2]} veces)`],
  [/^(\d+) week\(s\) with 3\+ lineup saves \(indecision pattern\)$/, (m) => `${m[1]} semana(s) con 3+ guardados de alineación (patrón de indecisión)`],
  [/^(\d+) player\(s\) flip-flopped between bench and starter$/, (m) => `${m[1]} jugador(es) alternaron entre la banca y la titularidad`],
  [/^(\d+) window\(s\) with repeated trade rejections$/, (m) => `${m[1]} periodo(s) con trades rechazados repetidamente`],
  [/^(\d+) streak\(s\) of zero-change weeks — draft quality has outsized impact on outcomes$/,
    (m) => `${m[1]} racha(s) de semanas sin cambios: la calidad del draft pesa mucho en los resultados`],
  [/^Retention risk level: (.+)$/, (m) => `Nivel de riesgo de retención: ${word(m[1]!)}`],
  [/^League archetype: (.+)$/, (m) => `Arquetipo de liga: ${m[1]}`],
  [/^(\d+)% of managers inactive$/, (m) => `${m[1]}% de los mánagers inactivos`],
  [/^Trade activity at (\d+)th percentile platform-wide$/, (m) => `Actividad de trades en el percentil ${m[1]} de la plataforma`],
  [/^Trade tier: (.+)$/, (m) => `Nivel de trades: ${word(m[1]!)}`],
  [/^Waiver activity at (\d+)th percentile platform-wide$/, (m) => `Actividad de reclamos en el percentil ${m[1]} de la plataforma`],
  [/^Waiver tier: (.+)$/, (m) => `Nivel de reclamos: ${word(m[1]!)}`],
  [/^Engagement at (\d+)th percentile platform-wide$/, (m) => `Participación en el percentil ${m[1]} de la plataforma`],
  [/^Engagement tier: (.+)$/, (m) => `Nivel de participación: ${word(m[1]!)}`],
  [/^(\d+) window\(s\) of league activity below 40% of baseline$/, (m) => `${m[1]} periodo(s) con la actividad de la liga por debajo del 40% de lo habitual`],
  [/^([\d.]+)% of leagues classified as high or critical retention risk$/, (m) => `${m[1]}% de las ligas con riesgo de retención alto o crítico`],
  [/^([\d.]+)% of leagues below 30th percentile engagement$/, (m) => `${m[1]}% de las ligas por debajo del percentil 30 de participación`],
  [/^([\d.]+)% of leagues classified as inactive_or_stale or dormant$/, (m) => `${m[1]}% de las ligas clasificadas como inactive_or_stale o dormant`],
  [/^([\d.]+)% of leagues are in low-engagement archetypes: (.+)$/, (m) => `${m[1]}% de las ligas están en arquetipos de poca participación: ${m[2]}`],
]

/** Lower-case engine tokens (confidence / risk / tier words) inside a pattern. Unknown ones stay. */
const WORD_ES: Readonly<Record<string, string>> = { low: 'baja', medium: 'media', high: 'alta', critical: 'crítica' }
function word(token: string): string {
  return WORD_ES[token] ?? token
}

/** One recommendation string in Spanish; unknown text comes back unchanged. */
export function translateRecText(text: string): string {
  const exact = REC_ES[text]
  if (exact != null) return exact
  for (const [re, build] of PATTERNS) {
    const m = text.match(re)
    if (m) return build(m)
  }
  return text
}

/** The Recommended Moves a screen renders, in the viewer's language. Only 'es' changes anything. */
export function localizeRecommendations(model: DecisionRecommendationsViewModel, language: string): DecisionRecommendationsViewModel {
  if (language !== 'es') return model
  const tr = translateRecText
  return {
    ...model,
    title: tr(model.title),
    subtitle: tr(model.subtitle),
    evidence: model.evidence.map((e) => ({ ...e, label: tr(e.label), value: tr(e.value) })),
    recommendations: model.recommendations.map((r) => ({
      ...r,
      // `priority` stays English — see the header.
      title: tr(r.title),
      expectedImpact: tr(r.expectedImpact),
      difficulty: tr(r.difficulty),
      evidence: r.evidence.map(tr),
      suggestedAction: tr(r.suggestedAction),
      confidence: tr(r.confidence),
      ...(r.completionStatus != null ? { completionStatus: tr(r.completionStatus) } : {}),
    })),
    ...(model.insufficientData
      ? {
          insufficientData: {
            title: tr(model.insufficientData.title),
            message: tr(model.insufficientData.message),
            missing: model.insufficientData.missing.map(tr),
          },
        }
      : {}),
  }
}

/** Exposed for the coverage test. */
export const RECOMMENDATIONS_ES_TABLE = REC_ES
