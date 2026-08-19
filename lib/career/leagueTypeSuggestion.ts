/**
 * Suggest what kind of league this is. Never decide.
 *
 * ⚠ SLEEPER CANNOT EXPRESS MOST OF THESE FORMATS. It supports guillotine; it has
 * no concept of a zombie league or a tournament. Commissioners build those by
 * hand, so on import a 240-team tournament shell and a 12-man home league are
 * both just "redraft". Measured: "KBI Smoke Black" and "KBI Commish Chopped"
 * are tournament and guillotine leagues respectively, both stored as redraft.
 *
 * ⚠ SO THIS RETURNS A SUGGESTION AND WRITES NOTHING. The owner's own rule is
 * that the type is whatever the user says it is. A guess that silently became
 * the stored type would inflate someone's rank on the strength of a word in a
 * league name — and "KBI Commish Chat" proves how wrong that goes, since it
 * matches every KBI pattern and is a chat room, not a competition.
 *
 * ⚠ SCORING IS NOT USED AS EVIDENCE. It looks like the most rigorous signal and
 * it is the least reliable: commissioners change scoring freely, and the Zombie
 * rules ship deliberately ordinary scoring ("fairly classic scoring here") to
 * keep one part of the format simple. A league is not a zombie league because
 * of its TE bonus.
 */

export type SuggestedType = 'redraft' | 'dynasty' | 'guillotine' | 'zombie' | 'tournament' | 'survivor'

export type TypeSuggestion = {
  suggested: SuggestedType | null
  /** 'high' still means ASK. Nothing here is strong enough to apply silently. */
  confidence: 'high' | 'medium' | 'low'
  /** Shown to the user so they can agree or correct it. */
  reasons: string[]
  /** Buy-in detected in the name, e.g. "$20". Feeds the paid-league bump. */
  detectedBuyIn: number | null
  /** True when the name suggests this is not a competition at all. */
  looksNonCompetitive: boolean
}

/** Names that mark a league as administrative rather than played. */
const NON_COMPETITIVE = /\b(commish\s*chat|chat|admin|test|practice|demo|sandbox)\b/i

const PATTERNS: Array<{ type: SuggestedType; re: RegExp; why: string }> = [
  { type: 'guillotine', re: /guillotine|🪓|chopped/i, why: 'name mentions guillotine' },
  { type: 'zombie', re: /zombie|apocalyp|horde|whisperer|survivor universe/i, why: 'name mentions the zombie format' },
  { type: 'tournament', re: /\bkbi\b|king buffalo|invitational|\btournament\b/i, why: 'name matches a known tournament' },
  { type: 'survivor', re: /\bsurvivor\b/i, why: 'name mentions survivor' },
]

/** "$20", "($30)", "$20 / 2" — commissioners put the buy-in in the name. */
function buyInFromName(name: string): number | null {
  const m = name.match(/\$\s?(\d{1,4})/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function suggestLeagueType(input: {
  name: string | null | undefined
  isDynasty?: boolean | null
  /** Sleeper's own flag — the ONE format the platform models natively. */
  guillotineMode?: boolean | null
  currentType?: string | null
}): TypeSuggestion {
  const name = (input.name ?? '').trim()
  const reasons: string[] = []
  const detectedBuyIn = buyInFromName(name)
  const looksNonCompetitive = NON_COMPETITIVE.test(name)

  if (detectedBuyIn) reasons.push(`buy-in "$${detectedBuyIn}" found in the league name`)

  /*
   * Sleeper's guillotine flag is the only platform-native evidence available,
   * so it outranks any name match. Everything else is a commissioner's word.
   */
  if (input.guillotineMode) {
    return {
      suggested: 'guillotine',
      confidence: 'high',
      reasons: ['Sleeper reports guillotine mode for this league', ...reasons],
      detectedBuyIn,
      looksNonCompetitive,
    }
  }

  const matches = PATTERNS.filter((p) => p.re.test(name))

  if (looksNonCompetitive) {
    /*
     * "KBI Commish Chat" matches the tournament pattern and is a chat room.
     * Counting it would hand someone tournament credit for talking.
     */
    return {
      suggested: null,
      confidence: 'low',
      reasons: ['name suggests an administrative or chat league, not a competition', ...reasons],
      detectedBuyIn,
      looksNonCompetitive: true,
    }
  }

  if (matches.length === 1) {
    return {
      suggested: matches[0].type,
      // Medium, never high: a name is a commissioner's choice, not a setting.
      confidence: 'medium',
      reasons: [matches[0].why, ...reasons],
      detectedBuyIn,
      looksNonCompetitive,
    }
  }

  if (matches.length > 1) {
    /*
     * "Survivor Style Guillotine" and "Survivor All-Stars Guillotine" are real
     * league names that match two formats. Guessing between them is exactly the
     * case where a person should decide.
     */
    return {
      suggested: null,
      confidence: 'low',
      reasons: [
        `name matches more than one format (${matches.map((m) => m.type).join(', ')})`,
        ...reasons,
      ],
      detectedBuyIn,
      looksNonCompetitive,
    }
  }

  if (input.isDynasty) {
    return {
      suggested: 'dynasty',
      confidence: 'high',
      reasons: ['Sleeper reports this as a dynasty league', ...reasons],
      detectedBuyIn,
      looksNonCompetitive,
    }
  }

  return {
    suggested: 'redraft',
    confidence: 'low',
    reasons: ['no specialty markers found; defaulting to redraft', ...reasons],
    detectedBuyIn,
    looksNonCompetitive,
  }
}

/**
 * Whether a league's type may be trusted for RANKING.
 *
 * ⚠ AN UNCONFIRMED TYPE MUST NOT MOVE SOMEONE'S RANK. A suggestion is for a
 * prompt; only a type a human has confirmed should multiply what a season is
 * worth. Otherwise a league renamed "Zombie Apocalypse Dynasty" as a joke
 * silently promotes its winner.
 */
export function typeIsRankable(opts: { confirmedByUser: boolean }): boolean {
  return opts.confirmedByUser
}
