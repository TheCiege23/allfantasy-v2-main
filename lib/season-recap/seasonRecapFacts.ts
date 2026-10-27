/**
 * The facts a season recap narrative may use, the deterministic recap written from them, and the guard
 * that decides whether a model-written recap is still those facts. PURE — no I/O.
 *
 * ⚠ THE FACTS ARE THE WHOLE UNIVERSE. The narrative (./seasonRecapAi.ts) is handed this list and nothing
 * else: no roster, no player pool, no league chat. A sentence that needs anything outside it cannot be
 * written, and `validateSeasonRecapNarrative` refuses one that tries:
 *
 *   - every team and player name must be wrapped as [[Name]] and be a name in the facts, exactly;
 *   - no other capitalised word may appear mid-sentence (that is the shape of an invented name);
 *   - every number must be a fact's value (Storyline Studio's `validateHookRewrite`, which also refuses
 *     invented / certain-outcome claims, personal attacks and profanity);
 *   - Spanish output may not say «waiver» — the app's Spanish for a claim is «reclamo».
 *
 * A refused narrative is never shown; the caller falls back to `deterministicSeasonRecapText`, which is
 * written from the same facts and passes the same guard (pinned by a test).
 *
 * Numbers are rounded to one decimal HERE, before anyone sees them, so the model, the template and the
 * guard all read the same "132.5" rather than three renderings of 132.46.
 */
import { createHash } from 'node:crypto'
import { validateHookRewrite, type StoryFactGuardResult } from '@/lib/league-story-creator/StoryFactGuard'
import type { SeasonRecap, RecapGameAward, TeamRef } from './computeSeasonRecap'

export type RecapLanguage = 'en' | 'es'
export type RecapFact = { key: string; value: string | number }

export type SeasonRecapFacts = {
  season: number
  facts: RecapFact[]
  /** Every team and player name the narrative may mention. */
  names: string[]
}

/** Bump when the facts' shape changes: a cached narrative over the old shape is then stale. */
export const SEASON_RECAP_FACTS_VERSION = 1

const r1 = (n: number) => Math.round(n * 10) / 10
/** The one rendering of a number used by the template, the prompt and the guard. */
export const fmt = (n: number) => {
  const r = r1(n)
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export function buildSeasonRecapFacts(recap: SeasonRecap): SeasonRecapFacts {
  const facts: RecapFact[] = []
  const names = new Set<string>()
  const num = (key: string, n: number | null | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n)) facts.push({ key, value: r1(n) })
  }
  const team = (key: string, t: TeamRef | null | undefined) => {
    if (!t?.name?.trim()) return
    facts.push({ key, value: t.name.trim() })
    names.add(t.name.trim())
  }
  const game = (prefix: string, g: RecapGameAward | null) => {
    if (!g) return
    team(`${prefix}.winner`, g.winner)
    team(`${prefix}.loser`, g.loser)
    num(`${prefix}.winnerScore`, g.winnerScore)
    num(`${prefix}.loserScore`, g.loserScore)
    num(`${prefix}.margin`, g.margin)
    num(`${prefix}.week`, g.week)
  }

  num('season', recap.season)
  num('teamCount', recap.teamLines.length)
  num('tradeCount', recap.tradeCount)
  team('champion', recap.champion)
  team('runnerUp', recap.runnerUp)
  if (recap.topSeed) {
    team('topSeed', recap.topSeed)
    num('topSeed.seed', 1)
    num('topSeed.wins', recap.topSeed.wins)
    num('topSeed.losses', recap.topSeed.losses)
    if (recap.topSeed.ties) num('topSeed.ties', recap.topSeed.ties)
  }
  if (recap.mostPointsFor) {
    team('mostPointsFor', recap.mostPointsFor)
    num('mostPointsFor.points', recap.mostPointsFor.points)
  }
  if (recap.highestWeek) {
    team('highestWeek', recap.highestWeek)
    num('highestWeek.points', recap.highestWeek.points)
    num('highestWeek.week', recap.highestWeek.week)
  }
  game('biggestBlowout', recap.biggestBlowout)
  game('closestGame', recap.closestGame)
  if (recap.bestTrade) {
    team('bestTrade', recap.bestTrade)
    team('bestTrade.partner', recap.bestTrade.partner)
    num('bestTrade.netGain', Math.round(Math.abs(recap.bestTrade.net)))
  }
  if (recap.worstTrade) {
    team('worstTrade', recap.worstTrade)
    team('worstTrade.partner', recap.worstTrade.partner)
    // Stored as the size of the loss: a "-12" would read as "12" to the guard and be refused.
    num('worstTrade.netLoss', Math.round(Math.abs(recap.worstTrade.net)))
  }
  if (recap.bestPickup) {
    team('bestPickup', recap.bestPickup)
    const player = recap.bestPickup.playerName?.trim()
    if (player) {
      facts.push({ key: 'bestPickup.player', value: player })
      names.add(player)
    }
    if (recap.bestPickup.position) facts.push({ key: 'bestPickup.position', value: recap.bestPickup.position })
    num('bestPickup.week', recap.bestPickup.pickupWeek)
    num('bestPickup.points', recap.bestPickup.pointsAfter)
  }
  if (recap.mostImproved) {
    team('mostImproved', recap.mostImproved)
    facts.push({ key: 'mostImproved.basis', value: recap.mostImproved.basis })
    if (recap.mostImproved.basis === 'prior_season') {
      num('mostImproved.winPctBefore', Math.round(recap.mostImproved.before * 100))
      num('mostImproved.winPctAfter', Math.round(recap.mostImproved.after * 100))
    } else {
      num('mostImproved.pointsPerWeekBefore', recap.mostImproved.before)
      num('mostImproved.pointsPerWeekAfter', recap.mostImproved.after)
    }
  }
  if (recap.lowerBracket) {
    facts.push({ key: 'lowerBracket.mode', value: recap.lowerBracket.mode })
    team('lowerBracket.winner', recap.lowerBracket.winner)
    team('lowerBracket.loser', recap.lowerBracket.loser)
  }
  for (const line of recap.teamLines) {
    const p = `standings.${line.rank}`
    team(`${p}.name`, line.team)
    num(`${p}.rank`, line.rank)
    num(`${p}.wins`, line.wins)
    num(`${p}.losses`, line.losses)
    if (line.ties) num(`${p}.ties`, line.ties)
    num(`${p}.pointsFor`, line.pointsFor)
    num(`${p}.pointsAgainst`, line.pointsAgainst)
    num(`${p}.longestWinStreak`, line.longestWinStreak)
    facts.push({ key: `${p}.finish`, value: line.finish })
  }
  return { season: recap.season, facts, names: [...names] }
}

