/**
 * The free weekly recap as a TV episode: a title, then the scores, the challenge, Tribal Council,
 * any twist, and who is left. Pure: built from facts the recap generator already gathers, and
 * spoiler-safe by construction (it only ever names managers from councils whose read finished, and
 * never says who voted for whom).
 */

export type SurvivorEpisodeFacts = {
  week: number
  merged: boolean
  /** Pre-merge tribe totals for the week, any order. */
  tribeTotals: Array<{ name: string; total: number }>
  /** Tribes that went to Tribal Council this week (once each). */
  attendingTribes: string[]
  challengeTitle?: string | null
  challengeWinner?: string | null
  immunityHolder?: string | null
  topScorer?: string | null
  topScore?: number | null
  /** Voted out this week, in council order (a double-elimination week has two). */
  eliminated: string[]
  idolsPlayed: string[]
  tie: boolean
  twist?: string | null
  /** Managers still in the game after this week. */
  remaining?: number | null
  /** Everyone voted out so far this season, including this week. */
  votedOutSoFar?: number | null
}

export type SurvivorEpisodeScene = { label: string; text: string }
export type SurvivorEpisode = { week: number; title: string; scenes: SurvivorEpisodeScene[] }

const pts = (value: number) => value.toFixed(1)

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${tail}`
}

function names(list: string[]): string {
  return list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function episodeTitle(facts: SurvivorEpisodeFacts): string {
  if (facts.idolsPlayed.length) return 'Idol in Play'
  if (facts.tie) return 'Deadlock'
  if (facts.eliminated.length > 1) return 'Double Trouble'
  if (facts.eliminated.length === 1) return 'The Tribe Has Spoken'
  return 'A Quiet Week on the Island'
}

export function buildSurvivorEpisode(facts: SurvivorEpisodeFacts): SurvivorEpisode {
  const scenes: SurvivorEpisodeScene[] = []

  // The scores: who led, who finished on the bottom.
  const ranked = [...facts.tribeTotals].sort((a, b) => b.total - a.total)
  if (!facts.merged && ranked.length >= 2) {
    const top = ranked[0]!
    const bottom = ranked[ranked.length - 1]!
    const sentTo = facts.attendingTribes.length ? facts.attendingTribes : [bottom.name]
    const council = sentTo.length === 1 && sentTo[0] === bottom.name ? ' and headed to Tribal Council' : `, and ${names(sentTo)} headed to Tribal Council`
    scenes.push({ label: 'The scores', text: `${top.name} led the week with ${pts(top.total)}. ${bottom.name} finished last with ${pts(bottom.total)}${council}.` })
  } else if (facts.merged && facts.immunityHolder) {
    scenes.push({ label: 'The scores', text: `${facts.immunityHolder} won individual immunity${facts.topScorer === facts.immunityHolder && facts.topScore != null ? ` with ${pts(facts.topScore)}` : ''}. Everyone else was fair game.` })
  }
  if (facts.topScorer && facts.topScore != null && !(facts.merged && facts.topScorer === facts.immunityHolder)) {
    scenes.push({ label: 'Top scorer', text: `${facts.topScorer} put up the week's best score: ${pts(facts.topScore)}.` })
  }

  if (facts.challengeWinner) {
    scenes.push({ label: 'The challenge', text: `${facts.challengeWinner} won${facts.challengeTitle ? ` "${facts.challengeTitle}"` : ' the challenge'}.` })
  }

  if (facts.eliminated.length) {
    const beats: string[] = []
    if (facts.idolsPlayed.length) beats.push(`${facts.idolsPlayed.length === 1 ? 'An idol was' : `${facts.idolsPlayed.length} idols were`} played: ${names(facts.idolsPlayed)}.`)
    if (facts.tie) beats.push('The vote deadlocked and went to a revote.')
    const out = names(facts.eliminated)
    const count = facts.votedOutSoFar
    beats.push(facts.eliminated.length > 1
      ? `${out} were voted out${count ? `, leaving ${count} managers gone this season` : ''}.`
      : `${out} was voted out${count ? `, the ${ordinal(count)} manager to leave the island` : ''}.`)
    scenes.push({ label: 'Tribal Council', text: beats.join(' ') })
  } else {
    scenes.push({ label: 'Tribal Council', text: 'Nobody went home this week.' })
  }

  if (facts.twist) scenes.push({ label: 'Twist', text: facts.twist })
  if (facts.remaining != null && facts.remaining > 0) {
    scenes.push({ label: 'Next time', text: `${facts.remaining} managers remain${facts.merged ? '' : '. The merge is getting closer'}.` })
  }

  return { week: facts.week, title: episodeTitle(facts), scenes }
}

/** The chat post: a headline, then one line per scene. */
export function survivorEpisodeText(episode: SurvivorEpisode): string {
  return [`**Episode ${episode.week}: ${episode.title}**`, ...episode.scenes.map(scene => `**${scene.label}:** ${scene.text}`)].join('\n')
}

/** Read a stored episode back (from the recap's audit entry); null when the shape is not one. */
export function readSurvivorEpisode(value: unknown): SurvivorEpisode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.week !== 'number' || typeof row.title !== 'string' || !Array.isArray(row.scenes)) return null
  const scenes = row.scenes.flatMap(scene => {
    if (!scene || typeof scene !== 'object') return []
    const { label, text } = scene as Record<string, unknown>
    return typeof label === 'string' && typeof text === 'string' ? [{ label, text }] : []
  })
  return { week: row.week, title: row.title, scenes }
}
