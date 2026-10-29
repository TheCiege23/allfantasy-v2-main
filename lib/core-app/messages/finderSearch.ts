import type { CompareCopy, FaCopy, PickerCopy, SearchBoxCopy, StripCopy } from '../finderSearchCopy'
import { coreUiCopy } from '../coreUiCopy'
import { defineMessages, messagesFor } from '@/lib/i18n/messages'

/**
 * Player Finder's search-and-leagues copy (lib/core-app/finderSearchCopy.ts). Every string is the one
 * the module produced before the move, byte for byte, in both languages. The tables' types stay
 * exported from finderSearchCopy.ts, which callers already import; this file imports them as types only.
 * The Spanish rebuilds of builder English (suggestion chips, compare verdicts, strip chips, FA notes)
 * stay in finderSearchCopy.ts: they are built from parts or keyed on English, not en/es pairs.
 */

/** The labels more than one Player Finder card prints: claimText, takenText, freeAgentText. */
export const finderSearchMessages = defineMessages({
  en: {
    claim: (last: string, platform: string) => `Claim ${last} in ${platform}`,
    taken: 'Taken',
    freeAgent: 'Free agent',
  },
  es: {
    claim: (last, platform) => `Reclamar a ${last} en ${platform}`,
    taken: 'Ocupado',
    freeAgent: 'Agente libre',
  },
})

/** The search box (searchBoxCopy). */
export const finderSearchBoxMessages = defineMessages<SearchBoxCopy>({
  en: {
    searchLabel: 'Search any player',
    compareLabel: 'Compare with another player',
    searchButton: 'Search',
    suggestions: 'Suggestions',
    playersToCompare: 'Players to compare',
    noTeam: 'no team on file',
    noteSignedIn: 'Searches every platform you have connected at once — Sleeper, ESPN and Yahoo.',
    noteSignedOut: 'One search covers Sleeper, ESPN and Yahoo at once. Connect a league to see your own slots and matchups.',
  },
  es: {
    searchLabel: 'Buscar cualquier jugador',
    compareLabel: 'Comparar con otro jugador',
    searchButton: 'Buscar',
    suggestions: 'Sugerencias',
    playersToCompare: 'Jugadores para comparar',
    noTeam: 'sin equipo registrado',
    noteSignedIn: 'Busca a la vez en todas las plataformas que conectaste: Sleeper, ESPN y Yahoo.',
    noteSignedOut: 'Una sola búsqueda cubre Sleeper, ESPN y Yahoo a la vez. Conecta una liga para ver tus propios puestos y enfrentamientos.',
  },
})

/** The compare card (compareCopy). */
export const finderCompareMessages = defineMessages<CompareCopy>({
  en: {
    heading: (a, b) => `Compare · ${a} vs ${b}`,
    swap: 'Swap',
    clear: 'Clear',
    sideBySide: 'Side by side',
    projHelp: 'Standard scoring · the table below is each league’s own',
    afProjHelp: 'AllFantasy’s own projection engine · standard scoring',
    unchecked: 'unchecked',
    notOnRoster: 'not on a roster we read',
    slotTitleYours: (name) => `${name}'s slot on your team`,
    slotTitleOwner: (owner, name) => `@${owner} has ${name}`,
    slotTitleOther: (name) => `${name} is on another roster`,
    neither: 'Neither is on a roster in your leagues that we could read.',
    acrossYourLeagues: 'Across your leagues',
    gap: 'Gap',
    even: 'even',
    signIn: 'Sign in to see the two of them across your leagues.',
    footnote: (a, b) => `Points in the table are under each league’s own scoring; the gap is ${a} minus ${b}. Standard scoring is the tile above.`,
    compareAgain: (a) => `Compare ${a} with someone else`,
  },
  es: {
    heading: (a, b) => `Comparar · ${a} vs ${b}`,
    swap: 'Invertir',
    clear: 'Quitar',
    sideBySide: 'Lado a lado',
    projHelp: 'Puntuación estándar · la tabla de abajo usa la de cada liga',
    afProjHelp: 'El motor de proyecciones propio de AllFantasy · puntuación estándar',
    unchecked: 'sin comprobar',
    notOnRoster: 'no está en ninguna plantilla que leamos',
    slotTitleYours: (name) => `Puesto de ${name} en tu equipo`,
    slotTitleOwner: (owner, name) => `@${owner} tiene a ${name}`,
    slotTitleOther: (name) => `${name} está en otra plantilla`,
    neither: 'Ninguno está en una plantilla de tus ligas que podamos leer.',
    acrossYourLeagues: 'En todas tus ligas',
    gap: 'Diferencia',
    even: 'igual',
    signIn: 'Inicia sesión para ver a los dos en todas tus ligas.',
    footnote: (a, b) =>
      `Los puntos de la tabla usan la puntuación propia de cada liga; la diferencia es ${a} menos ${b}. La puntuación estándar está en la casilla de arriba.`,
    compareAgain: (a) => `Comparar a ${a} con otro jugador`,
  },
})

