// @vitest-environment node
/** The free weekly recap reads as an episode: title, scores, challenge, Tribal Council, twist, who is left. */
import { describe, expect, it } from 'vitest'

import { buildSurvivorEpisode, readSurvivorEpisode, survivorEpisodeText, type SurvivorEpisodeFacts } from '@/lib/survivor/survivorEpisode'

const base: SurvivorEpisodeFacts = {
  week: 6, merged: false, tribeTotals: [{ name: 'Moto', total: 388.14 }, { name: 'Tala', total: 412.6 }], attendingTribes: ['Moto'],
  challengeTitle: 'Over/under', challengeWinner: 'Tala', topScorer: 'Ava', topScore: 151.2,
  eliminated: ['Ben'], idolsPlayed: [], tie: false, remaining: 10, votedOutSoFar: 6,
}

describe('buildSurvivorEpisode', () => {
  it('a normal pre-merge week', () => {
    const ep = buildSurvivorEpisode(base)
    expect(ep.title).toBe('The Tribe Has Spoken')
    expect(ep.scenes.map(s => s.label)).toEqual(['The scores', 'Top scorer', 'The challenge', 'Tribal Council', 'Next time'])
    expect(ep.scenes[0].text).toBe('Tala led the week with 412.6. Moto finished last with 388.1 and headed to Tribal Council.')
    expect(ep.scenes[2].text).toBe('Tala won "Over/under".')
    expect(ep.scenes[3].text).toBe('Ben was voted out, the 6th manager to leave the island.')
    // A double-tribal week (or a challenge-won immunity) can send a tribe other than the lowest.
    expect(buildSurvivorEpisode({ ...base, attendingTribes: ['Tala'] }).scenes[0].text).toContain('Moto finished last with 388.1, and Tala headed to Tribal Council.')
  })

  it('titles the drama: an idol, a deadlock, a double elimination, a quiet week', () => {
    const idol = buildSurvivorEpisode({ ...base, idolsPlayed: ['Immunity Idol'], tie: true })
    expect(idol.title).toBe('Idol in Play')
    expect(idol.scenes.find(s => s.label === 'Tribal Council')!.text).toBe('An idol was played: Immunity Idol. The vote deadlocked and went to a revote. Ben was voted out, the 6th manager to leave the island.')
    expect(buildSurvivorEpisode({ ...base, tie: true }).title).toBe('Deadlock')
    const double = buildSurvivorEpisode({ ...base, eliminated: ['Ben', 'Cy'], votedOutSoFar: 7 })
    expect(double.title).toBe('Double Trouble')
    expect(double.scenes.find(s => s.label === 'Tribal Council')!.text).toBe('Ben and Cy were voted out, leaving 7 managers gone this season.')
    const quiet = buildSurvivorEpisode({ ...base, eliminated: [], attendingTribes: [] })
    expect(quiet.title).toBe('A Quiet Week on the Island')
    expect(quiet.scenes.find(s => s.label === 'Tribal Council')!.text).toBe('Nobody went home this week.')
  })

  it('after the merge it leads with individual immunity and does not repeat the top scorer', () => {
    const ep = buildSurvivorEpisode({ ...base, merged: true, immunityHolder: 'Ava', tribeTotals: [] })
    expect(ep.scenes[0]).toEqual({ label: 'The scores', text: 'Ava won individual immunity with 151.2. Everyone else was fair game.' })
    expect(ep.scenes.find(s => s.label === 'Top scorer')).toBeUndefined()
    expect(ep.scenes.find(s => s.label === 'Next time')!.text).toBe('10 managers remain.')
  })

  it('writes the chat post and reads a stored episode back', () => {
    const ep = buildSurvivorEpisode({ ...base, twist: 'Tribes swapped one member.' })
    const text = survivorEpisodeText(ep)
    expect(text.split('\n')[0]).toBe('**Episode 6: The Tribe Has Spoken**')
    expect(text).toContain('**Twist:** Tribes swapped one member.')
    expect(readSurvivorEpisode(JSON.parse(JSON.stringify(ep)))).toEqual(ep)
    expect(readSurvivorEpisode({ week: 'x' })).toBeNull()
  })
})

describe('the confessional scene', () => {
  it('quotes each manager voted out who recorded one', () => {
    const ep = buildSurvivorEpisode({ ...base, confessionals: [{ name: 'Ben', text: 'Moto is cooked.' }] })
    expect(ep.scenes).toContainEqual({ label: 'Confessional', text: 'Ben, before the vote: “Moto is cooked.”' })
  })
})
