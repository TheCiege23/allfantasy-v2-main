import { coreUiCopy } from './coreUiCopy'
import { handoffText } from './homeBandsCopy'
import type { LeagueViewActions, ViewAction } from './leagueViewActions'
import type { StripChip } from './leagueStrip'
import type { PlayerCompare } from './playerCompare'
import type { PlayerLeagueView } from './playerLeagueView'
import { finderCopy } from './playerFinderCopy'
import type { SuggestionFact } from './suggestionChip'

/**
 * Player Finder's search-and-leagues pieces in the reader's language (2026-10-05): the search box and
 * its suggestion chips, the compare card, the league picker, the league strip, the phone's sticky
 * action bar and "available in your leagues" (components/core-app/player-finder/).
 *
 * The English stays where it was written — in each component, and in the pure builders behind them
 * (suggestionChip.ts, playerCompare.ts, leagueStrip.ts, leagueViewActions.ts), whose output the
 * player-finder-* suites pin byte for byte. What a builder decides (which chip, which verdict, which
 * note) it hands over as parts; this only puts those parts into Spanish, so a language can never
 * change the decision.
 *
 * Reused, never copied: the tile labels, "Trade for" and the column heading are Player Finder's own
 * (`finderCopy`), the slot chip is playerMovesCopy's `slotText`, "Open in Sleeper" goes through
 * homeBandsCopy's `handoffText`. FAAB words follow the Waivers screens and the `faabBid` help topic:
 * «puja», «reclamo», «presupuesto».
 *
 * ⚠ THE LOADER'S NOTES ARE TRANSLATED WHOLE OR NOT AT ALL. `faNoteText` knows the exact sentences
 * freeAgentBids.ts writes (held to its source by __tests__/finder-search-leagues-spanish.test.tsx);
 * a note it does not know stays whole English. The loader keeps writing English.
 *
 * PURE, client-safe.
 */

const ligas = (n: number) => (n === 1 ? 'liga' : 'ligas')

/* ── The search box ───────────────────────────────────────────────────────────────────────────── */

export type SearchBoxCopy = {
  searchLabel: string
  compareLabel: string
  searchButton: string
  suggestions: string
  playersToCompare: string
  noTeam: string
  noteSignedIn: string
  noteSignedOut: string
}

const SEARCH_EN: SearchBoxCopy = {
  searchLabel: 'Search any player',
  compareLabel: 'Compare with another player',
  searchButton: 'Search',
  suggestions: 'Suggestions',
  playersToCompare: 'Players to compare',
  noTeam: 'no team on file',
  noteSignedIn: 'Searches every platform you have connected at once — Sleeper, ESPN and Yahoo.',
  noteSignedOut: 'One search covers Sleeper, ESPN and Yahoo at once. Connect a league to see your own slots and matchups.',
}

const SEARCH_ES: SearchBoxCopy = {
  searchLabel: 'Buscar cualquier jugador',
  compareLabel: 'Comparar con otro jugador',
  searchButton: 'Buscar',
  suggestions: 'Sugerencias',
  playersToCompare: 'Jugadores para comparar',
  noTeam: 'sin equipo registrado',
  noteSignedIn: 'Busca a la vez en todas las plataformas que conectaste: Sleeper, ESPN y Yahoo.',
  noteSignedOut: 'Una sola búsqueda cubre Sleeper, ESPN y Yahoo a la vez. Conecta una liga para ver tus propios puestos y enfrentamientos.',
}

export function searchBoxCopy(language: string): SearchBoxCopy {
  return language === 'es' ? SEARCH_ES : SEARCH_EN
}

/** A suggestion chip in Spanish, from the fact `suggestionFact` chose; English callers use `suggestionChip`. */
export function suggestionChipText(f: SuggestionFact): string {
  switch (f.kind) {
    case 'yours':
      return `tuyo en ${f.league}`
    case 'yoursCount':
      return `tuyo en ${f.n} ligas`
    case 'ownedBy':
      return `@${f.owner} lo tiene en ${f.league}`
    case 'owned':
      return `con dueño en ${f.league}`
    case 'ownedCount':
      return `con dueño en ${f.n} de tus ligas`
    case 'free':
      return `libre en ${f.league}`
    case 'freeCount':
      return `libre en ${f.n} ligas`
  }
}