/** The league picker (pickerCopy). */
export const finderPickerMessages = defineMessages<PickerCopy>({
  en: {
    leagues: 'Leagues',
    count: (c, t) => (c === t ? `All ${t}` : `${c} of ${t}`),
    selected: (c, t) => `${c === t ? `All ${t}` : `${c} of ${t}`} selected`,
    panelLabel: 'Pick the leagues the Player Finder reads',
    filter: 'Filter leagues',
    all: 'All',
    none: 'None',
    save: 'Save',
    saving: 'Saving…',
    error: 'Could not save — try again.',
    note: 'Saved to your account, so the same leagues show on every device. None ticked means all.',
  },
  es: {
    leagues: coreUiCopy('Leagues', 'es'),
    count: (c, t) => (c === t ? `Todas (${t})` : `${c} de ${t}`),
    selected: (c, t) => (c === t ? `Las ${t} seleccionadas` : `${c} de ${t} seleccionadas`),
    panelLabel: 'Elige las ligas que lee el buscador de jugadores',
    filter: 'Filtrar ligas',
    all: coreUiCopy('All', 'es'),
    none: 'Ninguna',
    save: 'Guardar',
    saving: 'Guardando…',
    error: 'No se pudo guardar. Inténtalo de nuevo.',
    note: 'Se guarda en tu cuenta, así que verás las mismas ligas en todos tus dispositivos. Si no marcas ninguna, se usan todas.',
  },
})

/** The league strip (stripCopy). */
export const finderStripMessages = defineMessages<StripCopy>({
  en: {
    label: 'Where he is in each of your leagues',
    summary: (y, f, o) => `Yours in ${y} · available in ${f} · elsewhere in ${o}`,
    unreadable: (n) => ` · can't read ${n}`,
    foldLabel: 'Leagues where he is not yours',
    foldFree: (n) => `Available in ${n}`,
    foldOther: (n) => `Taken in ${n}`,
    foldUnknown: (n) => `Can't read ${n}`,
    noneYours: 'Not on any of your rosters.',
  },
  es: {
    label: 'Dónde está en cada una de tus ligas',
    summary: (y, f, o) => `Tuyo en ${y} · disponible en ${f} · con otro equipo en ${o}`,
    unreadable: (n) => ` · sin poder leer ${n}`,
    foldLabel: 'Ligas donde no es tuyo',
    foldFree: (n) => `Disponible en ${n}`,
    foldOther: (n) => `Con otro equipo en ${n}`,
    foldUnknown: (n) => `Sin leer ${n}`,
    noneYours: 'No está en ninguna de tus plantillas.',
  },
})

/** Available in your leagues — FreeAgentBids (faCopy). */
export const finderFaMessages = defineMessages<FaCopy>({
  en: {
    heading: (n) => `Available in ${n} of your leagues`,
    bid: (amount) => `Bid ~$${amount}`,
    ofBudget: (budget) => ` of $${budget}`,
    left: (remaining) => ` · $${remaining} left`,
    room: (median, p75, claims) => `This league's winning bids: median $${median} · p75 $${p75} (${claims} ${claims === 1 ? 'claim' : 'claims'})`,
    claim: (last, platform) => messagesFor(finderSearchMessages, 'en').claim(last, platform),
    foot:
      "The bid is his market value in each league's format against its budget, capped at 60% of it — the same number Waiver Intel uses. The league's winning bids sit beside it to calibrate against the room; they are not part of it.",
  },
  es: {
    heading: (n) => `Disponible en ${n} de tus ligas`,
    bid: (amount) => `Puja ~$${amount}`,
    ofBudget: (budget) => ` de $${budget}`,
    left: (remaining) => ` · quedan $${remaining}`,
    room: (median, p75, claims) => `Pujas ganadoras de esta liga: mediana $${median} · p75 $${p75} (${claims} ${claims === 1 ? 'reclamo' : 'reclamos'})`,
    claim: (last, platform) => messagesFor(finderSearchMessages, 'es').claim(last, platform),
    foot:
      'La puja es su valor de mercado en el formato de cada liga frente a su presupuesto, con un tope del 60% del presupuesto: el mismo número que usa Inteligencia de agentes libres. Las pujas ganadoras de la liga aparecen al lado para comparar con lo que paga el resto; no entran en la puja.',
  },
})
