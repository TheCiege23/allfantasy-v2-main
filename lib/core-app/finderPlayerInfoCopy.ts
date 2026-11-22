import { kickoffText } from './kickoffText'
import { designationText, reasonText } from './playerFinderCopy'
import type { SeasonSummary } from './playerSeason'
import { messagesFor } from '@/lib/i18n/messages'
import { finderPlayerInfoMessages, type PlayerInfoMessages } from './messages/finderPlayerInfo'

/**
 * Player Finder's player-info cards in the reader's language (2026-10-05): the live game badge, the
 * injury timeline chip, "Next man up" (the depth chart), "Who'd start him", "This season" and "News"
 * — components/core-app/player-finder/{LiveGameBadge, InjuryTimelineChip, DepthChartBackups,
 * WhoStartsHim, PlayerSeasonCard, PlayerNews}.tsx.
 *
 * The words live in one catalog behind this type (messages/finderPlayerInfo.ts), as playerFinderCopy.ts
 * does for the screen. The EN is
 * each component's English byte for byte — the player-finder-* suites pin it — so English mode is
 * unchanged.
 *
 * Shared translators are reused, never copied: "Claim X in Y" and "Taken" are finderSearchCopy's
 * (`claimText`, `takenText`), the PROJ column is playerFinderCopy's, designations through `designationText` (singular — a
 * player is «Inactivo», not the column heading «Inactivos»), month-day dates and the news weekday
 * through `kickoffText`, relative ages through shellCopy's `ageText`, "Live" / "Final" / "Week" /
 * "Trade Center" through `coreUiCopy`, and an unknown reason through playerFinderCopy's `reasonText`.
 *
 * ⚠ WHAT STAYS AS THE FEED WROTE IT: news headlines (including the injury feed's per-player sentences
 * the news list merges in), player, team and league names, NFL club codes, the opponent column and
 * the platform names. Only the app's own words around them are translated.
 *
 * ⚠ THE LOADERS ARE NOT CHANGED. Their English is translated at render: whole sentences keyed
 * verbatim on what playerDepth.ts, playerCard.ts and whoStartsHimLoader.ts write (`infoReasonText`,
 * each key held to its source by __tests__/finder-player-info-spanish.test.tsx), the season headline
 * rebuilt from the summary's numbers, and the depth chart's "yours" detail from its closed vocabulary
 * (depthChart.ts `YOURS`). Anything unknown stays whole English, never half.
 *
 * PURE, client-safe.
 */

export type PlayerInfoCopy = {
  // ── LiveGameBadge ─────────────────────────────────────────────────────────
  live: string
  final: string
  week: (week: number) => string
  liveStarting: string
  liveBench: string
  liveFinal: string
  liveUpdated: (ago: string) => string
  liveNone: string
  // ── InjuryTimelineChip ────────────────────────────────────────────────────
  /** "↑ from Out" — the arrow is passed in. */
  tlFrom: (arrow: string, status: string) => string
  tlWas: (trend: 'up' | 'down' | null, status: string, date: string) => string
  tlReturnShort: (date: string) => string
  tlReturnSentence: (date: string) => string
  // ── DepthChartBackups ─────────────────────────────────────────────────────
  dcHeading: (team: string, slot: string) => string
  dcSlot: (slot: string) => string
  dcYours: string
  dcFree: string
  dcTaken: string
  dcTakenIn: (n: number) => string
  dcCantRead: string
  /** A backup's slot in one of YOUR leagues (depthChart.ts `YOURS`, or "rostered"). */
  dcDetail: (detail: string) => string
  dcClaim: (last: string, platform: string) => string
  dcDepthAria: (depth: number) => string
  dcThisPlayer: string
  dcWhoPlays: (him: string) => string
  dcHisNumber: (him: string, depth: number) => string
  dcAsOf: (date: string) => string
  // ── WhoStartsHim ──────────────────────────────────────────────────────────
  wsHeading: (last: string) => string
  /** The CoreDepthLock subject, in the same language as the lock (coreDepthLockCopy.ts). */
  wsLockWhat: (last: string) => string
  wsNoTeam: string
  wsWouldStart: (n: number, of: number) => string
  wsOver: (slot: string, name: string) => string
  wsEmptySlot: (slot: string) => string
  wsMore: (n: number) => string
  wsOpenTradeCenter: string
  wsFoot: string
  wsTeamName: (name: string) => string
  // ── PlayerSeasonCard ──────────────────────────────────────────────────────
  thisSeason: string
  thisSeasonOf: (season: number) => string
  scoringPpr: string
  scoringLeague: (leagueName: string) => string
  points: string
  perGame: string
  games: string
  best: string
  bestValue: (points: string, week: number) => string
  chartAria: (name: string, weeks: string[]) => string
  chartWeek: (week: number, actual: string | null, projected: string | null) => string
  scored: string
  projected: string
  headline: (summary: SeasonSummary) => string | null
  colWeek: string
  colOpp: string
  colProj: string
  colScored: string
  noStats: string
  // ── PlayerNews ────────────────────────────────────────────────────────────
  news: string
  /** The label for a NewsAPI-sourced item ("News"). */
  newsFeed: string
  /** newsWhen's output ("just now", "12 min ago", "3h ago", "Sun, 10/25"). */
  newsWhen: (when: string) => string
}

