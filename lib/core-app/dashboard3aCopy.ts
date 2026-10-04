import { coreUiCopy } from './coreUiCopy'
import { FOREIGN_IDS_UNREADABLE, FOREIGN_IDS_UNREADABLE_CLAUSE } from './foreignIdSpaceCopy'
import { weekdayEs } from './kickoffText'
import { leagueConceptText, scopeLabelText } from './shellCopy'
import type { ExposureData, RivalRow } from './dash3aPanels'
import type { FollowingRow } from './followingCard'
import type { RoutineStep, RoutineStepKey, RoutineSummaryParts } from './weeklyRoutine'

/**
 * The /core home's cards — components/core-app/screens/Dashboard3A.tsx and the card components it
 * renders (YourWeekRoutine, FollowingCard, ReceiptsCard, ExposureImpact) — in Spanish (2026-10-04).
 *
 * Two kinds of words live here:
 *   - SERVER-BUILT SENTENCES (the routine's step summaries, the exposure note, a rival's last meeting,
 *     a followed player's next game). Their English is built on the server, which does not know the
 *     reader's language, and stays byte-identical; each also carries `…Parts`, and the Spanish is
 *     rebuilt from those here, at render. A payload without parts renders its English whole — never
 *     half a sentence. Same contract as decisionQueueCopy.ts, playerMovesCopy.ts, cardFreshnessCopy.ts.
 *   - FIXED LOADER STRINGS (a panel's `reason`, a placeholder name). Matched WHOLE against the English
 *     the loader writes; anything not listed passes through as written.
 *
 * Everything else the cards say is written inline (`es ? … : …`) beside its English.
 *
 * ⚠ REUSED, NOT DUPLICATED: weekdays go through `weekdayEs`, scope labels through `scopeLabelText`,
 * league types through `leagueConceptText`, injury designations and shared labels through
 * `coreUiCopy`. XP level names ("Practice Squad", "All-Pro") are the product's rank NAMES and are
 * left as written, as every other /core surface that shows them does.
 *
 * PURE and client-safe: the type imports are erased, so no server module reaches the client.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/* ── Your week (the weekly routine) ─────────────────────────────────────────────────────────────── */

const STEP_TITLE_ES: Record<RoutineStepKey, string> = {
  results: 'Repaso de resultados',
  waivers: coreUiCopy('Waivers', 'es'),
  lineups: 'Revisión de alineación',
  gameday: 'Día de partido',
  recap: 'Resumen',
}

/** A routine step's name — the English is the loader's own `title`. */
export function routineStepTitle(step: Pick<RoutineStep, 'key' | 'title'>, language: string): string {
  return language === 'es' ? (STEP_TITLE_ES[step.key] ?? step.title) : step.title
}

const WEEKDAY_FULL_ES: Record<string, string> = {
  Sunday: 'Domingo',
  Monday: 'Lunes',
  Tuesday: 'Martes',
  Wednesday: 'Miércoles',
  Thursday: 'Jueves',
  Friday: 'Viernes',
  Saturday: 'Sábado',
  Today: 'Hoy',
}

/** `routineDayFor`'s label: "Wednesday" → "Miércoles". */
export function routineTodayLabel(label: string, language: string): string {
  return language === 'es' ? (WEEKDAY_FULL_ES[label] ?? label) : label
}

