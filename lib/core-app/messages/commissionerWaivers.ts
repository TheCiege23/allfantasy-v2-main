import { defineMessages } from '@/lib/i18n/messages'

/**
 * Waiver Oversight in the Commissioner Hub (lib/core-app/commissionerWaivers.ts). Every string is the
 * one the module wrote before the move, byte for byte, in both languages — a relocation, not a rewrite.
 * `waiverType*` are the waiver-type labels that were the `WAIVER_TYPE_LABEL` / `_ES` tables.
 */

/*
 * The shared outcome labels (`waiver-outcome-labels`) serve the waivers history, notifications and
 * exports in English. The hub's panel words the same codes in the reader's language here, so that
 * module's other callers are untouched. A code with no entry keeps the shared English label.
 */
const OUTCOME_LABEL_ES: Record<string, string> = {
  won: 'Concedida',
  lost_priority: 'Perdida: prioridad',
  lost_tiebreaker: 'Perdida: desempate',
  insufficient_faab: 'No concedida: FAAB',
  invalid_due_to_roster: 'Bloqueada: plantilla',
  player_no_longer_available: 'No concedida: jugador ya fichado',
  blocked_by_lineup_lock: 'Bloqueada: alineación cerrada',
  blocked_by_ir_taxi_devy_violation: 'Bloqueada: IR / taxi / devy',
  failed: 'No concedida',
}

export const commissionerWaiversMessages = defineMessages({
  en: {
    resultWon: 'Won',
    resultOutbid: 'Outbid',
    resultShort: 'Short on FAAB',
    aManager: 'A manager',
    unavailableImported: (platformName: string) =>
      `This league's waivers run on ${platformName}. Bids and claim results aren't shared with AllFantasy, so there is nothing to oversee here — manage them on the platform.`,
    unavailableNoRunsYet: 'No waiver settings or runs yet. Once the first run processes, budgets and results appear here.',
    budgetsNotFaab: 'This league does not use FAAB, so there are no budgets to track.',
    budgetsNoSeasonBudget: 'No season FAAB budget is set for this league.',
    budgetsNoBalances: 'No roster has a FAAB balance recorded yet.',
    unrecognisedPlayer: 'Unrecognised player',
    waiverTypeFallback: 'Waivers',
    waiverTypeFaab: 'FAAB',
    waiverTypeRolling: 'Rolling priority',
    waiverTypeReverseStandings: 'Reverse standings priority',
    waiverTypeFcfs: 'First come, first served',
    waiverTypeStandard: 'Standard priority',
    waiverTypeOff: 'No waivers',
    /** A run result by outcome code: the shared English label (`formatWaiverOutcomeLabel`), handed in. */
    outcomeLabel: (_code: string, english: string): string => english,
    /** The run times' Intl locale ("Sun 1 PM ET"). */
    runSlotLocale: 'en-US',
  },
  es: {
    resultWon: 'Ganada',
    resultOutbid: 'Superada',
    resultShort: 'Sin FAAB suficiente',
    aManager: 'Un mánager',
    unavailableImported: (platformName) =>
      `Los reclamos de esta liga se procesan en ${platformName}. Las ofertas y los resultados de los reclamos no se comparten con AllFantasy, así que aquí no hay nada que supervisar: gestiónalos en la plataforma.`,
    unavailableNoRunsYet:
      'Aún no hay configuración ni procesamientos de reclamos. Cuando se procese el primero, aquí aparecerán los presupuestos y los resultados.',
    budgetsNotFaab: 'Esta liga no usa FAAB, así que no hay presupuestos que seguir.',
    budgetsNoSeasonBudget: 'Esta liga no tiene un presupuesto FAAB de temporada.',
    budgetsNoBalances: 'Ninguna plantilla tiene todavía un saldo de FAAB registrado.',
    unrecognisedPlayer: 'Jugador no reconocido',
    waiverTypeFallback: 'Agentes libres',
    waiverTypeFaab: 'FAAB',
    waiverTypeRolling: 'Prioridad rotativa',
    waiverTypeReverseStandings: 'Prioridad por clasificación inversa',
    waiverTypeFcfs: 'Por orden de llegada',
    waiverTypeStandard: 'Prioridad estándar',
    waiverTypeOff: 'Sin agentes libres en espera',
    outcomeLabel: (code, english) => (code && OUTCOME_LABEL_ES[code] ? OUTCOME_LABEL_ES[code]! : english),
    runSlotLocale: 'es-US',
  },
})
