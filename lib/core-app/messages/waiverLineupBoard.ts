import { defineMessages } from '@/lib/i18n/messages'

/**
 * Worth adding (components/core-app/WaiverLineupBoard.tsx). Every string is the one the board
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * The state reasons and loader notes are not here: they arrive in English and go through
 * `coreUiCopy`, as before.
 */
export const waiverLineupBoardMessages = defineMessages({
  en: {
    worthAdding: 'Worth adding',
    yourBestLineup: 'your best lineup',
    perGame: ' per game',
    weekSuffix: (week: number) => ` · wk ${week}`,
    proj: 'proj',
    afEngineTitle: "AllFantasy engine projection, adjusted to this league's scoring",
    formTitle: 'No projection feed covers him — this is his recent scoring here',
    formChip: (games: number | undefined) => `form · ${games}g`,
    seasonRateTitle: "A per-game rate from AllFantasy's season projection, not a projection for this week",
    seasonRateChip: 'per game · season',
    bidTitle: 'Suggested bid by the Waiver intelligence rule below: budget × his market value ÷ the anchor, capped at 60% of the budget',
    bid: 'bid',
    overYourLeft: (remaining: number) => ` · over your $${remaining} left`,
    over: 'over',
    fillsEmptySlot: 'fills an empty slot',
    rosterNeedsLabel: 'What your roster needs',
    empty: 'Empty',
    inWeek: (week: number) => ` in wk ${week}`,
    noBackup: (position: string) => `No ${position} backup`,
    rosteredFor: (rostered: number, starting: number) =>
      `${rostered} rostered for ${starting} starting ${starting === 1 ? 'slot' : 'slots'}`,
    byeWeek: (week: number) => `Bye wk ${week}`,
    yourPriority: (priority: number, rosters: number) => `Your priority: #${priority} of ${rosters}.`,
    alreadyLast: 'You are already last, so a claim costs you no place in the order.',
    claimSendsYouTo: (rosters: number) => `A claim sends you to #${rosters}. `,
    priorityGap: (top: string, topGain: string, unit: string, next: string, nextGain: string, gap: string) =>
      `${top} adds +${topGain}${unit}; the next best, ${next}, adds +${nextGain} — a ${gap}-point gap is what spending it buys.`,
    onlyFreeAgent: (top: string, topGain: string, unit: string) =>
      `${top} (+${topGain}${unit}) is the only free agent who improves your lineup.`,
  },
  es: {
    worthAdding: 'Vale la pena sumar',
    yourBestLineup: 'tu mejor alineación',
    perGame: ' por partido',
    weekSuffix: (week) => ` · sem ${week}`,
    proj: 'proy',
    afEngineTitle: 'Proyección del motor de AllFantasy, ajustada a la puntuación de esta liga',
    formTitle: 'Ninguna proyección lo cubre: esto es lo que viene anotando aquí',
    formChip: (games) => `forma · ${games} p`,
    seasonRateTitle: 'Un promedio por partido de la proyección de temporada de AllFantasy, no una proyección para esta semana',
    seasonRateChip: 'por partido · temporada',
    bidTitle: 'Oferta sugerida con la regla de Inteligencia de agentes libres de abajo: presupuesto × su valor de mercado ÷ el ancla, con un tope del 60% del presupuesto',
    bid: 'oferta',
    overYourLeft: (remaining) => ` · más que tus $${remaining} restantes`,
    over: 'en lugar de',
    fillsEmptySlot: 'ocupa un puesto vacío',
    rosterNeedsLabel: 'Lo que necesita tu plantilla',
    empty: 'Vacío',
    inWeek: (week) => ` en sem ${week}`,
    noBackup: (position) => `Sin suplente de ${position}`,
    rosteredFor: (rostered, starting) =>
      `${rostered} en plantilla para ${starting} ${starting === 1 ? 'puesto titular' : 'puestos titulares'}`,
    byeWeek: (week) => `Descanso sem ${week}`,
    yourPriority: (priority, rosters) => `Tu prioridad: #${priority} de ${rosters}.`,
    alreadyLast: 'Ya eres último, así que un reclamo no te cuesta ningún lugar en el orden.',
    claimSendsYouTo: (rosters) => `Un reclamo te manda al #${rosters}. `,
    priorityGap: (top, topGain, unit, next, nextGain, gap) =>
      `${top} suma +${topGain}${unit}; el siguiente, ${next}, suma +${nextGain}: una diferencia de ${gap} puntos es lo que compra gastarla.`,
    onlyFreeAgent: (top, topGain, unit) =>
      `${top} (+${topGain}${unit}) es el único agente libre que mejora tu alineación.`,
  },
})
