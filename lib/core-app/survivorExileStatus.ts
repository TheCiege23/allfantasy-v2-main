/**
 * What an Exile Island row on the rail says instead of "Matchup not available yet": an island has no
 * head-to-head, so the line is your tokens and the way back, or, while you are still in the main
 * game, how many castaways are out on the island.
 */
export type ExileRailStatus =
  | { kind: 'island'; tokens: number; tokensToReturn: number | null; returnWeek: number | null }
  | { kind: 'watching'; onIsland: number }

export type ExileStatusInputs = {
  /** The viewer's player row in the Survivor league, if they have one. */
  viewer: { playerState: string; tokenBalance: number } | null
  /** Managers on the island now (`playerState: 'exile'`). */
  onIsland: number
  exileIslandEnabled: boolean
  exileReturnWeek: number
  exileReturnTokens: number
  /** The season's one scheduled return has already happened. */
  returnResolved: boolean
}

export function exileRailStatus(input: ExileStatusInputs): ExileRailStatus {
  if (input.viewer?.playerState === 'exile') {
    const returnOpen = input.exileIslandEnabled && !input.returnResolved
    return {
      kind: 'island',
      tokens: Math.max(0, input.viewer.tokenBalance),
      tokensToReturn: returnOpen ? input.exileReturnTokens : null,
      returnWeek: returnOpen ? input.exileReturnWeek : null,
    }
  }
  return { kind: 'watching', onIsland: input.onIsland }
}
