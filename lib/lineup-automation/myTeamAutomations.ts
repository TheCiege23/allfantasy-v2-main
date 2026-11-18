/**
 * "What AllFantasy may do for your team" — the manager's side of the league's automations (phase 11,
 * 2026-10-29). Commissioners see every switch on the Commissioner Hub; a manager otherwise only finds out
 * when a lineup changes under them. This lists, in plain words, what may act on THIS team in THIS league,
 * and how to take control back. It changes nothing.
 *
 * Pure: the reader (`./myTeamAutomationsService.ts`) gathers the facts.
 */
import { fillEmptyStartersOn } from './fillEmptyStarters'
import { readEliminatedLineupRule } from '@/lib/eliminated-lineups/eliminatedLineups'
import { readIrAutoMoveEnabled } from '@/lib/ir-activation/irAutoMove'
import { readAutoHandover } from '@/lib/inactive-manager/autoHandover'

export type MyTeamAutomation = { key: string; en: string; es: string }

type MyTeamFacts = {
  settings: unknown
  /** Lineups are set week by week (not daily, not automatic): the lineup automations apply. */
  weeklyLineups: boolean
  /** The league owner holds AF Commissioner: the paid automations run. */
  commissionerPlan: boolean
  /** This team is being run for its owner right now. */
  managed: null | { autopilot: boolean }
  /** The commissioner's "auto-switch injured starters" for this team, while the owner has Pro. */
  autoSwitch?: null | { level: 'out' | 'doubtful' | 'questionable'; timing: 'pregame_90' | 'night_before' }
}

const AUTO_SWITCH_LEVEL: Record<'out' | 'doubtful' | 'questionable', { en: string; es: string }> = {
  out: { en: 'is ruled out', es: 'queda descartado' },
  doubtful: { en: 'is doubtful or worse', es: 'está en duda o peor' },
  questionable: { en: 'is questionable or worse', es: 'es cuestionable o peor' },
}
const AUTO_SWITCH_TIMING: Record<'pregame_90' | 'night_before', { en: string; es: string }> = {
  pregame_90: { en: 'in the 90 minutes before his game', es: 'en los 90 minutos antes de su partido' },
  night_before: { en: 'from 8pm Eastern the night before his game', es: 'desde las 8pm (hora del Este) la noche antes de su partido' },
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function myTeamAutomations(f: MyTeamFacts): { items: MyTeamAutomation[]; takeBack: MyTeamAutomation } {
  const items: MyTeamAutomation[] = []
  if (f.managed) {
    items.push(
      f.managed.autopilot
        ? { key: 'managed', en: 'Chimmy is running your team on autopilot right now: your lineup, plus a waiver claim when a starter cannot play. Trade offers to you are paused while it does.', es: 'Chimmy dirige tu equipo en piloto automático ahora mismo: tu alineación y un reclamo cuando un titular no puede jugar. Las ofertas de intercambio quedan en pausa mientras tanto.' }
        : { key: 'managed', en: 'AllFantasy is setting your lineup right now, while you are away.', es: 'AllFantasy está poniendo tu alineación ahora mismo, mientras estás ausente.' },
    )
  }
  if (f.autoSwitch && f.weeklyLineups && !f.managed) {
    const l = AUTO_SWITCH_LEVEL[f.autoSwitch.level], t = AUTO_SWITCH_TIMING[f.autoSwitch.timing]
    items.push({
      key: 'auto_switch_injured',
      en: `Your commissioner turned on auto-switch: a starter who ${l.en} is swapped for your best healthy bench player ${t.en}. You can turn it off on your Team tab.`,
      es: `Tu comisionado activó el cambio automático: un titular que ${l.es} se cambia por tu mejor suplente sano ${t.es}. Puedes desactivarlo en tu pestaña Equipo.`,
    })
  }
  if (f.weeklyLineups && fillEmptyStartersOn(f.settings)) {
    items.push({ key: 'fill_empty_starters', en: 'If you leave a starting spot empty, AllFantasy tells you first, then about 3 hours later puts your best bench player who can play there (at once if games have already started). It never moves a player you started.', es: 'Si dejas un puesto titular vacío, AllFantasy te avisa primero y unas 3 horas después pone al mejor suplente que pueda jugar ahí (de inmediato si ya empezaron los partidos). Nunca mueve a un jugador que pusiste de titular.' })
  }
  const handover = readAutoHandover(f.settings)
  if (handover && !f.managed) {
    items.push({ key: 'auto_handover', en: `If you have no activity for ${handover.days} days, your team is handed to ${handover.to === 'autopilot' && f.commissionerPlan ? 'Chimmy autopilot' : 'AllFantasy'} until you are back.`, es: `Si no tienes actividad durante ${handover.days} días, tu equipo pasa a ${handover.to === 'autopilot' && f.commissionerPlan ? 'el piloto automático de Chimmy' : 'AllFantasy'} hasta que vuelvas.` })
  }
  if (f.commissionerPlan) {
    if (asRecord(f.settings).draft_as_me !== false) {
      items.push({ key: 'draft_as_me', en: 'If you miss a draft pick, Chimmy picks the way you usually draft.', es: 'Si pierdes una selección del draft, Chimmy elige como sueles elegir tú.' })
    }
    const eliminated = readEliminatedLineupRule(f.settings)
    if (eliminated?.autoFill && f.weeklyLineups) {
      items.push({ key: 'eliminated_lineups', en: 'If your team is out of the playoff race, AllFantasy fills any short lineup spots from your bench.', es: 'Si tu equipo queda fuera de la pelea por los playoffs, AllFantasy llena desde tu banca los puestos que falten.' })
    }
    if (readIrAutoMoveEnabled(f.settings)) {
      items.push({ key: 'ir_auto_move', en: 'A player on your IR who is activated is moved to your bench.', es: 'Un jugador de tu IR que vuelve a estar activo pasa a tu banca.' })
    }
  }
  return {
    items,
    takeBack: f.managed
      ? { key: 'take_back', en: 'Save a lineup of your own and you are in charge again at once.', es: 'Guarda una alineación tuya y vuelves a estar al mando al instante.' }
      : { key: 'take_back', en: 'Every change is in the league log, and anything you set yourself stays as you set it.', es: 'Cada cambio está en el registro de la liga, y lo que pongas tú se queda como lo pusiste.' },
  }
}