/* ── The compare card ─────────────────────────────────────────────────────────────────────────── */

export type CompareCopy = {
  heading: (a: string, b: string) => string
  swap: string
  clear: string
  sideBySide: string
  projHelp: string
  afProjHelp: string
  unchecked: string
  notOnRoster: string
  slotTitleYours: (name: string) => string
  slotTitleOwner: (owner: string, name: string) => string
  slotTitleOther: (name: string) => string
  neither: string
  acrossYourLeagues: string
  gap: string
  even: string
  signIn: string
  footnote: (a: string, b: string) => string
  compareAgain: (a: string) => string
}

const COMPARE_EN: CompareCopy = {
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
}

const COMPARE_ES: CompareCopy = {
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
}

export function compareCopy(language: string): CompareCopy {
  return language === 'es' ? COMPARE_ES : COMPARE_EN
}

/** The card's verdict line: its English as playerCompare.ts wrote it, or Spanish from `headlineParts`. */
export function compareHeadlineText(cmp: Pick<PlayerCompare, 'headline' | 'headlineParts'>, language: string): string {
  const p = cmp.headlineParts
  if (language !== 'es' || !p) return cmp.headline
  const { a, b } = p
  switch (p.kind) {
    case 'priced': {
      const where = p.biggest
        ? `: la mayor diferencia, en ${p.biggest.leagueName} (${p.biggest.gap > 0 ? '+' : ''}${p.biggest.gap.toFixed(1)} para ${p.biggest.gap > 0 ? a : b})`
        : ''
      const valoradas = (n: number) => `${ligas(n)} ${n === 1 ? 'valorada' : 'valoradas'}`
      const sweep = (n: number) => (n === 1 ? 'la única liga valorada' : `las ${n} ligas valoradas`)
      if (p.tallyA === p.n) return `${a} supera a ${b} en ${sweep(p.n)}${where}.`
      if (p.tallyB === p.n) return `${b} supera a ${a} en ${sweep(p.n)}${where}.`
      if (p.tallyA > p.tallyB) return `${a} supera a ${b} en ${p.tallyA} de ${p.n} ${valoradas(p.n)}${where}.`
      if (p.tallyB > p.tallyA) return `${b} supera a ${a} en ${p.tallyB} de ${p.n} ${valoradas(p.n)}${where}.`
      return p.n === 1
        ? `${a} y ${b} empatan en la única liga valorada${where}.`
        : `${a} y ${b} se reparten las ${p.n} ligas valoradas ${p.tallyA}–${p.tallyB}${where}.`
    }
    case 'standard': {
      const lead = p.pointsA === p.pointsB ? `${a} y ${b} tienen la misma proyección` : `${p.pointsA > p.pointsB ? a : b} tiene más proyección`
      return `${lead} esta semana: ${p.pointsA.toFixed(1)} a ${p.pointsB.toFixed(1)}, con puntuación estándar. Todavía no hay cifra con la puntuación de ninguna liga para ninguno de los dos.`
    }
    case 'none':
      return 'Todavía no hay nada que valorar para estos dos.'
  }
}

/** A row's note: its English as written, or Spanish from `noteParts`. */
export function compareNoteText(
  row: { note: string | null; noteParts: PlayerCompare['rows'][number]['noteParts'] },
  aName: string,
  bName: string,
  language: string,
): string | null {
  const p = row.noteParts
  if (language !== 'es' || !p) return row.note
  const [self, other] = p.side === 'a' ? [aName, bName] : [bName, aName]
  return p.kind === 'start' ? `Alinea a ${self} en lugar de ${other}` : `${self} es de @${p.ownerName} aquí`
}

/* ── The league picker ────────────────────────────────────────────────────────────────────────── */

export type PickerCopy = {
  leagues: string
  /** The button's count: every league, or some of them. */
  count: (chosen: number, total: number) => string
  /** The panel's foot: the same count, as a selection. */
  selected: (chosen: number, total: number) => string
  panelLabel: string
  filter: string
  all: string
  none: string
  save: string
  saving: string
  error: string
  note: string
}

