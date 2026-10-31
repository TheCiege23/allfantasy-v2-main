/**
 * Real-game challenges: the pure half. Which real game a week features, what a stored final says,
 * who won, and the words a league reads (English or Spanish). No I/O — the DB half is
 * `survivorRealGameChallenges.ts`.
 *
 * ── The rules, in one place ─────────────────────────────────────────────────────────────────────
 *
 * PICK THE WINNER ONLY. No spread, no total, no line of any kind: there is no line we could derive
 * without an external odds feed, and inventing one would be a betting line we made up.
 *
 * THE RESULT IS A STORED FINAL. `SportsGame` keeps one row per provider per fixture, and providers
 * disagree — measured 2026-10-15, one stored Nuggets at Clippers with home and away swapped
 * (lib/social-newsroom/scoreCheck.ts). So every final row is mapped to TEAM → score through the
 * team resolver (never by home/away column), and the challenge settles only when:
 *   - two providers report the same final, or
 *   - one provider does and the game started at least `SINGLE_SOURCE_GRACE_MS` ago (time for a
 *     second feed to disagree), and
 *   - no final row disagrees. A disagreement holds the challenge; three days of it voids it.
 * Never before a final: a live 21–7 is not a result.
 *
 * VOID PAYS NOTHING. Cancelled, postponed for a day, or still no final three days after the start:
 * the challenge closes void, no pick is right or wrong, and no prize is paid.
 *
 * A TIE PAYS NOTHING. Nobody picked "tie" (it is not an option), so nobody called it.
 *
 * TRIBE RULE (before the merge). Every castaway picks for themself. A correct pick counts toward
 * their tribe; the tribe with the best SHARE of its members correct (correct ÷ members, so a big
 * tribe gains nothing from size and a castaway who skips the pick costs their tribe) wins, and every
 * member of a winning tribe gets the prize. Equal shares all win; a tribe with no correct pick never
 * does. After the merge it is individual: everyone who called it wins the prize.
 */

import { normalizeGameStatus } from '@/lib/sports/gameStatus'

export const REAL_GAME_PICK_TYPE = 'real_game_pick'
/** Challenge numbers 1–2 are the verified slate and 3 the weekly call; real games take 4 and 5. */
export const REAL_GAME_CHALLENGE_NUMBERS = [4, 5] as const
export const REAL_GAME_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const

const HOUR_MS = 3_600_000
/** Rows for the same two teams this close together are one fixture (provider kickoff drift). */
const SAME_FIXTURE_MS = 3 * HOUR_MS
/** A game starting sooner than this is not offered: nobody would have time to pick. */
export const MIN_PICK_LEAD_MS = HOUR_MS
/** One provider's final, uncontradicted this long after the start, is accepted on its own. */
export const SINGLE_SOURCE_GRACE_MS = 12 * HOUR_MS
/** A game still postponed (or suspended) this long after its start is void. */
export const POSTPONED_VOID_MS = 24 * HOUR_MS
/** No agreed final this long after the start: void, never a guess. */
export const NO_RESULT_VOID_MS = 72 * HOUR_MS

