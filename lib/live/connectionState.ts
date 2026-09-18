/**
 * What the live screens are entitled to claim about their own connection.
 *
 * Before this the badge had two states, Live and Idle, and both described the
 * SLATE rather than the connection. A failed poll was swallowed silently in both
 * clients, so a browser that had lost the network kept saying "Live" over numbers
 * that had stopped moving — the age label was the only tell, and only to someone
 * who happened to be watching it climb.
 *
 * Pure and outside the server-only loader so both surfaces share one answer;
 * same split as `lockAlerts.ts` and `liveTieInGroups.ts`.
 */

export type LiveConnectionState =
  /** The browser says it has no network at all. */
  | 'offline'
  /** A poll failed and we are still retrying. */
  | 'reconnecting'
  /** Polls are landing, a game is in play, and the feed has gone quiet far past cadence. */
  | 'delayed'
  /** A game is in play and the feed is keeping up. */
  | 'live'
  /** Nothing is in play. Not a fault. */
  | 'idle'

export type ConnectionInputs = {
  /**
   * `navigator.onLine`, or null before mount / where it cannot be read.
   *
   * ⚠ ONLY EVER BELIEVED IN THE NEGATIVE, AND THAT IS NOT TIMIDITY. `true` from
   * this API means "an interface is up", which is famously also true on a hotel
   * wifi that has captured the connection and on a LAN with no route out. Acting
   * on `true` would mean asserting a working connection we have not tested.
   * `false` is the reliable half: the browser knows it has no interface at all.
   */
  online: boolean | null
  /** Polls that have failed since the last one that landed. A 304 is a landing. */
  consecutiveFailures: number
  /** Is anything actually in play? */
  anyLive: boolean
  /** Age of the payload on screen, or null when it could not be dated. */
  ageSeconds: number | null
  /** The cadence currently in effect, so the staleness bar tracks it. */
  pollIntervalMs: number
}

/**
 * How many poll intervals of silence make a live feed "delayed".
 *
 * Three, so a single dropped or slow poll does not raise an alarm — two
 * consecutive misses is a pattern, one is a Tuesday.
 */
export const DELAY_INTERVAL_MULTIPLE = 3

export function resolveConnectionState(input: ConnectionInputs): LiveConnectionState {
  // The browser knowing it has no network outranks everything else we might infer.
  if (input.online === false) return 'offline'

  if (input.consecutiveFailures > 0) return 'reconnecting'

  /*
   * ⚠ "DELAYED" REQUIRES A LIVE GAME, AND THAT IS THE WHOLE DESIGN. Since the
   * payload gained a validator, a 304 means the feed was NOT re-read — so on a
   * quiet slate the age climbing is the correct, expected behaviour, not a fault.
   * Flagging it would cry wolf every Tuesday and teach people to ignore the badge
   * by the time it matters on a Sunday.
   *
   * Derived from the interval actually in effect rather than a constant, so a
   * longer cadence (low-data mode) widens the bar instead of accusing the feed of
   * being late for doing exactly what it was told.
   */
  if (
    input.anyLive &&
    input.ageSeconds != null &&
    input.ageSeconds * 1000 > input.pollIntervalMs * DELAY_INTERVAL_MULTIPLE
  ) {
    return 'delayed'
  }

  return input.anyLive ? 'live' : 'idle'
}

/** The word on the badge. */
export function connectionLabel(state: LiveConnectionState): string {
  switch (state) {
    case 'offline':
      return 'Offline'
    case 'reconnecting':
      return 'Reconnecting'
    case 'delayed':
      return 'Delayed'
    case 'live':
      return 'Live'
    case 'idle':
      return 'Idle'
  }
}

/**
 * The sentence under it, when there is something worth saying.
 *
 * ⚠ EACH ONE SAYS WHAT IS STILL TRUE OF WHAT IS ON SCREEN. A connection notice
 * that only announced the fault would leave the reader guessing whether the
 * numbers in front of them are real; they ARE real, they are simply old, and
 * saying so is the difference between a warning and a scare.
 */
export function connectionDetail(state: LiveConnectionState): string | null {
  switch (state) {
    case 'offline':
      return 'No connection — these scores are the last we received.'
    case 'reconnecting':
      return 'Trying to reach the feed. Showing the last scores we received.'
    case 'delayed':
      return 'The feed has not updated for a while. These scores may be behind.'
    default:
      return null
  }
}

/** True when the state is a fault the reader should be told about. */
export function isConnectionFault(state: LiveConnectionState): boolean {
  return state === 'offline' || state === 'reconnecting' || state === 'delayed'
}
