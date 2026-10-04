import type { Dash34BriefLineParts, Dash34Data } from '@/components/core-app/screens/Dashboard34'
import type { PlayActionParts } from '@/lib/live/playFeedPresentation'
import type { BriefTradeParts } from './sinceLastVisit'
import type { RecentTradeGradeParts } from './recentTrades'
import type { Next24OddsParts } from './todayStrip'
import { coreUiCopy } from './coreUiCopy'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'

/**
 * The /core home's bands in Spanish (2026-10-04): the words the LOADERS write — dash34's first-kickoff
 * band, Chimmy's brief, the notice and the coverage list; the brief's trade summaries and alert groups;
 * a trade side's grade line; a scoring play; a betting line.
 *
 * Every one of those is built on the SERVER, which does not know the reader's language. Each keeps its
 * English byte-identical and now carries `parts` — the values the sentence was built from — and this
 * rebuilds the sentence in Spanish at render, in the client. A fixed label the loader writes (a coverage
 * item, the brief's eyebrow) is a fixed table here. An injury designation goes through `coreUiCopy`, an
 * age through shellCopy's `ageText`, a kickoff through `kickoffText` — at the call site, never re-written.
 *
 * Anything without parts, or that this does not know, returns null and the caller renders its English as
 * written — a whole English sentence, never half of one. The band's own words (headings, buttons, counts)
 * are inline `es ? … : …` in each band's view, as DashScheduleBandView does. PURE, client-safe.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** "A, B, C y 2 más" — the loaders' "A, B, C and 2 more". */
function namesWithMore(names: string[], more: number): string {
  return `${names.join(', ')}${more > 0 ? ` y ${more} más` : ''}`
}

/* ── dash34: the first-kickoff band ──────────────────────────────────────────────────────────── */

type FirstLock = NonNullable<Dash34Data['firstLock']>

/** The fixed labels dash34 writes (and the band's own fallbacks). */
const DASH34_FIXED_ES: Record<string, string> = {
  'FIRST KICKOFF': 'PRIMER INICIO',
  "CHIMMY'S BRIEF": 'EL RESUMEN DE CHIMMY',
  'CHIMMY’S BRIEF': 'EL RESUMEN DE CHIMMY',
  'Nothing is waiting on you': 'Nada te está esperando',
  'Built from the injury feed and the fixture list. Live scores, projections and standings are not part of it.':
    'Basado en el parte de lesiones y el calendario de partidos. No incluye marcadores en vivo, proyecciones ni clasificaciones.',
  'See every call': 'Ver todas las recomendaciones',
  'No league has been read yet': 'Todavía no se ha leído ninguna liga',
  'Check your connections': 'Revisa tus conexiones',
  'Fix this': 'Corregir esto',
  'Open Player Finder': 'Abrir Buscar jugadores',
}

/** A fixed dash34 label in Spanish, or null when it is not one this knows. */
export function dash34FixedText(english: string): string | null {
  return DASH34_FIXED_ES[english] ?? null
}

export type FirstLockText = { kickoffLabel: string; headline: string; openLabel: string }

/** "NFL · Pretemporada · Semana 3", "Steelers en Bills", "Revisar Mi liga" — or null without parts. */
export function firstLockText(lock: FirstLock): FirstLockText | null {
  const p = lock.parts
  if (!p) return null
  return {
    kickoffLabel: [p.sport, p.slate === 'pre' ? 'Pretemporada' : p.slate === 'post' ? 'Postemporada' : null, p.week != null ? `Semana ${p.week}` : null]
      .filter(Boolean)
      .join(' · '),
    // ESPN Deportes' convention: the away side "en" the home side.
    headline: `${p.away} en ${p.home}`,
    openLabel: p.leagueName != null ? `Revisar ${p.leagueName}` : DASH34_FIXED_ES['Open Player Finder']!,
  }
}

/**
 * The band's coarse countdown ("in 3d 2h", "underway") from the MINUTES the server worked out — the
 * server keeps `Date.now()`, so both sides of hydration agree on it.
 */
