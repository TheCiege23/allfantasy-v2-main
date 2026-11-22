/**
 * My Leagues in plain words (2026-11-14). The owner's ask: users should know what the page is for and
 * exactly what to do. The question people open their league list with is "which of my leagues needs me
 * right now?" — and on the owner's 82-league account the page answered "70 of them", which answers nothing.
 *
 * Measured on that account, the 70 broke down as:
 *
 *   9   a starter is out                      needs you now
 *   18  a starter is questionable             needs you now
 *   2   a draft under way / lineup unchecked  needs you now
 *   23  only BENCH players hurt ("N FLAGGED") does not — dash34's own comment says a hurt bench player
 *                                             "changes nothing about today"
 *   17  draft not started ("PRE DRAFT")       does not — nothing to do until the draft
 *
 * So the tier rules here are the honest version of the old "any warn chip → needs you": a bench-only
 * injury stays in season with a note, and a league waiting on its draft gets its own group.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */

/** The fields of a 34a league these rules read. Kept structural so the client and the loader share it. */
export type GuideLeagueInput = {
  priority?: 'urgent' | 'draft' | null
  chips?: ReadonlyArray<{ label: string; tone?: string | null }> | null
  matchupNote?: string | null
  /** For `exileOf`: an Exile Island names the Survivor league it belongs to by id. */
  id?: string
  exileOf?: string | null
}

export type GuideTier = 'needs' | 'playing' | 'predraft' | 'quiet'

const STARTERS_OUT = /^(\d+) STARTERS? OUT$/
const STARTERS_FLAGGED = /^(\d+) STARTERS? FLAGGED$/
/** Hurt players, none of them starting (or a format with no lineup to set). */
const PLAYERS_FLAGGED = /^(\d+) FLAGGED$/

/** A chip that asks something of you TODAY. Bench injuries and a draft that has not begun do not. */
function isCallToAction(c: { label: string; tone?: string | null }): boolean {
  if (c.tone === 'bad') return true
  if (c.tone !== 'warn') return false
  return !PLAYERS_FLAGGED.test(c.label) && c.label !== 'PRE DRAFT'
}

export function leagueTier(l: GuideLeagueInput): GuideTier {
  const chips = l.chips ?? []
  const has = (label: string) => chips.some((c) => c.label === label)
  // Anything the 34a ranker treats as urgent (empty slot, starter out, waivers) or a draft under way.
  if (l.priority === 'urgent' || l.priority === 'draft') return 'needs'
  if (chips.some(isCallToAction)) return 'needs'
  if (has('PRE DRAFT')) return 'predraft'
  if (has('SEASON OVER')) return 'quiet'
  if (l.matchupNote === 'No roster imported yet') return 'quiet'
  return 'playing'
}

/**
 * The reason a card leads with, as a key the screen can phrase in either language. `n` is the count the
 * chip carried. Null when the league has nothing to say.
 */
export type GuideReason =
  | { key: 'startersOut'; n: number }
  | { key: 'startersQuestionable'; n: number }
  | { key: 'playersHurt'; n: number }
  | { key: 'drafting' }
  | { key: 'preDraft' }
  | { key: 'lineupUnchecked' }
  | { key: 'bestBallGap' }
  | { key: 'raw'; label: string }

export function parseReason(label: string | null | undefined): GuideReason | null {
  if (!label) return null
  let m = STARTERS_OUT.exec(label)
  if (m) return { key: 'startersOut', n: Number(m[1]) }
  m = STARTERS_FLAGGED.exec(label)
  if (m) return { key: 'startersQuestionable', n: Number(m[1]) }
  m = PLAYERS_FLAGGED.exec(label)
  if (m) return { key: 'playersHurt', n: Number(m[1]) }
  if (label === 'DRAFTING') return { key: 'drafting' }
  if (label === 'PRE DRAFT') return { key: 'preDraft' }
  if (label === 'LINEUP NOT VERIFIED') return { key: 'lineupUnchecked' }
  if (label === 'BEST BALL · COVERAGE GAP') return { key: 'bestBallGap' }
  return { key: 'raw', label }
}

/**
 * The chips a card still needs to show once the reason line and the COMMISH badge have said their part.
 * The live page printed "1 STARTER FLAGGED" twice on one card and "COMMISH" beside "YOU COMMISH".
 */
export function extraChips<C extends { label: string }>(chips: ReadonlyArray<C> | null | undefined, reason: string | null | undefined): C[] {
  return (chips ?? []).filter((c) => c.label !== reason && c.label !== 'YOU COMMISH')
}

export type MyLeaguesHeadline = {
  /** Starter out, empty slot or waivers to review — the 34a ranker's "urgent". */
  fix: number
  /** A questionable starter, nothing worse. */
  questionable: number
  /** A draft under way now. */
  drafting: number
  /** Waiting on a draft that has not started. */
  predraft: number
  /** Everything in the "Needs you" group, for the group heading. */
  needs: number
  /** What the headline leads with. */
  lead: 'fix' | 'questionable' | 'drafting' | 'clear' | 'empty'
}

/**
 * The group each league is SHOWN in. Usually its own tier — but an Exile Island rides under its
 * Survivor league, in that league's group (MyLeaguesV4 pairs them with ↕), because it is part of that
 * game. The headline counts the same way, or its chips disagree with the groups they point at: live on
 * 2026-11-14, "17 waiting on a draft" sat above a "Before the draft" group of 19 — two pre-draft
 * Survivor leagues, each carrying its island.
 */
export function shownTier(l: GuideLeagueInput, byId: ReadonlyMap<string, GuideLeagueInput>): GuideTier {
  // A league naming itself finds itself here, which gives its own tier — so no self-check is needed.
  const host = l.exileOf ? byId.get(l.exileOf) : undefined
  return leagueTier(host ?? l)
}

export function myLeaguesHeadline(leagues: ReadonlyArray<GuideLeagueInput & { reason?: string | null }>): MyLeaguesHeadline {
  const byId = new Map<string, GuideLeagueInput>()
  for (const l of leagues) if (l.id) byId.set(l.id, l)
  let fix = 0
  let questionable = 0
  let drafting = 0
  let predraft = 0
  let needs = 0
  for (const l of leagues) {
    const tier = shownTier(l, byId)
    if (tier === 'needs') needs++
    if (tier === 'predraft') predraft++
    // Only a league shown under "Needs you" can be counted as needing you.
    if (tier !== 'needs') continue
    if (l.priority === 'urgent') fix++
    else if (l.priority === 'draft') drafting++
    else if ((l.chips ?? []).some((c) => STARTERS_FLAGGED.test(c.label))) questionable++
  }
  const lead = leagues.length === 0 ? 'empty' : fix > 0 ? 'fix' : questionable > 0 ? 'questionable' : drafting > 0 ? 'drafting' : 'clear'
  return { fix, questionable, drafting, predraft, needs, lead }
}

/** A matchup line's parts, so the screen can phrase it — "Week 10 · 20.3–18.1 vs Wounded Warriors". */
export type GuideMatchup = {
  week: number
  scored: boolean
  yourScore: number
  opponentScore: number
  opponent: string | null
  /** No head-to-head pairing (guillotine, league scoreboard). */
  unpaired: boolean
}
