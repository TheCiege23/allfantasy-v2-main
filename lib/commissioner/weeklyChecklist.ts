/**
 * The weekly commissioner checklist for redraft leagues: this week's jobs in the order a week runs —
 * last week's scores, waivers, this week's lineups, trades waiting on the commissioner, dues, and
 * what is coming up. Each item is either done, needs the commissioner, or is a heads-up, and each
 * one links to where it is fixed.
 *
 * It CONFIRMS as well as warns. The action queue lists only problems; a commissioner who sees
 * "Week 6 scores are final ✓" knows the job was checked, not merely that nothing was found.
 *
 * Quiet managers are deliberately not here: the hub's Member activity section already counts them,
 * and a second, slightly different count would disagree with it.
 *
 * Pure, and bilingual (en/es) like the rest of the commissioner hub's own components.
 */

import { cannotStart, isNonStarterSlot } from '@/lib/redraft/lineupValidation'

export type ChecklistStatus = 'done' | 'todo' | 'heads_up'
export type Bilingual = { en: string; es: string }

export type ChecklistItem = {
  id: 'scores' | 'waivers' | 'lineups' | 'trades' | 'dues' | 'trade_deadline' | 'playoffs' | 'final_week'
  status: ChecklistStatus
  title: Bilingual
  detail: Bilingual
  href: string
}

export type WeeklyChecklistInput = {
  leagueId: string
  week: number
  totalWeeks: number
  playoffStartWeek: number
  /** Last week's head-to-head matchups (regular or playoff); empty when there was no last week. */
  lastWeekMatchups: Array<{ status: string }>
  /** Waiver claims still pending, with when they were submitted. */
  pendingClaims: Array<{ submittedAt: Date }>
  /** Claims processed in the last 7 days. */
  processedClaimsLast7Days: number
  /** Each team's starting lineup for this week. */
  lineups: Array<{ teamName: string; required: number; filled: number; unavailable: string[] }>
  /** Accepted trades waiting on commissioner review. */
  tradesAwaitingReview: number
  tradeDeadlineWeek: number | null
  /** Null when the league does not track dues. */
  dues: { unpaid: string[]; total: number } | null
}

/** A pending claim older than this means the waiver run that should have processed it did not. */
export const STALE_CLAIM_MS = 36 * 60 * 60 * 1000

