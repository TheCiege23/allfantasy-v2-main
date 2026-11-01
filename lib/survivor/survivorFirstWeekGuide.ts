/**
 * The "how Survivor works" guide a player sees in their first week, built from THIS league's rules
 * (tribe count, idols, merge, Exile return, finale) so it never describes a rule the league does not
 * run. Pure, for the home card and its tests.
 */

export type FirstWeekGuideRules = {
  tribeName: string | null
  idolCount: number | null
  mergeTrigger: string | null
  mergeWeek: number | null
  mergePlayerCount: number | null
  exileReturnEnabled: boolean
  exileReturnTokens: number | null
  exileReturnWeek: number | null
  finalistCount: number | null
  finaleWeek: number | null
}

export type FirstWeekGuideStep = { id: string; title: string; body: string }

export function firstWeekGuideSteps(rules: FirstWeekGuideRules): FirstWeekGuideStep[] {
  const tribe = rules.tribeName ? `You are on Tribe ${rules.tribeName}.` : 'You are on a tribe.'
  const merge = rules.mergeTrigger === 'player_count' && rules.mergePlayerCount
    ? `when ${rules.mergePlayerCount} castaways remain`
    : rules.mergeWeek
      ? `in week ${rules.mergeWeek}`
      : 'later in the season'
  const finale = rules.finalistCount && rules.finaleWeek
    ? `The jury picks the winner from the final ${rules.finalistCount} in week ${rules.finaleWeek}.`
    : 'The jury picks the winner at the finale.'
  const steps: FirstWeekGuideStep[] = [
    {
      id: 'tribe',
      title: 'Score for your tribe',
      body: `${tribe} Every point your starters score adds to your tribe's total for the week. Set your lineup like any other league.`,
    },
    {
      id: 'council',
      title: 'Lowest tribe goes to Tribal Council',
      body: 'When the week ends, the tribe with the lowest total votes someone out. The top scorer in that tribe wins immunity and cannot be voted out.',
    },
    {
      id: 'vote',
      title: 'Vote in private',
      body: 'Cast your vote on the ballot screen or tell @Chimmy. Nobody sees your vote. The votes are read one by one after the deadline.',
    },
  ]
  if (rules.idolCount && rules.idolCount > 0) {
    steps.push({
      id: 'idols',
      title: 'Hidden idols',
      body: `${rules.idolCount} ${rules.idolCount === 1 ? 'idol is' : 'idols are'} hidden on drafted players. If you hold one, Chimmy tells you privately. Play it at Tribal Council to protect yourself.`,
    })
  }
  steps.push(rules.exileReturnEnabled
    ? {
        id: 'exile',
        title: 'Voted out is not the end',
        body: rules.exileReturnWeek && rules.exileReturnTokens
          ? `If you are voted out, you go to Exile Island and keep playing to earn tokens. After week ${rules.exileReturnWeek}, the exile with the most tokens returns to the game, as long as they have at least ${rules.exileReturnTokens}.`
          : 'If you are voted out, you go to Exile Island and keep playing to earn tokens. The exile with the most tokens gets one chance to return.',
      }
    : {
        id: 'exile',
        title: 'Voted out is final',
        body: 'This league has no Exile Island. Once you are voted out, you watch the rest of the season, and after the merge you may sit on the jury.',
      })
  steps.push({
    id: 'merge',
    title: 'Merge, jury and finale',
    body: `The tribes merge ${merge}. From then on it is every castaway for themselves, and immunity goes to the top score on the island. Managers voted out after the merge form the jury. ${finale}`,
  })
  return steps
}

/** Shown through the first week of play. Week 0 is the gap between the draft and the first games. */
export function showFirstWeekGuide(week: number | null | undefined, isPlayer: boolean): boolean {
  return isPlayer && (week == null || week <= 1)
}