const built = new WeakMap<PlayerInfoMessages, PlayerInfoCopy>()

export function finderPlayerInfoCopy(language: string): PlayerInfoCopy {
  const m = messagesFor(finderPlayerInfoMessages, language)
  let out = built.get(m)
  if (!out) built.set(m, (out = { ...m, headline: (s) => m.headline(s) || null }))
  return out
}

/** A designation ("Out", "Questionable") as one player's chip reads it — `designationText`, singular. */
export function infoDesignationText(status: string, language: string): string {
  return designationText(status, language)
}

/** "Oct 5" — the en-US month-day these cards format — in the reader's language ("5 oct"). */
export function infoDateText(monthDay: string, language: string): string {
  return kickoffText(monthDay, language)
}

/**
 * The loaders' reasons and notes these cards print, verbatim. Every key is a sentence a loader
 * writes today; a test holds each one to its source file.
 */
const REASON_ES: Record<string, string> = {
  // lib/core-app/playerDepth.ts — the season card
  'No weekly projections or stat lines on file for this player.': 'No hay proyecciones semanales ni estadísticas registradas para este jugador.',
  // lib/core-app/playerDepth.ts and playerCard.ts `loadNews` — the news list
  'News could not be read.': 'No se pudieron leer las noticias.',
  'No recent item mentions this player.': 'Ninguna noticia reciente menciona a este jugador.',
  // lib/core-app/whoStartsHimLoader.ts — why a league is not ranked
  'this league could not be read just now': 'no se pudo leer esta liga en este momento',
  'other teams’ rosters in this league use the platform’s own player ids, so we can’t read them yet':
    'las plantillas de los otros equipos de esta liga usan los ids de jugador propios de la plataforma, así que todavía no podemos leerlas',
  'we couldn’t find your team in this league': 'no encontramos tu equipo en esta liga',
  'no other teams are on file': 'no hay otros equipos registrados',
  'this league’s lineup is not on file': 'la alineación de esta liga no está registrada',
  'he has no market value in this league’s format': 'no tiene valor de mercado en el formato de esta liga',
  'too few players on the other rosters have a market value to compare':
    'muy pocos jugadores de las otras plantillas tienen valor de mercado para comparar',
}

const REASON_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // whoStartsHimLoader.ts — a lineup with slots the engine does not model
  [/^lineup slot (\S+) isn’t modelled$/, (m) => `el puesto de alineación ${m[1]} no está modelado`],
  [/^lineup slots (.+) aren’t modelled$/, (m) => `los puestos de alineación ${m[1]} no están modelados`],
]

/** Every loader sentence `infoReasonText` translates whole — exported so a test can hold each to its source. */
export const INFO_REASON_KEYS: readonly string[] = Object.keys(REASON_ES)

/** A loader's reason or note in the reader's language; an unknown one goes to `reasonText`, then stays English. */
export function infoReasonText(reason: string, language: string): string {
  if (language !== 'es') return reason
  const exact = REASON_ES[reason]
  if (exact != null) return exact
  for (const [pattern, build] of REASON_PATTERNS_ES) {
    const m = reason.match(pattern)
    if (m) return build(m)
  }
  return reasonText(reason, language)
}
