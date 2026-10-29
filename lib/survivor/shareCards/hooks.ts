/**
 * Engine hooks for Survivor share moments. Each is fire-and-forget: it runs after the engine's own
 * commit, loads the capture module lazily (so engine modules do not pull in the share code at
 * import time), and swallows failures — a share card must never fail a game transition. The lazy
 * `syncLeagueShareMoments` backstop creates anything a hook missed.
 */
type CaptureModule = typeof import('./momentCapture')

function queue(task: (capture: CaptureModule) => Promise<unknown>): void {
  void import('./momentCapture')
    .then(task)
    .catch((error: unknown) => {
      console.warn('[survivor-share] moment capture failed:', error instanceof Error ? error.message : 'unknown error')
    })
}

/** Torch Ceremony published: the out card (eliminated manager) and any played-idol cards. */
export function afterCouncilRevealed(leagueId: string, councilId: string): void {
  queue(capture => capture.captureCouncilShareMoments(leagueId, councilId))
}

/** Week scores went final: the immunity card. */
export function afterWeeklyScoresFinalized(leagueId: string, week: number): void {
  queue(capture => capture.captureImmunityShareMoment(leagueId, week))
}

/** The scheduled Exile return settled. */
export function afterExileReturnResolved(leagueId: string): void {
  queue(capture => capture.captureExileReturnShareMoments(leagueId))
}

/** The final jury vote crowned a winner. */
export function afterWinnerCrowned(leagueId: string): void {
  queue(capture => capture.captureChampionShareMoment(leagueId))
}
