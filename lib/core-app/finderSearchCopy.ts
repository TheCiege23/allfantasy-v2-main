import { handoffText } from './homeBandsCopy'
import type { LeagueViewActions, ViewAction } from './leagueViewActions'
import type { StripChip } from './leagueStrip'
import type { PlayerCompare } from './playerCompare'
import type { PlayerLeagueView } from './playerLeagueView'
import { finderCopy } from './playerFinderCopy'
import type { SuggestionFact } from './suggestionChip'
import { messagesFor } from '@/lib/i18n/messages'
import {
  finderCompareMessages,
  finderFaMessages,
  finderPickerMessages,
  finderSearchBoxMessages,
  finderSearchMessages,
  finderStripMessages,
} from './messages/finderSearch'

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

/* ── Labels more than one Player Finder card prints — ONE translator each (2026-10-06) ─────────── */

/**
 * "Claim Kincaid in Sleeper" / «Reclamar a Kincaid en Sleeper» — the FA bids row, the depth chart's
 * free backup (finderPlayerInfoCopy.ts `dcClaim`) and, in Spanish, the league card and sticky bar's
 * claim button (`viewActionsText`, whose English is leagueViewActions.ts's own "Claim X — on Y").
 */
export function claimText(last: string, platform: string, language: string): string {
  return messagesFor(finderSearchMessages, language).claim(last, platform)
}

/** "Taken" — the league strip's badge and the depth chart's chip for a player another team holds. */
export function takenText(language: string): string {
  return messagesFor(finderSearchMessages, language).taken
}

/** "Free agent" — the sticky bar's status and the shares board's holder (finderTradeValueCopy.ts). */
export function freeAgentText(language: string): string {
  return messagesFor(finderSearchMessages, language).freeAgent
}

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

export function searchBoxCopy(language: string): SearchBoxCopy {
  return messagesFor(finderSearchBoxMessages, language)
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

export function compareCopy(language: string): CompareCopy {
  return messagesFor(finderCompareMessages, language)
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

export function pickerCopy(language: string): PickerCopy {
  return messagesFor(finderPickerMessages, language)
}

/* ── The league strip ─────────────────────────────────────────────────────────────────────────── */

/**
 * The strip's badges in Spanish. TITULAR and BANCA are the slot words the league table (`slotText`)
 * and the swap list (SwapCandidates) already use on this screen; IR and TAXI stay, as they do there.
 */
const BADGE_ES: Record<string, string> = { START: 'TITULAR', BENCH: 'BANCA', IR: 'IR', TAXI: 'TAXI', FA: 'LIBRE', Taken: takenText('es') }

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
  /** The folded strip (LeagueStrip.tsx FOLD_AFTER): one toggle per group that is not yours. */
  foldLabel: string
  foldFree: (n: number) => string
  foldOther: (n: number) => string
  foldUnknown: (n: number) => string
  noneYours: string
}

export function stripCopy(language: string): StripCopy {
  return messagesFor(finderStripMessages, language)
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
        return m && m[1] === last ? claimText(last, m[2]!, 'es') : english
      }),
      status: freeAgentText('es'),
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

export function faCopy(language: string): FaCopy {
  return messagesFor(finderFaMessages, language)
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
