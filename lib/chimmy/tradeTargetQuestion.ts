import { extractPlayerNameCandidates, splitSides } from '@/lib/chimmy-trade/tradeSentence'

/**
 * "Should I trade for X?" — one player the asker wants, and no price named.
 *
 * Pure. It shares the described-trade grader's sentence splitter (`tradeSentence.ts`), so the two
 * never disagree about a sentence. `lib/ai/deterministic.ts` imports it on every chat message: the
 * FantasyCalc price shortcut there has to recognise this question so it can step aside.
 *
 * 🛑 THIS QUESTION WAS ANSWERED WITH A PRICE. User report, 2026-09-16: "is it worth me trading for
 * Rashee Rice in this league?" came back as "Rashee Rice's FantasyCalc dynasty value is 3421 …" —
 * the price shortcut fires on the word "worth" and returns before the league is read. The user
 * asked for a decision: yes or no, from their roster, their league's scoring and their record.
 *
 * ⚠ A DESCRIBED TRADE IS NOT THIS QUESTION. "Trade Bijan Robinson for Rashee Rice" names both
 * sides and belongs to `buildTradeScenario`, which compares the two. This parser only claims a
 * sentence whose give side is empty — the verb runs straight into "for".
 */

export type TradeTargetQuestion = {
  /** The name as the asker wrote it, trimmed. One to four words. */
  playerName: string
}

/*
 * The asking shapes. Each captures everything after the trigger; `readName` cuts the name out of it.
 * The verb must run straight into "for" — "trading for X", never "trading Y for X".
 */
const TRIGGERS: RegExp[] = [
  // "is it worth me trading for X", "should I trade for X", "thinking about dealing for X"
  /\b(?:trade|trading|deal|dealing)\s+(?:for|to\s+get)\s+(.+)$/i,
  // "make a move for X", "make an offer for X", "make a play for X"
  /\bmak(?:e|ing)\s+(?:a|an)\s+(?:move|offer|play|push|run)\s+(?:for|at)\s+(.+)$/i,
  // "should I go after X", "should I target X", "should I buy low on X", "should I try to get X"
  /\bshould\s+i\s+(?:try\s+(?:to|and)\s+)?(?:go\s+after|go\s+get|target|pursue|acquire|buy\s+low\s+on|buy|get)\s+(.+)$/i,
]

/* "is X worth trading for", "is X worth a trade", "is X worth going after" — X is group 1. */
const WORTH_SUBJECT =
  /\bis\s+(.+?)\s+worth\s+(?:trading\s+for|a\s+trade|getting|acquiring|buying|going\s+after|pursuing|trading\s+to\s+get)\b/i

/*
 * Words that end a name. A name is followed by the rest of the question — "in this league", "right
 * now", "for my team" — and a stop word is where it ends. Compared lowercased, because a phone
 * keyboard does not always capitalise.
 */
const STOP_WORDS = new Set([
  'in', 'on', 'at', 'this', 'that', 'these', 'those', 'for', 'from', 'right', 'now', 'today',
  'with', 'or', 'and', 'if', 'to', 'league', 'team', 'my', 'me', 'because', 'since', 'when',
  'given', 'considering', 'is', 'was', 'worth', 'it', 'yet', 'still', 'before', 'after', 'as',
  'straight', 'up', 'please', 'though', 'here', 'there', 'rn', 'vs', 'versus',
  'by', 'giving', 'sending', 'offering', 'using', 'give', 'send', 'offer', 'who', 'he', 'so',
])

/*
 * What a name cannot start with. "Should I trade for a RB" asks about a position, "should I get
 * him" about someone named earlier — neither is a player this parser can resolve, so neither is
 * claimed. Met after the first word, one of these ends the name instead ("Rashee Rice WR").
 */
const NOT_A_NAME = new Set([
  'a', 'an', 'the', 'some', 'someone', 'somebody', 'anyone', 'anybody', 'him', 'her', 'them',
  'his', 'their', 'another', 'any', 'more', 'depth', 'help', 'player', 'players', 'qb', 'rb', 'wr',
  'te', 'k', 'dst', 'def', 'idp', 'flex', 'receiver', 'back', 'kicker', 'defense', 'pick', 'picks',
  'upgrade', 'one', 'two', 'what', 'who', 'which', 'first', 'second', 'third', 'faab', 'waivers',
  'it', 'that', 'this',
])