/** The cache key's content half: a changed recap (a re-finalize) is a different hash, so a stale narrative is never served. */
export function seasonRecapFactsHash(f: SeasonRecapFacts, lang: RecapLanguage): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: SEASON_RECAP_FACTS_VERSION, lang, facts: f.facts }))
    .digest('hex')
    .slice(0, 32)
}

/* ─── The deterministic recap ─────────────────────────────────────────────────────────────── */

const n = (name: string) => `[[${name}]]`
const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`

/**
 * The recap written from the facts by template — the free baseline and the fallback whenever a model's
 * text is refused. Names are marked [[Name]], exactly as the model is told to mark them.
 */
export function deterministicSeasonRecapText(recap: SeasonRecap, lang: RecapLanguage): string {
  const es = lang === 'es'
  const out: string[] = []
  if (recap.champion) {
    const tail = recap.runnerUp ? (es ? `, ante ${n(recap.runnerUp.name)} en la final` : `, beating ${n(recap.runnerUp.name)} in the final`) : ''
    out.push(es ? `${n(recap.champion.name)} ganó el título de ${recap.season}${tail}.` : `${n(recap.champion.name)} won the ${recap.season} title${tail}.`)
  } else {
    out.push(es ? `Así fue la temporada ${recap.season}.` : `Here is how the ${recap.season} season went.`)
  }
  if (recap.topSeed) {
    const rec = record(recap.topSeed.wins, recap.topSeed.losses, recap.topSeed.ties)
    out.push(es ? `${n(recap.topSeed.name)} terminó la temporada regular como primer cabeza de serie (${rec}).` : `${n(recap.topSeed.name)} finished the regular season as the top seed at ${rec}.`)
  }
  if (recap.mostPointsFor) {
    out.push(es ? `${n(recap.mostPointsFor.name)} sumó más puntos que nadie: ${fmt(recap.mostPointsFor.points)}.` : `${n(recap.mostPointsFor.name)} scored the most points: ${fmt(recap.mostPointsFor.points)}.`)
  }
  if (recap.highestWeek) {
    const h = recap.highestWeek
    out.push(es ? `La mejor semana fue de ${n(h.name)}: ${fmt(h.points)} pts en la semana ${h.week}.` : `The best single week belonged to ${n(h.name)}: ${fmt(h.points)} points in week ${h.week}.`)
  }
  const gameLine = (g: RecapGameAward) => `${n(g.winner.name)} ${fmt(g.winnerScore)} – ${n(g.loser.name)} ${fmt(g.loserScore)}`
  if (recap.biggestBlowout) {
    const g = recap.biggestBlowout
    out.push(es ? `La mayor paliza: ${gameLine(g)}, semana ${g.week}.` : `The biggest blowout: ${gameLine(g)} in week ${g.week}.`)
  }
  if (recap.closestGame) {
    const g = recap.closestGame
    out.push(es ? `El partido más ajustado: ${gameLine(g)}, semana ${g.week}, por ${fmt(g.margin)} pts.` : `The closest game: ${gameLine(g)} in week ${g.week}, decided by ${fmt(g.margin)} points.`)
  }
  if (recap.bestTrade) {
    const t = recap.bestTrade
    const net = fmt(Math.round(Math.abs(t.net)))
    const partner = t.partner ? (es ? ` con ${n(t.partner.name)}` : ` with ${n(t.partner.name)}`) : ''
    out.push(es ? `El mejor trade por valor fue de ${n(t.name)}${partner}: +${net}.` : `The best trade by value was ${n(t.name)}'s deal${partner}: +${net}.`)
  }
  if (recap.bestPickup && recap.bestPickup.playerName?.trim()) {
    const p = recap.bestPickup
    out.push(
      es
        ? `La mejor alta por reclamo fue ${n(p.playerName.trim())} para ${n(p.name)}: ${fmt(p.pointsAfter)} pts tras la semana ${p.pickupWeek}.`
        : `The best pickup was ${n(p.playerName.trim())} for ${n(p.name)}: ${fmt(p.pointsAfter)} points after week ${p.pickupWeek}.`,
    )
  }
  if (recap.tradeCount > 0) {
    out.push(es ? `La liga cerró ${recap.tradeCount} trades.` : `The league made ${recap.tradeCount} trades.`)
  }
  return out.join(' ')
}

