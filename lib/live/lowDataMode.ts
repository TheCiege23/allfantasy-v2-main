/**
 * Low-data mode for the live screens: fewer images, less animation, slower polls.
 *
 * These screens are the ones people open on a phone, in a stadium or a bar, on a
 * connection that is already struggling — and they are the most expensive screens
 * in the app by design, polling every 20 seconds and rendering a headshot per
 * rostered player per league.
 *
 * Pure, and outside the server-only loader, like `lockAlerts.ts` and
 * `connectionState.ts`.
 */

export type LowDataSource =
  /** The reader turned it on or off themselves. */
  | 'user'
  /** The browser told us the connection is metered or slow. */
  | 'connection'
  /** Nobody said anything; full fat. */
  | 'default'

export type LowDataDecision = { lowData: boolean; source: LowDataSource }

/**
 * What the browser will tell us, where it tells us anything.
 *
 * ⚠ NULL MEANS UNSUPPORTED, NOT "FINE". The Network Information API is
 * Chromium-only — Safari and Firefox implement none of it — so on a large share
 * of real phones both fields are null and auto-detection simply cannot happen.
 * That is exactly why the manual toggle is not a nicety: for those readers it is
 * the ONLY way in, and a feature that silently does nothing on iOS would be worse
 * than not claiming to have it.
 */
export type ConnectionSignals = {
  /** `navigator.connection.saveData` — the reader's OS-level "Data Saver". */
  saveData: boolean | null
  /** `navigator.connection.effectiveType` — '4g', '3g', '2g', 'slow-2g'. */
  effectiveType: string | null
}

/** Connections we treat as reason enough on their own. */
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g'])

/**
 * How much to slow polling by in low-data mode.
 *
 * Three, so the live cadence goes 20s → 60s rather than off. A live scoreboard
 * that stops updating is not a cheaper live scoreboard, it is a broken one —
 * and `resolveConnectionState` derives its staleness bar from the interval in
 * effect, so the longer cadence widens that bar instead of reporting the feed
 * as delayed for doing what it was told.
 */
export const LOW_DATA_POLL_MULTIPLIER = 3

/**
 * ⚠ AN EXPLICIT CHOICE ALWAYS WINS, IN BOTH DIRECTIONS. A reader who turned the
 * mode OFF on a 3G connection has told us something the radio cannot: that they
 * want the pictures anyway. Re-deciding for them on the next poll — which is what
 * letting `saveData` override a stored `false` would do — is how a setting
 * becomes a thing that fights you.
 */
export function resolveLowDataMode(opts: {
  /** The reader's stored choice, or null when they have never made one. */
  override: boolean | null
  signals: ConnectionSignals
}): LowDataDecision {
  if (opts.override !== null) return { lowData: opts.override, source: 'user' }

  if (opts.signals.saveData === true) return { lowData: true, source: 'connection' }

  const type = opts.signals.effectiveType
  if (type != null && SLOW_EFFECTIVE_TYPES.has(type)) {
    return { lowData: true, source: 'connection' }
  }

  return { lowData: false, source: 'default' }
}

/**
 * Read the signals, or report that we cannot.
 *
 * ⚠ EVERY ACCESS IS GUARDED AND THE WHOLE THING IS WRAPPED. This runs on every
 * reader's browser; `navigator.connection` is absent on most of them, and a
 * hardened or privacy-patched browser can make even the lookup throw. A
 * live-scoring screen must not fail to render over a data-saving hint.
 */
export function readConnectionSignals(): ConnectionSignals {
  try {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
    const conn = nav.connection
    if (!conn) return { saveData: null, effectiveType: null }
    return {
      saveData: typeof conn.saveData === 'boolean' ? conn.saveData : null,
      effectiveType: typeof conn.effectiveType === 'string' ? conn.effectiveType : null,
    }
  } catch {
    return { saveData: null, effectiveType: null }
  }
}

/** Why the mode is on, for the toggle to explain itself. */
export function lowDataExplanation(decision: LowDataDecision): string {
  if (!decision.lowData) return 'Full images and 20-second refresh.'
  return decision.source === 'connection'
    ? 'On automatically — your connection is metered or slow.'
    : 'Fewer images, no animation, slower refresh.'
}
