/**
 * This week's strategy for one manager: whether they are at risk, whether to play an idol, and how
 * to set a lineup for what the week rewards. Pure and client-safe: built from the facts the Survivor
 * summary already holds for the viewer, so it never reads anything another manager could not see
 * except their own idols.
 *
 * The lineup advice follows the format, not a projection:
 *  - before the merge a tribe goes to Tribal Council only if it finishes LAST, which rewards a floor;
 *  - after the merge the week's top score wins immunity, which rewards a ceiling.
 */

export type SurvivorAdviceTone = 'warn' | 'info' | 'good'
export type SurvivorAdvice = { id: 'at_risk' | 'at_council' | 'immune' | 'play_idol' | 'hold_idol' | 'lineup'; tone: SurvivorAdviceTone; title: string; body: string }

export type SurvivorWeekAdviceFacts = {
  merged: boolean
  /** The viewer is still in the game (not voted out, not on Exile). */
  inGame: boolean
  myRosterId: string | null
  myTribeId: string | null
  /** This week's counted totals by tribe id. */
  tribeScores: Readonly<Record<string, number>>
  tribeNames: Readonly<Record<string, string>>
  /** This week's score by main roster id. */
  memberScores: Readonly<Record<string, number>>
  rosterNames: Readonly<Record<string, string>>
  immuneRosterIds: readonly string[]
  /** Every score of the week is final: the lineup can no longer change anything. */
  scoresFinalized: boolean
  /** The open council, if votes are being cast now. */
  council: { attendingTribeId: string | null } | null
  /** The viewer's unplayed idols, with whether each is played at Tribal Council. */
  myIdols: ReadonlyArray<{ name: string; playableAtCouncil: boolean }>
  /** The league's idol expiry rule, in words. */
  idolExpiryText: string | null
}

const pts = (value: number) => value.toFixed(1)

export function buildSurvivorWeekAdvice(facts: SurvivorWeekAdviceFacts): SurvivorAdvice[] {
  if (!facts.inGame || !facts.myRosterId) return []
  const advice: SurvivorAdvice[] = []
  const immune = facts.immuneRosterIds.includes(facts.myRosterId)
  const ranked = Object.entries(facts.tribeScores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const myRank = facts.myTribeId ? ranked.findIndex(([id]) => id === facts.myTribeId) : -1
  const tribeLast = !facts.merged && ranked.length >= 2 && myRank === ranked.length - 1

  // Is the viewer going to (or at) Tribal Council?
  const atCouncil = facts.council != null && !immune && (facts.merged || facts.council.attendingTribeId === facts.myTribeId)
  if (immune) {
    advice.push({ id: 'immune', tone: 'good', title: 'You have immunity', body: 'Nobody can vote you out this week.' })
  } else if (atCouncil) {
    advice.push({ id: 'at_council', tone: 'warn', title: 'You are at Tribal Council', body: facts.merged ? 'Everyone without immunity can be voted out tonight. Cast your vote before the deadline.' : 'Your tribe is voting someone out. Cast your vote before the deadline.' })
  } else if (tribeLast && !facts.scoresFinalized) {
    const above = ranked[ranked.length - 2]!
    const gap = above[1] - (facts.tribeScores[facts.myTribeId!] ?? 0)
    const aboveName = facts.tribeNames[above[0]] ?? 'the next tribe'
    advice.push({ id: 'at_risk', tone: 'warn', title: 'You are at risk this week', body: `Your tribe is last, ${pts(gap)} behind ${aboveName}. Finish last and you go to Tribal Council.` })
  }

  // Idols: play one at a council you attend; otherwise say whether holding it is safe.
  const playable = facts.myIdols.filter(idol => idol.playableAtCouncil)
  if (playable.length && atCouncil) {
    const name = playable[0]!.name
    advice.push({ id: 'play_idol', tone: 'warn', title: 'Play your idol now?', body: `You hold ${name}${playable.length > 1 ? ` and ${playable.length - 1} more` : ''}. Play it before the votes are read, or it cannot help you tonight.${facts.idolExpiryText ? ` ${facts.idolExpiryText}` : ''}` })
  } else if (playable.length && !facts.council) {
    advice.push({ id: 'hold_idol', tone: 'info', title: tribeLast ? 'Keep your idol ready' : 'Your idol is safe to hold', body: `${tribeLast ? 'If your tribe stays last, you can play it at Tribal Council.' : 'You are not at Tribal Council yet.'}${facts.idolExpiryText ? ` ${facts.idolExpiryText}` : ''}` })
  }

  // Lineup advice, while the week's scores can still move.
  if (!facts.scoresFinalized && !facts.council) {
    if (!facts.merged) {
      advice.push({ id: 'lineup', tone: 'info', title: 'Lineup: protect the floor', body: tribeLast
        ? 'Your tribe only needs to pass one other tribe. Start the players you trust to score every week, not the boom-or-bust ones.'
        : 'Only the last tribe goes to Tribal Council. Steady starters keep your tribe off the bottom.' })
    } else if (!immune) {
      const top = Object.entries(facts.memberScores).sort((a, b) => b[1] - a[1])[0]
      const mine = facts.memberScores[facts.myRosterId] ?? 0
      const leader = top && top[0] !== facts.myRosterId ? top : null
      advice.push({ id: 'lineup', tone: 'info', title: 'Lineup: chase the top score', body: leader
        ? `Immunity goes to the week's top score. You are ${pts(leader[1] - mine)} behind ${facts.rosterNames[leader[0]] ?? 'the leader'}. Start the players with the biggest upside.`
        : 'Immunity goes to the week\'s top score, and you lead right now. Keep your highest-ceiling players in.' })
    }
  }
  return advice
}