/** "[[Hawks]] won" → "Hawks won", for display and copy. */
export function stripNameMarks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1')
}

/* ─── The guard ───────────────────────────────────────────────────────────────────────────── */

/**
 * Capitalised words that are not names and may appear mid-sentence. Kept short on purpose: a word not
 * here and not in the facts is treated as an invented name, and a refusal costs only the template.
 */
const NON_NAME_WORDS = new Set([
  'I', 'AllFantasy', 'Chimmy', 'MVP', 'PF', 'PA', 'PC', 'Week', 'Season', 'Playoffs', 'Playoff', 'Toilet', 'Bowl',
  'Semana', 'Temporada', 'NFL', 'NBA', 'NHL', 'MLB', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST',
])

// Only a real sentence start excuses a capital. Not a colon, a quote or a bracket: "Best pickup: Joe"
// is exactly where an invented name would go.
const SENTENCE_START = /(^\s*|[.!?\n]\s+|[¡¿])$/

export type SeasonRecapGuardResult = StoryFactGuardResult

export function validateSeasonRecapNarrative(
  text: string,
  f: SeasonRecapFacts,
  opts: { lang: RecapLanguage; hasProfanity?: (t: string) => boolean },
): SeasonRecapGuardResult {
  const errors: string[] = []
  const trimmed = (text ?? '').trim()
  if (trimmed.length < 40) errors.push('Recap is empty or too short.')
  if (trimmed.length > 2000) errors.push('Recap is too long.')

  const allowedNames = new Set(f.names)
  for (const m of trimmed.matchAll(/\[\[([^\]]*)\]\]/g)) {
    if (!allowedNames.has(m[1])) errors.push(`Recap names "${m[1]}", which is not in the facts.`)
  }
  if (/\[\[|\]\]/.test(trimmed.replace(/\[\[[^\]]*\]\]/g, ''))) errors.push('Recap has a malformed name mark.')

  const plain = stripNameMarks(trimmed)
  // Numbers, invented / certain-outcome claims, personal attacks, profanity: Storyline Studio's guard.
  const base = validateHookRewrite(plain, f.facts, { hasProfanity: opts.hasProfanity })
  errors.push(...base.errors.filter((e) => e !== 'Rewrite is empty.'))

  // An unmarked capitalised word mid-sentence that is not a fact string is the shape of an invented name.
  let rest = plain
  const strings = f.facts.map((x) => (typeof x.value === 'string' ? x.value.trim() : '')).filter(Boolean)
  for (const s of [...strings].sort((a, b) => b.length - a.length)) rest = rest.split(s).join('·')
  const unknown = new Set<string>()
  for (const m of rest.matchAll(/[\p{Lu}][\p{L}'’-]*/gu)) {
    const word = m[0].replace(/['’]s$/, '')
    if (NON_NAME_WORDS.has(word)) continue
    const before = rest.slice(0, m.index ?? 0)
    if (SENTENCE_START.test(before)) continue
    unknown.add(word)
  }
  if (unknown.size > 0) errors.push(`Recap mentions names that are not in the facts: ${[...unknown].join(', ')}`)

  if (opts.lang === 'es' && /\bwaivers?\b/i.test(plain)) errors.push('Spanish recap must say «reclamo».')

  return { passed: errors.length === 0, errors, warnings: [] }
}