const PICKER_EN: PickerCopy = {
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
}

const PICKER_ES: PickerCopy = {
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
}

export function pickerCopy(language: string): PickerCopy {
  return language === 'es' ? PICKER_ES : PICKER_EN
}

/* ── The league strip ─────────────────────────────────────────────────────────────────────────── */

/**
 * The strip's badges in Spanish. TITULAR and BANCA are the slot words the league table (`slotText`)
 * and the swap list (SwapCandidates) already use on this screen; IR and TAXI stay, as they do there.
 */
const BADGE_ES: Record<string, string> = { START: 'TITULAR', BENCH: 'BANCA', IR: 'IR', TAXI: 'TAXI', FA: 'LIBRE', Taken: 'Ocupado' }

/** A chip's badge and sentence: English as leagueStrip.ts wrote them, or Spanish from the chip's parts. */
export function stripChipText(c: StripChip, language: string): { badge: string; sentence: string } {
  if (language !== 'es') return { badge: c.badge, sentence: c.sentence }
  const { leagueName: l, last } = c
  switch (c.state) {
    case 'other':
      return { badge: c.team ?? BADGE_ES.Taken!, sentence: `${l}: ${c.team ? `${c.team} tiene a ${last}` : `otro mánager tiene a ${last}`}.` }
    case 'free':
      return { badge: BADGE_ES.FA!, sentence: `${l}: nadie tiene a ${last}; está disponible.` }
    case 'unknown':
      return { badge: '?', sentence: `${l}: no podemos leer las plantillas de esta liga, así que no sabemos dónde está ${last}.` }
    default: {
      const where = c.state === 'start' ? 'es titular' : c.state === 'bench' ? 'está en tu banca' : c.state === 'ir' ? 'está en tu IR' : 'está en tu taxi'
      const bestBall = c.bestBall ? ' (best ball: la plataforma fija la alineación)' : ''
      return { badge: BADGE_ES[c.badge] ?? c.badge, sentence: `${l}: ${last} ${where}${bestBall}.` }
    }
  }
}

export type StripCopy = {
  label: string
  summary: (yours: number, free: number, other: number) => string
  unreadable: (n: number) => string
}

const STRIP_EN: StripCopy = {
  label: 'Where he is in each of your leagues',
  summary: (y, f, o) => `Yours in ${y} · available in ${f} · elsewhere in ${o}`,
  unreadable: (n) => ` · can't read ${n}`,
}

const STRIP_ES: StripCopy = {
  label: 'Dónde está en cada una de tus ligas',
  summary: (y, f, o) => `Tuyo en ${y} · disponible en ${f} · con otro equipo en ${o}`,
  unreadable: (n) => ` · sin poder leer ${n}`,
}

export function stripCopy(language: string): StripCopy {
  return language === 'es' ? STRIP_ES : STRIP_EN
}

/* ── The sticky action bar (and the league card's buttons) ────────────────────────────────────── */

/** The slot a "Yours · …" status names; a position (TE, FLEX) stays as it is. */
const STATUS_SLOT_ES: Record<string, string> = { STARTER: 'titular', BENCH: 'banca', 'IR SLOT': 'IR', TAXI: 'taxi' }

/**
 * `leagueViewActions` in the reader's language — the context line and both buttons. Exported for the
 * league card (LeagueOwnershipCard), which renders the same actions: one rule, so one translation.
 * Each label is rebuilt from the view it was built from; one this does not recognise stays English.
 */