/** A step's summary: the English as written, or the Spanish rebuilt from its parts. */
export function routineSummaryText(step: Pick<RoutineStep, 'summary' | 'summaryParts'>, language: string): string | null {
  const p: RoutineSummaryParts | undefined = step.summaryParts
  if (language !== 'es' || !p || step.summary == null) return step.summary
  switch (p.kind) {
    case 'results':
      return `${p.season} semana ${p.week}: ${p.wins}-${p.losses} en ${plural(p.wins + p.losses, 'liga', 'ligas')}`
    case 'no-results':
      return 'Aún no hay resultados tuyos con puntuación.'
    case 'adds':
      return `Hiciste ${plural(p.count, 'incorporación', 'incorporaciones')} esta semana.`
    case 'no-adds':
      return 'No tienes incorporaciones registradas esta semana.'
    case 'in-doubt':
      return p.count === 1 ? '1 titular podría no jugar.' : `${p.count} titulares podrían no jugar.`
    case 'none-in-doubt':
      return 'Ninguno de tus titulares está en duda.'
    case 'games':
      return `${plural(p.games, 'enfrentamiento', 'enfrentamientos')} esta semana${
        p.coinFlips > 0 ? ` · ${plural(p.coinFlips, 'partido ajustado', 'partidos ajustados')}` : ''
      }.`
    case 'recap':
      return [
        `${p.wins}-${p.losses} en la semana ${p.week}`,
        p.topScorer ? `máximo anotador ${p.topScorer.name} ${p.topScorer.points.toFixed(1)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    default:
      return step.summary
  }
}

/** `AWARD_LABEL` (lib/share/weeklyAwardCard.ts) by kind. */
const AWARD_ES: Record<string, string> = {
  topScore: 'Puntuación más alta',
  lowScore: 'Puntuación más baja',
  narrowEscape: 'Victoria por la mínima',
  biggestBlowout: 'Mayor paliza',
}

export function awardLabelText(award: { kind: string; label: string }, language: string): string {
  return language === 'es' ? (AWARD_ES[award.kind] ?? award.label) : award.label
}

/* ── Following ─────────────────────────────────────────────────────────────────────────────────── */

/** "vs KC · Sun" → "vs KC · dom". The English as written when the row has no parts. */
export function followingNextText(row: Pick<FollowingRow, 'next' | 'nextParts'>, language: string): string | null {
  const p = row.nextParts
  if (language !== 'es' || !p || row.next == null) return row.next
  return `${p.home ? 'vs' : '@'} ${p.opponent} · ${weekdayEs(p.weekday)}${p.preseason ? ' (pretemp.)' : ''}`
}

/** "QUESTIONABLE" → "DUDOSO", through coreUiCopy's designations; IR/PUP and the unknown stay. */
export function followingStatusText(status: string, language: string): string {
  if (language !== 'es') return status
  const title = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
  const es = coreUiCopy(title, 'es')
  return es === title ? status : es.toUpperCase()
}

/* ── Portfolio & exposure ──────────────────────────────────────────────────────────────────────── */

/** The concentration callout: the English as written, or the Spanish rebuilt from its parts. */
export function exposureNoteText(data: Pick<ExposureData, 'note' | 'noteParts'>, language: string): string | null {
  const p = data.noteParts
  if (language !== 'es' || !p || data.note == null) return data.note
  const name = placeholderNameText(p.name, 'es')
  return p.kind === 'every'
    ? `${name} está en todas tus plantillas: una lesión y se te mueve todo el domingo.`
    : `${name} está en ${p.count} de tus ${p.of} plantillas.`
}

const PLACEHOLDER_ES: Record<string, string> = {
  // dash3aPanels.ts: an exposure row whose id no player resolves to, and a rival with no name on file.
  'Unmatched player': 'Jugador sin identificar',
  'Unknown manager': 'Mánager desconocido',
}

/** A loader's placeholder for a missing name. A real name passes through. */
export function placeholderNameText(name: string, language: string): string {
  return language === 'es' ? (PLACEHOLDER_ES[name] ?? name) : name
}

/** The "if he sits" breakdown's slot (playerLeagueImpact.ts `ImpactSlot`). */
const IMPACT_SLOT_ES: Record<string, string> = { starter: 'titular', bench: 'banca', ir: 'IR', taxi: 'taxi' }

export function impactSlotText(slot: string, english: string, language: string): string {
  return language === 'es' ? (IMPACT_SLOT_ES[slot] ?? english) : english
}

/**
 * Why a league in the breakdown has no number — playerLeagueImpact.ts's `no_matchup` reasons and
 * winProbability.ts's `unpriced` ones, matched whole. An unlisted reason stays whole English.
 */
const IMPACT_REASON_ES: Record<string, string> = {
  'this league has no platform id, so its weekly results cannot be located':
    'esta liga no tiene id de plataforma, así que no podemos ubicar sus resultados semanales',
  'no weekly results stored for this league': 'no hay resultados semanales guardados para esta liga',
  'we could not match both sides of this matchup to an imported roster':
    'no pudimos emparejar los dos lados de este enfrentamiento con una plantilla importada',
  'this league’s matchup could not be read just now': 'el enfrentamiento de esta liga no se pudo leer ahora',
  'no starters on file for one side of this matchup': 'no hay titulares registrados en un lado de este enfrentamiento',
}

export function impactReasonText(reason: string, language: string): string {
  if (language !== 'es') return reason
  const exact = IMPACT_REASON_ES[reason]
  if (exact) return exact
  let m = reason.match(/^your team has no result stored for week (\d+)$/)
  if (m) return `tu equipo no tiene resultado guardado en la semana ${m[1]}`
  m = reason.match(/^no opponent is paired with your team in week (\d+)$/)
  if (m) return `no hay un rival emparejado con tu equipo en la semana ${m[1]}`
  m = reason.match(/^(\d+) starters? still to play have no projection — treating them as zero would tilt the result toward the other side$/)
  if (m) {
    const n = Number(m[1])
    return `${n === 1 ? '1 titular que aún debe jugar no tiene' : `${n} titulares que aún deben jugar no tienen`} proyección; contarlos como cero inclinaría el resultado hacia el otro lado`
  }
  // "we cannot tell which team in this league is yours" — already in coreUiCopy (Standings says it too).
  return coreUiCopy(reason, 'es')
}

/* ── Rivalry radar ─────────────────────────────────────────────────────────────────────────────── */

/** "you won by 3.2" / "beat you by 3.2" / "a tie", rebuilt from its parts. */
export function rivalLastText(row: Pick<RivalRow, 'lastResult' | 'lastParts'>, language: string): string | null {
  const p = row.lastParts
  if (language !== 'es' || !p || row.lastResult == null) return row.lastResult
  if (p.kind === 'tie') return coreUiCopy('a tie', 'es')
  return p.kind === 'won' ? `${coreUiCopy('you won by', 'es')} ${p.margin.toFixed(1)}` : `te ganó por ${p.margin.toFixed(1)}`
}

/* ── A panel's reason (exposure and rivals) ────────────────────────────────────────────────────── */

const PANEL_REASON_ES: Record<string, string> = {
  'no leagues imported yet': 'aún no has importado ligas',
  'none of your leagues have a team claimed by you, so there is no roster to read':
    'ninguna de tus ligas tiene un equipo asignado a ti, así que no hay plantilla que leer',
  'your teams are claimed but no roster rows were imported for them yet':
    'tus equipos están asignados, pero aún no se importó ninguna plantilla para ellos',
  [FOREIGN_IDS_UNREADABLE]: coreUiCopy("this league's player ids can't be matched to ours yet", 'es'),
  'your rosters imported with no resolvable player ids': 'tus plantillas se importaron sin ids de jugadores reconocibles',
  'none of your leagues carry a platform id, so their weekly results cannot be located':
    'ninguna de tus ligas tiene id de plataforma, así que no podemos ubicar sus resultados semanales',
  'no weekly results are stored for any league where you have claimed a team':
    'no hay resultados semanales guardados en ninguna liga donde tengas un equipo asignado',
  'weeks are on file but none have been scored yet, so there is no head-to-head record':
    'hay semanas registradas, pero ninguna tiene puntuación todavía, así que no hay historial de enfrentamientos',
}

/** A `PanelState.reason` from lib/core-app/dash3aPanels.ts. The card turns either language into a sentence. */
export function panelReasonText(reason: string, language: string): string {
  if (language !== 'es') return reason
  const exact = PANEL_REASON_ES[reason]
  if (exact) return exact
  const m = reason.match(/^for each of your (\d+) leagues, (.+)$/)
  if (m && m[2] === FOREIGN_IDS_UNREADABLE_CLAUSE) {
    return `en cada una de tus ${m[1]} ligas, todavía no podemos emparejar los ids de sus jugadores con los nuestros`
  }
  return reason
}

/* ── Portfolio chart and leagues ───────────────────────────────────────────────────────────────── */

/**
 * The chart's subtitle. The default is this card's own; a filtered home passes `${scope.label} in Core`
 * (components/core-app/home/HomeCards.tsx), whose label is a `scopeLabelText` scope word.
 */
export function portfolioSubtitleText(subtitle: string, language: string): string {
  if (language !== 'es') return subtitle
  if (subtitle === 'Every connected league in Core') return 'Todas las ligas conectadas en Core'
  const m = subtitle.match(/^(.+) in Core$/)
  return m ? `${scopeLabelText(m[1]!, 'es')} en Core` : subtitle
}

/**
 * dash34.ts `formatLabelOf`: "2026 · 12-team · Dynasty · PPR Superflex". Only the team count is a word;
 * the league type goes through `leagueConceptText`, and the season and scoring stay as written.
 */
export function formatLabelText(label: string, language: string): string {
  if (language !== 'es') return label
  return label
    .split(' · ')
    .map((part) => {
      const m = part.match(/^(\d+)-team$/)
      if (m) return `${m[1]} equipos`
      return leagueConceptText(part, 'es')
    })
    .join(' · ')
}

/* ── Receipts ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Chimmy's record line (lib/chimmy-outcomes/trackRecord.ts `describeTrackRecord`, which also feeds the
 * chat model its English and is left alone). Same numbers, same order.
 */
export function trackRecordText(
  l: { right: number; wrong: number; same: number; ratePct: number | null },
  english: string,
  language: string,
): string {
  if (language !== 'es') return english
  const base = `${plural(l.right, 'acierto', 'aciertos')}, ${plural(l.wrong, 'fallo', 'fallos')}${l.ratePct != null ? ` (${l.ratePct}%)` : ''}`
  return l.same > 0 ? `${base} · ${plural(l.same, 'caso demasiado parejo para juzgar', 'casos demasiado parejos para juzgar')}` : base
}
