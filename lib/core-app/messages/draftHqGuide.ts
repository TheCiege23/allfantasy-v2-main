import { defineMessages } from '@/lib/i18n/messages'

/**
 * The cross-league Draft HQ (components/core-app/boards/DraftHqBoard.tsx, lib/core-app/draftHqGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): «draft»,
 * «selección», «ronda»; a waiver claim is «reclamo» and no Spanish value says «waiver».
 *
 * ⚠ SOME ENGLISH VALUES ARE PINNED BY TESTS AND CARRY A PRODUCT RULE — keep their wording: "No queue
 * built in AllFantasy" (an empty queue is our gap, not an unprepared manager), "Player not identified"
 * (an unnamed pick is shown, never dropped) and "does not check whether they are still available".
 */
export const draftHqGuideMessages = defineMessages({
  en: {
    eyebrow: 'Draft HQ',
    headNone: 'Draft HQ',
    headYourPick: (league: string, n: number) => (n === 1 ? `You’re on the clock in ${league}` : `You’re on the clock in ${n} drafts`),
    headRunning: (league: string, n: number) =>
      n === 1 ? `${league} is drafting — it’s not your pick yet` : `${n} drafts are running — none is waiting on you`,
    headPaused: (league: string, n: number, yours: boolean) =>
      n === 1 ? `${league} is paused${yours ? ' — you pick next' : ''}` : `${n} drafts are paused — none is running`,
    headUpcoming: (n: number) => `No draft is running · ${n} coming up`,
    headAllDone: 'Every draft you’re in is finished',
    intro:
      'Every draft you’re in, in one place. The one that needs you comes first — open it to make your pick, or get ready for the ones that haven’t started.',
    secYourPick: 'Your pick now',
    secDrafting: 'Drafting now',
    secComingUp: 'Coming up · not started',
    secFinished: 'Finished',
    statSlot: 'Your slot',
    statRound: 'Round',
    statOnClock: 'On the clock',
    statQueued: 'Queued',
    of: (a: number, b: number) => `${a} of ${b}`,
    you: 'You',
    tagPaused: 'PAUSED',
    tagYourPick: 'YOUR PICK',
    tagLive: (pick: number | null) => (pick != null ? `LIVE · PICK ${pick}` : 'LIVE'),
    tagUpcoming: 'NOT STARTED',
    tagDone: 'COMPLETE',
    btnLive: 'Open the board →',
    btnUpcoming: 'Prepare →',
    btnDone: 'Open board →',
    lineYourPick: 'It’s your pick right now.',
    linePaused: 'Paused — the pick timer is stopped.',
    lineOnClock: (name: string) => `${name} is on the clock.`,
    lineRunning: 'This draft is running.',
    rowFacts: (slot: string | null, rounds: number | null) =>
      [slot ? `Slot ${slot}` : null, rounds != null ? `${rounds} rounds` : null].filter(Boolean).join(' · '),
    queueNote:
      'No queue built in AllFantasy? That’s fine — if you keep your queue on Sleeper or another platform, it stays there and we can’t see it.',
    lastPicks: 'Last picks',
    yourQueue: 'Your queue',
    noPicks: 'No picks recorded yet.',
    unnamedPick: 'Player not identified',
    youTag: 'YOU',
    queueUnchecked: 'This does not check whether they are still available — read the picks beside them.',
    noDraftYet: (n: number) => (n > 0 ? `No draft is set up in any of your ${n} leagues yet.` : 'No draft to show yet.'),
    foot: (shown: number, withDraft: number, without: number) =>
      `${shown < withDraft ? `Showing the ${shown} most urgent of ${withDraft} drafts.` : `${withDraft} ${withDraft === 1 ? 'draft' : 'drafts'} in all.`}${
        without > 0 ? ` ${without} ${without === 1 ? 'league has' : 'leagues have'} no draft we can read.` : ''
      }`,
    footAll: (total: number) => `See all ${total} leagues`,
    pastDrafts: 'Past drafts — every draft you’ve been in, searchable',
  },
  es: {
    eyebrow: 'Draft HQ',
    headNone: 'Draft HQ',
    headYourPick: (league, n) => (n === 1 ? `Te toca elegir en ${league}` : `Te toca elegir en ${n} drafts`),
    headRunning: (league, n) =>
      n === 1 ? `${league} está en pleno draft — aún no es tu turno` : `${n} drafts en curso — ninguno espera por ti`,
    headPaused: (league, n, yours) =>
      n === 1 ? `${league} está en pausa${yours ? ' — eliges tú después' : ''}` : `${n} drafts en pausa — ninguno en curso`,
    headUpcoming: (n) => `Ningún draft en curso · ${n} por empezar`,
    headAllDone: 'Todos tus drafts han terminado',
    intro:
      'Todos tus drafts en un solo lugar. Primero el que te necesita: ábrelo para hacer tu selección, o prepárate para los que aún no empiezan.',
    secYourPick: 'Te toca ahora',
    secDrafting: 'En curso',
    secComingUp: 'Por empezar',
    secFinished: 'Terminados',
    statSlot: 'Tu turno',
    statRound: 'Ronda',
    statOnClock: 'Eligiendo',
    statQueued: 'En tu cola',
    of: (a, b) => `${a} de ${b}`,
    you: 'Tú',
    tagPaused: 'EN PAUSA',
    tagYourPick: 'TU TURNO',
    tagLive: (pick) => (pick != null ? `EN VIVO · SELECCIÓN ${pick}` : 'EN VIVO'),
    tagUpcoming: 'SIN EMPEZAR',
    tagDone: 'TERMINADO',
    btnLive: 'Abrir el tablero →',
    btnUpcoming: 'Prepararme →',
    btnDone: 'Abrir tablero →',
    lineYourPick: 'Es tu turno ahora mismo.',
    linePaused: 'En pausa: el reloj de selección está detenido.',
    lineOnClock: (name) => `Elige ${name}.`,
    lineRunning: 'Este draft está en curso.',
    rowFacts: (slot, rounds) =>
      [slot ? `Turno ${slot}` : null, rounds != null ? `${rounds} rondas` : null].filter(Boolean).join(' · '),
    queueNote:
      '¿Sin cola creada en AllFantasy? No pasa nada: si tienes tu cola en Sleeper u otra plataforma, se queda allí y no podemos verla.',
    lastPicks: 'Últimas selecciones',
    yourQueue: 'Tu cola',
    noPicks: 'Aún no hay selecciones registradas.',
    unnamedPick: 'Jugador no identificado',
    youTag: 'TÚ',
    queueUnchecked: 'Esto no comprueba si siguen disponibles: revisa las selecciones de al lado.',
    noDraftYet: (n) => (n > 0 ? `Aún no hay draft en ninguna de tus ${n} ligas.` : 'Aún no hay draft que mostrar.'),
    foot: (shown, withDraft, without) =>
      `${shown < withDraft ? `Mostrando los ${shown} más urgentes de ${withDraft} drafts.` : `${withDraft} ${withDraft === 1 ? 'draft' : 'drafts'} en total.`}${
        without > 0 ? ` ${without} ${without === 1 ? 'liga no tiene' : 'ligas no tienen'} un draft que podamos leer.` : ''
      }`,
    footAll: (total) => `Ver las ${total} ligas`,
    pastDrafts: 'Drafts anteriores: todos en los que has estado, con búsqueda',
  },
})