export function viewActionsText(view: PlayerLeagueView, actions: LeagueViewActions, playerName: string, language: string): LeagueViewActions {
  if (language !== 'es') return actions
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  const o = view.ownership
  const relabel = (a: ViewAction | null, label: (english: string) => string): ViewAction | null => (a ? { ...a, label: label(a.label) } : null)
  const handoff = (english: string) => handoffText(english, '', 'es').label

  if (o.kind === 'yours') {
    const slot = o.exactSlot ?? o.slot
    return { ...actions, primary: relabel(actions.primary, handoff), status: `Tuyo · ${STATUS_SLOT_ES[slot] ?? slot}` }
  }
  if (o.kind === 'other') {
    return {
      primary: relabel(actions.primary, (english) => (english === `Trade for ${last} →` ? finderCopy('es').tradeFor(last) : english)),
      secondary: relabel(actions.secondary, handoff),
      status: o.owner ? `De ${o.owner.teamName}` : 'De otro mánager',
    }
  }
  if (o.kind === 'free-agent') {
    return {
      ...actions,
      primary: relabel(actions.primary, (english) => {
        const m = /^Claim (.+) — on (.+)$/.exec(english)
        return m && m[1] === last ? `Reclamar a ${last} en ${m[2]}` : english
      }),
      status: 'Agente libre',
    }
  }
  return { ...actions, status: 'No se puede leer aquí' }
}

/* ── Available in your leagues (FreeAgentBids) ────────────────────────────────────────────────── */

export type FaCopy = {
  heading: (n: number) => string
  bid: (amount: number) => string
  ofBudget: (budget: number) => string
  left: (remaining: number) => string
  room: (median: number, p75: number, claims: number) => string
  claim: (last: string, platform: string) => string
  foot: string
}

const FA_EN: FaCopy = {
  heading: (n) => `Available in ${n} of your leagues`,
  bid: (amount) => `Bid ~$${amount}`,
  ofBudget: (budget) => ` of $${budget}`,
  left: (remaining) => ` · $${remaining} left`,
  room: (median, p75, claims) => `This league's winning bids: median $${median} · p75 $${p75} (${claims} ${claims === 1 ? 'claim' : 'claims'})`,
  claim: (last, platform) => `Claim ${last} in ${platform}`,
  foot:
    "The bid is his market value in each league's format against its budget, capped at 60% of it — the same number Waiver Intel uses. The league's winning bids sit beside it to calibrate against the room; they are not part of it.",
}

const FA_ES: FaCopy = {
  heading: (n) => `Disponible en ${n} de tus ligas`,
  bid: (amount) => `Puja ~$${amount}`,
  ofBudget: (budget) => ` de $${budget}`,
  left: (remaining) => ` · quedan $${remaining}`,
  room: (median, p75, claims) => `Pujas ganadoras de esta liga: mediana $${median} · p75 $${p75} (${claims} ${claims === 1 ? 'reclamo' : 'reclamos'})`,
  claim: (last, platform) => `Reclamar a ${last} en ${platform}`,
  foot:
    'La puja es su valor de mercado en el formato de cada liga frente a su presupuesto, con un tope del 60% del presupuesto: el mismo número que usa Waiver Intel. Las pujas ganadoras de la liga aparecen al lado para comparar con lo que paga el resto; no entran en la puja.',
}

export function faCopy(language: string): FaCopy {
  return language === 'es' ? FA_ES : FA_EN
}

/** The notes lib/core-app/freeAgentBids.ts writes, verbatim. */
const FA_NOTE_ES: Record<string, string> = {
  'no market value to price him': 'no hay valor de mercado para ponerle precio',
  'this league’s waiver settings are not on file': 'los ajustes de reclamos de esta liga no están registrados',
  'waiver-priority league — no FAAB bid': 'liga con prioridad de reclamo: sin puja FAAB',
  'no market value to price him in this format': 'no hay valor de mercado para ponerle precio en este formato',
  'the value chart is still syncing': 'la tabla de valores todavía se está sincronizando',
}

/** Every note `faNoteText` translates whole — exported so a test can hold each to the loader's source. */
export const FA_NOTE_KEYS: readonly string[] = Object.keys(FA_NOTE_ES)

/** A row's note in the reader's language; one this does not know stays whole English. */
export function faNoteText(note: string, language: string): string {
  if (language !== 'es') return note
  const exact = FA_NOTE_ES[note]
  if (exact != null) return exact
  // freeAgentBids.ts: `bids are shown for ${BID_LEAGUE_CAP} leagues at a time`
  const cap = /^bids are shown for (\d+) leagues at a time$/.exec(note)
  return cap ? `las pujas se muestran para ${cap[1]} ligas a la vez` : note
}