export type RealGameLang = 'en' | 'es'
export const realGameLang = (language: string | null | undefined): RealGameLang =>
  (String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en')

export type TeamResolver = (name: string) => string | null

export type RealGameRow = {
  source: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  fetchedAt?: Date | null
}

export type RealGameFixture = {
  key: string
  homeAbbr: string
  awayAbbr: string
  homeLabel: string
  awayLabel: string
  /** The EARLIEST start any provider reports, so a pick locks early rather than late. */
  kickoff: Date
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

/**
 * One fixture per real game. Rows whose teams do not both resolve, or resolve to one team, are
 * dropped (a game we cannot name cannot be settled). The label comes from the most-preferred
 * provider in `sourcePreference`.
 */
export function groupFixtures(rows: readonly RealGameRow[], resolve: TeamResolver, sourcePreference: readonly string[]): RealGameFixture[] {
  const rank = (source: string) => { const i = sourcePreference.indexOf(source); return i < 0 ? sourcePreference.length : i }
  const groups: Array<{ pair: string; kickoff: Date; best: { row: RealGameRow; home: string; away: string } }> = []
  for (const row of rows) {
    if (!row.startTime || Number.isNaN(row.startTime.getTime())) continue
    const home = resolve(row.homeTeam)
    const away = resolve(row.awayTeam)
    if (!home || !away || home === away) continue
    const pair = pairKey(home, away)
    const group = groups.find(g => g.pair === pair && Math.abs(g.kickoff.getTime() - row.startTime!.getTime()) <= SAME_FIXTURE_MS)
    if (!group) { groups.push({ pair, kickoff: row.startTime, best: { row, home, away } }); continue }
    if (row.startTime.getTime() < group.kickoff.getTime()) group.kickoff = row.startTime
    if (rank(row.source) < rank(group.best.row.source)) group.best = { row, home, away }
  }
  return groups.map(g => ({
    key: `${g.pair}@${g.kickoff.toISOString()}`,
    homeAbbr: g.best.home,
    awayAbbr: g.best.away,
    homeLabel: g.best.row.homeTeam,
    awayLabel: g.best.row.awayTeam,
    kickoff: g.kickoff,
  }))
}

/**
 * The featured games: most of the league's rostered players first (both teams counted), then the
 * earlier kickoff, then the fixture key — so the same inputs always give the same games. Only games
 * at least `MIN_PICK_LEAD_MS` away are offered. The first always runs; the second only when it has a
 * rostered player in it.
 */
export function selectFeaturedFixtures(
  fixtures: readonly RealGameFixture[],
  rosteredByTeam: ReadonlyMap<string, number>,
  now: Date,
  max = REAL_GAME_CHALLENGE_NUMBERS.length,
): Array<RealGameFixture & { rostered: number }> {
  const scored = fixtures
    .filter(f => f.kickoff.getTime() - now.getTime() >= MIN_PICK_LEAD_MS)
    .map(f => ({ ...f, rostered: (rosteredByTeam.get(f.homeAbbr) ?? 0) + (rosteredByTeam.get(f.awayAbbr) ?? 0) }))
    .sort((a, b) => b.rostered - a.rostered || a.kickoff.getTime() - b.kickoff.getTime() || a.key.localeCompare(b.key))
  return scored.slice(0, Math.max(0, max)).filter((f, i) => i === 0 || f.rostered > 0)
}

export type RealGameOutcome =
  | { state: 'pending'; reason: 'not_final' | 'awaiting_second_source' | 'conflicting_results' }
  | { state: 'final'; winnerAbbr: string | null; scores: Record<string, number>; sources: string[] }
  | { state: 'void'; reason: 'cancelled' | 'postponed' | 'no_final_result' | 'conflicting_results' }

/** What the stored rows of one fixture say right now. `rows` may include other games; they are ignored. */
export function classifyFixtureResult(
  fixture: Pick<RealGameFixture, 'homeAbbr' | 'awayAbbr' | 'kickoff'>,
  rows: readonly RealGameRow[],
  resolve: TeamResolver,
  now: Date,
): RealGameOutcome {
  const pair = pairKey(fixture.homeAbbr, fixture.awayAbbr)
  const elapsed = now.getTime() - fixture.kickoff.getTime()
  const mine = rows
    .map(row => ({ row, home: resolve(row.homeTeam), away: resolve(row.awayTeam) }))
    .filter(r => r.home && r.away && r.home !== r.away && pairKey(r.home, r.away) === pair)

  const finals = mine.filter(r => normalizeGameStatus(r.row.status) === 'final' && r.row.homeScore != null && r.row.awayScore != null)
  if (finals.length) {
    const first = finals[0]!
    const scores: Record<string, number> = { [first.home!]: first.row.homeScore!, [first.away!]: first.row.awayScore! }
    const agree = finals.every(r => scores[r.home!] === r.row.homeScore && scores[r.away!] === r.row.awayScore)
    if (!agree) return elapsed >= NO_RESULT_VOID_MS ? { state: 'void', reason: 'conflicting_results' } : { state: 'pending', reason: 'conflicting_results' }
    const sources = [...new Set(finals.map(r => r.row.source))].sort()
    if (sources.length < 2 && elapsed < SINGLE_SOURCE_GRACE_MS) return { state: 'pending', reason: 'awaiting_second_source' }
    const a = scores[fixture.homeAbbr]!
    const b = scores[fixture.awayAbbr]!
    return { state: 'final', winnerAbbr: a === b ? null : a > b ? fixture.homeAbbr : fixture.awayAbbr, scores, sources }
  }

  // No final anywhere. The freshest row speaks for the game's status.
  const freshest = [...mine].sort((x, y) => (y.row.fetchedAt?.getTime() ?? 0) - (x.row.fetchedAt?.getTime() ?? 0))[0]
  const status = freshest ? normalizeGameStatus(freshest.row.status) : 'unknown'
  if (status === 'cancelled' && elapsed >= 0) return { state: 'void', reason: 'cancelled' }
  if (status === 'postponed' && elapsed >= POSTPONED_VOID_MS) return { state: 'void', reason: 'postponed' }
  if (elapsed >= NO_RESULT_VOID_MS) return { state: 'void', reason: 'no_final_result' }
  return { state: 'pending', reason: 'not_final' }
}

export type TribeSnapshot = { id: string; name: string; memberUserIds: string[] }
export type RealGamePick = { userId: string; optionId: string }

export type RealGameSettlement = {
  correctUserIds: string[]
  winnerTribeIds: string[]
  /** Who is paid: active castaways only. */
  prizeUserIds: string[]
  tribeTally: Array<{ tribeId: string; correct: number; members: number }>
}

/** Who called it, which tribe won (before the merge) and who is paid. See the tribe rule above. */
export function settleRealGamePicks(input: {
  answerAbbr: string | null
  picks: readonly RealGamePick[]
  tribes: readonly TribeSnapshot[] | null
  activeUserIds: ReadonlySet<string>
}): RealGameSettlement {
  const correctUserIds = input.answerAbbr ? input.picks.filter(p => p.optionId === input.answerAbbr).map(p => p.userId).sort() : []
  const correct = new Set(correctUserIds)
  if (!input.tribes || input.tribes.length === 0) {
    return { correctUserIds, winnerTribeIds: [], prizeUserIds: correctUserIds.filter(id => input.activeUserIds.has(id)), tribeTally: [] }
  }
  const tribeTally = input.tribes.map(t => ({ tribeId: t.id, correct: t.memberUserIds.filter(id => correct.has(id)).length, members: t.memberUserIds.length }))
  // Compare shares exactly (a/b vs c/d by cross-multiplication), never as rounded floats.
  let best: { correct: number; members: number } | null = null
  for (const row of tribeTally) {
    if (row.correct === 0 || row.members === 0) continue
    if (!best || row.correct * best.members > best.correct * row.members) best = row
  }
  const winnerTribeIds = best
    ? tribeTally.filter(row => row.correct > 0 && row.correct * best!.members === best!.correct * row.members).map(row => row.tribeId).sort()
    : []
  const winners = new Set(winnerTribeIds)
  const prizeUserIds = [...new Set(input.tribes.filter(t => winners.has(t.id)).flatMap(t => t.memberUserIds))]
    .filter(id => input.activeUserIds.has(id)).sort()
  return { correctUserIds, winnerTribeIds, prizeUserIds, tribeTally }
}

// ── Prizes ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The prizes a real-game challenge may pay, and why the list is this short.
 *
 * Prizes go through `applyChallengeRewards` (SurvivorEffectEngine). Of the reward types it knows:
 *   - `faab`: credits real waiver budget (`RedraftRoster.faabBalance`). It never touches a ballot,
 *     an immunity or a tie-break — the only reward with no reach into a council. ALLOWED, default.
 *   - `immunity` / `voting_safety`: sets `hasImmunityThisWeek`, taking a manager off the ballot. A
 *     coin-flip game result deciding who can be voted out, possibly settled after the council has
 *     opened, breaks the council. EXCLUDED.
 *   - `tribe_immunity`: keeps a tribe out of council for the week. Same problem. EXCLUDED.
 *   - `advantage`: mints an idol (extra vote by default) — a vote changer. EXCLUDED.
 *   - `score_boost`: adds to the season points the legacy vote tie-break and the finale read
 *     (`getSeasonPointsFromRosterPerformance`), keyed by a LEGACY `Roster.id` — the id this path
 *     does not have (castaways carry a `redraftRosterId`). It would either reach a tie-break or do
 *     nothing. EXCLUDED until it is keyed on the castaway's roster.
 * `none` (bragging rights) is the other allowed setting.
 */
export const REAL_GAME_ALLOWED_PRIZES = ['faab', 'none'] as const
export type RealGamePrizeType = (typeof REAL_GAME_ALLOWED_PRIZES)[number]
export type RealGamePrize = { type: RealGamePrizeType; amount: number }
export const REAL_GAME_DEFAULT_PRIZE: RealGamePrize = { type: 'faab', amount: 5 }
const MAX_FAAB_PRIZE = 25

export type RealGameSettings = { enabled: boolean; prize: RealGamePrize }

/**
 * The commissioner's choice, read from `League.settings.survivorRealGameChallenges`:
 * `{ enabled?: boolean, prizeType?: 'faab' | 'none', faabAmount?: number }`. Anything else —
 * including a prize type that is not allowed — falls back to the default ($5 FAAB). The amount is a
 * whole number from 1 to 25.
 */
export function readRealGameSettings(leagueSettings: unknown): RealGameSettings {
  const root = leagueSettings && typeof leagueSettings === 'object' && !Array.isArray(leagueSettings) ? (leagueSettings as Record<string, unknown>) : {}
  const raw = root.survivorRealGameChallenges
  const block = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const enabled = block.enabled !== false
  const type = (REAL_GAME_ALLOWED_PRIZES as readonly string[]).includes(String(block.prizeType)) ? (block.prizeType as RealGamePrizeType) : REAL_GAME_DEFAULT_PRIZE.type
  if (type === 'none') return { enabled, prize: { type, amount: 0 } }
  const n = typeof block.faabAmount === 'number' && Number.isFinite(block.faabAmount) ? Math.round(block.faabAmount) : REAL_GAME_DEFAULT_PRIZE.amount
  return { enabled, prize: { type, amount: Math.min(MAX_FAAB_PRIZE, Math.max(1, n)) } }
}

// ── Words ─────────────────────────────────────────────────────────────────────────────────────────

export function prizeLabel(prize: RealGamePrize, lang: RealGameLang): string {
  if (prize.type === 'faab' && prize.amount > 0) return lang === 'es' ? `${prize.amount} $ de FAAB` : `$${prize.amount} FAAB`
  return lang === 'es' ? 'el orgullo' : 'bragging rights'
}

export function realGameChallengeCopy(input: { lang: RealGameLang; sport: string; homeLabel: string; awayLabel: string; tribeScope: boolean; prize: RealGamePrize }) {
  const { lang, sport, homeLabel, awayLabel, tribeScope } = input
  const prize = prizeLabel(input.prize, lang)
  if (lang === 'es') {
    return {
      title: `¿Quién gana: ${awayLabel} vs. ${homeLabel}?`,
      description: tribeScope
        ? `Elige al ganador de este partido real de ${sport}. Cada acierto cuenta para tu tribu; la tribu con mayor proporción de aciertos gana ${prize} para cada miembro.`
        : `Elige al ganador de este partido real de ${sport}. Todos los que acierten ganan ${prize}.`,
      instructions: 'Las elecciones se cierran al inicio del partido. Se resuelve con el marcador final; un partido aplazado o cancelado se anula y no da premio.',
    }
  }
  return {
    title: `Who wins: ${awayLabel} vs. ${homeLabel}?`,
    description: tribeScope
      ? `Pick the winner of this real ${sport} game. Every correct pick counts for your tribe; the tribe with the best share of correct picks wins ${prize} for every member.`
      : `Pick the winner of this real ${sport} game. Everyone who calls it wins ${prize}.`,
    instructions: 'Picks lock at kickoff. It settles from the final score; a postponed or cancelled game is void and pays nothing.',
  }
}

export function realGameResultSummary(input: {
  lang: RealGameLang
  outcome: Exclude<RealGameOutcome, { state: 'pending' }>
  labels: Record<string, string>
  pickCount: number
  correctCount: number
  paidCount: number
  winnerTribeNames: string[]
  prize: RealGamePrize
}): string {
  const { lang, outcome } = input
  const es = lang === 'es'
  if (outcome.state === 'void') {
    const why = outcome.reason === 'cancelled' ? (es ? 'El partido fue cancelado' : 'The game was cancelled')
      : outcome.reason === 'postponed' ? (es ? 'El partido fue aplazado' : 'The game was postponed')
        : es ? 'No se registró un marcador final verificado' : 'No verified final score was recorded'
    return es ? `${why}: este reto se anula y no da premio.` : `${why}: this challenge is void and pays nothing.`
  }
  const values = Object.values(outcome.scores)
  if (!outcome.winnerAbbr) {
    const s = values[0] ?? 0
    return es ? `El partido terminó empatado ${s}-${s}: sin ganador ni premio.` : `The game ended in a ${s}-${s} tie: no winner, no prize.`
  }
  const w = outcome.scores[outcome.winnerAbbr] ?? 0
  const l = Object.entries(outcome.scores).find(([abbr]) => abbr !== outcome.winnerAbbr)?.[1] ?? 0
  const name = input.labels[outcome.winnerAbbr] ?? outcome.winnerAbbr
  const head = es
    ? `Ganó ${name} ${w}-${l}. ${input.correctCount} de ${input.pickCount} acertaron.`
    : `${name} won ${w}-${l}. ${input.correctCount} of ${input.pickCount} called it.`
  const tribes = input.winnerTribeNames.length
    ? (es ? ` Tribu ganadora: ${input.winnerTribeNames.join(', ')}.` : ` Winning tribe: ${input.winnerTribeNames.join(', ')}.`)
    : ''
  if (input.prize.type === 'none' || input.paidCount === 0) return head + tribes
  const prize = prizeLabel(input.prize, lang)
  const paid = es
    ? ` ${input.paidCount} ${input.paidCount === 1 ? 'náufrago gana' : 'náufragos ganan'} ${prize}.`
    : ` ${input.paidCount} castaway${input.paidCount === 1 ? '' : 's'} earn${input.paidCount === 1 ? 's' : ''} ${prize}.`
  return head + tribes + paid
}