export function coarseCountdownText(mins: number, language: string): string {
  const es = language === 'es'
  if (mins <= 0) return es ? 'en curso' : 'underway'
  if (mins < 60) return es ? `en ${mins} min` : `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return es ? `en ${hours} h` : `in ${hours}h`
  const days = Math.floor(hours / 24)
  const rem = hours - days * 24
  if (es) return rem > 0 ? `en ${days} d ${rem} h` : `en ${days} d`
  return rem > 0 ? `in ${days}d ${rem}h` : `in ${days}d`
}

/* ── dash34: Chimmy's brief ──────────────────────────────────────────────────────────────────── */

type Brief = NonNullable<Dash34Data['chimmyBrief']>

/** Abbreviations a Spanish reader sees on the platform too stay, and take "en": "está en IR". */
function statusPhraseEs(status: string): string {
  const es = coreUiCopy(status, 'es')
  if (/^[A-Z]{2,4}$/.test(es)) return `en ${es}`
  if (status === 'Injured Reserve') return 'en la lista de lesionados'
  return es.toLowerCase()
}

export function briefHeadlineText(brief: Brief): string | null {
  const p = brief.headlineParts
  if (!p) return dash34FixedText(brief.headline)
  switch (p.kind) {
    case 'urgent':
      return `${p.count} ${plural(p.count, 'plantilla necesita', 'plantillas necesitan')} atención`
    case 'drafting':
      return `${p.count} ${plural(p.count, 'draft está', 'drafts están')} en marcha`
    case 'flagged':
      return `${p.count} ${plural(p.count, 'liga tiene', 'ligas tienen')} un jugador que vale la pena revisar`
    case 'quiet':
      return DASH34_FIXED_ES['Nothing is waiting on you']!
    default:
      return null
  }
}

/** A brief line in Spanish. The kickoff line ends where the band appends the localised instant. */
export function briefLineText(parts: Dash34BriefLineParts | null | undefined): string | null {
  if (!parts) return null
  switch (parts.kind) {
    case 'concentration': {
      const who = `${parts.name}${parts.position ? ` (${parts.position})` : ''}`
      const where =
        parts.startingIn > 0 ? `: en tu alineación en ${parts.startingIn} de ellas` : ': en la banca en todas'
      return `${who} está ${statusPhraseEs(parts.status)} en ${parts.exposureCount} de tus ${parts.totalActive} ligas${where}.`
    }
    case 'kickoff':
      return `${parts.name} juega su próximo partido el`
    case 'empty-slots':
      return (
        `${parts.totalEmpty} ${plural(parts.totalEmpty, 'puesto titular está vacío', 'puestos titulares están vacíos')} en ` +
        `${parts.leagueCount} ${plural(parts.leagueCount, 'liga', 'ligas')}: ${namesWithMore(parts.names, parts.more)}.`
      )
    case 'flagged':
      return `${parts.count} ${plural(parts.count, 'liga más tiene', 'ligas más tienen')} un jugador señalado que aún puede jugar.`
    default:
      return null
  }
}

export function briefCaveatText(brief: Brief): string | null {
  const p = brief.caveatParts
  if (!p) return dash34FixedText(brief.caveat)
  if (p.everSynced) return DASH34_FIXED_ES['Built from the injury feed and the fixture list. Live scores, projections and standings are not part of it.']!
  return (
    'Basado en el parte de lesiones y el calendario de partidos, no en tus ligas. Nunca se ha sincronizado ' +
    `${p.totalActive === 1 ? 'tu liga' : `ninguna de tus ${p.totalActive} ligas`}, así que no hay marcadores, récords ni alineaciones detrás de esto.`
  )
}

export function noticeBodyText(notice: NonNullable<Dash34Data['notice']>): string | null {
  const p = notice.parts
  if (!p) return null
  return p.totalActive === 1
    ? 'Tu liga está importada, pero nunca se ha sincronizado, así que todavía no hay marcadores, récords ni alineaciones detrás de esta pantalla.'
    : `Tus ${p.totalActive} ligas están importadas, pero ninguna se ha sincronizado nunca, así que todavía no hay marcadores, récords ni alineaciones detrás de esta pantalla.`
}

/* ── dash34: what this screen is not watching ────────────────────────────────────────────────── */

const COVERAGE_ES: Record<string, { label: string; reason: string }> = {
  'Live scores': { label: coreUiCopy('Live scores', 'es'), reason: 'no se importan puntuaciones semanales de las ligas importadas' },
  'AF projections': { label: 'Proyecciones AF', reason: 'requieren las reglas de puntuación de cada liga y una plantilla sincronizada' },
  'Records and standings': { label: 'Récords y clasificaciones', reason: 'todavía no se ha leído ningún resultado de liga' },
  'Which slot is which': { label: 'Qué puesto es cuál', reason: 'no se leen las plantillas de alineación, así que un puesto no tiene nombre' },
  'Pending trade offers and waiver claims': {
    label: 'Ofertas de intercambio y reclamaciones de agentes libres pendientes',
    reason: 'solo se leen las transacciones completadas',
  },
  'League chatter': { label: 'Conversación de la liga', reason: 'no se importan los chats de Discord ni de la plataforma' },
}

/** A coverage item in Spanish — label and reason together, or null so the item stays whole English. */
export function coverageText(item: NonNullable<Dash34Data['coverage']>[number]): { label: string; reason: string } | null {
  if (item.parts?.kind === 'ambiguous-injury') {
    return {
      label: `Estado de lesión de ${namesWithMore(item.parts.names, item.parts.more)}`,
      reason: 'más de un jugador comparte ese nombre y no vamos a adivinar cuál',
    }
  }
  const fixed = COVERAGE_ES[item.label]
  // The reason must be the one this table was written for, or the pair is not this item any more.
  const english: Record<string, string> = {
    'Live scores': 'no weekly scoring is ingested for imported leagues',
    'AF projections': 'requires per-league scoring rules and a synced roster',
    'Records and standings': 'no league result has been read yet',
    'Which slot is which': 'roster templates are not read, so a slot has no name',
    'Pending trade offers and waiver claims': 'only completed transactions are read',
    'League chatter': 'Discord and platform chat are not ingested',
  }
  return fixed && english[item.label] === item.reason ? fixed : null
}

/* ── Since your last visit ───────────────────────────────────────────────────────────────────── */

/** "chxnk recibió Darren Waller, Puka Nacua +1; Hustead no recibió jugadores ni selecciones registrados". */
export function briefTradeSummaryText(parts: BriefTradeParts | null | undefined): string | null {
  if (!parts) return null
  return parts.sides
    .map((s) =>
      s.got.length
        ? `${s.who} recibió ${s.got.join(', ')}${s.more > 0 ? ` +${s.more}` : ''}`
        : `${s.who} no recibió jugadores ni selecciones registrados`,
    )
    .join('; ')
}

/** The brief's alert groups, keyed by notification TYPE (`ALERT_LABELS` in lib/core-app/sinceLastVisit.ts). */
const ALERT_LABEL_ES: Record<string, string> = {
  chimmy_alert: 'alertas de Chimmy',
  player_injury_update: 'novedades de lesiones',
  player_news_update: 'noticias de jugadores',
  live_score_swing: 'alertas de partidos en vivo',
  injury_update: 'novedades de lesiones',
  breaking_news: 'noticias de última hora',
  trade_proposed: 'ofertas de intercambio',
  trade_accepted: 'intercambios aceptados',
  trade_rejected: 'intercambios rechazados',
  trade_countered: 'contraofertas',
  waiver_processed: 'resultados de agentes libres',
  waiver_claim: 'reclamaciones de agentes libres',
  draft_pick: 'selecciones del draft',
  draft_starting: 'drafts que empiezan',
  lineup_lock: 'bloqueos de alineación',
  commissioner_action: 'acciones del comisionado',
}

export function alertGroupText(type: string, english: string, language: string): string {
  return language === 'es' ? (ALERT_LABEL_ES[type] ?? english) : english
}

/** The screen a provider handoff opens (`SourceScreen` in lib/league-links/sourceLinkResolver.ts), for its title. */
const HANDOFF_SCREEN_ES: Record<string, string> = {
  league: 'liga',
  lineup: 'alineación',
  waivers: coreUiCopy('Waivers', 'es').toLowerCase(),
  trade: 'intercambio',
}

/** "Open in Sleeper" → "Abrir en Sleeper" — the label `platformLinks` builds, with its screen for the title. */
export function handoffText(label: string, screen: string, language: string): { label: string; title: string } {
  if (language !== 'es') return { label, title: `${label} · ${screen}` }
  const m = /^Open in (.+)$/.exec(label)
  const es = m ? `${coreUiCopy('Open in', 'es')} ${m[1]}` : label
  return { label: es, title: `${es} · ${HANDOFF_SCREEN_ES[screen] ?? screen}` }
}

/* ── Latest league trades ────────────────────────────────────────────────────────────────────── */

/** A trade's status chip. Keyed on the status CODE: a Spanish status agrees with "el intercambio". */
const TRADE_STATUS_ES: Record<string, string> = {
  pending: 'Propuesto',
  awaiting_votes: 'Esperando votos',
  awaiting_commissioner: coreUiCopy('Commissioner review', 'es'),
  accepted: 'Aceptado',
  scheduled: 'Programado',
  processed: 'Completado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  countered: 'Contraofertado',
  expired: 'Vencido',
  vetoed: 'Vetado',
  reversed: 'Revertido',
}

export function tradeStatusText(status: string, english: string, language: string): string {
  return language === 'es' ? (TRADE_STATUS_ES[status] ?? english) : english
}

/** The fixed grade lines `recentTrades.ts` writes when there is no letter to explain. */
const GRADE_REASON_ES: Record<string, string> = {
  'League-specific grade is still being prepared.': 'La calificación específica de la liga aún se está preparando.',
  'Grade context is being checked.': 'Se está revisando el contexto de la calificación.',
  'No grade is available for this side.': 'No hay calificación disponible para este lado.',
  'Trade received. Grade pending.': 'Intercambio recibido. Calificación pendiente.',
  'Original grade unavailable — this trade predates complete decision evidence.':
    'La calificación original no está disponible: este intercambio es anterior a tener datos completos de la decisión.',
}

/** A trade side's grade line in Spanish, or null so it stays whole English. Numbers keep their figures. */
export function gradeReasonText(reason: string, parts: RecentTradeGradeParts | null | undefined): string | null {
  if (!parts) return GRADE_REASON_ES[reason] ?? null
  if (parts.kind === 'realized') {
    return `Neto de ${parts.net.toFixed(1)} puntos de fantasy con la puntuación de esta liga mientras tuvo los activos.`
  }
  const moved = parts.nowLetter ? ` Con los valores de hoy: ${parts.nowLetter}.` : ''
  const realized =
    parts.realizedNet != null ? ` Real hasta ahora: neto de ${parts.realizedNet.toFixed(1)} puntos de fantasy mientras tuvo los activos.` : ''
  return `Recibió ${parts.got.toLocaleString('en-US')} por ${parts.gave.toLocaleString('en-US')} con los valores de esta liga ${gradeMoment(parts.moment, 'es')}.${moved}${realized}`
}

/* ── Game day ────────────────────────────────────────────────────────────────────────────────── */

/** What a scoring play was, in Spanish — the twin of `playActionFor`, from the same parts. */
export function playActionText(parts: PlayActionParts | null | undefined): string | null {
  if (!parts) return null
  const yd = parts.yards != null ? ` de ${parts.yards} yardas` : ''
  const from = parts.from ? `, pase de ${parts.from}` : ''
  const to = parts.to ? ` a ${parts.to}` : ''
  switch (parts.kind) {
    case 'rushing-td':
      return `TD por tierra${yd}`
    case 'receiving-td':
      return `TD de recepción${yd}${from}`
    case 'passing-td':
      return `pase de TD${yd}${to}`
    case 'touchdown':
      return 'anotó un touchdown'
    case 'run':
      return parts.yards != null ? `carrera${yd}` : 'carrera larga'
    case 'catch':
      return `${parts.yards != null ? `recepción${yd}` : 'recepción larga'}${from}`
    case 'completion':
      return `${parts.yards != null ? `pase completo${yd}` : 'pase completo largo'}${to}`
    case 'gain':
      return parts.yards != null ? `ganancia${yd}` : 'gran ganancia'
    case 'field-goal':
      return 'convirtió un gol de campo'
    case 'intercepted':
      return 'interceptó un pase'
    case 'recovered':
      return 'recuperó un balón suelto'
    case 'threw-int':
      return 'lanzó una intercepción'
    case 'lost-fumble':
      return 'perdió un balón suelto'
    case 'turnover':
      return 'perdió el balón'
    case 'pick-six':
      return 'intercepción devuelta para TD'
    case 'fumble-return-td':
      return 'TD por devolución de balón suelto'
    case 'safety':
      return 'safety'
    case 'defensive-td':
      return 'TD defensivo'
    case 'kickoff-return-td':
      return 'TD por devolución de patada inicial'
    case 'punt-return-td':
      return 'TD por devolución de despeje'
    case 'special-teams-td':
      return 'TD de equipos especiales'
    default:
      return null
  }
}

/** A betting line in Spanish, in PlayerNextGames' words ("favorito por", "parejo", "total del partido"). */
export function oddsText(parts: Next24OddsParts | null | undefined): string | null {
  if (!parts) return null
  const bits = [
    parts.pickem ? 'parejo' : parts.favorite != null && parts.spread != null ? `${parts.favorite} favorito por ${parts.spread}` : null,
    parts.total != null ? `total del partido ${parts.total}` : null,
    parts.staleClock ? `línea de las ${parts.staleClock}` : null,
  ].filter(Boolean)
  return bits.join(' · ') || 'Cuotas no disponibles'
}
