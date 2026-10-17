import { defineMessages } from '@/lib/i18n/messages'
import type { StartCallReceipt, TradeReceipt } from '@/lib/core-app/decisionReceipts'

/**
 * The home Receipts card (components/core-app/screens/ReceiptsCard.tsx). Every string is the one the
 * card printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. (Notes that were line-wrapped JSX text are the same rendered words with single spaces.)
 */

const OUTCOME_TEXT: Record<TradeReceipt['outcome'], string> = {
  ahead: 'you’re ahead',
  behind: 'you’re behind',
  even: 'about even',
}

const OUTCOME_TEXT_ES: Record<TradeReceipt['outcome'], string> = {
  ahead: 'vas ganando',
  behind: 'vas perdiendo',
  even: 'más o menos parejo',
}

export const receiptsCardMessages = defineMessages({
  en: {
    callResult: (who: string, call: StartCallReceipt['call']): string => (call === 'same' ? 'about the same' : `${who} was ${call}`),
    nothing: 'nothing',
    and: ' & ',
    starts: (n: number) => `${n} start${n === 1 ? '' : 's'}`,
    wk: 'wk',
    youAdded: (name: string) => `You added ${name}`,
    forYou: ' for you · ',
    goneWeek: (week: number) => ` · gone wk ${week}`,
    stillYours: ' (still yours)',
    perfectLineup: (week: number) => `Perfect lineup in week ${week}`,
    leftOnBench: (points: string) => `You left ${points} pts on your bench`,
    bestLegalLineup: 'Best legal lineup: ',
    startsPlayers: (players: string) => `starts ${players}`,
    benchesPlayers: (players: string) => `benches ${players}`,
    includesBenched: (name: string, points: string) => `Best legal lineup includes ${name} (${points}).`,
    saidStart: (who: string, recommended: string, instead: string) => `${who} said start ${recommended} over ${instead}`,
    confident: (pct: number) => ` · ${pct}% confident`,
    followedYes: (name: string) => `You started ${name} on Sleeper.`,
    followedNo: (name: string) => `You kept ${name} in on Sleeper.`,
    followedUnclear: 'Your Sleeper lineup didn’t match either way.',
    saidAdd: (name: string) => `Chimmy said add ${name}`,
    addedInWeek: (week: number) => ` for you · you added him wk ${week} · `,
    notAdded: 'You didn’t add him.',
    callsPending: (n: number, who: string) => `${n} ${who} call${n === 1 ? ' is' : 's are'} for a week still being played.`,
    callsUnscored: (n: number) => `${n} call${n === 1 ? ' has' : 's have'} no weekly scores on file yet.`,
    callsUnreadable: (n: number) => `${n} call${n === 1 ? '' : 's'} couldn’t be matched to a week or to your roster that week.`,
    label: 'RECEIPTS',
    trades: 'Trades',
    yourTrade: (counterparty: string | null | undefined) => `Your trade${counterparty ? ` with ${counterparty}` : ''}`,
    gaveGot: (gave: string, got: string) => `Gave ${gave} · got ${got}`,
    sinceOutcome: (outcome: TradeReceipt['outcome'], ongoing: boolean | undefined) =>
      `since — ${OUTCOME_TEXT[outcome]}${ongoing ? ' (still counting)' : ''}`,
    unsettledPicks: (n: number) => `${n} pick${n === 1 ? '' : 's'} not drafted yet — not counted`,
    tradesTooEarly: (n: number) => `${n} newer trade${n === 1 ? ' is' : 's are'} too early to call.`,
    waiverAdds: 'Waiver adds',
    waiversTooEarly: (n: number) => `${n} recent add${n === 1 ? ' is' : 's are'} too early to call.`,
    waiversUnscored: (n: number) => `${n} add${n === 1 ? ' has' : 's have'} no weekly scores on file yet.`,
    lineups: 'Lineups',
    lineupsUnscored: (n: number) => `${n} recent week${n === 1 ? ' has' : 's have'} no weekly scores on file yet.`,
    lineupsUnreadable: (n: number) =>
      `${n} week${n === 1 ? '' : 's'} couldn’t be checked — a starter’s position or the league’s lineup slots aren’t on file.`,
    chimmyRecord: 'Chimmy’s record on your start/sit calls:',
    addCallsTooEarly: (n: number) => `${n} add call${n === 1 ? ' is' : 's are'} too early to call.`,
    addCallsUnscored: (n: number) =>
      `${n} add${n === 1 ? ' you made on Chimmy’s call has' : 's you made on Chimmy’s call have'} no weekly scores on file yet.`,
    addCallsUnknown: (n: number) =>
      `${n} add call${n === 1 ? '' : 's'} couldn’t be checked yet — your league’s transactions haven’t synced past that week.`,
    afSwapTips: 'AF swap tips',
    sleeperOnly: 'Receipts cover your Sleeper leagues for now.',
  },
  es: {
    callResult: (who, call) => (call === 'same' ? 'más o menos igual' : call === 'right' ? `${who} acertó` : `${who} falló`),
    nothing: 'nada',
    and: ' y ',
    starts: (n) => `${n} ${n === 1 ? 'titularidad' : 'titularidades'}`,
    wk: 'sem.',
    youAdded: (name) => `Incorporaste a ${name}`,
    forYou: ' para ti · ',
    goneWeek: (week) => ` · se fue en la sem. ${week}`,
    stillYours: ' (sigue en tu equipo)',
    perfectLineup: (week) => `Alineación perfecta en la semana ${week}`,
    leftOnBench: (points) => `Dejaste ${points} pts en tu banca`,
    bestLegalLineup: 'Mejor alineación válida: ',
    startsPlayers: (players) => `alinea a ${players}`,
    benchesPlayers: (players) => `sienta a ${players}`,
    includesBenched: (name, points) => `La mejor alineación válida incluye a ${name} (${points}).`,
    saidStart: (who, recommended, instead) => `${who} dijo que alinearas a ${recommended} en lugar de ${instead}`,
    confident: (pct) => ` · ${pct}% de confianza`,
    followedYes: (name) => `Alineaste a ${name} en Sleeper.`,
    followedNo: (name) => `Mantuviste a ${name} en Sleeper.`,
    followedUnclear: 'Tu alineación de Sleeper no coincidió con ninguna de las dos opciones.',
    saidAdd: (name) => `Chimmy dijo que incorporaras a ${name}`,
    addedInWeek: (week) => ` para ti · lo incorporaste en la sem. ${week} · `,
    notAdded: 'No lo incorporaste.',
    callsPending: (n, who) =>
      `${n === 1 ? `1 consejo de ${who} es` : `${n} consejos de ${who} son`} de una semana que aún se está jugando.`,
    callsUnscored: (n) => `${n === 1 ? '1 consejo aún no tiene' : `${n} consejos aún no tienen`} puntuaciones semanales registradas.`,
    callsUnreadable: (n) =>
      `${n === 1 ? '1 consejo no se pudo emparejar' : `${n} consejos no se pudieron emparejar`} con una semana ni con tu plantilla de esa semana.`,
    label: 'RESULTADOS DE TUS DECISIONES',
    trades: 'Intercambios',
    yourTrade: (counterparty) => `Tu intercambio${counterparty ? ` con ${counterparty}` : ''}`,
    gaveGot: (gave, got) => `Diste ${gave} · recibiste ${got}`,
    sinceOutcome: (outcome, ongoing) => `desde entonces: ${OUTCOME_TEXT_ES[outcome]}${ongoing ? ' (sigue contando)' : ''}`,
    unsettledPicks: (n) =>
      n === 1 ? '1 selección aún no se ha usado en un draft: no cuenta' : `${n} selecciones aún no se han usado en un draft: no cuentan`,
    tradesTooEarly: (n) => `Es pronto para evaluar ${n === 1 ? '1 intercambio más reciente' : `${n} intercambios más recientes`}.`,
    waiverAdds: 'Incorporaciones',
    waiversTooEarly: (n) => `Es pronto para evaluar ${n === 1 ? '1 incorporación reciente' : `${n} incorporaciones recientes`}.`,
    waiversUnscored: (n) =>
      `${n === 1 ? '1 incorporación aún no tiene' : `${n} incorporaciones aún no tienen`} puntuaciones semanales registradas.`,
    lineups: 'Alineaciones',
    lineupsUnscored: (n) =>
      `${n === 1 ? '1 semana reciente aún no tiene' : `${n} semanas recientes aún no tienen`} puntuaciones semanales registradas.`,
    lineupsUnreadable: (n) =>
      `${n === 1 ? '1 semana no se pudo revisar' : `${n} semanas no se pudieron revisar`}: falta la posición de un titular o los puestos de alineación de la liga.`,
    chimmyRecord: 'Historial de Chimmy en tus decisiones de titular o banca:',
    addCallsTooEarly: (n) => `Es pronto para evaluar ${n === 1 ? '1 consejo de incorporación' : `${n} consejos de incorporación`}.`,
    addCallsUnscored: (n) =>
      `${n === 1 ? '1 incorporación que hiciste por consejo de Chimmy aún no tiene' : `${n} incorporaciones que hiciste por consejo de Chimmy aún no tienen`} puntuaciones semanales registradas.`,
    addCallsUnknown: (n) =>
      `${n === 1 ? '1 consejo de incorporación aún no se pudo revisar' : `${n} consejos de incorporación aún no se pudieron revisar`}: las transacciones de tu liga no se han sincronizado más allá de esa semana.`,
    afSwapTips: 'Consejos de cambio de AF',
    sleeperOnly: 'Por ahora, estos resultados cubren tus ligas de Sleeper.',
  },
})