const list = (names: string[], max = 3) => (names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', '))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function buildWeeklyChecklist(input: WeeklyChecklistInput, now: Date): ChecklistItem[] {
  const id = encodeURIComponent(input.leagueId)
  const items: ChecklistItem[] = []
  const w = input.week
  const last = w - 1

  // 1 · Last week's scores
  if (last >= 1 && input.lastWeekMatchups.length) {
    const open = input.lastWeekMatchups.filter((m) => m.status !== 'final').length
    items.push(
      open
        ? {
            id: 'scores', status: 'todo', href: `/core/matchup?league=${id}`,
            title: { en: `Week ${last} scores aren't final`, es: `La puntuación de la semana ${last} no es definitiva` },
            detail: {
              en: `${plural(open, 'matchup is still open', 'matchups are still open')}. Standings move once they finalize; check for a stat correction or a game that hasn't been scored.`,
              es: `${plural(open, 'enfrentamiento sigue abierto', 'enfrentamientos siguen abiertos')}. La clasificación cambia cuando terminan; revisa si hay una corrección de estadísticas o un partido sin puntuar.`,
            },
          }
        : {
            id: 'scores', status: 'done', href: `/core/standings?league=${id}`,
            title: { en: `Week ${last} scores are final`, es: `La puntuación de la semana ${last} es definitiva` },
            detail: { en: 'Every matchup is scored and the standings are up to date.', es: 'Todos los enfrentamientos están puntuados y la clasificación está al día.' },
          },
    )
  }

  // 2 · Waivers
  const stale = input.pendingClaims.filter((c) => now.getTime() - c.submittedAt.getTime() > STALE_CLAIM_MS).length
  if (stale) {
    items.push({
      id: 'waivers', status: 'todo', href: `/core/waivers?league=${id}`,
      title: { en: 'Waiver claims are stuck', es: 'Hay reclamos atascados' },
      detail: {
        en: `${plural(stale, 'claim has', 'claims have')} waited more than 36 hours. The scheduled run may not have happened — run waivers or check the schedule.`,
        es: `${plural(stale, 'reclamo lleva', 'reclamos llevan')} más de 36 horas esperando. Puede que el procesamiento programado no se haya hecho: procésalos o revisa el calendario.`,
      },
    })
  } else {
    items.push({
      id: 'waivers', status: 'done', href: `/core/waivers?league=${id}`,
      title: { en: 'Waivers are running', es: 'Los reclamos se procesan con normalidad' },
      detail: input.processedClaimsLast7Days
        ? { en: `${plural(input.processedClaimsLast7Days, 'claim', 'claims')} processed this week, none stuck.`, es: `${plural(input.processedClaimsLast7Days, 'reclamo procesado', 'reclamos procesados')} esta semana, ninguno atascado.` }
        : { en: 'No claims are waiting.', es: 'No hay reclamos pendientes.' },
    })
  }

  // 3 · This week's lineups
  const short = input.lineups.filter((l) => l.required > 0 && l.filled < l.required)
  const hurt = input.lineups.filter((l) => l.unavailable.length > 0)
  const flagged = [...new Set([...short, ...hurt].map((l) => l.teamName))]
  items.push(
    flagged.length
      ? {
          id: 'lineups', status: 'todo', href: `/core/standings?league=${id}`,
          title: { en: `${plural(flagged.length, 'team needs', 'teams need')} a lineup fix for week ${w}`, es: `${plural(flagged.length, 'equipo necesita', 'equipos necesitan')} arreglar su alineación de la semana ${w}` },
          detail: {
            en: [
              short.length ? `Empty starting slots: ${list(short.map((l) => l.teamName))}.` : '',
              hurt.length ? `Starting someone who can't play: ${list(hurt.map((l) => l.teamName))}.` : '',
              'Nudge the manager, or set the lineup yourself before it locks.',
            ].filter(Boolean).join(' '),
            es: [
              short.length ? `Puestos titulares vacíos: ${list(short.map((l) => l.teamName))}.` : '',
              hurt.length ? `Titulares que no pueden jugar: ${list(hurt.map((l) => l.teamName))}.` : '',
              'Avisa al mánager o pon tú la alineación antes de que se bloquee.',
            ].filter(Boolean).join(' '),
          },
        }
      : {
          id: 'lineups', status: 'done', href: `/core/standings?league=${id}`,
          title: { en: `Every week ${w} lineup is set`, es: `Todas las alineaciones de la semana ${w} están listas` },
          detail: { en: 'No empty starting slots and nobody is starting a player who is out.', es: 'No hay puestos titulares vacíos ni titulares que estén fuera.' },
        },
  )

  // 4 · Trades waiting on the commissioner
  items.push(
    input.tradesAwaitingReview
      ? {
          id: 'trades', status: 'todo', href: `/core/trades?league=${id}`,
          title: { en: `${plural(input.tradesAwaitingReview, 'trade is', 'trades are')} waiting on your review`, es: `${plural(input.tradesAwaitingReview, 'intercambio espera', 'intercambios esperan')} tu revisión` },
          detail: { en: 'Both managers accepted. Approve or veto so the rosters can move.', es: 'Los dos mánagers aceptaron. Aprueba o veta para que se muevan las plantillas.' },
        }
      : {
          id: 'trades', status: 'done', href: `/core/trades?league=${id}`,
          title: { en: 'No trades waiting on you', es: 'Ningún intercambio espera por ti' },
          detail: { en: 'Nothing is held for commissioner review.', es: 'No hay nada pendiente de revisión del comisionado.' },
        },
  )

  // 5 · Dues (only when the league tracks them)
  if (input.dues && input.dues.total > 0) {
    const { unpaid, total } = input.dues
    items.push(
      unpaid.length
        ? {
            id: 'dues', status: 'todo', href: `/league/${id}?view=settings`,
            title: { en: `${unpaid.length} of ${total} teams haven't paid dues`, es: `${unpaid.length} de ${total} equipos no han pagado la cuota` },
            detail: { en: `Still owed: ${list(unpaid)}.`, es: `Pendiente: ${list(unpaid)}.` },
          }
        : {
            id: 'dues', status: 'done', href: `/league/${id}?view=settings`,
            title: { en: 'Dues are all paid', es: 'Todas las cuotas están pagadas' },
            detail: { en: `All ${total} teams have paid.`, es: `Los ${total} equipos han pagado.` },
          },
    )
  }

  // 6 · Coming up
  if (input.tradeDeadlineWeek != null && (input.tradeDeadlineWeek === w || input.tradeDeadlineWeek === w + 1)) {
    const thisWeek = input.tradeDeadlineWeek === w
    items.push({
      id: 'trade_deadline', status: 'heads_up', href: `/core/trades?league=${id}`,
      title: thisWeek ? { en: 'The trade deadline is this week', es: 'El plazo de intercambios es esta semana' } : { en: 'The trade deadline is next week', es: 'El plazo de intercambios es la semana que viene' },
      detail: { en: `Trades close after week ${input.tradeDeadlineWeek}. A reminder in league chat helps.`, es: `Los intercambios cierran tras la semana ${input.tradeDeadlineWeek}. Un recordatorio en el chat de la liga ayuda.` },
    })
  }
  if (input.playoffStartWeek === w || input.playoffStartWeek === w + 1) {
    const thisWeek = input.playoffStartWeek === w
    items.push({
      id: 'playoffs', status: 'heads_up', href: `/core/standings?league=${id}`,
      title: thisWeek ? { en: 'The playoffs start this week', es: 'Los playoffs empiezan esta semana' } : { en: 'The playoffs start next week', es: 'Los playoffs empiezan la semana que viene' },
      detail: { en: 'Check the seeds and the bracket before the first playoff matchups lock.', es: 'Revisa las posiciones y el cuadro antes de que se bloqueen los primeros enfrentamientos.' },
    })
  } else if (w === input.playoffStartWeek - 2 && input.playoffStartWeek > 2) {
    items.push({
      id: 'final_week', status: 'heads_up', href: `/core/standings?league=${id}`,
      title: { en: 'Two regular-season weeks left', es: 'Quedan dos semanas de temporada regular' },
      detail: { en: 'A good time to remind managers how playoff seeding and tiebreakers work.', es: 'Buen momento para recordar cómo se ordenan los playoffs y los desempates.' },
    })
  }

  return items
}

/**
 * Whether a starter can't play this week: on a bye, or an injury designation the lineup validator
 * itself refuses to start (`cannotStart`, lib/redraft/lineupValidation) — so this flags exactly the
 * lineups a save would be told are wrong.
 */
export function isUnavailable(p: { injuryStatus: string | null; byeWeek: number | null }, week: number): boolean {
  if (p.byeWeek != null && p.byeWeek === week) return true
  return cannotStart(p)
}

/** A rostered player counts as a starter unless his slot is bench, IR, taxi or another reserve slot. */
export function isStarterSlot(slotType: string): boolean {
  return slotType.trim().toLowerCase() !== 'free_agent' && !isNonStarterSlot(slotType)
}

export function checklistSummary(items: readonly ChecklistItem[]): { todo: number; done: number } {
  return { todo: items.filter((i) => i.status === 'todo').length, done: items.filter((i) => i.status === 'done').length }
}