/* What follows a target when the asker has already said what they would give for him. */
const GIVE_SIDE_AFTER =
  /^(?:with|giving|sending|offering|using|by\s+(?:giving|sending|trading|offering|moving|dealing)|and\s+(?:give|send|offer))\s+\S/i

/*
 * A period that belongs to the name rather than ending the sentence: "St.", "Jr.", and initials —
 * "A.J. Brown", "D.K. Metcalf". Measured on staging: "A.J. Brown" was read as "A.J" and found nobody.
 */
const ABBREVIATION = /^(?:(?:st|jr|sr)\.|(?:[a-z]\.){1,3})$/i
const MAX_NAME_WORDS = 4

/**
 * The name at the start of `tail`, and whatever follows it. Null when what follows the trigger is
 * not a name.
 */
export function readName(tail: string): { name: string; rest: string } | null {
  // Punctuation ends the name: "dealing for Rashee Rice, good idea?" is about Rashee Rice.
  const words = (tail.split(/[?!,;:()"]/)[0] ?? '')
    .split(/\s+/)
    .filter(Boolean)

  const kept: string[] = []
  let used = 0
  for (const raw of words) {
    // A period inside a name ("St.", "Jr.") stays; one that ends the sentence ends the name.
    const endsSentence = raw.endsWith('.') && !ABBREVIATION.test(raw)
    const word = endsSentence ? raw.replace(/\.+$/, '') : raw
    const bare = word.toLowerCase().replace(/[.'’-]/g, '')
    if (!bare || !/[a-z]/.test(bare)) break
    if (NOT_A_NAME.has(bare)) {
      if (kept.length === 0) return null
      break
    }
    if (STOP_WORDS.has(bare)) break
    kept.push(word)
    used += 1
    if (endsSentence || kept.length >= MAX_NAME_WORDS) break
  }
  if (kept.length === 0) return null
  return { name: kept.join(' '), rest: words.slice(used).join(' ') }
}

/**
 * The player an acquisition question names, or null when the message is not one.
 *
 * Null — and so left to the other paths — when it names both sides of a trade, when it names two
 * targets ("Rice or Waddle"), or when what follows the trigger is not a name.
 */
export function parseTradeTargetQuestion(message: string): TradeTargetQuestion | null {
  const text = message.trim()
  if (!text) return null

  // Both sides named: the described-trade scenario's question, not this one.
  if (namesBothSidesOfTrade(text)) return null

  let read: { name: string; rest: string } | null = null

  // "Is Rashee Rice worth trading for?" — the whole subject must be the name, or it is not one.
  const subject = text.match(WORTH_SUBJECT)
  if (subject?.[1]) {
    const candidate = readName(subject[1])
    if (candidate && candidate.rest === '') read = candidate
  }

  if (!read) {
    for (const re of TRIGGERS) {
      const m = text.match(re)
      if (!m?.[1]) continue
      read = readName(m[1])
      break
    }
  }
  if (!read) return null

  // "trade for Rice or Waddle": two targets. A comparison, not a yes/no on one player.
  if (/^(?:or|vs\.?|versus)\s+\S/i.test(read.rest)) return null

  /*
   * "dealing for Rashee Rice with Bijan Robinson": the give side is named AFTER the target, where the
   * sentence splitter cannot see it. That is a described trade, and a verdict on Rice alone would
   * answer a different question from the one asked.
   */
  if (GIVE_SIDE_AFTER.test(read.rest)) return null

  return { playerName: read.name }
}

/**
 * True when the sentence puts a named player on each side of a trade — "Bijan Robinson for Rashee
 * Rice". Split with the described-trade grader's own splitter, so the two agree on every sentence.
 */
export function namesBothSidesOfTrade(message: string): boolean {
  const sides = splitSides(message)
  return Boolean(
    sides &&
      extractPlayerNameCandidates(sides.left).length > 0 &&
      extractPlayerNameCandidates(sides.right).length > 0,
  )
}

/** True when the message asks whether to trade for one named player. */
export function looksLikeTradeTargetQuestion(message: string): boolean {
  return parseTradeTargetQuestion(message) !== null
}
