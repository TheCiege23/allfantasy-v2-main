/**
 * The weekly commissioner checklist for an AllFantasy-run zombie league (./weeklyChecklistService.ts).
 *
 * A zombie week does not run on the redraft season tables the redraft checklist reads, so it gets its own items:
 * the four states in which the zombie engine stops and waits for a person. Each one is something nothing else would
 * fix, and each links to where it is fixed. When none holds, one "done" line confirms the week is settling — a
 * checklist that only ever warns cannot tell "checked, all fine" from "never looked".
 *
 * Pure, and bilingual (en/es) like the rest of the checklist.
 */
import type { ChecklistItem } from './weeklyChecklist'

export type ZombieChecklistInput = {
  leagueId: string
  week: number
  /** `ZombieLeague.status === 'paused'`: nothing settles until it is resumed. */
  paused: boolean
  /** A week held for review (lib/zombie/settlementHoldRelease.ts), with the reason in English words. */
  hold: { week: number; reasonText: string } | null
  /** `ZombieLeague.correctionHoldFromWeek`: a reviewed stat correction holds every week from here. */
  correctionFromWeek: number | null
  /** The Whisperer offer list ran out (`initial_offer` workflow in `review_required`); only the owner may nominate. */
  whispererReviewNeeded: boolean
}

export function buildZombieWeeklyChecklist(input: ZombieChecklistInput): ChecklistItem[] {
  const id = encodeURIComponent(input.leagueId)
  const tools = `/zombie/${id}/settings`
  const items: ChecklistItem[] = []

  if (input.paused) {
    items.push({
      id: 'zombie_paused', status: 'todo', href: tools,
      title: { en: 'The league is paused', es: 'La liga está en pausa' },
      detail: {
        en: 'No infections, items or winnings settle until you resume it (commissioner tools → Overrides).',
        es: 'No se liquidan infecciones, objetos ni ganancias hasta que la reanudes (herramientas del comisionado → Overrides).',
      },
    })
  }
  if (input.hold) {
    items.push({
      id: 'zombie_hold', status: 'todo', href: tools,
      title: { en: `Week ${input.hold.week} settlement is on hold`, es: `La liquidación de la semana ${input.hold.week} está en espera` },
      detail: {
        en: `${input.hold.reasonText} Open Automation to retry it.`,
        es: 'La semana quedó retenida para revisión. Abre Automatización para ver el motivo y reintentar.',
      },
    })
  }
  if (input.correctionFromWeek != null) {
    items.push({
      id: 'zombie_correction', status: 'todo', href: tools,
      title: { en: `A stat correction is waiting for review (from week ${input.correctionFromWeek})`, es: `Una corrección de estadísticas espera revisión (desde la semana ${input.correctionFromWeek})` },
      detail: {
        en: 'A settled week changed. Weeks from here wait until the correction is reviewed in Automation.',
        es: 'Cambió una semana ya liquidada. Las semanas desde aquí esperan a que revises la corrección en Automatización.',
      },
    })
  }
  if (input.whispererReviewNeeded) {
    items.push({
      id: 'zombie_whisperer', status: 'todo', href: `/zombie/${id}`,
      title: { en: 'Nominate the Whisperer', es: 'Nombra al Whisperer' },
      detail: {
        en: 'Every eligible manager declined or timed out. The league owner nominates someone, with a reason, on the league home.',
        es: 'Todos los mánagers elegibles rechazaron o no respondieron. El dueño de la liga nombra a alguien, con un motivo, en la portada de la liga.',
      },
    })
  }
  if (!items.length) {
    items.push({
      id: 'zombie_ok', status: 'done', href: tools,
      title: { en: `Week ${input.week} is settling normally`, es: `La semana ${input.week} se liquida con normalidad` },
      detail: {
        en: 'Nothing is paused, held or waiting on you. The weekly settlement runs on its own.',
        es: 'Nada está en pausa, retenido ni esperando por ti. La liquidación semanal se hace sola.',
      },
    })
  }
  return items
}
