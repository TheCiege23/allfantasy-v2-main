/**
 * THE DYNASTY OFFSEASON CALENDAR (phase 13, 2026-10-29): one timeline of what happens between the
 * champion and the next kickoff, and which steps AllFantasy takes by itself.
 *
 * Every date comes from the rule that acts on it, never a second copy: the rookie draft's opening from
 * `resolveRookieDraftWindow` and `resolveRookieDraftAutoOpen` (what openRookieDraftsOnCalendar.ts
 * reads), its start from `rookieDraftAutoStartAt` or the draft's own scheduled date, and the taxi
 * deadlines from the league's taxi rules. A step with no date says who takes it instead of guessing one.
 *
 * Pure.
 */
import { rookieDraftAutoStartAt, type RookieDraftAutoOpenDecision, type RookieDraftAutoStartDays, type RookieDraftWindow } from './rookieDraftCalendar'

export type OffseasonStepKey = 'season_over' | 'rookie_order' | 'draft_opens' | 'draft_starts' | 'kickoff' | 'taxi'

export type OffseasonStep = {
  key: OffseasonStepKey
  /** ISO time, or null when the step has no fixed date. */
  at: string | null
  /** True when the date is AllFantasy's plan rather than something already set or done. */
  estimated: boolean
  done: boolean
  /** AllFantasy takes this step by itself. */
  byAllFantasy: boolean
  en: string
  es: string
}

export type OffseasonCalendarInput = {
  /** The season being set up (the one the rookie draft seeds), and when its offseason began. */
  season: number
  offseasonStartedAt: Date
  window: RookieDraftWindow | null
  autoOpen: RookieDraftAutoOpenDecision
  autoStartDays: RookieDraftAutoStartDays | null
  draft: 'none' | 'open' | 'complete'
  /** Set when AllFantasy opened the draft: when, and the start it scheduled. */
  autoOpened: { openedAt: Date; startsAt: Date | null } | null
  /** The draft's own scheduled start, when one is set. */
  draftDate: Date | null
  liveOrderOn: boolean
  taxi: { promotionDeadlineWeek: number | null; lockAfterWeek: number | null } | null
  now: Date
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export function offseasonCalendar(i: OffseasonCalendarInput): OffseasonStep[] {
  const steps: OffseasonStep[] = []
  steps.push({
    key: 'season_over',
    at: iso(i.offseasonStartedAt),
    estimated: false,
    done: true,
    byAllFantasy: false,
    en: `The season ended and the ${i.season} offseason began.`,
    es: `La temporada terminó; ahora se prepara la de ${i.season}.`,
  })
  steps.push(
    i.liveOrderOn
      ? { key: 'rookie_order', at: null, estimated: false, done: i.draft !== 'none', byAllFantasy: true, en: 'AllFantasy keeps the rookie draft order up to date until the draft.', es: 'AllFantasy mantiene al día el orden del draft de novatos hasta el draft.' }
      : { key: 'rookie_order', at: null, estimated: false, done: i.draft !== 'none', byAllFantasy: false, en: 'The rookie draft order is set when the draft is created, worst record first unless the league uses a lottery.', es: 'El orden del draft de novatos se fija al crear el draft: peor récord primero, salvo que la liga use lotería.' },
  )

  // Opening.
  if (i.draft !== 'none') {
    const at = i.autoOpened?.openedAt ?? null
    steps.push({ key: 'draft_opens', at: iso(at), estimated: false, done: true, byAllFantasy: Boolean(i.autoOpened), en: i.autoOpened ? 'AllFantasy opened the rookie draft.' : 'The rookie draft was created.', es: i.autoOpened ? 'AllFantasy abrió el draft de novatos.' : 'Se creó el draft de novatos.' })
  } else if (i.autoOpen.autoOpen && i.window) {
    steps.push({ key: 'draft_opens', at: iso(i.window.opensAt), estimated: true, done: false, byAllFantasy: true, en: 'AllFantasy opens the rookie draft.', es: 'AllFantasy abre el draft de novatos.' })
  } else {
    steps.push({
      key: 'draft_opens',
      at: iso(i.window?.opensAt ?? null),
      estimated: Boolean(i.window),
      done: false,
      byAllFantasy: false,
      en: i.window ? 'The rookie draft window opens; the commissioner creates the draft (it does not open by itself).' : 'The commissioner creates the rookie draft.',
      es: i.window ? 'Se abre la ventana del draft de novatos; el comisionado crea el draft (no se abre solo).' : 'El comisionado crea el draft de novatos.',
    })
  }

  // Start.
  if (i.draft === 'complete') {
    steps.push({ key: 'draft_starts', at: null, estimated: false, done: true, byAllFantasy: false, en: 'The rookie draft is done.', es: 'El draft de novatos terminó.' })
  } else {
    const scheduled = i.autoOpened?.startsAt ?? i.draftDate
    const planned = !scheduled && i.draft === 'none' && i.autoOpen.autoOpen && i.window && i.autoStartDays ? rookieDraftAutoStartAt(i.window.opensAt, i.autoStartDays) : null
    if (scheduled || planned) {
      steps.push({ key: 'draft_starts', at: iso(scheduled ?? planned), estimated: !scheduled, done: false, byAllFantasy: true, en: 'The rookie draft starts by itself.', es: 'El draft de novatos empieza solo.' })
    } else {
      steps.push({ key: 'draft_starts', at: null, estimated: false, done: false, byAllFantasy: false, en: 'The commissioner starts the rookie draft.', es: 'El comisionado inicia el draft de novatos.' })
    }
  }

  steps.push({
    key: 'kickoff',
    at: null,
    estimated: false,
    done: false,
    byAllFantasy: true,
    en: `Week 1 of ${i.season}: the season starts. A rookie draft still open holds it until the draft is done.`,
    es: `Semana 1 de ${i.season}: empieza la temporada. Un draft de novatos aún abierto la retiene hasta que termine.`,
  })

  if (i.taxi && (i.taxi.promotionDeadlineWeek != null || i.taxi.lockAfterWeek != null)) {
    const en: string[] = []
    const es: string[] = []
    if (i.taxi.lockAfterWeek != null) {
      en.push(`nobody joins the taxi squad after week ${i.taxi.lockAfterWeek}`)
      es.push(`nadie entra al taxi squad después de la semana ${i.taxi.lockAfterWeek}`)
    }
    if (i.taxi.promotionDeadlineWeek != null) {
      en.push(`taxi promotions close after week ${i.taxi.promotionDeadlineWeek}`)
      es.push(`los ascensos del taxi squad cierran después de la semana ${i.taxi.promotionDeadlineWeek}`)
    }
    steps.push({
      key: 'taxi',
      at: null,
      estimated: false,
      done: false,
      byAllFantasy: true,
      en: `In ${i.season}, ${en.join(' and ')}. AllFantasy warns every owner in that week.`,
      es: `En ${i.season}, ${es.join(' y ')}. AllFantasy avisa a cada dueño esa semana.`,
    })
  }
  return steps
}
