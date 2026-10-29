import { defineMessages } from '@/lib/i18n/messages'

/**
 * Waiver Oversight in the Commissioner Hub (lib/core-app/commissionerWaivers.ts). Every string is the
 * one the module wrote before the move, byte for byte, in both languages — a relocation, not a rewrite.
 * `waiverType*` are the waiver-type labels that were the `WAIVER_TYPE_LABEL` / `_ES` tables.
 */
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
  },
})
